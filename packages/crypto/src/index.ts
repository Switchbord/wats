// @wats/crypto barrel — RED stub; GREEN re-exports implementations.

export type {
  CryptoProvider,
  CryptoProviderCapability,
  CryptoValidationErrorShape
} from "./provider";
export { WATS_CRYPTO_PROVIDER_EXPORTS } from "./provider";
export {
  CryptoProviderError,
  InvalidKeyError,
  InvalidBodyError,
  InvalidLengthError,
  UnsupportedCapabilityError
} from "./errors";
export type { CryptoErrorCode } from "./errors";
export {
  createCryptoProvider,
  type CreateCryptoProviderOptions
} from "./createCryptoProvider";
export { createNodeCryptoProvider } from "./adapters/node/index";
export { createWebCryptoProvider } from "./adapters/webcrypto/index";
