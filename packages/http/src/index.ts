// Explicit re-exports (rather than `export *`) so module-private
// test-only override hooks (`_setDefaultCryptoProviderFactory`) stay
// OUT of the public @wats/http surface. Each hook is still importable
// from its submodule path for tests, but never surfaces through the
// package entry point.

export {
  verifyWebhookChallenge,
  type VerifyWebhookChallengeInput,
  type WebhookChallengeError,
  type WebhookChallengeErrorCode,
  type VerifyWebhookChallengeErrorCode,
  type WebhookChallengeResult
} from "./webhookServer";

export {
  validateWebhookSignature,
  type SignatureValidationError,
  type SignatureValidationErrorCode,
  type SignatureValidationResult,
  type ValidateWebhookSignatureInput
} from "./signature";

// F-12 WebhookAdapter — runtime-neutral HTTP adapter layer.
export {
  createWebhookAdapter,
  WebhookAdapterConfigError,
  type WebhookAdapter,
  type WebhookAdapterConfig,
  type WebhookAdapterConfigErrorCode,
  type WebhookAdapterEvent,
  type WebhookDispatchSummary,
  type WebhookFacadeLike,
  type WebhookRequest,
  type WebhookResponse
} from "./adapters/webhookAdapter";

export {
  createFetchWebhookHandler
} from "./adapters/fetchAdapter";

export {
  createBunWebhookServer,
  type BunAdapterOptions,
  type BunServerHandle
} from "./adapters/bunAdapter";

export {
  createNodeWebhookHandler,
  type NodeIncomingMessageLike,
  type NodeServerResponseLike,
  type NodeWebhookHandler
} from "./adapters/nodeAdapter";
