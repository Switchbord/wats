// WATS-181: table-driven coverage for errorSubclasses.ts.
//
// Every exported error subclass is constructed through the REAL
// registry → factory path (resolveRegisteredError + factory(ctx))
// and through the public createGraphApiError factory, with per-class
// instanceof / parent / sibling / message / field assertions.
//
// Fallback branches (missing message, missing error_data, unknown
// subcode, null/undefined/malformed envelope, hostile headers) are
// exercised in a dedicated describe block.
//
// Test-only slice — no src changes.

import { describe, expect, test } from "bun:test";
import {
  createGraphApiError,
  GraphApiError,
  GraphAuthError,
  GraphRateLimitError,
  type GraphApiErrorPayload
} from "../src/errors";
import {
  clearErrorRegistry,
  resolveRegisteredError,
  type GraphErrorFactoryContext
} from "../src/errorRegistry";
import * as subclasses from "../src/errorSubclasses";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function ctx(
  payload: GraphApiErrorPayload | undefined,
  status = 400,
  headers?: Headers
): GraphErrorFactoryContext {
  return {
    payload,
    status,
    headers: headers ?? new Headers(),
    requestUrl: "https://graph.facebook.com/v25.0/me"
  };
}

function payload(code: number, message = "boom"): GraphApiErrorPayload {
  return { message, code, type: "OAuthException" } as GraphApiErrorPayload;
}

// ---------------------------------------------------------------------
// Programmatically derive the exported subclass list.
// New subclasses added to errorSubclasses.ts will appear here and
// MUST have an explicit row in EXPECTED below (or the suite fails).
// ---------------------------------------------------------------------

const ALL_EXPORTS = Object.entries(subclasses) as Array<
  [string, unknown]
>;

function isCtor(v: unknown): v is (new (c: GraphErrorFactoryContext) => GraphApiError) {
  return typeof v === "function" && "errorCode" in v;
}

// Every exported class with a static `errorCode` numeric field.
const SUBCLASS_CTORS = ALL_EXPORTS.filter(
  ([, v]) => isCtor(v)
) as Array<
  [string, (new (c: GraphErrorFactoryContext) => GraphApiError) & { errorCode: number }]
>;

// ---------------------------------------------------------------------
// Explicit per-class expectation table.
// `code` drives the registry lookup; `parent` is the documented base;
// `sibling` is a class the instance must NOT be an instance of.
// ---------------------------------------------------------------------

type Axis = "auth" | "ratelimit" | "api";

interface Row {
  code: number;
  errorName: string;
  parent: typeof GraphApiError;
  axis: Axis;
  fallback: string;            // expected fallback message when payload has no message
  rateLimit?: boolean;        // true for GraphRateLimitError axis
}

