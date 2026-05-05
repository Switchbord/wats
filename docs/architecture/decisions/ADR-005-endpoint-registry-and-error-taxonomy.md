# ADR-005: Endpoint Registry and Error Taxonomy

- status: Accepted
- date: 2026-04-21
- labels: [foundation, endpoints, errors, registry, scoped-clients]
- relatesTo: ADR-001 (API Shape), ADR-003 (Transport/Crypto), ADR-006 (Testing)

## Context

`GraphClient.request` today takes a hand-built path and arbitrary body.
Endpoints live as ad-hoc classes (`GraphMessagesEndpoint`) that interpolate
paths (`/${phoneNumberId}/messages`) and hand-validate one parameter.
Errors are classified in `createGraphApiError` by a hard-coded rate-limit
set `{4, 17, 32, 613}` and a loose auth heuristic.

Pywa's `pywa/errors.py` declares 80+ concrete `WhatsAppError` subclasses
routed by `(code, subcode)` under five axes (authorization, throttling,
integrity, send-message, server). WATS's parity commitment (ADR-001) means
we need similar cardinality. Endpoint surface area will grow rapidly
(messages, media, templates, flows, WABA, phone numbers, QR codes, block,
typing indicators), each with a method, path template with typed params, a
camelCase→snake_case body builder, a response parser, and a known error
subset.

Four drivers:

1. Arch-D (WATS-18): endpoint registry so new endpoints add data, not
   classes.
2. Arch-E (WATS-19): scoped sub-clients (`client.phone(id)`,
   `client.waba(id)`) binding path-identifiers once per call site.
3. Arch-M (WATS-27): error code registry scaling to 100+ codes with
   subcode branches.
4. Tighten classification boundaries (WATS-11 L5), cause scrubbing
   (WATS-13 L7), and input validation (WATS-4 M2, WATS-5 M3, M4 empty
   query) into one taxonomy.

## Decision

WATS adopts a data-driven `EndpointDef<Req, Res>` registry for every WhatsApp
Cloud API endpoint, consumed by `GraphClient.execute`. Sugar methods
(`client.messages.sendText`) are attached from the registry, not hand-written
per endpoint class. Errors extend the existing `GraphApiError` hierarchy with
registered per-code subclasses, routed by a `(code, subcode?)` table.

### Seam diagram

```
 consumer: client.phone("123").messages.sendText({ to, text })
     |
     v
 PhoneScopedClient.execute(endpointDef, req)
     |  bind { phoneNumberId } into path params
     v
 GraphClient.execute(endpointDef, req, { signal? })
     |  render path (typed template -> encoded URL)
     |  build body (camelCase -> snake_case, ADR-001)
     |  parse + map (responseParser, errorMap)
     v
 Transport.send  (ADR-003)
```

### defineEndpoint

Endpoints are frozen definitions. Path templates use `/{segmentName}/...`
and expose their parameter set through a compile-time template-literal
type, so `client.execute(endpoint, req)` cannot be called with a `req`
missing `phoneNumberId`.

```ts
// @switchbord/graph/endpoints
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ExtractPathParams<P extends string> =
  P extends `${string}{${infer Name}}${infer Rest}`
    ? Name | ExtractPathParams<Rest>
    : never;

export type PathParams<P extends string> = {
  readonly [K in ExtractPathParams<P>]: string;
};

export interface EndpointDef<
  Req extends object,
  Res,
  Path extends string = string
> {
  readonly method: HttpMethod;
  readonly path: Path;
  readonly pathParams: (req: Req) => PathParams<Path>;
  readonly bodyBuilder?: (req: Req) => unknown;
  readonly queryBuilder?: (req: Req) => Readonly<Record<string, string>>;
  readonly responseParser: (raw: unknown) => Res;
  readonly errorMap?: EndpointErrorMap;
  readonly headers?: Readonly<Record<string, string>>;
  readonly name: string;   // stable id for logging, e.g. "messages.sendText"
}

// defineEndpoint is the factory; input is structurally EndpointDef.
export function defineEndpoint<Req extends object, Res, Path extends string>(
  input: EndpointDef<Req, Res, Path>
): EndpointDef<Req, Res, Path>;

export interface EndpointErrorMap {
  readonly expectedCodes?: ReadonlySet<number>;
  readonly remap?: (raw: GraphApiErrorPayload, status: number) =>
    GraphApiError | undefined;
}
```

### Client execute

