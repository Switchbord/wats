# ADR-003: Transport and Crypto Abstractions

- status: Accepted
- date: 2026-04-21
- labels: [foundation, transport, crypto, interop, edge]
- relatesTo: ADR-001 (API Shape), ADR-005 (Endpoint Registry), ADR-006 (Testing Strategy)

## Context

`@wats/graph` currently calls `globalThis.fetch` directly inside `GraphClient.request`
and classifies failures into `GraphNetworkError`, `GraphApiError`, `GraphAuthError`,
`GraphRateLimitError`, `GraphSerializationError`, and `GraphRequestValidationError`.
`@wats/http` imports `createHmac` and `timingSafeEqual` from `node:crypto` in
`signature.ts` and `webhookServer.ts`. `@wats/crypto` is empty.

Pywa reference (`pywa/api.py`, `pywa/client.py`) takes an injectable `httpx.Client`,
letting callers configure timeouts, proxies, connection pools, and retries; auth and
base URL are bound to the session at construction. WATS must offer equivalent control
without adopting `httpx` semantics or forcing Node-only primitives on callers running
Cloudflare Workers, Deno, Bun, or Vercel Edge.

Three concrete drivers motivate this ADR:

1. Arch-C (WATS-17): introduce a `Transport` seam beneath `GraphClient` so tests,
   instrumentation, and non-fetch runtimes can plug in without patching
   `globalThis.fetch`.
2. Arch-F (WATS-20): materialise `@wats/crypto` as a `CryptoProvider` interface with
   pluggable adapters; required to lift `@wats/http` off `node:crypto` so webhook
   signature verification runs on Edge/Workers.
3. Construction-time input validation gaps raised by WATS-3 (accessToken CR/LF/NUL),
   WATS-4 (baseUrl path prefix silently dropped), and WATS-5 (baseUrl/apiVersion
   validated only at first request) — the new `GraphClient` surface must reject
   these inputs during construction, not on first `request()`.

The hygiene issue WATS-13 (`GraphNetworkError.cause` log-scrubbing) and the
hidden `rawBody` coercion path in `validateWebhookSignature` (flagged internally
as H1) also need a typed seam: the HMAC call must not surface raw `TypeError`s
from a Node buffer coercion, and transport failures must not leak arbitrary
`cause` chains into logs.

## Decision

WATS splits HTTP request/response and cryptographic primitives behind two narrow
interfaces: `Transport` (owned by `@wats/graph`, consumed by `GraphClient`) and
`CryptoProvider` (owned by `@wats/crypto`, consumed by `@wats/http` and, later,
by flow/media decryption in `@wats/graph`).

### Seam diagram

```
 caller code
     |
     v
 +---------------------+          +-------------------------+
 |  GraphClient        |          |  WebhookSignatureVerif. |
 |  (@wats/graph)      |          |  (@wats/http)           |
 +----------+----------+          +------------+------------+
            |                                  |
            | request(TransportRequest)        | hmacSha256 / timingSafeEqual
            v                                  v
 +---------------------+          +-------------------------+
 |  Transport          |          |  CryptoProvider         |
 |  (interface)        |          |  (@wats/crypto)         |
 +----------+----------+          +------------+------------+
            |                                  |
    +-------+-------+                  +-------+-------+
    |               |                  |               |
    v               v                  v               v
 FetchTransport MockTransport   NodeBunProvider  WebCryptoProvider
 (Bun/Node/Deno/                (node:crypto +   (SubtleCrypto
  Workers — fetch)               subtle)          only)
```

Neither interface assumes Node globals. Neither interface ships as a default
import from a package entrypoint that transitively imports `node:crypto` or
`node:http`. Capability detection decides which adapter is installed.

### Transport

The `Transport` interface is request/response-shaped, `AbortSignal`-aware, and
exposes a single `send` method plus a retry-policy knob and an interceptor hook.
All higher-level concerns (URL building, header injection, JSON
serialisation/deserialisation, error classification) remain in `GraphClient`
above the seam.