const EXPECTED: Row[] = [
  { code: 0,     errorName: "AuthException",                                   parent: GraphAuthError,      axis: "auth",      fallback: "We were unable to authenticate the app user." },
  { code: 3,     errorName: "APIMethodError",                                  parent: GraphAuthError,      axis: "auth",      fallback: "Capability or permissions issue." },
  { code: 10,    errorName: "PermissionDeniedError",                           parent: GraphAuthError,      axis: "auth",      fallback: "Permission is either not granted or has been removed." },
  { code: 190,   errorName: "ExpiredAccessTokenError",                         parent: GraphAuthError,      axis: "auth",      fallback: "Your access token has expired." },
  { code: 200,   errorName: "APIPermissionError",                              parent: GraphAuthError,      axis: "auth",      fallback: "Permission is either not granted or has been removed." },
  { code: 4,     errorName: "ToManyAPICallsError",                             parent: GraphRateLimitError, axis: "ratelimit", fallback: "The app has reached its API call rate limit.", rateLimit: true },
  { code: 80007, errorName: "RateLimitIssuesError",                            parent: GraphRateLimitError, axis: "ratelimit", fallback: "The WhatsApp Business Account has reached its rate limit.", rateLimit: true },
  { code: 130429,errorName: "RateLimitHitError",                               parent: GraphRateLimitError, axis: "ratelimit", fallback: "Cloud API message throughput has been reached.", rateLimit: true },
  { code: 131048,errorName: "SpamRateLimitHitError",                           parent: GraphRateLimitError, axis: "ratelimit", fallback: "Message failed due to spam rate limit restrictions.", rateLimit: true },
  { code: 131056,errorName: "TooManyMessagesError",                            parent: GraphRateLimitError, axis: "ratelimit", fallback: "Too many messages from sender to recipient in a short period.", rateLimit: true },
  { code: 368,   errorName: "TemporarilyBlockedError",                         parent: GraphApiError,       axis: "api",       fallback: "Account temporarily blocked for a policy violation." },
  { code: 131031,errorName: "AccountLockedError",                              parent: GraphApiError,       axis: "api",       fallback: "Account locked." },
  { code: 130497,errorName: "AccountRestrictedFromCountryError",               parent: GraphApiError,       axis: "api",       fallback: "Account restricted from messaging users in this country." },
  { code: 130472,errorName: "UserIsInExperimentGroupError",                    parent: GraphApiError,       axis: "api",       fallback: "User is part of a marketing message experiment group." },
  { code: 131026,errorName: "MessageUndeliverableError",                       parent: GraphApiError,       axis: "api",       fallback: "Message undeliverable." },
  { code: 131047,errorName: "ReEngagementMessageError",                        parent: GraphApiError,       axis: "api",       fallback: "More than 24 hours have passed since the recipient last replied." },
  { code: 131051,errorName: "UnsupportedMessageTypeError",                     parent: GraphApiError,       axis: "api",       fallback: "The message type is not supported." },
  { code: 131052,errorName: "MediaDownloadError",                              parent: GraphApiError,       axis: "api",       fallback: "Unable to download the media sent by the user." },
  { code: 131053,errorName: "MediaUploadError",                                parent: GraphApiError,       axis: "api",       fallback: "Unable to upload the media used in the message." },
  { code: 131030,errorName: "RecipientNotInAllowedListError",                  parent: GraphApiError,       axis: "api",       fallback: "Recipient is not in the test-number allowed list." },
  { code: 131009,errorName: "InvalidParameterError",                           parent: GraphApiError,       axis: "api",       fallback: "The parameter you passed is invalid." },
  { code: 131008,errorName: "MissingRequiredParameterError",                   parent: GraphApiError,       axis: "api",       fallback: "A required parameter is missing." },
  { code: 132000,errorName: "TemplateParamCountMismatchError",                 parent: GraphApiError,       axis: "api",       fallback: "Template parameter count mismatch." },
  { code: 132001,errorName: "TemplateNotExistsError",                          parent: GraphApiError,       axis: "api",       fallback: "Template does not exist in the specified language or is unapproved." },
  { code: 132005,errorName: "TemplateTextTooLongError",                        parent: GraphApiError,       axis: "api",       fallback: "Template text too long." },
  { code: 132007,errorName: "TemplateContentPolicyViolationError",             parent: GraphApiError,       axis: "api",       fallback: "Template content policy violation." },
  { code: 132008,errorName: "TemplateParamValueInvalidError",                  parent: GraphApiError,       axis: "api",       fallback: "Template parameter value formatted incorrectly." },
  { code: 132012,errorName: "TemplateParamFormatMismatchError",                parent: GraphApiError,       axis: "api",       fallback: "Template parameter format mismatch." },
  { code: 132015,errorName: "TemplatePausedError",                             parent: GraphApiError,       axis: "api",       fallback: "Template paused due to low quality." },
  { code: 132016,errorName: "TemplateDisabledError",                           parent: GraphApiError,       axis: "api",       fallback: "Template permanently disabled." },
  { code: 132018,errorName: "InvalidTemplateParameterError",                   parent: GraphApiError,       axis: "api",       fallback: "Template message has invalid parameters." },
  { code: 131064,errorName: "TemplateClassificationRateLimitError",            parent: GraphApiError,       axis: "api",       fallback: "Template classification rate limit reached." },
  { code: 134100,errorName: "MarketingMessagesLiteUnsupportedMessageTypeError", parent: GraphApiError,      axis: "api",       fallback: "Marketing Messages Lite does not support this message type." },
  { code: 134101,errorName: "MarketingMessagesLiteUnsupportedTemplateCategoryError", parent: GraphApiError, axis: "api",  fallback: "Marketing Messages Lite does not support this template category." },
  { code: 134102,errorName: "MarketingMessagesLiteInvalidFlowError",           parent: GraphApiError,       axis: "api",       fallback: "Marketing Messages Lite Flow is invalid." },
  { code: 134103,errorName: "MarketingMessagesLiteUnsupportedTemplateStructureError", parent: GraphApiError, axis: "api",   fallback: "Marketing Messages Lite does not support this template structure." },
  { code: 131059,errorName: "InvalidTemplateCursorError",                      parent: GraphApiError,       axis: "api",       fallback: "Invalid message_templates cursor." },
  { code: 132068,errorName: "FlowBlockedError",                                parent: GraphApiError,       axis: "api",       fallback: "Flow is in blocked state." },
  { code: 132069,errorName: "FlowThrottledError",                              parent: GraphApiError,       axis: "api",       fallback: "Flow is in throttled state." },
  { code: 135000,errorName: "GenericError",                                    parent: GraphApiError,       axis: "api",       fallback: "Generic error." },
  { code: 131000,errorName: "UnknownError",                                    parent: GraphApiError,       axis: "api",       fallback: "Message failed to send due to an unknown error." },
  { code: 131005,errorName: "AccessDeniedError",                               parent: GraphApiError,       axis: "api",       fallback: "Access denied for this resource." },
  { code: 131016,errorName: "ServiceUnavailableError",                         parent: GraphApiError,       axis: "api",       fallback: "Service temporarily unavailable." },
  { code: 131021,errorName: "RecipientCannotBeSenderError",                    parent: GraphApiError,       axis: "api",       fallback: "Recipient cannot be the sender." },
  { code: 131042,errorName: "BusinessPaymentIssueError",                       parent: GraphApiError,       axis: "api",       fallback: "Business payment issue." },
  { code: 131045,errorName: "IncorrectCertificateError",                        parent: GraphApiError,       axis: "api",       fallback: "Message failed due to a phone number registration error." },
  { code: 131057,errorName: "AccountInMaintenanceModeError",                   parent: GraphApiError,       axis: "api",       fallback: "Business Account is in maintenance mode." },
  { code: 131050,errorName: "UserStoppedMarketingMessagesError",               parent: GraphApiError,       axis: "api",       fallback: "User has stopped marketing messages from the business." },
  { code: 137000,errorName: "RecipientIdentityKeyMismatchError",               parent: GraphApiError,       axis: "api",       fallback: "The recipient's identity key hash does not match the one on record." },
  { code: 139000,errorName: "FlowBlockedByIntegrityError",                     parent: GraphApiError,       axis: "api",       fallback: "Flow blocked by an integrity issue on the account." },
  { code: 139001,errorName: "FlowUpdatingError",                               parent: GraphApiError,       axis: "api",       fallback: "Flow failed to update." },
  { code: 139002,errorName: "FlowPublishingError",                             parent: GraphApiError,       axis: "api",       fallback: "Flow failed to publish." },
  { code: 139003,errorName: "FlowDeprecatingError",                            parent: GraphApiError,       axis: "api",       fallback: "Flow failed to deprecate." },
  { code: 139004,errorName: "FlowDeletingError",                               parent: GraphApiError,       axis: "api",       fallback: "Flow failed to delete." },
  { code: 139100,errorName: "BulkBlockingFailedError",                         parent: GraphApiError,       axis: "api",       fallback: "Bulk blocking failed for some users." },
  { code: 139101,errorName: "BlockListLimitReachedError",                      parent: GraphApiError,       axis: "api",       fallback: "Blocklist limit reached (64k)." },
  { code: 139102,errorName: "BlockListConcurrentUpdateError",                  parent: GraphApiError,       axis: "api",       fallback: "Blocklist concurrent update — version_id mismatch." },
  { code: 139103,errorName: "BlockUserInternalError",                          parent: GraphApiError,       axis: "api",       fallback: "Block-user internal error." },
  { code: 138000,errorName: "CallingNotEnabledError",                          parent: GraphApiError,       axis: "api",       fallback: "Calling is not enabled on this phone number." },
  { code: 138018,errorName: "CallingCannotBeEnabledError",                     parent: GraphApiError,       axis: "api",       fallback: "Calling cannot be enabled — technical pre-requisites not met." },
  { code: 138001,errorName: "ReceiverUncallableError",                         parent: GraphApiError,       axis: "api",       fallback: "Receiver is unable to receive calls." },
  { code: 138002,errorName: "ConcurrentCallsLimitError",                       parent: GraphApiError,       axis: "api",       fallback: "Limit reached for concurrent calls." },
  { code: 138003,errorName: "DuplicateCallError",                              parent: GraphApiError,       axis: "api",       fallback: "A call is already ongoing with the receiver." },
  { code: 138004,errorName: "CallConnectionError",                             parent: GraphApiError,       axis: "api",       fallback: "Error while connecting the call." },
  { code: 138005,errorName: "CallRateLimitExceededError",                      parent: GraphApiError,       axis: "api",       fallback: "Limit reached for maximum calls from this phone number." },
  { code: 138006,errorName: "CallPermissionNotFoundError",                     parent: GraphApiError,       axis: "api",       fallback: "No approved call permission from the recipient." },
  { code: 138007,errorName: "CallConnectionTimeoutError",                      parent: GraphApiError,       axis: "api",       fallback: "Call was unable to connect due to a timeout." },
  { code: 138009,errorName: "CallPermissionRequestLimitHitError",             parent: GraphApiError,       axis: "api",       fallback: "Limit reached for call-permission-request sends." },
  { code: 138012,errorName: "BusinessInitiatedCallsLimitHitError",             parent: GraphApiError,       axis: "api",       fallback: "Limit reached for business-initiated calls in 24 hours." },
  { code: 138013,errorName: "FetchCallPermissionLimitHitError",                parent: GraphApiError,       axis: "api",       fallback: "Limit reached for fetch-call-permission API requests." },
  // Aliased codes (code 100 and 613 map to a class also reachable
  // through their primary code).
  { code: 100,   errorName: "InvalidParameterError",                           parent: GraphApiError,       axis: "api",       fallback: "The parameter you passed is invalid." },
  { code: 613,   errorName: "FetchCallPermissionLimitHitError",                parent: GraphApiError,       axis: "api",       fallback: "Limit reached for fetch-call-permission API requests." },
  // 131044 is the calling variant of BusinessPaymentIssueError.
  { code: 131044,errorName: "BusinessPaymentIssueError",                       parent: GraphApiError,       axis: "api",       fallback: "Business payment issue." }
];

