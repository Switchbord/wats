// WATS-151 — WhatsApp Flow media-upload (PhotoPicker / DocumentPicker)
// AES-256-CBC + HMAC-SHA256 + PKCS#7 decryption runtime.
//
// Pure, framework-agnostic implementation of Meta's Flow media-upload crypto
// (REFERENCE-151). The CDN file downloaded from `cdn_url` is structured as
// `ciphertext ‖ hmac10`, where `hmac10` is the first 10 bytes of
// HMAC-SHA256(hmac_key, iv ‖ ciphertext). All key material arrives in
// plaintext base64 inside the Flow request's `encryption_metadata` object
// (no RSA wrap, no KDF). All crypto is delegated to an injected
// CryptoProvider — this module never reaches for node:crypto or SubtleCrypto
// directly, and never logs or echoes the AES key, IV, HMAC key, or decrypted
// plaintext.
//
// Order of operations (STRICT — verify MAC BEFORE decrypt):
//   1. ciphertext = cdnFile[:-10]; hmac10 = cdnFile[-10:]
//   2. VERIFY base64(SHA256(cdnFile)) == encrypted_hash   [full file]
//   3. VERIFY HMAC-SHA256(hmacKey, iv ‖ ciphertext)[:10] == hmac10
//   4. AES-256-CBC decrypt ciphertext → padded plaintext
//   5. PKCS#7 unpad (16-byte block) — automatic in the provider
//   6. VERIFY base64(SHA256(plaintext)) == plaintext_hash
//   7. RETURN plaintext (raw Uint8Array)
//
// This is NOT the Flow data-channel AES-GCM scheme (WATS-76). There is no
// RSA-OAEP key wrap here.

import type { CryptoProvider } from "@wats/crypto";
import { flowIsPlainObject } from "./shared.js";

// ── Limits ──────────────────────────────────────────────────────────────────

/**
 * Maximum accepted size of a downloaded CDN media file, in bytes (25 MiB).
 * Meta's Flow media-upload cap is 25 MiB; this finite bound prevents a hostile
 * or oversized `cdnFile` from driving unbounded allocation or hashing work.
 */
export const FLOW_MEDIA_MAX_BYTES = 26_214_400;

/**
 * Maximum encoded length accepted for any single base64 field in
 * `encryption_metadata`. base64 expands by ~4/3, so 256 bytes of decoded
 * material (more than enough for a 32-byte key + headroom) bounds the encoded
 * side; a hostile body cannot drive a pathological decode.
 */
const FLOW_MEDIA_MAX_BASE64_FIELD_LENGTH = 256;

// The 10-byte truncated HMAC tag appended to the CDN ciphertext.
const FLOW_MEDIA_HMAC_TAG_LENGTH = 10;

// AES-CBC block size (16 bytes / 128 bits). The CDN file must hold at least
// one ciphertext block plus the 10-byte HMAC trailer to be structurally valid.
const FLOW_MEDIA_AES_BLOCK_SIZE = 16;

// ── Typed errors ─────────────────────────────────────────────────────────────

/**
 * Thrown by `decryptFlowMedia` / `decryptFlowMediaFile` for ANY failure on the
 * decrypt path — missing or malformed fields, invalid base64, wrong key/IV
 * length, hash mismatch, HMAC mismatch, AES failure, bad PKCS#7 padding, or a
 * plaintext-hash mismatch. Carries no key/IV/plaintext/tag material; the
 * `cause` is preserved for server-side diagnostics but the public message is a
 * FIXED string so nothing sensitive is leaked.
 */
