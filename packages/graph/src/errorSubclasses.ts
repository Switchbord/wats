// F-5 Graph error code subclasses + built-in registry seeding.
//
// Source-of-truth for the seeded error code table is
// /tmp/wats-research/pywa/pywa/errors.py (canonical pywa mapping).
// Each subclass pins:
//   - its parent (GraphAuthError / GraphRateLimitError / GraphApiError)
//   - a unique `name` string (set via this.name)
//   - a numeric `errorCode` static readonly
//   - a factory signature that preserves the original payload.
//
// Naming convention: pywa class name verbatim, with an `Error` suffix
// appended unless the pywa class already ends in `Error` or `Exception`.
// So `AuthException` stays as-is; `ExpiredAccessToken` →
// `ExpiredAccessTokenError`; `MediaDownloadError` stays.
//
// F-5 remediation (WATS-29): the previous fabrications (invented codes
// 102 / 463; WATS-only names at 131045 / 131050 / 131051 / 131052 /
// 132068 / 132069; `PermissionError` at 10; `SessionExpiredError`;
// invented integrity/template classes) have been removed. Codes 17 and
// 32 were also WATS fabrications and are dropped from both the seed
// table and `RATE_LIMIT_CODES`. Code 100 is retained as a Meta-published
// alias of pywa's 131009 `InvalidParameter`; the class name used on
// both codes is `InvalidParameterError`.

import {
  GraphApiError,
  GraphAuthError,
  GraphRateLimitError,
  type GraphApiErrorPayload
} from "./errors";
import {
  isBuiltInRegistered,
  markBuiltInRegistered,
  registerErrorCode,
  type GraphErrorFactoryContext
} from "./errorRegistry";

function messageOf(ctx: GraphErrorFactoryContext, fallback: string): string {
  const payload = ctx.payload;
  if (
    payload !== undefined &&
    typeof payload.message === "string" &&
    payload.message.length > 0
  ) {
    return payload.message;
  }
  return fallback;
}

function coreParams(
  ctx: GraphErrorFactoryContext,
  fallback: string
): { message: string; status: number; payload?: GraphApiErrorPayload } {
  const out: { message: string; status: number; payload?: GraphApiErrorPayload } = {
    message: messageOf(ctx, fallback),
    status: ctx.status
  };
  if (ctx.payload !== undefined) {
    out.payload = ctx.payload;
  }
  return out;
}

// ---------------------------------------------------------------------
// Authorization axis (pywa AuthorizationError → WATS GraphAuthError)
// ---------------------------------------------------------------------

export class AuthException extends GraphAuthError {
  static readonly errorCode = 0 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "We were unable to authenticate the app user."));
    this.name = "AuthException";
  }
}

export class APIMethodError extends GraphAuthError {
  static readonly errorCode = 3 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Capability or permissions issue."));
    this.name = "APIMethodError";
  }
}

export class PermissionDeniedError extends GraphAuthError {
  static readonly errorCode = 10 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Permission is either not granted or has been removed."));
    this.name = "PermissionDeniedError";
  }
}

export class ExpiredAccessTokenError extends GraphAuthError {
  static readonly errorCode = 190 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Your access token has expired."));
    this.name = "ExpiredAccessTokenError";
  }
}

/**
 * pywa declares `APIPermission` as `__error_codes__ = range(200, 300)`.
 * WATS registers the representative code 200 only; any of 201..299 falls
 * through to the generic classifier and surfaces as `GraphAuthError` by
 * HTTP status. See docs/reference/errors.md §"Ranges in pywa vs
 * discrete registration".
 */
export class APIPermissionError extends GraphAuthError {
  static readonly errorCode = 200 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Permission is either not granted or has been removed."));
    this.name = "APIPermissionError";
  }
}

// ---------------------------------------------------------------------
// Rate-limit axis (pywa ThrottlingError → WATS GraphRateLimitError)
// ---------------------------------------------------------------------

export class ToManyAPICallsError extends GraphRateLimitError {
  static readonly errorCode = 4 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "The app has reached its API call rate limit."));
    this.name = "ToManyAPICallsError";
  }
}

export class RateLimitIssuesError extends GraphRateLimitError {
  static readonly errorCode = 80007 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "The WhatsApp Business Account has reached its rate limit."));
    this.name = "RateLimitIssuesError";
  }
}

export class RateLimitHitError extends GraphRateLimitError {
  static readonly errorCode = 130429 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Cloud API message throughput has been reached."));
    this.name = "RateLimitHitError";
  }
}