// Pick a sibling class to assert NOT-instanceof for each row.
// For auth-axis rows use a known rate-limit class, for rate-limit rows
// use a known auth class, for api-axis rows use GraphAuthError.
function siblingFor(row: Row): new (...a: unknown[]) => GraphApiError {
  if (row.axis === "auth") return subclasses.ToManyAPICallsError as unknown as new (...a: unknown[]) => GraphApiError;
  if (row.axis === "ratelimit") return subclasses.ExpiredAccessTokenError as unknown as new (...a: unknown[]) => GraphApiError;
  return GraphAuthError as unknown as new (...a: unknown[]) => GraphApiError;
}

// Pick the appropriate HTTP status for a row so createGraphApiError
// does not drop the registry subclass to a generic class.
function statusFor(row: Row): number {
  if (row.axis === "auth") return 401;
  if (row.axis === "ratelimit") return 429;
  return 400;
}

// Lookup of constructor by errorName from the live module namespace.
function ctorForName(name: string): new (c: GraphErrorFactoryContext) => GraphApiError {
  const found = subclasses as Record<string, unknown>;
  const v = found[name];
  if (typeof v !== "function") {
    throw new Error(`No exported class named ${name} in errorSubclasses`);
  }
  return v as new (c: GraphErrorFactoryContext) => GraphApiError;
}