export class FlowMediaDecryptionError extends Error {
  override readonly cause?: unknown;
  constructor(cause?: unknown) {
    super("Flow media could not be decrypted");
    this.name = "FlowMediaDecryptionError";
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Thrown when the injected CryptoProvider lacks a capability the media-upload
 * runtime requires (`sha256`, `hmacSha256`, `timingSafeEqual`, or
 * `aesCbcDecrypt`). This is a server-side misconfiguration, distinct from a
 * malformed inbound payload.
 */
export class FlowMediaCryptoUnavailableError extends Error {
  constructor(capability: string) {
    super(`CryptoProvider does not implement required capability: ${capability}`);
    this.name = "FlowMediaCryptoUnavailableError";
  }
}

// ── Wire types ───────────────────────────────────────────────────────────────

/**
 * The `encryption_metadata` object Meta sends inside each per-file Flow media
 * dict. All five fields are base64 strings; Meta uses these exact snake_case
 * keys on the wire (kept snake_case to match, like `EncryptedFlowRequestWire`).
 *
 * Decoded byte lengths: `iv` = 16, `encryption_key` = 32, `hmac_key` = 32,
 * `encrypted_hash` = 32 (base64(SHA256(full cdn_file))),
 * `plaintext_hash` = 32 (base64(SHA256(unpadded plaintext))).
 */
export interface FlowMediaEncryptionMetadata {
  readonly iv: string;
  readonly encryption_key: string;
  readonly hmac_key: string;
  readonly encrypted_hash: string;
  readonly plaintext_hash: string;
}

/**
 * One per-file dict from the Flow request's `data[key]` array (e.g.
 * `data.photo_picker[index]`). `media_id`, `cdn_url`, and `file_name` are
 * sibling string fields to `encryption_metadata`.
 */
export interface FlowMediaEncryptedFile {
  readonly media_id: string;
  readonly cdn_url: string;
  readonly file_name: string;
  readonly encryption_metadata: FlowMediaEncryptionMetadata;
}

/**
 * The decrypted result for a single media file: the raw plaintext bytes plus
 * the identifying metadata the caller needs to persist the file. Mirrors
 * pywa's `FlowRequestDecryptedMedia` frozen dataclass
 * (`{ media_id, filename, data }`).
 */
export interface DecryptedFlowMedia {
  readonly mediaId: string;
  readonly filename: string;
  readonly data: Uint8Array;
}

// ── base64 helpers (strict, fail-closed) ─────────────────────────────────────

const TEXT_ENCODER = new TextEncoder();

function decodeBase64Field(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0
  ) {
    throw new FlowMediaDecryptionError();
  }
  if (value.length > FLOW_MEDIA_MAX_BASE64_FIELD_LENGTH) {
    throw new FlowMediaDecryptionError();
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch (cause) {
    throw new FlowMediaDecryptionError(cause);
  }
  if (binary.length === 0) {
    throw new FlowMediaDecryptionError();
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

// ── metadata validation ──────────────────────────────────────────────────────

function assertMetadataShape(
  metadata: unknown
): asserts metadata is FlowMediaEncryptionMetadata {
  if (!flowIsPlainObject(metadata)) {
    throw new FlowMediaDecryptionError();
  }
  const record = metadata as Record<string, unknown>;
  const requiredKeys: ReadonlyArray<keyof FlowMediaEncryptionMetadata> = [
    "iv",
    "encryption_key",
    "hmac_key",
    "encrypted_hash",
    "plaintext_hash"
  ];
  for (const key of requiredKeys) {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new FlowMediaDecryptionError();
    }
  }
}

// ── decryptFlowMedia ─────────────────────────────────────────────────────────

/**
 * Decrypt a Flow media-upload CDN file (REFERENCE-151 §7).
 *
 * Steps:
 *   1. Validate `cdnFile` is a non-empty Uint8Array ≤ FLOW_MEDIA_MAX_BYTES and
 *      long enough to hold one AES block + the 10-byte HMAC trailer
 *      (≥ 26 bytes).
 *   2. Validate `metadata` is a plain object with all five non-empty string
 *      fields; base64-decode `iv`/`encryption_key`/`hmac_key` and verify their
 *      decoded lengths (16/32/32).
 *   3. Split `ciphertext = cdnFile[:-10]`, `hmac10 = cdnFile[-10:]`.
 *   4. VERIFY `base64(SHA256(cdnFile)) == metadata.encrypted_hash` (full file).
 *   5. VERIFY `HMAC-SHA256(hmacKey, iv ‖ ciphertext)[:10] == hmac10`.
 *   6. `plaintext = crypto.aesCbcDecrypt(encryptionKey, iv, ciphertext)`
 *      (PKCS#7 unpad is automatic in the provider).
 *   7. VERIFY `base64(SHA256(plaintext)) == metadata.plaintext_hash`.
 *   8. RETURN the raw plaintext Uint8Array.
 *
 * ALL three verifications use `crypto.timingSafeEqual` (constant-time) — a
 * strict improvement over pywa's non-constant-time `!=`. On ANY failure throws
 * {@link FlowMediaDecryptionError} (fixed message, no secret echo); a missing
 * provider capability throws {@link FlowMediaCryptoUnavailableError}. Never
 * throws a host TypeError/RangeError.
 */
export async function decryptFlowMedia(
  crypto: CryptoProvider,
  cdnFile: Uint8Array,
  metadata: FlowMediaEncryptionMetadata
): Promise<Uint8Array> {
  // Capability check up front — a missing capability is a server-side
  // misconfiguration, surfaced as FlowMediaCryptoUnavailableError (not the
  // fixed-string decryption error).
  if (typeof crypto.sha256 !== "function") {
    throw new FlowMediaCryptoUnavailableError("sha256");
  }
  if (typeof crypto.hmacSha256 !== "function") {
    throw new FlowMediaCryptoUnavailableError("hmacSha256");
  }
  if (typeof crypto.timingSafeEqual !== "function") {
    throw new FlowMediaCryptoUnavailableError("timingSafeEqual");
  }
  if (typeof crypto.aesCbcDecrypt !== "function") {
    throw new FlowMediaCryptoUnavailableError("aesCbcDecrypt");
  }

  // cdnFile validation.
  if (!(cdnFile instanceof Uint8Array)) {
    throw new FlowMediaDecryptionError();
  }
  if (cdnFile.byteLength === 0) {
    throw new FlowMediaDecryptionError();
  }
  if (cdnFile.byteLength > FLOW_MEDIA_MAX_BYTES) {
    throw new FlowMediaDecryptionError();
  }
  // Must hold at least one 16-byte AES block plus the 10-byte HMAC trailer.
  if (cdnFile.byteLength < FLOW_MEDIA_AES_BLOCK_SIZE + FLOW_MEDIA_HMAC_TAG_LENGTH) {
    throw new FlowMediaDecryptionError();
  }

  // metadata shape validation (plain object, all five non-empty string fields).
  assertMetadataShape(metadata);

  // base64-decode the three key/IV fields and verify decoded lengths.
  let iv: Uint8Array;
  let encryptionKey: Uint8Array;
  let hmacKey: Uint8Array;
  try {
    iv = decodeBase64Field(metadata.iv);
    encryptionKey = decodeBase64Field(metadata.encryption_key);
    hmacKey = decodeBase64Field(metadata.hmac_key);
  } catch (cause) {
    if (cause instanceof FlowMediaCryptoUnavailableError) throw cause;
    throw new FlowMediaDecryptionError(cause);
  }
  if (iv.byteLength !== FLOW_MEDIA_AES_BLOCK_SIZE) {
    throw new FlowMediaDecryptionError();
  }
  if (encryptionKey.byteLength !== 32) {
    throw new FlowMediaDecryptionError();
  }
  if (hmacKey.byteLength !== 32) {
    throw new FlowMediaDecryptionError();
  }

  // 1. Split ciphertext and hmac10.
  const ciphertext = cdnFile.subarray(
    0,
    cdnFile.byteLength - FLOW_MEDIA_HMAC_TAG_LENGTH
  );
  const hmac10 = cdnFile.subarray(
    cdnFile.byteLength - FLOW_MEDIA_HMAC_TAG_LENGTH
  );

  // 2. VERIFY base64(SHA256(cdnFile)) == encrypted_hash. Compare on the base64
  //    STRING bytes (constant-time on the ASCII string avoids re-decoding the
  //    hash field and sidesteps base64 canonicalization concerns).
  let encHash: Uint8Array;
  try {
    encHash = await crypto.sha256(cdnFile);
  } catch (cause) {
    throw new FlowMediaDecryptionError(cause);
  }
  const encHashB64Bytes = TEXT_ENCODER.encode(encodeBase64(encHash));
  const expectedEncHashB64Bytes = TEXT_ENCODER.encode(metadata.encrypted_hash);
  if (!crypto.timingSafeEqual(encHashB64Bytes, expectedEncHashB64Bytes)) {
    throw new FlowMediaDecryptionError();
  }

  // 3. VERIFY HMAC-SHA256(hmacKey, iv ‖ ciphertext)[:10] == hmac10.
  const macInput = concatBytes(iv, ciphertext);
  let macFull: Uint8Array;
  try {
    macFull = await crypto.hmacSha256(hmacKey, macInput);
  } catch (cause) {
    throw new FlowMediaDecryptionError(cause);
  }
  const mac10 = macFull.subarray(0, FLOW_MEDIA_HMAC_TAG_LENGTH);
  if (!crypto.timingSafeEqual(mac10, hmac10)) {
    throw new FlowMediaDecryptionError();
  }

  // 4-5. AES-256-CBC decrypt → PKCS#7 unpadded plaintext.
  let plaintext: Uint8Array;
  try {
    plaintext = await crypto.aesCbcDecrypt(encryptionKey, iv, ciphertext);
  } catch (cause) {
    throw new FlowMediaDecryptionError(cause);
  }

  // 6. VERIFY base64(SHA256(plaintext)) == plaintext_hash.
  let ptHash: Uint8Array;
  try {
    ptHash = await crypto.sha256(plaintext);
  } catch (cause) {
    throw new FlowMediaDecryptionError(cause);
  }
  const ptHashB64Bytes = TEXT_ENCODER.encode(encodeBase64(ptHash));
  const expectedPtHashB64Bytes = TEXT_ENCODER.encode(metadata.plaintext_hash);
  if (!crypto.timingSafeEqual(ptHashB64Bytes, expectedPtHashB64Bytes)) {
    throw new FlowMediaDecryptionError();
  }

  // 7. RETURN the raw plaintext.
  return plaintext;
}

// ── decryptFlowMediaFile (thin wrapper) ──────────────────────────────────────

/**
 * Validate a per-file media dict (`media_id` / `cdn_url` / `file_name` /
 * `encryption_metadata`) and delegate to {@link decryptFlowMedia}. Returns a
 * {@link DecryptedFlowMedia} carrying the media id, filename, and raw
 * plaintext bytes — mirroring pywa's `FlowRequestDecryptedMedia`.
 *
 * `cdn_url` is NOT fetched here — the caller downloads the CDN file and passes
 * the raw bytes as `cdnFile`. This keeps the function pure and transport-
 * agnostic (no live Meta calls, no network inside the crypto path).
 */
export async function decryptFlowMediaFile(
  crypto: CryptoProvider,
  encryptedFile: FlowMediaEncryptedFile,
  cdnFile: Uint8Array
): Promise<DecryptedFlowMedia> {
  if (!flowIsPlainObject(encryptedFile)) {
    throw new FlowMediaDecryptionError();
  }
  const record = encryptedFile as Record<string, unknown>;
  const mediaId = record.media_id;
  const fileName = record.file_name;
  const metadata = record.encryption_metadata;
  if (typeof mediaId !== "string" || mediaId.length === 0) {
    throw new FlowMediaDecryptionError();
  }
  if (typeof fileName !== "string" || fileName.length === 0) {
    throw new FlowMediaDecryptionError();
  }
  // `cdn_url` presence is required by the wire shape but not used by the
  // crypto path; validate it is a non-empty string for shape parity.
  const cdnUrl = record.cdn_url;
  if (typeof cdnUrl !== "string" || cdnUrl.length === 0) {
    throw new FlowMediaDecryptionError();
  }
  const data = await decryptFlowMedia(
    crypto,
    cdnFile,
    metadata as FlowMediaEncryptionMetadata
  );
  return { mediaId, filename: fileName, data };
}
