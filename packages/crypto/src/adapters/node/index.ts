// @wats/crypto — Node/Bun adapter.
//
// IMPORTANT: this module MUST NOT statically import `node:crypto`. The
// import happens inside `createNodeCryptoProvider` so the module is
// tree-shakable and edge-portable on Workers / Deno, where `node:*`
// specifiers are rejected by the bundler or the runtime loader. The
// workspace-policy test (packages/testing/tests/workspace-policy.test.ts)
// enforces the "no top-level node:* imports outside
// packages/crypto/src/adapters/node/" invariant; even here, we use a
// *dynamic* import to keep behavior consistent across adapters.

import type { CryptoProvider } from "../../provider.js";
import {
  CryptoProviderError,
  InvalidBodyError,
  InvalidKeyError,
  UnsupportedCapabilityError,
  GCM_TAG_LENGTH,
  assertAesCbcKey,
  assertAesGcmKey,
  assertCbcCiphertext,
  assertCbcIv,
  assertFiniteLength,
  assertGcmIv,
  assertOptionalAad,
  assertUint8Array,
  assertValidBody,
  assertValidKey
} from "../../errors.js";

interface NodeHmac {
  update(data: Uint8Array | string): { digest(): Uint8Array };
}

interface NodeKeyObject {
  readonly type: string;
}

interface NodeDecipher {
  setAuthTag(tag: Uint8Array): void;
  update(data: Uint8Array): Uint8Array;
  final(): Uint8Array;
}

interface NodeCipher {
  update(data: Uint8Array): Uint8Array;
  final(): Uint8Array;
  getAuthTag(): Uint8Array;
}

interface NodeCryptoModule {
  createHmac(algorithm: string, key: Uint8Array | string): NodeHmac;
  createHash(algorithm: string): NodeHash;
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  randomBytes(size: number): Uint8Array;
  privateDecrypt(
    options: {
      key: NodeKeyObject;
      padding: number;
      oaepHash: string;
    },
    buffer: Uint8Array
  ): Uint8Array;
  createPrivateKey(input: unknown): NodeKeyObject;
  createDecipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array
  ): NodeDecipher;
  createCipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array
  ): NodeCipher;
  readonly constants: { readonly RSA_PKCS1_OAEP_PADDING: number };
}

interface NodeHash {
  update(data: Uint8Array): { digest(): Uint8Array };
}

const MAX_RANDOM_BYTES = 1_048_576;