```ts
// @switchbord/graph/client
export interface GraphExecuteOptions {
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

export class GraphClient {
  constructor(config: GraphClientConfig);
  execute<Req extends object, Res, Path extends string>(
    endpoint: EndpointDef<Req, Res, Path>,
    req: Req,
    options?: GraphExecuteOptions
  ): Promise<Res>;
  phone(phoneNumberId: string): PhoneScopedClient;
  waba(wabaId: string): WabaScopedClient;
  // sugar groups resolved via registry (see below):
  readonly messages: MessagesGroup;
  readonly media: MediaGroup;
  readonly businessProfile: BusinessProfileGroup;
  readonly phoneNumbers: PhoneNumbersGroup;
  readonly templates: TemplatesGroup;
  readonly flows: FlowsGroup;
}
```

### Scoped sub-clients (WATS-19)

`client.phone(phoneNumberId)` narrows every endpoint under it so `req`
no longer carries `phoneNumberId`; `client.waba(wabaId)` is the equivalent
for WABA-scoped endpoints (templates, subscribed apps, phone-numbers list).
Both are structurally identical — one binds `phoneNumberId`, the other
`wabaId`:

```ts
// @switchbord/graph/client
export type OmitBoundField<T, K extends PropertyKey> = Omit<T, K>;

export interface PhoneScopedClient {
  readonly phoneNumberId: string;
  execute<Req extends { phoneNumberId: string }, Res, Path extends string>(
    endpoint: EndpointDef<Req, Res, Path>,
    req: OmitBoundField<Req, "phoneNumberId">,
    options?: GraphExecuteOptions
  ): Promise<Res>;
  readonly messages: ScopedMessagesGroup;
  readonly media: ScopedMediaGroup;
  readonly businessProfile: ScopedBusinessProfileGroup;
}

export interface WabaScopedClient {
  readonly wabaId: string;
  execute<Req extends { wabaId: string }, Res, Path extends string>(
    endpoint: EndpointDef<Req, Res, Path>,
    req: OmitBoundField<Req, "wabaId">,
    options?: GraphExecuteOptions
  ): Promise<Res>;
  readonly templates: ScopedTemplatesGroup;
  readonly phoneNumbers: ScopedPhoneNumbersGroup;
  readonly flows: ScopedFlowsGroup;
}
```

Binding rules: `phone(id)` / `waba(id)` validate `id` at call time using
the same `assertSafeGraphPathSegment` rules as `GraphClient.buildUrl`
(WATS-8) so scoped clients fail fast; scoped clients do not hide the
unscoped `execute`; `phoneNumberId` / `wabaId` are never defaulted from
environment variables (ADR-001).

### Sugar resolution

Sugar groups (`client.messages.sendText(req)`) are generated from a
module-level registry populated at package load:

```ts
// @switchbord/graph/endpoints/registry
export interface EndpointRegistryEntry {
  readonly group: "messages" | "media" | "businessProfile"
    | "phoneNumbers" | "templates" | "flows";
  readonly methodName: string;
  readonly endpoint: EndpointDef<object, unknown, string>;
  readonly scope: "phone" | "waba" | "root";
}
export function registerEndpoint(entry: EndpointRegistryEntry): void;
export function listEndpoints(): readonly EndpointRegistryEntry[];
```

Each endpoint module calls `registerEndpoint` per endpoint. `GraphClient`
sugar getters lazily materialise a method table from `listEndpoints()`
filtered by `scope === "root"`; scoped clients filter by `"phone"`/`"waba"`.

### Error taxonomy

The existing `GraphApiError` hierarchy is preserved and extended:

```
GraphApiError                     (status, code, subcode, fbtraceId, payload)
├── GraphAuthError                (401, OAuth — gated to 4xx per WATS-11)
├── GraphRateLimitError           (429 + code in rate-limit set)
├── GraphValidationError          (caller-side validation; renamed from
│                                  GraphRequestValidationError, broadened
│                                  to cover path/URL/header/body/query)
├── GraphSerializationError       (request/response JSON boundary)
├── GraphCapabilityError          (caller-side capability check failure)
└── <registered subclasses>       (from registerErrorCode, code-keyed)

GraphNetworkError                 (Transport-level; not GraphApiError)
```