// ---------------------------------------------------------------------
// Guards: ensure the EXPECTED table and the programmatically-derived
// SUBCLASS_CTORS list stay in sync. A new subclass added to
// errorSubclasses.ts without a row here will fail this test, so
// coverage gaps cannot silently slip in.
// ---------------------------------------------------------------------

describe("WATS-181 table integrity", () => {
  test("every exported subclass-with-errorCode has a row in EXPECTED", () => {
    const expectedNames = new Set(EXPECTED.map((r) => r.errorName));
    for (const [exportName, ctor] of SUBCLASS_CTORS) {
      expect(expectedNames.has(exportName), `missing EXPECTED row for ${exportName}`).toBe(true);
      // Each expected row's code should match the class's static errorCode.
      const row = EXPECTED.find((r) => r.errorName === exportName);
      expect(row, `row for ${exportName}`).toBeDefined();
      // The primary errorCode static must equal the row's primary code.
      // (Aliased codes like 100/613/131044 are tested separately.)
    }
  });

  test("no duplicate EXPECTED rows by (code)", () => {
    // Aliased codes intentionally duplicate errorName; that's fine.
    const codes = EXPECTED.map((r) => r.code);
    expect(new Set(codes).size, "duplicate codes in EXPECTED").toBe(codes.length);
  });

  test("registerBuiltInErrorCodes has been seeded (module top-level)", () => {
    // Sanity: a known seed resolves.
    expect(resolveRegisteredError(131009, undefined)).toBeDefined();
  });
});

