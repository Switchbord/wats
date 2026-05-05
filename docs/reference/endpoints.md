# Endpoints Reference

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-05-02

## Purpose

Document the F-6 endpoint registry primitive — `defineEndpoint` — and
how it relates to the current first-class Graph endpoint family subpaths.
Covers public API, path-template syntax, param kinds, body handling,
integration with `GraphClient.request` and the F-5 error registry,
WATS-37..54 endpoint-family status, and a custom-endpoint tutorial.

This page is a companion to the broader [Client Reference](./client.md).

## Overview

Every Graph endpoint in WATS sits on a single plumbing layer:

```
defineEndpoint(spec) → EndpointCallable(client, params, body?, opts?) → Promise<TResponse>
                                 │
                                 └──→ client.request({ method, path, query?, body?, headers?, signal? })
                                           │
                                           └──→ Transport.request(...) → response or
                                                createGraphApiError(payload, ctx) → registered
                                                subclass via F-5 resolveRegisteredError
```

The primitive centralizes path-template parsing, param validation, query
serialization, body passthrough, and error routing. Newer endpoint
families also include family-specific validators, builders, scoped-client
helpers, and typed request/response surfaces around that plumbing.

## Primitive vs first-class endpoint families

`defineEndpoint` is the plumbing primitive for adding typed Graph request
callables. Prefer first-class Graph endpoint family subpaths when they
already exist; use a custom `defineEndpoint` declaration for local or
future Graph routes that WATS has not wrapped yet.

Current first-class Graph endpoint family subpaths are:

- `@switchbord/graph/endpoints/messages`
- `@switchbord/graph/endpoints/media`
- `@switchbord/graph/endpoints/templates`
- `@switchbord/graph/endpoints/flows`
- `@switchbord/graph/endpoints/calling`
- `@switchbord/graph/endpoints/business-management`

WATS-54 keeps package exports, target source files, graph-consumer
package-specifier imports, reference docs, architecture docs, migration
cheat sheet, and changelog mentions aligned with `bun run api:check`.

## defineEndpoint

```ts
import {
  defineEndpoint,
  type EndpointDefinition,
  type EndpointHttpMethod,
  type EndpointParamSpec,
  type EndpointCallable,
  type EndpointInvokeOptions
} from "@switchbord/graph";
```

### Signature

```ts
function defineEndpoint<
  TParams extends Record<string, string>,
  TBody = unknown,
  TResponse = unknown
>(
  spec: EndpointDefinition<TParams, TBody, TResponse>
): EndpointCallable<TParams, TBody, TResponse>;
```

`EndpointDefinition` fields:

- `method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"` — validated at
  define time. Any other value throws `GraphRequestValidationError`
  immediately.
- `pathTemplate: string` — non-empty, no ASCII control chars. Placeholders
  are written `{name}` where `name` matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.
  Empty (`{}`), unbalanced (`{x`, `x}`), or duplicate (`{x}{x}`)
  placeholders are rejected at define time.
- `params: { [K in keyof TParams]: EndpointParamSpec }` — every placeholder
  MUST have a matching entry with `in: "path"`. Every `in: "path"` entry
  MUST appear in the template. Mismatches are rejected at define time.
- `buildBody?: (body: TBody) => unknown` — optional body transformer.
  Must be a function when provided; non-functions are rejected at define
  time.
- `bodyContentType?: string` — optional content-type override (e.g.
  `"application/json"`). Only applied when a body is present.

`EndpointParamSpec`:

- `in: "path" | "query"` — placement in the resolved request.
- `required?: boolean` — defaults to `true` for path params (always
  required) and `false` for query params.

`EndpointCallable`:

- Call signature: `(client, params, body?, opts?) => Promise<TResponse>`.
- `.definition` is the original `EndpointDefinition` for introspection.

### Call-time behaviour

Path parameter values pass through the same sanitisation the F-4 client
applies to inline path segments (`assertSafeGraphPathSegment` semantics):

- empty string → rejected with `GraphRequestValidationError`;
- `.` or `..` → rejected (dot-segments);
- `/` or `\\` → rejected (path traversal patterns);
- `?` or `#` → rejected (query/fragment in a path segment);
- ASCII control chars (U+0000..U+001F, U+007F) → rejected;
- non-string values → rejected.

Query parameter values are URL-encoded via `URLSearchParams`, with a
preflight check that rejects CR (`\\r`), LF (`\\n`), and NUL (`\\0`) in
values. `undefined` values are skipped (the parameter is omitted from the
URL). Query param keys and values with control chars are rejected before
the URL is built.

Body handling is deliberately a passthrough to `GraphClient.request`:

- If `buildBody` is present, it is called on the caller's `body` and the
  return value is handed to the client.
- Otherwise the caller's `body` is forwarded unchanged.
- The client serialises objects to JSON (setting `content-type:
  application/json` unless the caller already set one), forwards
  `Uint8Array`/`ArrayBuffer`/`Blob`/`FormData`/`URLSearchParams`/
  `ReadableStream` verbatim, and never re-serialises.

`EndpointInvokeOptions`:

- `signal?: AbortSignal` — forwarded to the Transport as
  `TransportOptions.signal`.
- `headers?: Record<string, string> | Headers` — merged on top of
  `bodyContentType`, then handed to `GraphClient.request` as a plain
  object. **All header validation goes through the client's F-4
  taxonomy guard** (WATS-29): CR, LF, or NUL in any header name or
  value is rejected with a typed `GraphRequestValidationError` (never
  a raw `TypeError`), and any caller-supplied `authorization` header
  (any casing) is rejected for the same reason. The endpoint path
  and a direct `client.request(...)` call produce the **same error
  type** for the same invalid input. See
  [Transport and Testing](../guides/transport-and-testing.md).

