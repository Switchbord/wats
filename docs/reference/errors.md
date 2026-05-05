# Errors Reference

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-21

## Purpose

Define WATS error model, taxonomy, and propagation behavior.

## Scope

- Error classes and codes
- Retryability semantics
- Mapping to transport-level failures
- Error Code Registry (F-5)

## API Surface

### Graph error class hierarchy (B2 + F-4 + F-5)

`@switchbord/graph` defines a single-inheritance hierarchy of typed errors:

```
Error
├── GraphApiError                     (status, code, errorSubcode, fbtraceId, payload, classification)
│   ├── GraphAuthError                (OAuth/permission failures; WATS-11 L5: 4xx-only)
│   │   ├── AuthException             (code 0 — pywa AuthException)
│   │   ├── APIMethodError            (code 3 — pywa APIMethod)
│   │   ├── PermissionDeniedError     (code 10 — pywa PermissionDenied)
│   │   ├── ExpiredAccessTokenError   (code 190 — pywa ExpiredAccessToken)
│   │   └── APIPermissionError        (code 200 representative; pywa range 200..299)
│   ├── GraphRateLimitError           (throttling; HTTP 429 OR 4xx + code in RATE_LIMIT_CODES)
│   │   ├── ToManyAPICallsError       (code 4 — pywa ToManyAPICalls)
│   │   ├── RateLimitIssuesError      (code 80007)
│   │   ├── RateLimitHitError         (code 130429)
│   │   ├── SpamRateLimitHitError     (code 131048)
│   │   └── TooManyMessagesError      (code 131056)
│   ├── GraphRequestValidationError   (caller-side validation; construction-time + path/header)
│   ├── GraphSerializationError       (JSON boundary)
│   └── <registered subclasses>       (per-code; see Error Code Registry)
└── GraphNetworkError                 (Transport-level, NOT a GraphApiError subclass)
```

Every `GraphApiError` instance carries:

| Field | Type | Description |
| --- | --- | --- |
| `status` | `number` | HTTP status code of the response. |
| `code` | `number \| undefined` | Graph error code from `payload.error.code`. |
| `errorSubcode` | `number \| undefined` | Graph error subcode from `payload.error.error_subcode`. |
| `type` | `string \| undefined` | Graph error type (e.g. `OAuthException`). |
| `fbtraceId` | `string \| undefined` | Graph trace id. |
| `payload` | `GraphApiErrorPayload \| undefined` | Original envelope payload (camelCase-unchanged). |
| `classification` | `"ClientError" \| "ServerError" \| "Unknown"` | Coarse HTTP-status-driven bucket (F-5). |

### Error Code Registry (F-5, WATS-27 Arch-M)

ADR-005 defines the error code registry. `@switchbord/graph` exposes three
functions:

```ts
import {
  registerErrorCode,
  resolveRegisteredError,
  clearErrorRegistry
} from "@switchbord/graph";

registerErrorCode({
  code: 131079,                       // required: finite non-negative number
  subcode: 2494023,                   // optional: narrower match
  errorName: "MyCustomError",         // required: non-empty string
  factory: (ctx) => new MyCustomError(ctx) // required: function
});

const entry = resolveRegisteredError(131079, 2494023);
// entry?.errorName === "MyCustomError"
```

Input validation rules (registerErrorCode throws on violation):

- `code` must be a `number`, finite, integer, and non-negative.
- `subcode`, when provided, must be a finite, integer `number` and
  non-negative (symmetric with `code`).
- `errorName` must be a non-empty string.
- `factory` must be a function.

Resolution semantics:

1. Exact `(code, subcode)` match wins.
2. Falls back to the any-subcode `(code, undefined)` entry.
3. Returns `undefined` when no entry matches either key.

Last-writer-wins: re-registering the same `(code, subcode?)` key
replaces the prior entry. This lets consumers override built-in
subclasses without a separate deregister call.