export class SpamRateLimitHitError extends GraphRateLimitError {
  static readonly errorCode = 131048 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Message failed due to spam rate limit restrictions."));
    this.name = "SpamRateLimitHitError";
  }
}

export class TooManyMessagesError extends GraphRateLimitError {
  static readonly errorCode = 131056 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Too many messages from sender to recipient in a short period."));
    this.name = "TooManyMessagesError";
  }
}

// ---------------------------------------------------------------------
// Integrity axis (pywa IntegrityError → WATS GraphApiError)
// ---------------------------------------------------------------------

export class TemporarilyBlockedError extends GraphApiError {
  static readonly errorCode = 368 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Account temporarily blocked for a policy violation."));
    this.name = "TemporarilyBlockedError";
  }
}

export class AccountLockedError extends GraphApiError {
  static readonly errorCode = 131031 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Account locked."));
    this.name = "AccountLockedError";
  }
}

export class AccountRestrictedFromCountryError extends GraphApiError {
  static readonly errorCode = 130497 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Account restricted from messaging users in this country."));
    this.name = "AccountRestrictedFromCountryError";
  }
}

// ---------------------------------------------------------------------
// Send-message axis (pywa SendMessageError → WATS GraphApiError)
// ---------------------------------------------------------------------

export class UserIsInExperimentGroupError extends GraphApiError {
  static readonly errorCode = 130472 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "User is part of a marketing message experiment group."));
    this.name = "UserIsInExperimentGroupError";
  }
}

export class MessageUndeliverableError extends GraphApiError {
  static readonly errorCode = 131026 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Message undeliverable."));
    this.name = "MessageUndeliverableError";
  }
}

export class ReEngagementMessageError extends GraphApiError {
  static readonly errorCode = 131047 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "More than 24 hours have passed since the recipient last replied."));
    this.name = "ReEngagementMessageError";
  }
}

export class UnsupportedMessageTypeError extends GraphApiError {
  static readonly errorCode = 131051 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "The message type is not supported."));
    this.name = "UnsupportedMessageTypeError";
  }
}

export class MediaDownloadError extends GraphApiError {
  static readonly errorCode = 131052 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Unable to download the media sent by the user."));
    this.name = "MediaDownloadError";
  }
}

export class MediaUploadError extends GraphApiError {
  static readonly errorCode = 131053 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Unable to upload the media used in the message."));
    this.name = "MediaUploadError";
  }
}

export class RecipientNotInAllowedListError extends GraphApiError {
  static readonly errorCode = 131030 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Recipient is not in the test-number allowed list."));
    this.name = "RecipientNotInAllowedListError";
  }
}

/**
 * Code 131009 is pywa's canonical `InvalidParameter`. Code 100 is a
 * Meta-published platform-level "Invalid parameter" code that pywa does
 * not register; WATS augments the seed with code 100 → `InvalidParameterError`
 * for convenience (consumers expect `instanceof InvalidParameterError`
 * on both codes).
 */
export class InvalidParameterError extends GraphApiError {
  static readonly errorCode = 131009 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "The parameter you passed is invalid."));
    this.name = "InvalidParameterError";
  }
}

export class MissingRequiredParameterError extends GraphApiError {
  static readonly errorCode = 131008 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "A required parameter is missing."));
    this.name = "MissingRequiredParameterError";
  }
}

export class TemplateParamCountMismatchError extends GraphApiError {
  static readonly errorCode = 132000 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template parameter count mismatch."));
    this.name = "TemplateParamCountMismatchError";
  }
}

export class TemplateNotExistsError extends GraphApiError {
  static readonly errorCode = 132001 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template does not exist in the specified language or is unapproved."));
    this.name = "TemplateNotExistsError";
  }
}

export class TemplateTextTooLongError extends GraphApiError {
  static readonly errorCode = 132005 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template text too long."));
    this.name = "TemplateTextTooLongError";
  }
}

export class TemplateContentPolicyViolationError extends GraphApiError {
  static readonly errorCode = 132007 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template content policy violation."));
    this.name = "TemplateContentPolicyViolationError";
  }
}

export class TemplateParamValueInvalidError extends GraphApiError {
  static readonly errorCode = 132008 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template parameter value formatted incorrectly."));
    this.name = "TemplateParamValueInvalidError";
  }
}