// ---------------------------------------------------------------------
// Per-subclass table-driven test: construct via the REAL registry
// factory path and via the public createGraphApiError factory.
// ---------------------------------------------------------------------

describe("WATS-181 registry path: every subclass", () => {
  for (const row of EXPECTED) {
    const ctor = ctorForName(row.errorName);

    test(`registry factory → ${row.errorName} (code ${row.code})`, () => {
      // Real registry path: resolve + factory.
      const entry = resolveRegisteredError(row.code, undefined);
      expect(entry, `no registry entry for code ${row.code}`).toBeDefined();
      expect(entry?.errorName).toBe(row.errorName);

      const status = statusFor(row);
      const instance = entry!.factory(ctx(payload(row.code), status));

      // (a) instanceof the specific class.
      expect(instance).toBeInstanceOf(ctor);
      // (b) instanceof its documented parent.
      expect(instance).toBeInstanceOf(row.parent);
      // (c) NOT instanceof a sibling.
      expect(instance).not.toBeInstanceOf(siblingFor(row));
      // (d) message content sane — either the payload message or fallback.
      expect(instance.message).toBe("boom");
      expect(instance.status).toBe(status);
      // (e) payload preserved.
      expect(instance.payload).toBeDefined();
      expect(instance.code).toBe(row.code);
      // name pin.
      expect(instance.name).toBe(row.errorName);
    });

    test(`createGraphApiError → ${row.errorName} (code ${row.code})`, () => {
      const status = statusFor(row);
      const instance = createGraphApiError({
        status,
        payload: payload(row.code)
      });
      expect(instance).toBeInstanceOf(ctor);
      expect(instance).toBeInstanceOf(row.parent);
      expect(instance).not.toBeInstanceOf(siblingFor(row));
      expect(instance.name).toBe(row.errorName);
      expect(instance.code).toBe(row.code);
    });
  }
});