`clearErrorRegistry()` empties the registry AND resets the built-in-seed
guard so a subsequent `registerBuiltInErrorCodes()` call re-seeds. It is
the single public reset hook — there is no separate
`clearErrorRegistryForTesting`. The F-5 remediation consolidated the
guard into the registry module to eliminate a footgun where the public
`clearErrorRegistry()` silently left built-ins marked "already
registered" and subsequent `registerBuiltInErrorCodes()` calls
no-opped.

Consumer registering a private subclass:

```ts
import {
  GraphApiError,
  registerErrorCode,
  type GraphErrorFactoryContext
} from "@switchbord/graph";

class MyCustomError extends GraphApiError {
  static readonly errorCode = 131079;
  constructor(ctx: GraphErrorFactoryContext) {
    super({
      message: ctx.payload?.message ?? "custom",
      status: ctx.status,
      payload: ctx.payload
    });
    this.name = "MyCustomError";
  }
}

registerErrorCode({
  code: 131079,
  errorName: "MyCustomError",
  factory: (ctx) => new MyCustomError(ctx)
});
```

### Classification decision tree (WATS-11 L5)

`createGraphApiError({ status, payload, ... })` follows this exact
**order of checks** — no fall-through reordering:

1. **Registry match**. If `payload.code` resolves via
   `resolveRegisteredError(code, subcode)`, construct the registered
   subclass. If the resulting instance is an auth or rate-limit
   subclass but the HTTP status contradicts (e.g., code 190 at 500),
   drop to step 4 to avoid a misclassified auth error at 5xx.
2. **Auth axis (4xx-only)**. If `status === 401 || 403`, OR
   `payload.type === "OAuthException"` with `status ∈ [400..500)`, OR
   `payload.code === 190` with `status ∈ [400..500)` → `GraphAuthError`.
   A 5xx with a stray `OAuthException` does NOT classify as auth
   (WATS-11 L5 regression: OAuth-on-5xx → ServerError, not auth).
3. **Rate-limit axis (HTTP-coherent)**. If `status === 429` OR
   (`status ∈ [400..500)` AND `payload.code ∈ RATE_LIMIT_CODES`) →
   `GraphRateLimitError`. A 500 with a stray code 4 does NOT
   classify as throttling.
4. **Plain GraphApiError**. `classification` is derived from the
   status band:
   - 4xx → `"ClientError"`
   - 5xx → `"ServerError"`
   - anything else → `"Unknown"`

`RATE_LIMIT_CODES` is exported as a `ReadonlySet<number>`:
`{4, 80007, 130429, 131048, 131056}`.

### Seeded error codes (reconciled from pywa/errors.py)

The following subclasses are registered at module load, sourced from
pywa's `errors.py` canonical mapping. Each subclass extends the parent
indicated by its axis; each has a unique `name` and a
`static readonly errorCode`. Sibling assertions in tests are expected
to rely on these identities.

`RATE_LIMIT_CODES` is the external set used by the HTTP-status-coherent
rate-limit classification: `{4, 80007, 130429, 131048, 131056}`.