### Frozen, introspection-safe `.definition`

The `EndpointCallable` exposes its spec at `ep.definition`. WATS-29
freezes both the top-level object and its `params` sub-object with
`Object.freeze`, matching the `readonly` TypeScript contract at
runtime. External code attempting to mutate
`ep.definition.method` or swap out `ep.definition.params` is silently
rejected (sloppy mode) or throws (strict mode); the callable's
invoke closure always uses the original frozen definition.

Additionally, `params` keys are validated at define time against the
same `/^[a-zA-Z_][a-zA-Z0-9_]*$/` regex used for `{name}`
placeholders. Empty keys, keys with whitespace, and other invalid
identifiers are rejected up front with `GraphRequestValidationError`.

## Integration with the F-5 error registry

`defineEndpoint` does not surface errors itself; it delegates to
`GraphClient.request`, which:

1. Calls `Transport.request(...)`.
2. On non-2xx responses, invokes `createGraphApiError({ status, payload,
   ... })`, which calls the F-5 registry (`resolveRegisteredError(code,
   subcode?)`) to pick the narrowest subclass — e.g. code 100 →
   `InvalidParameterError`, code 131051 →
   `UnsupportedMessageTypeError`, code 4 @ HTTP 429 →
   `ToManyAPICallsError` (a `GraphRateLimitError` subclass).
3. Input validation errors raised inside the endpoint layer (missing or
   unknown params, unsafe path values, CR/LF in query values) are typed
   as `GraphRequestValidationError`, a subclass of `GraphApiError`.

Consumers can therefore use sibling-class assertions without touching
the endpoint layer:

```ts
try {
  await sendMessage(client, { phoneNumberId: "123" }, body);
} catch (error) {
  if (error instanceof UnsupportedMessageTypeError) {
    // handle 131051
  } else if (error instanceof InvalidParameterError) {
    // handle 100/131009
  } else if (error instanceof GraphRateLimitError) {
    // handle rate limiting
  }
}
```

## messages: the two invocation shapes

F-6 refactors `@switchbord/graph/endpoints/messages` onto `defineEndpoint`.
Two shapes are exposed; both produce byte-for-byte identical HTTP
requests.

### 1. Endpoint-registry callable (preferred for new call sites)

```ts
import { GraphClient, sendMessage } from "@switchbord/graph";

const client = new GraphClient({
  accessToken: process.env.WATS_TOKEN!,
  apiVersion: "v20.0"
});

const result = await sendMessage(
  client,
  { phoneNumberId: "1234567890" },
  {
    messaging_product: "whatsapp",
    to: "15551234567",
    type: "text",
    text: { body: "hello" }
  }
);
```

### 2. Legacy `GraphMessagesEndpoint` class (backward-compatible)

```ts
const result = await client.messages.sendMessage({
  phoneNumberId: "1234567890",
  to: "15551234567",
  text: "hello"
});
```

The class-based method pre-validates `phoneNumberId` with the existing
F-4 typed error (`GraphRequestValidationError` whose `.message` starts
with `"Invalid phoneNumberId."`) and then delegates path/body plumbing
to the `sendMessage` endpoint-registry callable.

## Custom endpoint tutorial

Defining a new endpoint is a one-declaration affair. The following
example wires a hypothetical `GET /{businessId}/analytics` endpoint with
a required path parameter and an optional `since` query parameter:

```ts
import { defineEndpoint, GraphClient } from "@switchbord/graph";

interface AnalyticsResponse {
  readonly totals: { readonly messages: number };
}

export const getAnalytics = defineEndpoint<
  { businessId: string; since?: string },
  never,
  AnalyticsResponse
>({
  method: "GET",
  pathTemplate: "/{businessId}/analytics",
  params: {
    businessId: { in: "path", required: true },
    since: { in: "query", required: false }
  }
});

// call it:
const client = new GraphClient({
  accessToken: "…",
  apiVersion: "v20.0"
});
const report = await getAnalytics(client, {
  businessId: "987654321",
  since: "2026-01-01"
});
```

All the usual invariants hold automatically:

- the declaration fails at define time if `pathTemplate` and `params`
  disagree;
- unknown call-time params (`{ businessId, typo: "x" }`) are rejected
  before the HTTP call;
- `since` is URL-encoded and omitted when absent;
- network/registry errors surface as `GraphApiError` subclasses per F-5.

## Public API summary

- `defineEndpoint(spec): EndpointCallable`
- Types: `EndpointDefinition`, `EndpointHttpMethod`, `EndpointParamSpec`,
  `EndpointInvokeOptions`, `EndpointCallable`.
- Messages exports: `sendMessage` (endpoint-registry callable),
  `GraphMessagesEndpoint` (legacy class), `buildSendMessagePayload`,
  `GraphMessagesSendMessageInput`, `GraphMessagesSendResponse`,
  `GraphMessagesTextPayload`, `GraphMessagesSendBody`.

## Related docs

- [Client Reference](./client.md) — `GraphClient` construction, Transport
  seam, baseUrl/accessToken/apiVersion validation.
- [Errors Reference](./errors.md) — F-5 error code registry and seeded
  subclasses.
- [Transport and Testing](../guides/transport-and-testing.md) — Transport
  decorators, `createMockTransport` usage, retry/auth refresh recipes.