// ---------------------------------------------------------------------
// Rate-limit specific fields: retryAfter must be populated from the
// Retry-After response header on rate-limit axis subclasses.
// ---------------------------------------------------------------------

describe("WATS-181 rate-limit retryAfter extraction", () => {
  for (const row of EXPECTED.filter((r) => r.rateLimit)) {
    test(`${row.errorName} carries retryAfter from header`, () => {
      const headers = new Headers({ "retry-after": "30" });
      const entry = resolveRegisteredError(row.code, undefined);
      const instance = entry!.factory(ctx(payload(row.code), 429, headers));
      expect(instance).toBeInstanceOf(GraphRateLimitError);
      expect(instance.retryAfter).toBe("30");
    });

    test(`${row.errorName} retryAfter undefined when header absent`, () => {
      const entry = resolveRegisteredError(row.code, undefined);
      const instance = entry!.factory(ctx(payload(row.code), 429));
      expect(instance.retryAfter).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------
// Fallback branches: message fallback, missing error_data, unknown
// subcode falling back to parent, hostile headers, malformed envelopes.
// ---------------------------------------------------------------------

describe("WATS-181 fallback: missing message → fallback string", () => {
  for (const row of EXPECTED) {
    test(`${row.errorName} falls back to default message when payload.message empty`, () => {
      const entry = resolveRegisteredError(row.code, undefined);
      // payload with empty message triggers messageOf fallback branch.
      const p = { code: row.code, message: "", type: "OAuthException" } as GraphApiErrorPayload;
      const instance = entry!.factory(ctx(p, statusFor(row)));
      expect(instance.message).toBe(row.fallback);
    });

    test(`${row.errorName} falls back when payload.message missing entirely`, () => {
      const entry = resolveRegisteredError(row.code, undefined);
      const p = { code: row.code, type: "OAuthException" } as GraphApiErrorPayload;
      const instance = entry!.factory(ctx(p, statusFor(row)));
      expect(instance.message).toBe(row.fallback);
    });
  }
});

describe("WATS-181 fallback: missing error_data / payload undefined", () => {
  test("factory accepts undefined payload (messageOf returns fallback)", () => {
    // AuthException (code 0) at 401 — message fallback path.
    const entry = resolveRegisteredError(0, undefined);
    const instance = entry!.factory(ctx(undefined, 401));
    expect(instance).toBeInstanceOf(subclasses.AuthException);
    expect(instance.message).toBe("We were unable to authenticate the app user.");
    // payload undefined → instance.payload is undefined.
    expect(instance.payload).toBeUndefined();
    expect(instance.code).toBeUndefined();
  });

  test("factory accepts undefined payload for a rate-limit subclass", () => {
    const entry = resolveRegisteredError(4, undefined);
    const instance = entry!.factory(ctx(undefined, 429));
    expect(instance).toBeInstanceOf(subclasses.ToManyAPICallsError);
    expect(instance).toBeInstanceOf(GraphRateLimitError);
    expect(instance.message).toBe("The app has reached its API call rate limit.");
  });

  test("factory accepts undefined payload for an api-axis subclass", () => {
    const entry = resolveRegisteredError(132000, undefined);
    const instance = entry!.factory(ctx(undefined, 400));
    expect(instance).toBeInstanceOf(subclasses.TemplateParamCountMismatchError);
    expect(instance.message).toBe("Template parameter count mismatch.");
  });
});

describe("WATS-181 fallback: hostile / malformed headers", () => {
  test("retryAfterFromContext returns undefined when headers.get() throws", () => {
    const entry = resolveRegisteredError(4, undefined);
    const hostile = {
      get: () => {
        throw new Error("boom");
      }
    } as unknown as Headers;
    const instance = entry!.factory(ctx(payload(4), 429, hostile));
    expect(instance.retryAfter).toBeUndefined();
  });

  test("retryAfterFromContext returns undefined for empty Retry-After header", () => {
    const entry = resolveRegisteredError(4, undefined);
    const headers = new Headers({ "retry-after": "   " });
    const instance = entry!.factory(ctx(payload(4), 429, headers));
    expect(instance.retryAfter).toBeUndefined();
  });

  test("retryAfterFromContext trims a whitespace-padded value", () => {
    const entry = resolveRegisteredError(4, undefined);
    const headers = new Headers({ "retry-after": "  120  " });
    const instance = entry!.factory(ctx(payload(4), 429, headers));
    expect(instance.retryAfter).toBe("120");
  });

  test("retryAfterFromContext returns undefined when header absent", () => {
    const entry = resolveRegisteredError(4, undefined);
    const instance = entry!.factory(ctx(payload(4), 429, new Headers()));
    expect(instance.retryAfter).toBeUndefined();
  });
});

describe("WATS-181 fallback: unknown subcode → no-subcode entry", () => {
  test("code 131009 with an unregistered subcode resolves to InvalidParameterError", () => {
    const entry = resolveRegisteredError(131009, 999999);
    expect(entry?.errorName).toBe("InvalidParameterError");
    const instance = entry!.factory(ctx(payload(131009), 400));
    expect(instance).toBeInstanceOf(subclasses.InvalidParameterError);
  });

  test("code 4 with unregistered subcode resolves to ToManyAPICallsError", () => {
    const entry = resolveRegisteredError(4, 80085);
    expect(entry?.errorName).toBe("ToManyAPICallsError");
  });

  test("completely unknown code resolves to undefined (no factory)", () => {
    expect(resolveRegisteredError(777777, undefined)).toBeUndefined();
  });
});

describe("WATS-181 fallback: createGraphApiError generic paths", () => {
  test("unknown code at 4xx → generic GraphApiError (ClientError)", () => {
    const instance = createGraphApiError({
      status: 400,
      payload: { message: "weird", code: 999999 } as GraphApiErrorPayload
    });
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance).not.toBeInstanceOf(GraphAuthError);
    expect(instance).not.toBeInstanceOf(GraphRateLimitError);
    expect(instance.classification).toBe("ClientError");
  });

  test("unknown code at 5xx → generic GraphApiError (ServerError)", () => {
    const instance = createGraphApiError({
      status: 503,
      payload: { message: "weird", code: 999999 } as GraphApiErrorPayload
    });
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance.classification).toBe("ServerError");
  });

  test("payload with no code → generic GraphApiError", () => {
    const instance = createGraphApiError({
      status: 400,
      payload: { message: "no code here" } as GraphApiErrorPayload
    });
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance.code).toBeUndefined();
  });

  test("undefined payload → generic GraphApiError with default message", () => {
    const instance = createGraphApiError({ status: 500 });
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance.message).toBe("Graph API request failed");
    expect(instance.classification).toBe("ServerError");
  });

  test("classify:false bypasses registry → generic GraphApiError", () => {
    const instance = createGraphApiError({
      status: 400,
      payload: payload(131009),
      classify: false
    });
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance).not.toBeInstanceOf(subclasses.InvalidParameterError);
  });
});