export async function createNodeCryptoProvider(): Promise<CryptoProvider> {
  let nodeCrypto: NodeCryptoModule;
  try {
    // Dynamic import: kept OUT of the module's static import graph so
    // Workers/Deno bundlers don't need to resolve `node:crypto`. The
    // specifier is constructed through a variable to prevent TS from
    // type-checking it against `@types/node` (not installed here) and
    // to stop bundlers from statically analyzing it.
    const nodeCryptoSpecifier = "node:crypto";
    const mod = (await import(/* @vite-ignore */ nodeCryptoSpecifier)) as unknown;
    nodeCrypto = mod as NodeCryptoModule;
  } catch (err) {
    throw new UnsupportedCapabilityError(
      "node:crypto is not available in this runtime",
      { cause: err }
    );
  }

  async function hmacSha256(
    key: Uint8Array | string,
    body: Uint8Array | string
  ): Promise<Uint8Array> {
    assertValidKey(key);
    assertValidBody(body);
    try {
      const hmac = nodeCrypto.createHmac("sha256", key);
      const digest = hmac.update(body).digest();
      // digest is a Buffer; copy to a plain Uint8Array so the returned
      // value doesn't leak Node's Buffer identity across the seam.
      return new Uint8Array(
        digest.buffer,
        digest.byteOffset,
        digest.byteLength
      ).slice();
    } catch (err) {
      if (err instanceof CryptoProviderError) {
        throw err;
      }
      throw new CryptoProviderError(
        "invalid_body",
        `hmacSha256 failed: ${stringifyError(err)}`,
        { cause: err }
      );
    }
  }

  function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    assertUint8Array(a, "timingSafeEqual `a`");
    assertUint8Array(b, "timingSafeEqual `b`");
    if (a.byteLength !== b.byteLength) {
      return false;
    }
    if (a.byteLength === 0) {
      return true;
    }
    return nodeCrypto.timingSafeEqual(a, b);
  }

  async function randomBytes(byteLength: number): Promise<Uint8Array> {
    assertFiniteLength(byteLength, 1, MAX_RANDOM_BYTES);
    const buf = nodeCrypto.randomBytes(byteLength);
    // Copy to a detached Uint8Array to sever Buffer identity.
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  }

  // Build a Node KeyObject from a JWK or a PEM key (string or its UTF-8
  // bytes in a Uint8Array). Any failure is mapped to InvalidKeyError so a
  // raw node error never escapes.
  function toPrivateKeyObject(
    privateKey: JsonWebKey | Uint8Array
  ): NodeKeyObject {
    try {
      if (privateKey instanceof Uint8Array) {
        const pem = new TextDecoder().decode(privateKey);
        return nodeCrypto.createPrivateKey({ key: pem, format: "pem" } as unknown);
      }
      if (
        privateKey !== null &&
        typeof privateKey === "object" &&
        !Array.isArray(privateKey)
      ) {
        return nodeCrypto.createPrivateKey({
          key: privateKey,
          format: "jwk"
        } as unknown);
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
    const keyObject = toPrivateKeyObject(privateKey);
    try {
      const out = nodeCrypto.privateDecrypt(
        {
          key: keyObject,
          padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256"
        },
        ciphertext
      );
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength).slice();
    } catch (err) {
      // A ciphertext that does not decrypt under the key (wrong key, wrong
      // padding, corrupted bytes) surfaces as a body problem, not a key one.
      throw new InvalidBodyError(
        `rsaOaepDecrypt failed: ciphertext could not be decrypted`,
        { cause: err }
      );
    }
  }

  function algoForBits(bits: 128 | 256): string {
    return bits === 128 ? "aes-128-gcm" : "aes-256-gcm";
  }

  function cbcAlgoForBits(bits: 128 | 256): string {
    return bits === 128 ? "aes-128-cbc" : "aes-256-cbc";
  }

  async function sha256(data: Uint8Array): Promise<Uint8Array> {
    assertUint8Array(data, "sha256 `data`");
    try {
      const digest = nodeCrypto.createHash("sha256").update(data).digest();
      // Sever Buffer identity so the returned value is a plain Uint8Array.
      return new Uint8Array(
        digest.buffer,
        digest.byteOffset,
        digest.byteLength
      ).slice();
    } catch (err) {
      if (err instanceof CryptoProviderError) throw err;
      throw new CryptoProviderError(
        "invalid_body",
        `sha256 failed: ${stringifyError(err)}`,
        { cause: err }
      );
    }
  }

  async function aesCbcDecrypt(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array> {
    const bits = assertAesCbcKey(key);
    assertCbcIv(iv);
    assertCbcCiphertext(ciphertext);
    try {
      // setAutoPadding(true) is the Node default → PKCS#7 unpadding is
      // automatic. We do NOT disable it; a bad-padding block surfaces as a
      // final() throw, mapped to InvalidBodyError below.
      const decipher = nodeCrypto.createDecipheriv(
        cbcAlgoForBits(bits),
        key,
        iv
      );
      const head = decipher.update(ciphertext);
      const tail = decipher.final();
      return concatBytes(head, tail);
    } catch (err) {
      if (err instanceof CryptoProviderError) throw err;
      throw new InvalidBodyError(
        "aesCbcDecrypt failed: decryption or padding error",
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
    const bits = assertAesGcmKey(key);
    assertGcmIv(iv);
    assertUint8Array(ciphertext, "aesGcmDecrypt `ciphertext`");
    assertOptionalAad(aad);
    // CONTRACT: the auth tag is the LAST 16 bytes of `ciphertext`.
    if (ciphertext.byteLength < GCM_TAG_LENGTH) {
      throw new InvalidBodyError(
        `aesGcmDecrypt ciphertext must be at least ${GCM_TAG_LENGTH} bytes (tag); got ${ciphertext.byteLength}`
      );
    }
    const body = ciphertext.subarray(0, ciphertext.byteLength - GCM_TAG_LENGTH);
    const tag = ciphertext.subarray(ciphertext.byteLength - GCM_TAG_LENGTH);
    try {
      const decipher = nodeCrypto.createDecipheriv(algoForBits(bits), key, iv);
      if (aad !== undefined && aad.byteLength > 0) {
        (decipher as unknown as { setAAD(a: Uint8Array): void }).setAAD(aad);
      }
      decipher.setAuthTag(tag);
      const head = decipher.update(body);
      const tail = decipher.final();
      return concatBytes(head, tail);
    } catch (err) {
      // Auth-tag mismatch, bad IV length rejected by node, or malformed body.
      throw new InvalidBodyError(
        `aesGcmDecrypt failed: authentication or decryption error`,
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
    const bits = assertAesGcmKey(key);
    assertGcmIv(iv);
    assertUint8Array(plaintext, "aesGcmEncrypt `plaintext`");
    assertOptionalAad(aad);
    try {
      const cipher = nodeCrypto.createCipheriv(algoForBits(bits), key, iv);
      if (aad !== undefined && aad.byteLength > 0) {
        (cipher as unknown as { setAAD(a: Uint8Array): void }).setAAD(aad);
      }
      const head = cipher.update(plaintext);
      const tail = cipher.final();
      const tag = cipher.getAuthTag();
      return {
        ciphertext: concatBytes(head, tail),
        authTag: new Uint8Array(tag.buffer, tag.byteOffset, tag.byteLength).slice()
      };
    } catch (err) {
      throw new InvalidBodyError(`aesGcmEncrypt failed: ${stringifyError(err)}`, {
        cause: err
      });
    }
  }

  return {
    name: "node",
    hmacSha256,
    timingSafeEqual,
    randomBytes,
    rsaOaepDecrypt,
    aesGcmDecrypt,
    aesGcmEncrypt,
    sha256,
    aesCbcDecrypt
  };
}

// Concatenate two Node Buffers / Uint8Arrays into a plain Uint8Array,
// severing any Buffer identity at the seam.
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