```ts
// @switchbord/graph/errors
export class GraphApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly errorSubcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly payload?: GraphApiErrorPayload;
}

export class GraphAuthError extends GraphApiError {}
export class GraphRateLimitError extends GraphApiError {
  readonly retryAfterSeconds?: number;
}
export class GraphValidationError extends GraphApiError {
  readonly cause?: unknown;
}
export class GraphSerializationError extends GraphApiError {
  readonly cause?: unknown;
}
export class GraphCapabilityError extends GraphApiError {}
export class GraphNetworkError extends Error {
  readonly cause?: unknown;
}

export interface RegisteredErrorCode {
  readonly code: number;
  readonly subcode?: number;
  readonly errorName: string;            // e.g. "InvalidParameter"
  readonly factory: (params: {
    readonly message: string;
    readonly status: number;
    readonly payload?: GraphApiErrorPayload;
  }) => GraphApiError;
}

export function registerErrorCode(entry: RegisteredErrorCode): void;
export function resolveErrorClass(
  code: number | undefined,
  subcode: number | undefined,
  status: number
): RegisteredErrorCode["factory"] | undefined;

export function createGraphApiError(params: {
  readonly status: number;
  readonly payload?: GraphApiErrorPayload;
  readonly fallbackMessage?: string;
  readonly classify?: boolean;
}): GraphApiError;

export function scrubErrorCause(cause: unknown): unknown;
```

### Classification rules (WATS-11 L5, WATS-13 L7)

Order of checks in `createGraphApiError`:

1. `(code, subcode?)` resolves via `resolveErrorClass` → construct registered
   subclass.
2. Else `status === 401` OR (`payload.type === "OAuthException"` AND
   `status` in `[400, 499]`) → `GraphAuthError`. (WATS-11 fix: OAuth-type
   classification is now gated to 4xx; a 5xx with a stray `OAuthException`
   no longer becomes a caller-side auth failure.)
3. Else `status === 429` OR `payload.code` in rate-limit set
   `{4, 17, 32, 613}` → `GraphRateLimitError`.
4. Else → plain `GraphApiError`.

Rate-limit set is externalised to `RATE_LIMIT_CODES` in the registry module
so it can grow without client.ts churn.

`GraphNetworkError.cause` always passes through `scrubErrorCause` (WATS-13):
strip `Authorization`/`Cookie`/`Set-Cookie`/`Proxy-Authorization` from any
embedded `Request`; redact `url.searchParams.access_token` to `"***"`;
replace body buffers with `"[redacted: <byteLength> bytes]"`; coerce
non-Error values to `{ message: String(cause) }`.

### Initial registered error codes (WATS-27 sample)

Seed set from pywa's taxonomy to validate the registry shape — not a cap.
Format: `code[.subcode] HTTP SubclassName`.

```
authorization:
  0            401  AuthException
  3            400  ApiMethod
  10           403  PermissionDenied
  190          401  ExpiredAccessToken
  200          403  ApiPermission
throttling:
  4            429  TooManyApiCalls
  17           429  UserRequestLimitReached
  32           429  PageRequestLimitReached
  613          429  RateLimitIssues
  80007        429  RateLimitHit
  130429       429  SpamRateLimitHit
  131048       429  TooManyMessages
integrity:
  368          403  TemporarilyBlocked
  131031       403  AccountLocked
send-message:
  100          400  InvalidParameter
  100.2494023  400  UserNumberInvalid
  131026       400  MessageUndeliverable
  131030       400  RecipientNotInAllowedList
  131042       400  PaymentsRequired
  131047       400  ReEngagementMessage
  131051       400  UnsupportedMessageType
  131052       400  MediaDownloadError
  131053       500  MediaUploadError
  132000       400  TemplateParamCountMismatch
  132001       400  TemplateNotExists
  132005       400  TemplateTextTooLong
  132007       400  TemplateContentPolicyViolation
  132012       400  TemplateParamValueInvalid
  132015       400  TemplatePaused
  132016       400  TemplateDisabled
  139000       400  FlowBlocked
  139001       400  FlowThrottled
server:
  1            500  UnknownError
  2            503  ServiceUnavailable
```

Registration runs at import time in `@switchbord/graph/errors/codes.ts`;
consumers may call `registerErrorCode` to layer app-specific subclasses.

### Input-rejection policy (M2, M3, M4)

- **M2**: `GraphClientConfig.baseUrl` must parse with `pathname === "/"`;
  non-root pathnames throw `GraphValidationError` from the constructor
  (see ADR-003).
- **M3**: `baseUrl`/`apiVersion` validated in the constructor, not on
  first `execute`.