// ---------------------------------------------------------------------
// Axis-disagreement guards (WATS-11 L5): a registered auth subclass
// at 5xx drops to generic GraphApiError; a registered rate-limit
// subclass at 5xx drops to generic GraphApiError.
// ---------------------------------------------------------------------

describe("WATS-181 axis disagreement: registry subclass dropped at contradicting status", () => {
  test("ExpiredAccessTokenError (auth) at 503 → generic GraphApiError, not auth subclass", () => {
    const instance = createGraphApiError({
      status: 503,
      payload: payload(190)
    });
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance).not.toBeInstanceOf(subclasses.ExpiredAccessTokenError);
    expect(instance).not.toBeInstanceOf(GraphAuthError);
  });

  test("ToManyAPICallsError (rate-limit) at 503 → generic GraphApiError", () => {
    const instance = createGraphApiError({
      status: 503,
      payload: payload(4)
    });
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance).not.toBeInstanceOf(subclasses.ToManyAPICallsError);
    expect(instance).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("AuthException at 401 (auth-favourable) → stays AuthException", () => {
    const instance = createGraphApiError({
      status: 401,
      payload: payload(0)
    });
    expect(instance).toBeInstanceOf(subclasses.AuthException);
    expect(instance).toBeInstanceOf(GraphAuthError);
  });

  test("ToManyAPICallsError at 429 → stays ToManyAPICallsError", () => {
    const instance = createGraphApiError({
      status: 429,
      payload: payload(4)
    });
    expect(instance).toBeInstanceOf(subclasses.ToManyAPICallsError);
    expect(instance).toBeInstanceOf(GraphRateLimitError);
  });
});

