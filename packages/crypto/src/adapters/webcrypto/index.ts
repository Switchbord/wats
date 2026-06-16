// @wats/crypto — WebCrypto adapter.
//
// Uses globalThis.crypto.subtle only — NO `node:*` imports. Works
// unchanged on Bun, modern Node (>= 20), Deno, Cloudflare Workers,
// Vercel Edge, and any browser / WinterCG runtime exposing
// SubtleCrypto.

import type { CryptoProvider } from "../../provider.js";
import {
  CryptoProviderError,
  InvalidBodyError,
  InvalidKeyError,
  UnsupportedCapabilityError,
  GCM_TAG_LENGTH,
  assertAesGcmKey,
  assertFiniteLength,
  assertGcmIv,
  assertOptionalAad,
  assertUint8Array,
  assertValidBody,
  assertValidKey
} from "../../errors.js";

const MAX_RANDOM_BYTES = 1_048_576;
const TEXT_ENCODER = new TextEncoder();

function toUint8Array(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return TEXT_ENCODER.encode(value);
}

export async function createWebCryptoProvider(): Promise<CryptoProvider> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new UnsupportedCapabilityError(
      "globalThis.crypto.subtle is not available in this runtime"
    );
  }
  const cryptoObj = globalThis.crypto;
  if (cryptoObj === undefined || typeof cryptoObj.getRandomValues !== "function") {
    throw new UnsupportedCapabilityError(
      "globalThis.crypto.getRandomValues is not available"
    );
  }

  async function hmacSha256(
    key: Uint8Array | string,
    body: Uint8Array | string
  ): Promise<Uint8Array> {
    assertValidKey(key);
    assertValidBody(body);
    const keyBytes = toUint8Array(key);
    const bodyBytes = toUint8Array(body);
    let cryptoKey: CryptoKey;
    try {
      cryptoKey = await subtle.importKey(
        "raw",
        keyBytes as BufferSource,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
    } catch (err) {
      throw new CryptoProviderError(
        "invalid_key",
        `hmacSha256 importKey failed: ${stringifyError(err)}`,
        { cause: err }
      );
    }
    let signature: ArrayBuffer;
    try {
      signature = await subtle.sign("HMAC", cryptoKey, bodyBytes as BufferSource);
    } catch (err) {
      throw new CryptoProviderError(
        "invalid_body",
        `hmacSha256 sign failed: ${stringifyError(err)}`,
        { cause: err }
      );
    }
    return new Uint8Array(signature);
  }

  function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    assertUint8Array(a, "timingSafeEqual `a`");
    assertUint8Array(b, "timingSafeEqual `b`");
    // Length gate first (constant-time comparison is not meaningful
    // between differently-sized buffers; the length itself is public).
    if (a.byteLength !== b.byteLength) {
      return false;
    }
    // Constant-time XOR accumulator. Loop always runs over the full
    // length without an early-exit branch, so the wall-clock time
    // depends only on the (public) length, not on the position of the
    // first differing byte.
    let diff = 0;
    for (let i = 0; i < a.byteLength; i += 1) {
      diff |= (a[i] as number) ^ (b[i] as number);
    }
    return diff === 0;
  }

  async function randomBytes(byteLength: number): Promise<Uint8Array> {
    assertFiniteLength(byteLength, 1, MAX_RANDOM_BYTES);
    const out = new Uint8Array(byteLength);
    cryptoObj.getRandomValues(out);
    return out;
  }

  // Import an RSA-OAEP (SHA-256) private key for decryption. Accepts a JWK or
  // a PEM-encoded PKCS#8 key (string bytes in a Uint8Array). Any failure maps
  // to InvalidKeyError so a raw SubtleCrypto/DOMException never escapes.
  async function importRsaPrivateKey(
    privateKey: JsonWebKey | Uint8Array
  ): Promise<CryptoKey> {
    try {
      if (privateKey instanceof Uint8Array) {
        const der = pemToDer(new TextDecoder().decode(privateKey));
        return await subtle.importKey(
          "pkcs8",
          der as BufferSource,
          { name: "RSA-OAEP", hash: "SHA-256" },
          false,
          ["decrypt"]
        );
      }
      if (
        privateKey !== null &&
        typeof privateKey === "object" &&
        !Array.isArray(privateKey)
      ) {
        return await subtle.importKey(
          "jwk",
          privateKey,
          { name: "RSA-OAEP", hash: "SHA-256" },
          false,
          ["decrypt"]
        );
      }
      throw new InvalidKeyError(
        "rsaOaepDecrypt privateKey must be a PEM string/Uint8Array or a JsonWebKey"
      );
    } catch (err) {
      if (err instanceof CryptoProviderError) throw err;
      throw new InvalidKeyError(
        `rsaOaepDecrypt could not import private key: ${stringifyError(err)}`,
        { cause: err }
      );
    }
  }

  async function rsaOaepDecrypt(
    privateKey: JsonWebKey | Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array> {
    assertUint8Array(ciphertext, "rsaOaepDecrypt `ciphertext`");
    const key = await importRsaPrivateKey(privateKey);
    try {
      const plain = await subtle.decrypt(
        { name: "RSA-OAEP" },
        key,
        ciphertext as BufferSource
      );
      return new Uint8Array(plain);
    } catch (err) {
      throw new InvalidBodyError(
        "rsaOaepDecrypt failed: ciphertext could not be decrypted",
        { cause: err }
      );
    }
  }

  async function importAesKey(
    key: Uint8Array,
    usage: "encrypt" | "decrypt"
  ): Promise<CryptoKey> {
    // Key length already validated (16 or 32 bytes) by assertAesGcmKey;
    // WebCrypto selects AES-128 vs AES-256-GCM from the raw key length.
    try {
      return await subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [
        usage
      ]);
    } catch (err) {
      throw new InvalidKeyError(
        `aesGcm importKey failed: ${stringifyError(err)}`,
        { cause: err }
      );
    }
  }

  async function aesGcmDecrypt(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    aad?: Uint8Array
  ): Promise<Uint8Array> {
    assertAesGcmKey(key);
    assertGcmIv(iv);
    assertUint8Array(ciphertext, "aesGcmDecrypt `ciphertext`");
    assertOptionalAad(aad);
    // CONTRACT: the auth tag is the LAST 16 bytes of `ciphertext`. WebCrypto's
    // AES-GCM decrypt expects the ciphertext WITH the tag appended, which is
    // exactly the contract's input shape — so we pass `ciphertext` through.
    if (ciphertext.byteLength < GCM_TAG_LENGTH) {
      throw new InvalidBodyError(
        `aesGcmDecrypt ciphertext must be at least ${GCM_TAG_LENGTH} bytes (tag); got ${ciphertext.byteLength}`
      );
    }
    const cryptoKey = await importAesKey(key, "decrypt");
    try {
      const params: AesGcmParams = {
        name: "AES-GCM",
        iv: iv as BufferSource,
        tagLength: GCM_TAG_LENGTH * 8
      };
      if (aad !== undefined && aad.byteLength > 0) {
        params.additionalData = aad as BufferSource;
      }
      const plain = await subtle.decrypt(
        params,
        cryptoKey,
        ciphertext as BufferSource
      );
      return new Uint8Array(plain);
    } catch (err) {
      throw new InvalidBodyError(
        "aesGcmDecrypt failed: authentication or decryption error",
        { cause: err }
      );
    }
  }

  async function aesGcmEncrypt(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
    aad?: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; authTag: Uint8Array }> {
    assertAesGcmKey(key);
    assertGcmIv(iv);
    assertUint8Array(plaintext, "aesGcmEncrypt `plaintext`");
    assertOptionalAad(aad);
    const cryptoKey = await importAesKey(key, "encrypt");
    try {
      const params: AesGcmParams = {
        name: "AES-GCM",
        iv: iv as BufferSource,
        tagLength: GCM_TAG_LENGTH * 8
      };
      if (aad !== undefined && aad.byteLength > 0) {
        params.additionalData = aad as BufferSource;
      }
      // WebCrypto returns ciphertext WITH the 16-byte tag appended; split it
      // into the separate { ciphertext, authTag } shape of the public contract.
      const combined = new Uint8Array(
        await subtle.encrypt(params, cryptoKey, plaintext as BufferSource)
      );
      const split = combined.byteLength - GCM_TAG_LENGTH;
      return {
        ciphertext: combined.slice(0, split),
        authTag: combined.slice(split)
      };
    } catch (err) {
      throw new InvalidBodyError(`aesGcmEncrypt failed: ${stringifyError(err)}`, {
        cause: err
      });
    }
  }

  return {
    name: "webcrypto",
    hmacSha256,
    timingSafeEqual,
    randomBytes,
    rsaOaepDecrypt,
    aesGcmDecrypt,
    aesGcmEncrypt
  };
}

// Convert a PEM-encoded key (PKCS#8 "BEGIN PRIVATE KEY") into raw DER bytes.
// Throws InvalidKeyError on a malformed PEM so a raw atob/TypeError never
// escapes the public surface.
function pemToDer(pem: string): Uint8Array {
  const match = pem.match(
    /-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/
  );
  if (match === null) {
    throw new InvalidKeyError("rsaOaepDecrypt PEM is missing BEGIN/END markers");
  }
  const b64 = (match[1] ?? "").replace(/[\r\n\s]/g, "");
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch (err) {
    throw new InvalidKeyError("rsaOaepDecrypt PEM body is not valid base64", {
      cause: err
    });
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