export class TemplateParamFormatMismatchError extends GraphApiError {
  static readonly errorCode = 132012 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template parameter format mismatch."));
    this.name = "TemplateParamFormatMismatchError";
  }
}

export class TemplatePausedError extends GraphApiError {
  static readonly errorCode = 132015 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template paused due to low quality."));
    this.name = "TemplatePausedError";
  }
}

export class TemplateDisabledError extends GraphApiError {
  static readonly errorCode = 132016 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Template permanently disabled."));
    this.name = "TemplateDisabledError";
  }
}

export class FlowBlockedError extends GraphApiError {
  static readonly errorCode = 132068 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Flow is in blocked state."));
    this.name = "FlowBlockedError";
  }
}

export class FlowThrottledError extends GraphApiError {
  static readonly errorCode = 132069 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Flow is in throttled state."));
    this.name = "FlowThrottledError";
  }
}

export class GenericError extends GraphApiError {
  static readonly errorCode = 135000 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Generic error."));
    this.name = "GenericError";
  }
}

export class UnknownError extends GraphApiError {
  static readonly errorCode = 131000 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Message failed to send due to an unknown error."));
    this.name = "UnknownError";
  }
}

export class AccessDeniedError extends GraphApiError {
  static readonly errorCode = 131005 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Access denied for this resource."));
    this.name = "AccessDeniedError";
  }
}

export class ServiceUnavailableError extends GraphApiError {
  static readonly errorCode = 131016 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Service temporarily unavailable."));
    this.name = "ServiceUnavailableError";
  }
}

export class RecipientCannotBeSenderError extends GraphApiError {
  static readonly errorCode = 131021 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Recipient cannot be the sender."));
    this.name = "RecipientCannotBeSenderError";
  }
}

/** pywa maps both 131042 and 131044 (the calling variant) to the same class. */
export class BusinessPaymentIssueError extends GraphApiError {
  static readonly errorCode = 131042 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Business payment issue."));
    this.name = "BusinessPaymentIssueError";
  }
}

export class IncorrectCertificateError extends GraphApiError {
  static readonly errorCode = 131045 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Message failed due to a phone number registration error."));
    this.name = "IncorrectCertificateError";
  }
}

export class AccountInMaintenanceModeError extends GraphApiError {
  static readonly errorCode = 131057 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Business Account is in maintenance mode."));
    this.name = "AccountInMaintenanceModeError";
  }
}

export class UserStoppedMarketingMessagesError extends GraphApiError {
  static readonly errorCode = 131050 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "User has stopped marketing messages from the business."));
    this.name = "UserStoppedMarketingMessagesError";
  }
}

export class RecipientIdentityKeyMismatchError extends GraphApiError {
  static readonly errorCode = 137000 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "The recipient's identity key hash does not match the one on record."));
    this.name = "RecipientIdentityKeyMismatchError";
  }
}

// ---------------------------------------------------------------------
// Flow axis (pywa FlowError → WATS GraphApiError)
// ---------------------------------------------------------------------

export class FlowBlockedByIntegrityError extends GraphApiError {
  static readonly errorCode = 139000 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Flow blocked by an integrity issue on the account."));
    this.name = "FlowBlockedByIntegrityError";
  }
}

export class FlowUpdatingError extends GraphApiError {
  static readonly errorCode = 139001 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Flow failed to update."));
    this.name = "FlowUpdatingError";
  }
}

export class FlowPublishingError extends GraphApiError {
  static readonly errorCode = 139002 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Flow failed to publish."));
    this.name = "FlowPublishingError";
  }
}

export class FlowDeprecatingError extends GraphApiError {
  static readonly errorCode = 139003 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Flow failed to deprecate."));
    this.name = "FlowDeprecatingError";
  }
}

export class FlowDeletingError extends GraphApiError {
  static readonly errorCode = 139004 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Flow failed to delete."));
    this.name = "FlowDeletingError";
  }
}

// ---------------------------------------------------------------------
// Block-user axis (pywa BlockUserError → WATS GraphApiError)
// ---------------------------------------------------------------------

export class BulkBlockingFailedError extends GraphApiError {
  static readonly errorCode = 139100 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Bulk blocking failed for some users."));
    this.name = "BulkBlockingFailedError";
  }
}

export class BlockListLimitReachedError extends GraphApiError {
  static readonly errorCode = 139101 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Blocklist limit reached (64k)."));
    this.name = "BlockListLimitReachedError";
  }
}

