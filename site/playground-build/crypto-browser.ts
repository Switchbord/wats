// playground-build/crypto-browser.ts
//
// Browser-safe re-export barrel for @wats/crypto.
//
// FINDING (see bundle report): @wats/crypto's MAIN entry ("." ->
// dist/index.js) statically re-exports `createNodeCryptoProvider`, whose
// implementation does `await import("node:crypto")`. The package ships no
// `browser` export condition, so a browser-targeted bundler that imports
// "@wats/crypto" still pulls in the node:crypto builtin.
//
// This is NOT a shim: we deliberately import only the package's own
// browser-safe surfaces (the ./webcrypto adapter + ./errors), which use
// globalThis.crypto.subtle and contain zero node builtins. The node adapter
// is simply never referenced from the browser bundle.

export { createWebCryptoProvider } from "@wats/crypto/webcrypto";
export {
  CryptoProviderError,
  InvalidKeyError,
  InvalidBodyError,
  InvalidLengthError,
  UnsupportedCapabilityError,
} from "@wats/crypto/errors";
