// @wats/crypto — WebCrypto adapter.
//
// Uses globalThis.crypto.subtle only — NO `node:*` imports. Works
// unchanged on Bun, modern Node (>= 20), Deno, Cloudflare Workers,
// Vercel Edge, and any browser / WinterCG runtime exposing
// SubtleCrypto.

import type { CryptoProvider } from "../../provider";
import {
  CryptoProviderError,
  UnsupportedCapabilityError,
  assertFiniteLength,
  assertUint8Array,
  assertValidBody,
  assertValidKey
} from "../../errors";

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

  return {
    name: "webcrypto",
    hmacSha256,
    timingSafeEqual,
    randomBytes
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
