// @wats/crypto — CryptoProvider interface and capability types.

export type CryptoProviderCapability =
  | "hmacSha256"
  | "timingSafeEqual"
  | "randomBytes"
  | "rsaOaepDecrypt"
  | "aesGcmDecrypt"
  | "aesGcmEncrypt"
  | "sha256"
  | "aesCbcDecrypt";

export interface CryptoValidationErrorShape {
  readonly code:
    | "invalid_key"
    | "invalid_body"
    | "invalid_length"
    | "unsupported_capability";
  readonly message: string;
}

export interface CryptoProvider {
  readonly name: string;
  hmacSha256(
    key: Uint8Array | string,
    body: Uint8Array | string
  ): Promise<Uint8Array>;
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  randomBytes(byteLength: number): Promise<Uint8Array>;
  // Forward-declared optional methods — implementation arrives with Flows / Media.
  //
  // rsaOaepDecrypt: RSA-OAEP decryption with MGF1 + OAEP hash both SHA-256
  // and an empty label (matches the WhatsApp Flow encrypted-data-channel
  // scheme). `privateKey` accepts a PEM-encoded PKCS#8 key (as a string or
  // its UTF-8 bytes in a Uint8Array) or a JSON Web Key. Rejects with
  // InvalidKeyError for a malformed/unsupported key and InvalidBodyError
  // for a ciphertext that does not decrypt under the key.
  rsaOaepDecrypt?(
    privateKey: JsonWebKey | Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;
  // aesGcmDecrypt: AES-GCM decryption. CONTRACT — the auth tag is the LAST
  // 16 bytes of `ciphertext` (tag = ciphertext[-16:], body = ciphertext[:-16]),
  // matching the Flow scheme where the 16-byte GCM tag is appended after the
  // ciphertext. No AAD is used by the Flow scheme, but `aad` is accepted for
  // generality. AES-128-GCM vs AES-256-GCM is selected by key length
  // (16 → 128, 32 → 256). Rejects with InvalidKeyError (bad key length),
  // InvalidLengthError (bad IV length or ciphertext shorter than the 16-byte
  // tag), and InvalidBodyError (authentication failure / malformed body).
  aesGcmDecrypt?(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    aad?: Uint8Array
  ): Promise<Uint8Array>;
  // aesGcmEncrypt: AES-GCM encryption. RETURN SHAPE — the ciphertext and the
  // 16-byte auth tag are returned SEPARATELY as `{ ciphertext, authTag }`;
  // callers concatenate them (`ciphertext` followed by `authTag`) per the
  // Flow response scheme. AES-128/256-GCM is selected by key length
  // (16 → 128, 32 → 256). No AAD is used by the Flow scheme, but `aad` is
  // accepted for generality. Rejects with InvalidKeyError (bad key length),
  // InvalidLengthError (bad IV length), and InvalidBodyError (other failures).
  aesGcmEncrypt?(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
    aad?: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; authTag: Uint8Array }>;
  // sha256: SHA-256 digest. Returns a fresh 32-byte Uint8Array. Rejects with
  // CryptoProviderError (invalid_body) for a non-Uint8Array input — never a
  // raw TypeError. Used by the Flow media-upload scheme (WATS-151) for the
  // encrypted_hash and plaintext_hash integrity checks.
  sha256?(data: Uint8Array): Promise<Uint8Array>;
  // aesCbcDecrypt: AES-CBC decryption with automatic PKCS#7 unpadding
  // (16-byte block size, matching the Flow media-upload scheme, WATS-151).
  // CONTRACT — AES-128-CBC vs AES-256-CBC is selected by key length
  // (16 → 128, 32 → 256); the IV must be exactly 16 bytes; PKCS#7 unpadding
  // is automatic (Node `setAutoPadding(true)` default / WebCrypto native) and
  // the returned Uint8Array is the unpadded plaintext. Rejects with
  // InvalidKeyError (bad key length), InvalidLengthError (bad IV length /
  // ciphertext not a multiple of 16 / ciphertext empty), and InvalidBodyError
  // (bad PKCS#7 padding / decryption failure). No AAD — CBC has no auth tag;
  // callers MUST verify an external MAC (e.g. HMAC-SHA256) BEFORE trusting
  // the plaintext.
  aesCbcDecrypt?(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;
}

// Sentinel runtime export so consumer fixtures / importability tests can
// confirm the module is wired through the package specifier. Runtime
// behavior lives in the adapters / factory — this is a type-only module.
export const WATS_CRYPTO_PROVIDER_EXPORTS = [
  "CryptoProvider",
  "CryptoProviderCapability",
  "CryptoValidationErrorShape"
] as const;