```ts
// @wats/graph/transport
export interface TransportRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: BodyInit;
  readonly signal?: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface TransportRetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly retryableStatuses: ReadonlySet<number>;
  readonly retryOnNetworkError: boolean;
}

export interface TransportInterceptor {
  onRequest?(request: TransportRequest): Promise<TransportRequest> | TransportRequest;
  onResponse?(response: TransportResponse, request: TransportRequest):
    Promise<TransportResponse> | TransportResponse;
  onError?(error: unknown, request: TransportRequest): Promise<never> | never;
}

export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

export interface FetchTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly retryPolicy?: TransportRetryPolicy;
  readonly interceptors?: readonly TransportInterceptor[];
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export function createFetchTransport(options?: FetchTransportOptions): Transport;
export function createMockTransport(handler: MockTransportHandler): MockTransport;

export interface MockTransportHandler {
  (request: TransportRequest): Promise<TransportResponse> | TransportResponse;
}

export interface MockTransport extends Transport {
  readonly calls: readonly TransportRequest[];
  reset(): void;
}
```

`createFetchTransport` is the default. It binds to `globalThis.fetch` at call
time (not module import time) so it works identically under Bun, Node ≥ 20,
Deno, Cloudflare Workers, and Vercel Edge. Callers in environments with
non-global fetch (older Node, special runtimes) supply `options.fetch`.

Retries, backoff, and interceptor iteration are evaluated inside
`createFetchTransport`; `MockTransport` is a zero-retry inert shell for tests.

### GraphClient built on Transport

`GraphClient` is reshaped to accept a `Transport` rather than embed a `fetch`
call. It performs construction-time validation so WATS-3, WATS-4, and WATS-5
are closed at the earliest possible point.

```ts
// @wats/graph
export interface GraphClientConfig {
  readonly baseUrl: string;        // validated: origin-only, no path, no CR/LF/NUL
  readonly apiVersion: string;     // validated: /^v\d+\.\d+$/
  readonly accessToken: string;    // validated: non-empty, no CR/LF/NUL, no surrogates
  readonly transport?: Transport;  // defaults to createFetchTransport()
  readonly userAgent?: string;
}

export class GraphClient {
  constructor(config: GraphClientConfig);
  request<TResponse>(options: GraphRequestOptions): Promise<TResponse>;
  phone(phoneNumberId: string): PhoneScopedClient;
  waba(wabaId: string): WabaScopedClient;
}
```

Construction-time validation (WATS-3, WATS-4, WATS-5, WATS-8):

- `accessToken`: must be a non-empty string. Reject any token containing `\r`,
  `\n`, `\0`, or unpaired UTF-16 surrogates. Reject leading/trailing whitespace.
  Failure throws `GraphRequestValidationError` synchronously from the
  constructor (never a raw `TypeError`).
- `baseUrl`: must parse under `new URL(baseUrl)`; `url.pathname` must equal `/`
  (pywa binds to `https://graph.facebook.com/`; a silently dropped `/v1` prefix
  is a class of config bug we refuse). Scheme must be `https:` unless
  `baseUrl.hostname` is `localhost` or `127.0.0.1` (test escape hatch).
- `apiVersion`: must match `/^v\d+\.\d+$/`. Stripping of leading slashes as in
  the legacy implementation is dropped — callers pass `v19.0`, not `/v19.0/`.
- Control-character rejection is reused from `assertSafeGraphPathSegment`
  (WATS-8) and lifted into a shared `validateHeaderSafeString` helper.

### CryptoProvider

`@wats/crypto` exports a capability-oriented interface covering the primitives
used across WATS today and the ones announced for Flows, Media, and Encrypted
Payloads tomorrow.

```ts
// @wats/crypto
export interface CryptoProvider {
  readonly name: string;
  hmacSha256(key: Uint8Array | string, body: Uint8Array | string):
    Promise<Uint8Array>;
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  randomBytes(byteLength: number): Uint8Array;

  // Forward-declared for Flows / Media / Encrypted Payloads work.
  // Adapters that cannot implement these throw CryptoCapabilityUnavailableError
  // rather than returning a bogus buffer.
  rsaOaepDecrypt(
    privateKeyPkcs8: Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;

  aesGcmDecrypt(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    authTag?: Uint8Array,
    additionalData?: Uint8Array
  ): Promise<Uint8Array>;
}

export class CryptoError extends Error {
  readonly code:
    | "hmac_failed"
    | "rsa_decrypt_failed"
    | "aes_decrypt_failed"
    | "invalid_key"
    | "invalid_input"
    | "capability_unavailable";
  readonly cause?: unknown;
}

export class CryptoCapabilityUnavailableError extends CryptoError {}

export function createCryptoProvider(
  options?: CryptoProviderOptions
): CryptoProvider;

export interface CryptoProviderOptions {
  readonly prefer?: "webcrypto" | "node" | "auto";
}

// Explicit adapter constructors for advanced callers / tests:
export function createWebCryptoProvider(subtle?: SubtleCrypto): CryptoProvider;
export function createNodeBunCryptoProvider(): CryptoProvider;
export function createFakeCryptoProvider(seed?: {
  readonly hmacOutput?: Uint8Array;
  readonly randomBytes?: Uint8Array;
}): CryptoProvider;
```

