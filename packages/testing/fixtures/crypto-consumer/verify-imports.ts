// Consumer fixture for @switchbord/crypto.
//
// Imports ONLY through the published package specifiers (never through
// relative paths). Exercises each documented subpath entrypoint, asserts
// the runtime shape of the factory + adapters, runs a live HMAC call and
// a live randomBytes call, and emits a single-line JSON report ending
// with the success sentinel. A failure inside verify() must throw; the
// runner treats a non-zero exit code as a fixture failure.

import * as rootEntrypoint from "@switchbord/crypto";
import * as providerEntrypoint from "@switchbord/crypto/provider";
import * as errorsEntrypoint from "@switchbord/crypto/errors";
import * as nodeEntrypoint from "@switchbord/crypto/node";
import * as webcryptoEntrypoint from "@switchbord/crypto/webcrypto";

import {
  createCryptoProvider,
  createNodeCryptoProvider,
  createWebCryptoProvider,
  CryptoProviderError,
  InvalidBodyError,
  InvalidKeyError,
  InvalidLengthError,
  UnsupportedCapabilityError,
  WATS_CRYPTO_PROVIDER_EXPORTS
} from "@switchbord/crypto";
import type { CryptoProvider } from "@switchbord/crypto/provider";

interface VerifyReportOk {
  readonly ok: true;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly sentinel: "crypto-consumer:ok";
  readonly moduleKeys: Readonly<Record<string, readonly string[]>>;
}

async function verify(): Promise<VerifyReportOk> {
  const checks: Record<string, boolean> = {};

  checks["rootEntrypoint is a module namespace"] =
    typeof rootEntrypoint === "object" && rootEntrypoint !== null;
  checks["providerEntrypoint exports WATS_CRYPTO_PROVIDER_EXPORTS"] =
    Array.isArray(
      (providerEntrypoint as { WATS_CRYPTO_PROVIDER_EXPORTS?: unknown })
        .WATS_CRYPTO_PROVIDER_EXPORTS
    );
  checks["errorsEntrypoint exports CryptoProviderError"] =
    typeof (errorsEntrypoint as { CryptoProviderError?: unknown })
      .CryptoProviderError === "function";
  checks["nodeEntrypoint exports createNodeCryptoProvider"] =
    typeof (nodeEntrypoint as { createNodeCryptoProvider?: unknown })
      .createNodeCryptoProvider === "function";
  checks["webcryptoEntrypoint exports createWebCryptoProvider"] =
    typeof (webcryptoEntrypoint as { createWebCryptoProvider?: unknown })
      .createWebCryptoProvider === "function";

  checks["createCryptoProvider is a function"] =
    typeof createCryptoProvider === "function";
  checks["createNodeCryptoProvider is a function"] =
    typeof createNodeCryptoProvider === "function";
  checks["createWebCryptoProvider is a function"] =
    typeof createWebCryptoProvider === "function";

  checks["WATS_CRYPTO_PROVIDER_EXPORTS is an array"] =
    Array.isArray(WATS_CRYPTO_PROVIDER_EXPORTS);

  checks["CryptoProviderError is a class"] =
    typeof CryptoProviderError === "function";
  checks["InvalidKeyError subclasses CryptoProviderError"] =
    Object.create(InvalidKeyError.prototype) instanceof CryptoProviderError;
  checks["InvalidBodyError subclasses CryptoProviderError"] =
    Object.create(InvalidBodyError.prototype) instanceof CryptoProviderError;
  checks["InvalidLengthError subclasses CryptoProviderError"] =
    Object.create(InvalidLengthError.prototype) instanceof CryptoProviderError;
  checks["UnsupportedCapabilityError subclasses CryptoProviderError"] =
    Object.create(UnsupportedCapabilityError.prototype) instanceof
    CryptoProviderError;

  const provider: CryptoProvider = await createCryptoProvider();
  checks["createCryptoProvider() returns an object with name"] =
    typeof provider === "object" &&
    provider !== null &&
    typeof provider.name === "string" &&
    provider.name.length > 0;
  checks["provider.hmacSha256 is a function"] =
    typeof provider.hmacSha256 === "function";
  checks["provider.timingSafeEqual is a function"] =
    typeof provider.timingSafeEqual === "function";
  checks["provider.randomBytes is a function"] =
    typeof provider.randomBytes === "function";

  // Live HMAC-SHA256 call — not just "does not throw". We pin the
  // length of the output so a stub that returns an empty Uint8Array
  // can't sneak past.
  const mac = await provider.hmacSha256("key", "body");
  checks["hmacSha256 returns Uint8Array"] = mac instanceof Uint8Array;
  checks["hmacSha256 output is 32 bytes"] = mac.byteLength === 32;

  // timingSafeEqual positive + negative.
  checks["timingSafeEqual(same, same) === true"] =
    provider.timingSafeEqual(mac, mac) === true;
  const macCopy = mac.slice();
  macCopy[0] = (macCopy[0] ?? 0) ^ 0xff;
  checks["timingSafeEqual(mac, mutated) === false"] =
    provider.timingSafeEqual(mac, macCopy) === false;

  // randomBytes — request 16 bytes, assert length 16.
  const rb = await provider.randomBytes(16);
  checks["randomBytes(16) returns Uint8Array"] = rb instanceof Uint8Array;
  checks["randomBytes(16) returns 16 bytes"] = rb.byteLength === 16;

  // Input-rejection crossing: ensure invalid key is rejected via a
  // typed error at the package boundary.
  let sawInvalidKey = false;
  try {
    await provider.hmacSha256("", "body");
  } catch (err) {
    sawInvalidKey = err instanceof InvalidKeyError;
  }
  checks["empty key rejected with InvalidKeyError at the package boundary"] =
    sawInvalidKey;

  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) {
      throw new Error(`crypto-consumer check failed: ${label}`);
    }
  }

  return {
    ok: true,
    checks,
    sentinel: "crypto-consumer:ok",
    moduleKeys: {
      "@switchbord/crypto": Object.keys(rootEntrypoint).sort(),
      "@switchbord/crypto/provider": Object.keys(providerEntrypoint).sort(),
      "@switchbord/crypto/errors": Object.keys(errorsEntrypoint).sort(),
      "@switchbord/crypto/node": Object.keys(nodeEntrypoint).sort(),
      "@switchbord/crypto/webcrypto": Object.keys(webcryptoEntrypoint).sort()
    }
  };
}

const report = await verify();
console.log(JSON.stringify(report));
console.log(report.sentinel);