- **M4**: `queryBuilder` returns `Readonly<Record<string, string>>`; the
  string type prevents `null`/`undefined` leaks, and empty-string values
  are rejected as `GraphValidationError { code: "empty_query_value", key }`.
  Caller-side input contract centralised in the registry.

### Consumer-fixture test contract

`defineEndpoint` is imported from `@switchbord/graph` in an external fixture under
`packages/testing/fixtures/graph-consumer/` (see ADR-006). The fixture
imports `defineEndpoint`, `EndpointDef`, `GraphClient`, `PhoneScopedClient`;
constructs a sample endpoint with a 2-parameter path template; asserts via a
type-level helper that omitting a path param is a TS error and that
`ExtractPathParams` returns the expected union; and round-trips execution
through a `MockTransport`. This is the only compile-time check that the
registry actually narrows across the package boundary under
`moduleResolution: "bundler"`.

## Consequences

Positive:

- Adding an endpoint is a data file, not a new class; all endpoints benefit
  uniformly from interceptors, retries, and error classification.
- Scoped clients remove `phoneNumberId`/`wabaId` from every call site.
- Error taxonomy matches pywa's cardinality without copying its class tree;
  `registerErrorCode` lets integrators layer in private subclasses.

Negative:

- Two call styles (`client.messages.sendText` vs `client.execute(...)`).
  The sugar form is canonical; `execute` is the power-user escape.
- `registerEndpoint` relies on import-time side effects. Accepted because
  endpoint modules are unconditionally loaded and the registry is
  idempotent-keyed by `(group, methodName)` (throws on duplicate).
- Template-literal types raise type-check cost modestly; measured in CI
  via `bun tsc --noEmit`.

## Alternatives considered

- **OpenAPI-driven codegen.** Rejected for 0.x: Meta's spec drifts from
  behaviour; pywa hand-writes endpoints for the same reason.
- **Endpoint classes + error registry only.** Rejected: duplicates
  camelCase→snake_case body logic and loses scoped-client narrowing.
- **Path params in input type without a template string.** Rejected: loses
  "where does phoneNumberId land" documentation and makes path renames
  silent at runtime.
- **Discriminated-union `Req` per endpoint.** Rejected: forces discriminants
  callers don't need; pywa confirms one endpoint = one request shape.
- **Single `GraphError` with a `kind` field.** Rejected: explicit subclasses
  let TypeScript narrow on `instanceof`, which is what application error
  handlers reach for.

## Linear issues resolved

- WATS-4 (M2): baseUrl prefix validation — with ADR-003.
- WATS-5 (M3): baseUrl/apiVersion validation timing fixed via constructor.
- WATS-11 (L5): OAuth classification gated to 4xx; rate-limit set
  externalised and extensible.
- WATS-13 (L7): `scrubErrorCause` exported; used by transport and by every
  `GraphNetworkError` construction.
- WATS-18 (Arch-D): endpoint registry pattern.
- WATS-19 (Arch-E): scoped sub-clients.
- WATS-27 (Arch-M): error code registry shape and seed table.
- Partially M4 (empty query rejection): enforced by `queryBuilder` signature.

## Public API call-site sketch

```ts
// (signatures already declared in the sections above)
// client.execute(messagesSendText, { phoneNumberId, to, text });
// client.phone(phoneNumberId).messages.sendText({ to, text });
// client.waba(wabaId).templates.list({});
// registerErrorCode({ code: 100, subcode: 2494023,
//                     errorName: "UserNumberInvalid", factory });
```

## Interop notes

- **Bun/Node/Deno/Workers/Edge**: registry is pure data + plain functions;
  no runtime-specific deps. Import-time registration writes to a
  module-level `Map` (single-instance per realm on all supported runtimes).
- **Tree-shaking**: consumers importing `@switchbord/graph/endpoints/<group>`
  directly skip unused endpoint modules; sugar groups resolve lazily so
  untouched groups don't pull their endpoint modules.
- **React Native / browsers**: identical to Workers for the registry;
  Transport/Crypto interop is owned by ADR-003.

## Open questions

- `EndpointErrorMap.remap` input: payload-only today, but `Retry-After`
  parsing on rate-limit errors will want headers. Likely extended before
  1.0.
- `client.withHeader(k, v)` decoration distinct from `client.phone(id)` —
  deferred to a later ADR on cross-cutting request decorators.
- Sugar-group naming (`businessProfile` vs `profile` vs `business`) —
  final pick locked during the F-step that lands those endpoints.