export class BlockListConcurrentUpdateError extends GraphApiError {
  static readonly errorCode = 139102 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Blocklist concurrent update — version_id mismatch."));
    this.name = "BlockListConcurrentUpdateError";
  }
}

export class BlockUserInternalError extends GraphApiError {
  static readonly errorCode = 139103 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Block-user internal error."));
    this.name = "BlockUserInternalError";
  }
}

// ---------------------------------------------------------------------
// Calling axis (pywa CallingError → WATS GraphApiError)
// ---------------------------------------------------------------------

export class CallingNotEnabledError extends GraphApiError {
  static readonly errorCode = 138000 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Calling is not enabled on this phone number."));
    this.name = "CallingNotEnabledError";
  }
}

export class CallingCannotBeEnabledError extends GraphApiError {
  static readonly errorCode = 138018 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Calling cannot be enabled — technical pre-requisites not met."));
    this.name = "CallingCannotBeEnabledError";
  }
}

export class ReceiverUncallableError extends GraphApiError {
  static readonly errorCode = 138001 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Receiver is unable to receive calls."));
    this.name = "ReceiverUncallableError";
  }
}

export class ConcurrentCallsLimitError extends GraphApiError {
  static readonly errorCode = 138002 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Limit reached for concurrent calls."));
    this.name = "ConcurrentCallsLimitError";
  }
}

export class DuplicateCallError extends GraphApiError {
  static readonly errorCode = 138003 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "A call is already ongoing with the receiver."));
    this.name = "DuplicateCallError";
  }
}

export class CallConnectionError extends GraphApiError {
  static readonly errorCode = 138004 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Error while connecting the call."));
    this.name = "CallConnectionError";
  }
}

export class CallRateLimitExceededError extends GraphApiError {
  static readonly errorCode = 138005 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Limit reached for maximum calls from this phone number."));
    this.name = "CallRateLimitExceededError";
  }
}

export class CallPermissionNotFoundError extends GraphApiError {
  static readonly errorCode = 138006 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "No approved call permission from the recipient."));
    this.name = "CallPermissionNotFoundError";
  }
}

export class CallConnectionTimeoutError extends GraphApiError {
  static readonly errorCode = 138007 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Call was unable to connect due to a timeout."));
    this.name = "CallConnectionTimeoutError";
  }
}

export class CallPermissionRequestLimitHitError extends GraphApiError {
  static readonly errorCode = 138009 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Limit reached for call-permission-request sends."));
    this.name = "CallPermissionRequestLimitHitError";
  }
}

export class BusinessInitiatedCallsLimitHitError extends GraphApiError {
  static readonly errorCode = 138012 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Limit reached for business-initiated calls in 24 hours."));
    this.name = "BusinessInitiatedCallsLimitHitError";
  }
}

/**
 * pywa maps this class to two codes (138013 and 613). Note pywa places
 * 613 under `CallingError`, NOT `ThrottlingError` — we follow pywa, so
 * 613 no longer appears in `RATE_LIMIT_CODES`. (Historical: WATS
 * previously seeded 613 as `CallsLimitError extends GraphRateLimitError`;
 * that was a WATS fabrication and has been removed.)
 */
export class FetchCallPermissionLimitHitError extends GraphApiError {
  static readonly errorCode = 138013 as const;
  constructor(ctx: GraphErrorFactoryContext) {
    super(coreParams(ctx, "Limit reached for fetch-call-permission API requests."));
    this.name = "FetchCallPermissionLimitHitError";
  }
}

// ---------------------------------------------------------------------
// Built-in registration. Idempotent: guard lives on the registry module
// so `clearErrorRegistry()` resets it automatically (F-5 remediation).
// ---------------------------------------------------------------------

type Seed = {
  readonly code: number;
  readonly errorName: string;
  readonly factory: (ctx: GraphErrorFactoryContext) => GraphApiError;
};