### Adapter selection strategy

`createCryptoProvider({ prefer: "auto" })` follows a capability probe, not a
runtime sniff:

1. If `globalThis.crypto?.subtle?.sign` exists, install
   `createWebCryptoProvider(globalThis.crypto.subtle)`.
2. Otherwise, if `typeof process !== "undefined"` and `process.versions?.node`
   is present, `await import("node:crypto")` **dynamically** and install
   `createNodeBunCryptoProvider()`.
3. Otherwise throw `CryptoCapabilityUnavailableError` at construction time.

Critically, `@wats/crypto` must never statically import `node:crypto`. The
dynamic import lives behind a factory and is only reached on the Node branch.
This preserves tree-shaking and prevents bundler warnings on Workers/Edge
builds that forbid `node:*`. WATS-20 is resolved by this split.

### @wats/http interop

`validateWebhookSignature` and `verifyWebhookChallenge` are refactored to
accept an injected `CryptoProvider`:

```ts
// @wats/http
export interface ValidateWebhookSignatureInput {
  readonly appSecret: string;
  readonly rawBody: string | Uint8Array;
  readonly signatureHeader: string | null | undefined;
  readonly crypto: CryptoProvider;
}

export function validateWebhookSignature(
  input: ValidateWebhookSignatureInput
): Promise<SignatureValidationResult>;
```

The function becomes `async` (ADR-001 async-only). The `rawBody: ArrayBuffer |
ArrayBufferView` overload is normalised to `Uint8Array` at the seam, closing
the H1 hazard where a malformed `ArrayBufferView` could surface a raw
`TypeError` out of Node's `Buffer.from(view.buffer, ...)`. Inputs that cannot
be coerced throw a typed `GraphSerializationError`-equivalent (see error
taxonomy below) rather than bubbling a `TypeError`.

`@wats/http` MUST run on Cloudflare Workers and Deno without `node:crypto`.
That is a non-negotiable interop property tested by the edge-runtime sanity
suite defined in ADR-006.

### Error taxonomy pass-through

Errors flow across seams without loss of type identity.

| Seam                     | Low-level failure           | Surface error                         |
|--------------------------|-----------------------------|---------------------------------------|
| Transport.send           | fetch rejects / AbortError  | `GraphNetworkError`                   |
| Transport.send           | response body not JSON      | `GraphSerializationError`             |
| Transport interceptor    | thrown non-Error            | `GraphNetworkError` (message-coerced) |
| CryptoProvider.hmacSha256| SubtleCrypto rejects        | `CryptoError { code: "hmac_failed" }` |
| CryptoProvider, no capability | missing subtle/node    | `CryptoCapabilityUnavailableError`    |
| validateWebhookSignature | CryptoError                 | `SignatureValidationResult { ok:false, error:{ code:"crypto_failure" } }` |

`@wats/http` MUST wrap its `CryptoProvider.hmacSha256` call in a typed-error
shell: any `CryptoError` becomes a new `SignatureValidationErrorCode`
(`"crypto_failure"`); raw TypeErrors from argument coercion are caught and
remapped to `"invalid_body_type"`. This resolves H1.

`GraphNetworkError.cause` is scrubbed before it reaches consumer logs
(WATS-13): a helper `scrubErrorCause(cause: unknown): unknown` strips
`Authorization`/`Cookie`/`Set-Cookie` headers from any embedded `Request`,
redacts `url.searchParams.access_token`, and removes raw body buffers. The
helper is exported from `@wats/graph/errors` and applied inside the
fetch-transport `onError` default interceptor.

## Consequences

Positive:

- Tests stop patching `globalThis.fetch`. `MockTransport` gives per-test
  assertions on request shape (URL, headers, body) without runtime-global
  mutation. The Bun test runner's parallelism becomes safe.
- Webhook signature verification is portable. Cloudflare Workers and Vercel
  Edge deployments of `@wats/http` become supported without a re-export shim.
- Construction-time validation closes three M-tier issues in one surface
  change rather than patching validation into each endpoint.
- Future encrypted-payload parity (Flows, Media, Calls) lands on the same
  provider interface; no new dependency direction.

Negative:

- `@wats/graph` gains a public surface (`Transport`, `TransportRequest`,
  `TransportResponse`, `createFetchTransport`, `createMockTransport`). Once
  exported, semver compatibility applies.
