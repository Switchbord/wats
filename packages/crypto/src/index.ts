// @wats/crypto barrel — RED stub; GREEN re-exports implementations.

export type {
  CryptoProvider,
  CryptoProviderCapability,
  CryptoValidationErrorShape
} from "./provider.js";
export { WATS_CRYPTO_PROVIDER_EXPORTS } from "./provider.js";
export {
  CryptoProviderError,
  InvalidKeyError,
  InvalidBodyError,
  InvalidLengthError,
  UnsupportedCapabilityError
} from "./errors.js";
export type { CryptoErrorCode } from "./errors.js";
export {
  createCryptoProvider,
  type CreateCryptoProviderOptions
} from "./createCryptoProvider.js";
export { createNodeCryptoProvider } from "./adapters/node/index.js";
export { createWebCryptoProvider } from "./adapters/webcrypto/index.js";
