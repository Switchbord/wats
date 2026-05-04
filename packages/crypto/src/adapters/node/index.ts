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

import type { CryptoProvider } from "../../provider";
import {
  CryptoProviderError,
  UnsupportedCapabilityError,
  assertFiniteLength,
  assertUint8Array,
  assertValidBody,
  assertValidKey
} from "../../errors";

interface NodeHmac {
  update(data: Uint8Array | string): { digest(): Uint8Array };
}

interface NodeCryptoModule {
  createHmac(algorithm: string, key: Uint8Array | string): NodeHmac;
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  randomBytes(size: number): Uint8Array;
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

  return {
    name: "node",
    hmacSha256,
    timingSafeEqual,
    randomBytes
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