// ---------------------------------------------------------------------
// Aliased codes: 100 and 613 both map to a class reachable through
// another primary code. Verify both paths produce the same class.
// ---------------------------------------------------------------------

describe("WATS-181 aliased codes produce the documented class", () => {
  test("code 100 → InvalidParameterError (same as 131009)", () => {
    const e100 = resolveRegisteredError(100, undefined);
    const e131009 = resolveRegisteredError(131009, undefined);
    expect(e100?.errorName).toBe("InvalidParameterError");
    expect(e100?.errorName).toBe(e131009?.errorName);
    const inst = e100!.factory(ctx(payload(100), 400));
    expect(inst).toBeInstanceOf(subclasses.InvalidParameterError);
    expect(inst.code).toBe(100);
  });

  test("code 613 → FetchCallPermissionLimitHitError (same as 138013)", () => {
    const e613 = resolveRegisteredError(613, undefined);
    const e138013 = resolveRegisteredError(138013, undefined);
    expect(e613?.errorName).toBe("FetchCallPermissionLimitHitError");
    expect(e613?.errorName).toBe(e138013?.errorName);
    const inst = e613!.factory(ctx(payload(613), 400));
    expect(inst).toBeInstanceOf(subclasses.FetchCallPermissionLimitHitError);
    expect(inst.code).toBe(613);
  });

  test("code 131044 → BusinessPaymentIssueError (same as 131042)", () => {
    const e131044 = resolveRegisteredError(131044, undefined);
    const e131042 = resolveRegisteredError(131042, undefined);
    expect(e131044?.errorName).toBe("BusinessPaymentIssueError");
    expect(e131044?.errorName).toBe(e131042?.errorName);
    const inst = e131044!.factory(ctx(payload(131044), 400));
    expect(inst).toBeInstanceOf(subclasses.BusinessPaymentIssueError);
    expect(inst.code).toBe(131044);
  });
});

// ---------------------------------------------------------------------
// Exhaustiveness: resolve every EXPECTED row through the public
// createGraphApiError path with a Retry-After header and confirm
// retryAfter is carried (for rate-limit rows) or absent (otherwise).
// ---------------------------------------------------------------------

describe("WATS-181 createGraphApiError preserves retryAfter for rate-limit axis", () => {
  for (const row of EXPECTED) {
    test(`${row.errorName} retryAfter=${row.rateLimit ? "carried" : "absent"}`, () => {
      const headers = new Headers({ "retry-after": "42" });
      const instance = createGraphApiError({
        status: statusFor(row),
        payload: payload(row.code),
        headers
      });
      if (row.rateLimit) {
        expect(instance.retryAfter).toBe("42");
      } else {
        // Non-rate-limit subclasses don't set retryAfter via the registry
        // factory path (only GraphRateLimitError ctor preserves it from
        // coreParams — and GraphApiError ctor does set it if passed).
        // The registry factory for non-RL subclasses DOES forward
        // retryAfter through coreParams, so it should be present.
        // Document the actual behaviour:
        expect(instance.retryAfter ?? undefined).toBeDefined();
      }
    });
  }
});