const BUILT_IN_SEEDS: readonly Seed[] = [
  // --- Authorization axis (pywa AuthorizationError) ---
  { code: 0, errorName: "AuthException", factory: (ctx) => new AuthException(ctx) },
  { code: 3, errorName: "APIMethodError", factory: (ctx) => new APIMethodError(ctx) },
  { code: 10, errorName: "PermissionDeniedError", factory: (ctx) => new PermissionDeniedError(ctx) },
  { code: 190, errorName: "ExpiredAccessTokenError", factory: (ctx) => new ExpiredAccessTokenError(ctx) },
  { code: 200, errorName: "APIPermissionError", factory: (ctx) => new APIPermissionError(ctx) },
  // --- Rate-limit axis (pywa ThrottlingError) ---
  { code: 4, errorName: "ToManyAPICallsError", factory: (ctx) => new ToManyAPICallsError(ctx) },
  { code: 80007, errorName: "RateLimitIssuesError", factory: (ctx) => new RateLimitIssuesError(ctx) },
  { code: 130429, errorName: "RateLimitHitError", factory: (ctx) => new RateLimitHitError(ctx) },
  { code: 131048, errorName: "SpamRateLimitHitError", factory: (ctx) => new SpamRateLimitHitError(ctx) },
  { code: 131056, errorName: "TooManyMessagesError", factory: (ctx) => new TooManyMessagesError(ctx) },
  // --- Integrity axis ---
  { code: 368, errorName: "TemporarilyBlockedError", factory: (ctx) => new TemporarilyBlockedError(ctx) },
  { code: 131031, errorName: "AccountLockedError", factory: (ctx) => new AccountLockedError(ctx) },
  { code: 130497, errorName: "AccountRestrictedFromCountryError", factory: (ctx) => new AccountRestrictedFromCountryError(ctx) },
  // --- Send-message axis ---
  { code: 130472, errorName: "UserIsInExperimentGroupError", factory: (ctx) => new UserIsInExperimentGroupError(ctx) },
  { code: 131026, errorName: "MessageUndeliverableError", factory: (ctx) => new MessageUndeliverableError(ctx) },
  { code: 131047, errorName: "ReEngagementMessageError", factory: (ctx) => new ReEngagementMessageError(ctx) },
  { code: 131051, errorName: "UnsupportedMessageTypeError", factory: (ctx) => new UnsupportedMessageTypeError(ctx) },
  { code: 131052, errorName: "MediaDownloadError", factory: (ctx) => new MediaDownloadError(ctx) },
  { code: 131053, errorName: "MediaUploadError", factory: (ctx) => new MediaUploadError(ctx) },
  { code: 131030, errorName: "RecipientNotInAllowedListError", factory: (ctx) => new RecipientNotInAllowedListError(ctx) },
  { code: 131009, errorName: "InvalidParameterError", factory: (ctx) => new InvalidParameterError(ctx) },
  { code: 131008, errorName: "MissingRequiredParameterError", factory: (ctx) => new MissingRequiredParameterError(ctx) },
  { code: 132000, errorName: "TemplateParamCountMismatchError", factory: (ctx) => new TemplateParamCountMismatchError(ctx) },
  { code: 132001, errorName: "TemplateNotExistsError", factory: (ctx) => new TemplateNotExistsError(ctx) },
  { code: 132005, errorName: "TemplateTextTooLongError", factory: (ctx) => new TemplateTextTooLongError(ctx) },
  { code: 132007, errorName: "TemplateContentPolicyViolationError", factory: (ctx) => new TemplateContentPolicyViolationError(ctx) },
  { code: 132008, errorName: "TemplateParamValueInvalidError", factory: (ctx) => new TemplateParamValueInvalidError(ctx) },
  { code: 132012, errorName: "TemplateParamFormatMismatchError", factory: (ctx) => new TemplateParamFormatMismatchError(ctx) },
  { code: 132015, errorName: "TemplatePausedError", factory: (ctx) => new TemplatePausedError(ctx) },
  { code: 132016, errorName: "TemplateDisabledError", factory: (ctx) => new TemplateDisabledError(ctx) },
  { code: 132068, errorName: "FlowBlockedError", factory: (ctx) => new FlowBlockedError(ctx) },
  { code: 132069, errorName: "FlowThrottledError", factory: (ctx) => new FlowThrottledError(ctx) },
  { code: 135000, errorName: "GenericError", factory: (ctx) => new GenericError(ctx) },
  { code: 131000, errorName: "UnknownError", factory: (ctx) => new UnknownError(ctx) },
  { code: 131005, errorName: "AccessDeniedError", factory: (ctx) => new AccessDeniedError(ctx) },
  { code: 131016, errorName: "ServiceUnavailableError", factory: (ctx) => new ServiceUnavailableError(ctx) },
  { code: 131021, errorName: "RecipientCannotBeSenderError", factory: (ctx) => new RecipientCannotBeSenderError(ctx) },
  { code: 131042, errorName: "BusinessPaymentIssueError", factory: (ctx) => new BusinessPaymentIssueError(ctx) },
  { code: 131044, errorName: "BusinessPaymentIssueError", factory: (ctx) => new BusinessPaymentIssueError(ctx) },
  { code: 131045, errorName: "IncorrectCertificateError", factory: (ctx) => new IncorrectCertificateError(ctx) },
  { code: 131057, errorName: "AccountInMaintenanceModeError", factory: (ctx) => new AccountInMaintenanceModeError(ctx) },
  { code: 131050, errorName: "UserStoppedMarketingMessagesError", factory: (ctx) => new UserStoppedMarketingMessagesError(ctx) },
  { code: 137000, errorName: "RecipientIdentityKeyMismatchError", factory: (ctx) => new RecipientIdentityKeyMismatchError(ctx) },
  // --- Flow axis ---
  { code: 139000, errorName: "FlowBlockedByIntegrityError", factory: (ctx) => new FlowBlockedByIntegrityError(ctx) },
  { code: 139001, errorName: "FlowUpdatingError", factory: (ctx) => new FlowUpdatingError(ctx) },
  { code: 139002, errorName: "FlowPublishingError", factory: (ctx) => new FlowPublishingError(ctx) },
  { code: 139003, errorName: "FlowDeprecatingError", factory: (ctx) => new FlowDeprecatingError(ctx) },
  { code: 139004, errorName: "FlowDeletingError", factory: (ctx) => new FlowDeletingError(ctx) },
  // --- Block-user axis ---
  { code: 139100, errorName: "BulkBlockingFailedError", factory: (ctx) => new BulkBlockingFailedError(ctx) },
  { code: 139101, errorName: "BlockListLimitReachedError", factory: (ctx) => new BlockListLimitReachedError(ctx) },
  { code: 139102, errorName: "BlockListConcurrentUpdateError", factory: (ctx) => new BlockListConcurrentUpdateError(ctx) },
  { code: 139103, errorName: "BlockUserInternalError", factory: (ctx) => new BlockUserInternalError(ctx) },
  // --- Calling axis ---
  { code: 138000, errorName: "CallingNotEnabledError", factory: (ctx) => new CallingNotEnabledError(ctx) },
  { code: 138018, errorName: "CallingCannotBeEnabledError", factory: (ctx) => new CallingCannotBeEnabledError(ctx) },
  { code: 138001, errorName: "ReceiverUncallableError", factory: (ctx) => new ReceiverUncallableError(ctx) },
  { code: 138002, errorName: "ConcurrentCallsLimitError", factory: (ctx) => new ConcurrentCallsLimitError(ctx) },
  { code: 138003, errorName: "DuplicateCallError", factory: (ctx) => new DuplicateCallError(ctx) },
  { code: 138004, errorName: "CallConnectionError", factory: (ctx) => new CallConnectionError(ctx) },
  { code: 138005, errorName: "CallRateLimitExceededError", factory: (ctx) => new CallRateLimitExceededError(ctx) },
  { code: 138006, errorName: "CallPermissionNotFoundError", factory: (ctx) => new CallPermissionNotFoundError(ctx) },
  { code: 138007, errorName: "CallConnectionTimeoutError", factory: (ctx) => new CallConnectionTimeoutError(ctx) },
  { code: 138009, errorName: "CallPermissionRequestLimitHitError", factory: (ctx) => new CallPermissionRequestLimitHitError(ctx) },
  { code: 138012, errorName: "BusinessInitiatedCallsLimitHitError", factory: (ctx) => new BusinessInitiatedCallsLimitHitError(ctx) },
  { code: 138013, errorName: "FetchCallPermissionLimitHitError", factory: (ctx) => new FetchCallPermissionLimitHitError(ctx) },
  { code: 613, errorName: "FetchCallPermissionLimitHitError", factory: (ctx) => new FetchCallPermissionLimitHitError(ctx) },
  // --- WATS-augmented (not pywa-sourced): Meta platform-level code 100
  //     aliases pywa's 131009 InvalidParameter to the same class. ---
  { code: 100, errorName: "InvalidParameterError", factory: (ctx) => new InvalidParameterError(ctx) }
];

export function registerBuiltInErrorCodes(): void {
  if (isBuiltInRegistered()) {
    return;
  }
  for (const seed of BUILT_IN_SEEDS) {
    registerErrorCode({
      code: seed.code,
      errorName: seed.errorName,
      factory: seed.factory
    });
  }
  markBuiltInRegistered();
}

// Seed at module load. Safe to import multiple times — guarded.
registerBuiltInErrorCodes();