| Code | Subclass | Parent | Axis | pywa source |
| ---: | --- | --- | --- | --- |
| 0 | `AuthException` | `GraphAuthError` | authorization | `AuthException` |
| 3 | `APIMethodError` | `GraphAuthError` | authorization | `APIMethod` |
| 4 | `ToManyAPICallsError` | `GraphRateLimitError` | rate-limit | `ToManyAPICalls` |
| 10 | `PermissionDeniedError` | `GraphAuthError` | authorization | `PermissionDenied` |
| 100 | `InvalidParameterError` | `GraphApiError` | send-message | (WATS augmentation — aliases pywa's 131009) |
| 190 | `ExpiredAccessTokenError` | `GraphAuthError` | authorization | `ExpiredAccessToken` |
| 200 | `APIPermissionError` | `GraphAuthError` | authorization | `APIPermission` (representative of `range(200, 300)`) |
| 368 | `TemporarilyBlockedError` | `GraphApiError` | integrity | `TemporarilyBlocked` |
| 613 | `FetchCallPermissionLimitHitError` | `GraphApiError` | calling | `FetchCallPermissionLimitHit` (alias of 138013) |
| 80007 | `RateLimitIssuesError` | `GraphRateLimitError` | rate-limit | `RateLimitIssues` |
| 130429 | `RateLimitHitError` | `GraphRateLimitError` | rate-limit | `RateLimitHit` |
| 130472 | `UserIsInExperimentGroupError` | `GraphApiError` | send-message | `UserIsInExperimentGroup` |
| 130497 | `AccountRestrictedFromCountryError` | `GraphApiError` | integrity | `AccountRestrictedFromCountry` |
| 131000 | `UnknownError` | `GraphApiError` | send-message | `UnknownError` |
| 131005 | `AccessDeniedError` | `GraphApiError` | send-message | `AccessDenied` |
| 131008 | `MissingRequiredParameterError` | `GraphApiError` | send-message | `MissingRequiredParameter` |
| 131009 | `InvalidParameterError` | `GraphApiError` | send-message | `InvalidParameter` |
| 131016 | `ServiceUnavailableError` | `GraphApiError` | send-message | `ServiceUnavailable` |
| 131021 | `RecipientCannotBeSenderError` | `GraphApiError` | send-message | `RecipientCannotBeSender` |
| 131026 | `MessageUndeliverableError` | `GraphApiError` | send-message | `MessageUndeliverable` |
| 131030 | `RecipientNotInAllowedListError` | `GraphApiError` | send-message | `RecipientNotInAllowedList` |
| 131031 | `AccountLockedError` | `GraphApiError` | integrity | `AccountLocked` |
| 131042 | `BusinessPaymentIssueError` | `GraphApiError` | send-message | `BusinessPaymentIssue` |
| 131044 | `BusinessPaymentIssueError` | `GraphApiError` | send-message | `BusinessPaymentIssue` (calling-path code) |
| 131045 | `IncorrectCertificateError` | `GraphApiError` | send-message | `IncorrectCertificate` |
| 131047 | `ReEngagementMessageError` | `GraphApiError` | send-message | `ReEngagementMessage` |
| 131048 | `SpamRateLimitHitError` | `GraphRateLimitError` | rate-limit | `SpamRateLimitHit` |
| 131050 | `UserStoppedMarketingMessagesError` | `GraphApiError` | send-message | `UserStoppedMarketingMessages` |
| 131051 | `UnsupportedMessageTypeError` | `GraphApiError` | send-message | `UnsupportedMessageType` |
| 131052 | `MediaDownloadError` | `GraphApiError` | send-message | `MediaDownloadError` |
| 131053 | `MediaUploadError` | `GraphApiError` | send-message | `MediaUploadError` |
| 131056 | `TooManyMessagesError` | `GraphRateLimitError` | rate-limit | `TooManyMessages` |
| 131057 | `AccountInMaintenanceModeError` | `GraphApiError` | send-message | `AccountInMaintenanceMode` |
| 132000 | `TemplateParamCountMismatchError` | `GraphApiError` | template | `TemplateParamCountMismatch` |
| 132001 | `TemplateNotExistsError` | `GraphApiError` | template | `TemplateNotExists` |
| 132005 | `TemplateTextTooLongError` | `GraphApiError` | template | `TemplateTextTooLong` |
| 132007 | `TemplateContentPolicyViolationError` | `GraphApiError` | template | `TemplateContentPolicyViolation` |
| 132008 | `TemplateParamValueInvalidError` | `GraphApiError` | template | `TemplateParamValueInvalid` |
| 132012 | `TemplateParamFormatMismatchError` | `GraphApiError` | template | `TemplateParamFormatMismatch` |
| 132015 | `TemplatePausedError` | `GraphApiError` | template | `TemplatePaused` |
| 132016 | `TemplateDisabledError` | `GraphApiError` | template | `TemplateDisabled` |
| 132068 | `FlowBlockedError` | `GraphApiError` | flow | `FlowBlocked` |
| 132069 | `FlowThrottledError` | `GraphApiError` | flow | `FlowThrottled` |
| 135000 | `GenericError` | `GraphApiError` | send-message | `GenericError` |
| 137000 | `RecipientIdentityKeyMismatchError` | `GraphApiError` | send-message | `RecipientIdentityKeyMismatch` |
| 138000 | `CallingNotEnabledError` | `GraphApiError` | calling | `CallingNotEnabled` |
| 138001 | `ReceiverUncallableError` | `GraphApiError` | calling | `ReceiverUncallable` |
| 138002 | `ConcurrentCallsLimitError` | `GraphApiError` | calling | `ConcurrentCallsLimit` |
| 138003 | `DuplicateCallError` | `GraphApiError` | calling | `DuplicateCall` |
| 138004 | `CallConnectionError` | `GraphApiError` | calling | `CallConnectionError` |
| 138005 | `CallRateLimitExceededError` | `GraphApiError` | calling | `CallRateLimitExceeded` |
| 138006 | `CallPermissionNotFoundError` | `GraphApiError` | calling | `CallPermissionNotFound` |
| 138007 | `CallConnectionTimeoutError` | `GraphApiError` | calling | `CallConnectionTimeout` |
| 138009 | `CallPermissionRequestLimitHitError` | `GraphApiError` | calling | `CallPermissionRequestLimitHit` |
| 138012 | `BusinessInitiatedCallsLimitHitError` | `GraphApiError` | calling | `BusinessInitiatedCallsLimitHit` |
| 138013 | `FetchCallPermissionLimitHitError` | `GraphApiError` | calling | `FetchCallPermissionLimitHit` |
| 138018 | `CallingCannotBeEnabledError` | `GraphApiError` | calling | `CallingCannotBeEnabled` |
| 139000 | `FlowBlockedByIntegrityError` | `GraphApiError` | flow | `FlowBlockedByIntegrity` |
| 139001 | `FlowUpdatingError` | `GraphApiError` | flow | `FlowUpdatingError` |
| 139002 | `FlowPublishingError` | `GraphApiError` | flow | `FlowPublishingError` |
| 139003 | `FlowDeprecatingError` | `GraphApiError` | flow | `FlowDeprecatingError` |
| 139004 | `FlowDeletingError` | `GraphApiError` | flow | `FlowDeletingError` |
| 139100 | `BulkBlockingFailedError` | `GraphApiError` | block-user | `BulkBlockingFailed` |
| 139101 | `BlockListLimitReachedError` | `GraphApiError` | block-user | `BlockListLimitReached` |
| 139102 | `BlockListConcurrentUpdateError` | `GraphApiError` | block-user | `BlockListConcurrentUpdate` |
| 139103 | `BlockUserInternalError` | `GraphApiError` | block-user | `BlockUserInternalError` |

Naming convention: pywa class name verbatim with an `Error` suffix
appended unless the pywa class already ends in `Error` or `Exception`.
So `AuthException` stays as-is; `ExpiredAccessToken` →
`ExpiredAccessTokenError`; `MediaDownloadError` stays.

Source: `/tmp/wats-research/pywa/pywa/errors.py`. Adding a new code is
a data change — a new entry in
`packages/graph/src/errorSubclasses.ts`'s `BUILT_IN_SEEDS` array plus
a class definition.

### Ranges in pywa vs discrete registration

pywa's `errors.py` occasionally binds a range (or a tuple) of error
codes to a single class:

- `APIPermission.__error_codes__ = range(200, 300)` — any of
  200..299 counts as a permission failure.
- `BusinessPaymentIssue.__error_codes__ = (131042, 131044)` —
  two discrete codes share the class.
- `FetchCallPermissionLimitHit.__error_codes__ = (138013, 613)` —
  WhatsApp changed the code from 138013 to 613 at some point, so
  pywa binds both.

WATS's registry is keyed by discrete `(code, subcode?)` pairs and
does NOT currently support range-scoped registrations. The F-5
remediation takes the precision-limited route per WATS-29:

- For `range(200, 300)`: WATS registers **only** the start code
  (200) as a representative `APIPermissionError`. Codes 201..299
  fall through to the generic classifier and surface as
  `GraphAuthError` or `GraphApiError` based on HTTP status, without
  the `APIPermissionError` subclass identity.
- For tuple-bound classes: every code in the tuple is registered
  individually, all pointing at the same class. So
  `BusinessPaymentIssueError` resolves for both 131042 and 131044;
  `FetchCallPermissionLimitHitError` resolves for both 138013 and
  613.

Adding range-scoped registrations is a potential future extension
(e.g. `registerErrorCode({ codeRange: [200, 300), ... })`). Not
scoped to F-5.

### Retry-After header

`GraphErrorFactoryContext` carries `headers: Headers`, so a factory
COULD inspect the `Retry-After` response header. F-5's built-in
subclasses do NOT currently consult headers: rate-limit
classification is based purely on HTTP status + payload code (see
the decision tree above), and no back-off hint is attached to
`GraphRateLimitError` instances. This is a deliberate forward
declaration — header-aware remap (e.g. parsing `Retry-After` into a
millisecond delay on `GraphRateLimitError`) is out of scope for F-5
and deferred to a later feature. Consumers that need `Retry-After`
parsing today must read it themselves from
`error.payload ? ... : response.headers`.

### `GraphRequestValidationError` (F-4)

Thrown when request-path or construction-time validation fails:

- Construction-time: `accessToken` non-empty, non-whitespace, ≤ 4096
  chars, no CR/LF/NUL/control; `apiVersion` matches
  `/^v\d+(\.\d+)?$/`; `baseUrl` parses and has protocol `http:`/`https:`
  (no `javascript:`/`file:`/`ftp:`/`data:`/`about:`/`blob:`).
- Request-time: path dot-segments, traversal patterns, `?`/`#` injection,
  ASCII control characters; CR/LF/NUL in header names or values;
  `authorization` header override (managed by the client).
- Messages endpoint: invalid numeric `phoneNumberId` path segment.

`GraphRequestValidationError` extends `GraphApiError`, so pre-existing
`instanceof GraphApiError` checks remain valid.

### `GraphSerializationError`

Thrown when JSON serialization of request body fails (e.g. cyclic
objects) or when a 2xx response declares JSON but contains invalid
JSON.

### `GraphNetworkError`

Thrown when the underlying `Transport` fails before an HTTP response is
received (fetch-level throws, DNS, connection errors, missing fetch
runtime). Deliberately NOT a `GraphApiError` subclass: there is no HTTP
status to classify.

### `scrubErrorCause(err: unknown): unknown` (F-4, WATS-13 L7)

Log/metrics sinks frequently print errors verbatim and accidentally
leak the caller's access token when an error message contains
`Authorization: Bearer <token>`. `scrubErrorCause` returns a
shallow-cloned copy of `err` with every `Bearer <token>` substring in
`message`, `stack`, and the `cause` chain redacted to `Bearer ***`.

Guarantees:

- String input: returns the redacted string.
- `Error` instance: returns a clone with `message`/`stack` redacted AND
  the prototype preserved (so `instanceof Error`,
  `instanceof GraphApiError`, etc. still succeed on the scrubbed value).
- Cause chain: `cause` is recursively redacted at unbounded depth with
  a `WeakSet`-backed cycle guard, so pathological self-referential
  causes terminate cleanly without stack overflow.
- Enumerable own string properties on the cloned error are also redacted.
- Non-Error / non-string values (numbers, `null`, `undefined`, plain
  objects without a string `.message`): returned unchanged.

Example:

```ts
import { scrubErrorCause } from "@switchbord/graph";

try {
  await client.request({ method: "GET", path: "/me" });
} catch (error) {
  logger.error("graph.request.failed", scrubErrorCause(error));
  throw error; // rethrow the original for upstream handlers
}
```

Scope note: `scrubErrorCause` deliberately does NOT recurse into
arbitrary nested object graphs that are not error-like. If you log a
plain `Record<string, unknown>` containing `Bearer …` inside a nested
field, redact that yourself at the log boundary.

### Envelope + predicates

Exports related to mapping:

- `createGraphApiError(...)` — entry point described in the decision
  tree above.
- `isGraphErrorEnvelope(...)` — type guard for `{ error: {...} }` shape.
- `isGraphApiErrorPayload(...)` — type guard for the payload record.
- `GraphApiErrorPayload`, `GraphErrorEnvelope` — typed interfaces.
- `GraphErrorClassification` — `"ClientError" | "ServerError" | "Unknown"`.
- `RATE_LIMIT_CODES` — `ReadonlySet<number>` of throttling codes.

The request primitive inspects Graph JSON error envelopes only for
non-2xx responses. A 2xx response that happens to contain an `error`
object is treated as a success payload by default. Non-envelope
fallback handling disables subclass classification intentionally:
these failures always remain base `GraphApiError` regardless of
`code: 190`-style fields.

## HTTP webhook verification errors (C1)

`@switchbord/http` C1 primitives return typed error objects (result unions)
rather than throwing for expected verification failures.

Challenge verification (`verifyWebhookChallenge`) error codes:

- `invalid_expected_verify_token` (`status: 500`) when configured
  expected verify token is missing, non-string, empty, or whitespace-only.
- `invalid_mode` (`status: 403`)
- `invalid_verify_token` (`status: 403`)
- `missing_challenge` (`status: 400`)
- `crypto_provider_unavailable` (`status: 500`, F-3) when `input.crypto`
  is omitted AND the default `createCryptoProvider()` factory raises
  `UnsupportedCapabilityError`.

Signature verification (`validateWebhookSignature`) error codes:

- `invalid_app_secret`
- `invalid_raw_body` (F-3) — `null`/`undefined`/plain objects/numbers/
  booleans/arrays/symbols/functions rejected; `SharedArrayBuffer`-backed
  views and detached buffers rejected too.
- `missing_signature`
- `invalid_signature_format`
- `signature_mismatch`
- `crypto_provider_unavailable` (F-3)

Both functions are `async` and route cryptographic primitives through
the `@switchbord/crypto` `CryptoProvider` seam.

## Usage Examples

Catching and classifying a Graph failure:

```ts
import {
  GraphApiError,
  GraphAuthError,
  GraphRateLimitError,
  InvalidParameterError,
  RecipientIdentityKeyMismatchError,
  UnsupportedMessageTypeError,
  scrubErrorCause
} from "@switchbord/graph";

try {
  await client.messages.sendMessage({ phoneNumberId, to, text });
} catch (error) {
  if (error instanceof InvalidParameterError) {
    // code 100 — caller fix needed.
  } else if (error instanceof UnsupportedMessageTypeError) {
    // code 131051 — message type not supported; fall back or drop.
  } else if (error instanceof GraphAuthError) {
    // rotate access token.
  } else if (error instanceof GraphRateLimitError) {
    // back off; consult Retry-After.
  } else if (error instanceof GraphApiError) {
    logger.error("graph.unhandled", scrubErrorCause(error));
  } else {
    throw error;
  }
}
```

## Parity Notes

WATS mirrors pywa's `errors.py` taxonomy via the registry. Adding a new
code is a data change — no new bespoke class required beyond the
subclass declaration. See `docs/parity/pywa-parity-matrix.md` row
"Error model" for the current parity state.

## Open Questions

- `EndpointErrorMap.remap` will want access to `Retry-After` headers
  before 1.0; currently the factory context exposes headers but the
  built-in subclasses do not yet parse them.
- `GraphCapabilityError` is reserved for a later ADR when
  feature-gated endpoints arrive (F-13+).