- `CryptoProvider` is intentionally larger than the current call sites need
  (two of six methods are forward-declared). Adapters must implement all
  methods, even if forward-declared ones throw `CryptoCapabilityUnavailableError`.
- `validateWebhookSignature` becoming async is a breaking change for
  `@wats/http`; migration is gated behind the unreleased 0.x line.
- `fetch` indirection costs a closure per request. Benchmarking during
  implementation will confirm the overhead is sub-microsecond on Bun.

## Alternatives considered

- **No Transport seam; expose `fetch` option only.** Rejected: it collapses
  retry, backoff, and interceptor concerns into the user's `fetch` wrapper and
  makes `MockTransport.calls` unrepresentable without proxying. Pywa's
  `httpx.Client` injection reflects the same value proposition.
- **Publish `CryptoProvider` as the existing `@wats/crypto` default export
  using `node:crypto` statically.** Rejected: breaks `@wats/http` on Workers,
  violates the ADR-003 interop guarantee, and makes the `prefer: "webcrypto"`
  knob meaningless.
- **Adopt `undici` or another shared HTTP client.** Rejected: adds a Node-only
  transitive and duplicates `fetch` semantics on runtimes that already ship
  `fetch`. Bun-first means `fetch`-first.
- **Keep `GraphClient.request` building URLs and headers internally but make
  it accept an `HttpHandler` shaped like `fetch`.** Partially attractive, but
  loses the `MockTransport.calls` affordance and tangles retries into
  `GraphClient`. The fat interface (`Transport`) is cheaper to test and
  document than two thin ones (`HttpHandler` + `RetryController`).

## Linear issues resolved

- WATS-3 (M1): accessToken validation on non-empty, CR/LF/NUL moves to
  `GraphClient` constructor via `validateHeaderSafeString`.
- WATS-4 (M2): baseUrl path-prefix rejection is explicit at construction.
- WATS-5 (M3): baseUrl/apiVersion validation moves off first-request lazy
  evaluation and is performed synchronously in the constructor.
- WATS-8 (L1): control-char rejection is shared between path segments and
  header-safe string validation; the same helper powers both.
- WATS-13 (L7): `scrubErrorCause` helper is introduced alongside the fetch
  transport; `GraphNetworkError.cause` is always routed through it.
- WATS-17 (Arch-C): Transport interface and adapters defined here.
- WATS-20 (Arch-F): CryptoProvider interface and adapters defined here.

## Interop notes

- **Bun**: `createFetchTransport()` and `createWebCryptoProvider(crypto.subtle)`.
  Native path. Used by `bun test`.
- **Node ≥ 20**: `createFetchTransport()` binds to the global `fetch`;
  `createCryptoProvider({ prefer: "auto" })` installs the WebCrypto adapter
  because `globalThis.crypto.subtle` is present. No `node:crypto` import unless
  `prefer: "node"`.
- **Node 18**: WebCrypto exists but some flows expect `node:crypto` APIs;
  `prefer: "node"` loads the Node adapter via dynamic import. No static edge.
- **Deno**: WebCrypto provider only. `createFetchTransport()` binds to
  `globalThis.fetch`. Passes the edge-runtime sanity suite.
- **Cloudflare Workers / Vercel Edge**: WebCrypto provider only.
  `@wats/http` must not statically reference `node:crypto`. The `node:crypto`
  import in `signature.ts` is removed during the F-step that lands this ADR.
- **React Native / browsers**: out of scope for 0.x but not foreclosed — the
  WebCrypto provider is sufficient where a polyfilled `crypto.subtle` exists.

## Migration notes

Existing tests (`packages/graph/tests/client.test.ts` and the B2/C1/C2
signature/challenge tests under `packages/http/tests/`) mock
`globalThis.fetch` and import `node:crypto` transitively. Under this ADR they
migrate to `createMockTransport` and `createFakeCryptoProvider` respectively.
The concrete migration plan is owned by ADR-006; no source change lands with
this ADR.

## Open questions

- Should `TransportRetryPolicy` include a jitter function hook, or is
  "full jitter" sufficient for 1.0? Deferred to implementation.
- Should `CryptoProvider.randomBytes` be `async` to match WebCrypto's
  `getRandomValues` future? WebCrypto's current API is sync; keeping sync is
  the path of least surprise.
- Do we want a `StreamingTransportResponse` sub-interface for media downloads,
  or is `body: ReadableStream<Uint8Array>` sufficient? Revisit in the Media
  endpoint ADR.
