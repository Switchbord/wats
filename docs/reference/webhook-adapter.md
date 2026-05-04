# Webhook Adapter

> Status: baseline-complete (F-12 / WATS-22 Arch-K + WATS-25 edge-runtime)

## WebhookAdapter

The **WebhookAdapter** is `@wats/http`'s runtime-neutral HTTP adapter
layer. It takes incoming HTTP requests, verifies their
`X-Hub-Signature-256` via the F-3 signature primitives, normalizes
their body via the F-8 `normalizeWebhookEnvelope`, dispatches the
resulting `TypedUpdate` values through a facade-shaped `dispatch()`
method, and returns a response with the correct status code.

The adapter ships in **three shapes**, all backed by a single
runtime-neutral core:

| Wrapper                           | Runtime              | Subpath export                  |
| --------------------------------- | -------------------- | ------------------------------- |
| `createWebhookAdapter`            | any (the core)       | `@wats/http/webhookAdapter`     |
| `createFetchWebhookHandler`       | Workers / Deno / Bun | `@wats/http/adapters/fetch`     |
| `createBunWebhookServer`          | Bun                  | `@wats/http/adapters/bun`       |
| `createNodeWebhookHandler`        | Node                 | `@wats/http/adapters/node`      |

Every adapter wrapper is a thin marshalling layer. The verification,
normalization, dispatch, and status-code decisions all live in the
core — so behavior is identical across runtimes.

## Quick start

```ts
import {
  createWebhookAdapter,
  createFetchWebhookHandler
} from "@wats/http";
import { WhatsApp } from "@wats/core";

const wa = new WhatsApp({ graphClient, phoneNumberId: "12345" });

const adapter = createWebhookAdapter({
  verifyToken: process.env.VERIFY_TOKEN!,
  appSecret: process.env.APP_SECRET!,
  whatsapp: wa,
  maxBodyBytes: 1_048_576,
  logger: (event) => console.log(event.type)
});

// Edge runtime (Cloudflare Workers / Deno / Bun fetch):
const fetchHandler = createFetchWebhookHandler(adapter);
export default { fetch: fetchHandler };
```

## Runtime-neutral core: `createWebhookAdapter`

```ts
export function createWebhookAdapter(
  config: WebhookAdapterConfig
): WebhookAdapter;

export interface WebhookAdapter {
  handle(request: WebhookRequest): Promise<WebhookResponse>;
}
```

### `WebhookAdapterConfig`

| Field             | Type                                        | Required | Notes                                                       |
| ----------------- | ------------------------------------------- | -------- | ----------------------------------------------------------- |
| `verifyToken`     | `string`                                    | yes      | 1..512 chars, not whitespace-only, no CR / LF / NUL bytes   |
| `appSecret`       | `string`                                    | yes      | non-empty, not whitespace-only, no CR / LF / NUL bytes      |
| `whatsapp`        | object with `dispatch(update)` method       | yes      | a `WhatsApp` facade or any structural match                 |
| `cryptoProvider`  | `CryptoProvider` (from `@wats/crypto`)      | no       | auto-selected when omitted                                  |
| `maxBodyBytes`    | positive integer                            | no       | default `1_048_576` (1 MiB); enforced at READ time by Node + Fetch wrappers |
| `logger`          | `(event) => void`                           | no       | per-stage observability hook                                |

All config validation happens **at construction time**. Invalid input
throws `WebhookAdapterConfigError` with a taxonomized `.code`:

| Code                       | Cause                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `invalid_config`           | config is null or not an object                                 |
| `invalid_verify_token`     | missing / non-string / empty / whitespace-only / CR LF NUL / too long |
| `invalid_app_secret`       | missing / non-string / empty / whitespace-only / CR LF NUL       |
| `invalid_whatsapp`         | missing `dispatch()` method                                     |
| `invalid_crypto_provider`  | missing `hmacSha256` / `timingSafeEqual`                        |
| `invalid_max_body_bytes`   | non-positive, non-integer, non-finite                           |
| `invalid_logger`           | not a function                                                  |

`WebhookAdapterConfigError` is a plain `Error` subclass — it is NOT a
`TypeError`. Narrow via `instanceof WebhookAdapterConfigError` and
dispatch on `.code`.

### `WebhookRequest` / `WebhookResponse`

```ts
export interface WebhookRequest {
  readonly method: string;                        // "GET" | "POST" | ...
  readonly url: string;                           // absolute URL
  readonly headers: Headers;                      // WHATWG Headers
  readonly body: ArrayBuffer | ArrayBufferView | null; // raw bytes (POST only)
}

export interface WebhookResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string | Uint8Array;
}
```

The body field accepts any `ArrayBufferView` (`Uint8Array`, `DataView`,
typed-array subclasses) or a raw `ArrayBuffer`. A runtime guard in
`handleDispatch` enforces this at request time — a caller slipping a
`string` / `number` / plain-object / `Blob` through JS type erasure
is rejected with `400 invalid_request_body` rather than silently
coerced to empty bytes (which would leak to `401 signature_mismatch`).

The core operates exclusively on these WHATWG-shaped values so it
has zero runtime dependency on `node:http`, Bun's `Server`, or any
specific framework. Adapters translate.

## Status-code taxonomy

| Status | Meaning                                                                        |
| ------ | ------------------------------------------------------------------------------ |
| `200`  | valid GET verify (body = challenge); valid POST dispatched                     |
| `400`  | malformed JSON body; malformed signature header; malformed verify query; body type outside the declared `ArrayBuffer` / `ArrayBufferView` / `null` union (`invalid_request_body`) |
| `401`  | missing signature; invalid signature; wrong verify token                       |
| `405`  | method other than `GET` or `POST` (sets canonical `Allow: GET, POST`)          |
| `413`  | POST body exceeds `maxBodyBytes` (enforced at READ time by Node + Fetch wrappers; see "Body size enforcement") |
| `500`  | unexpected adapter-internal failure (should be rare; logged)                   |

### Dispatch-error semantics

A **handler** failure inside `facade.dispatch()` is isolated — the
adapter STILL returns `200`. Webhook acknowledgement semantics say:
once we've verified the signature and normalized the envelope, the
event is received from an HTTP perspective. Meta would otherwise
retry the delivery, creating a duplicate-event flood against a bug
that isn't a transport failure.

Handler errors are surfaced via `logger({ type: "error", stage: "dispatch", error })`
and via the `DispatchReport.errors` array the facade's own observer
can consume (see `docs/reference/router.md`).

## Logger hook

```ts
export type WebhookAdapterEvent =
  | { type: "request_received"; method: string; url: string }
  | { type: "signature_verified"; success: boolean }
  | { type: "body_normalized"; updates: number; skipped: number }
  | { type: "dispatched"; updates: number }
  | { type: "response_sent"; status: number }
  | { type: "error"; stage: string; error: unknown };
```

Events fire in lifecycle order. A throwing logger is swallowed — a
bad observability hook cannot crash the webhook response path.

## Adapter wrappers

### `createFetchWebhookHandler(adapter)`

```ts
import { createFetchWebhookHandler } from "@wats/http";
const handler = createFetchWebhookHandler(adapter);
// (request: Request) => Promise<Response>
```

Pure WinterCG: takes a WHATWG `Request`, returns a `Response`. This
module contains **zero** static `node:*` imports — that invariant is
enforced by both `packages/testing/tests/workspace-policy.test.ts`
and `packages/testing/edge/webhook-adapter.test.ts`, which the F-12
commit ships.

Use this directly under:
- Cloudflare Workers (export `{ fetch }`)
- Deno (`Deno.serve(handler)`)
- Bun's fetch handler shape
- Any edge runtime implementing WinterCG

### `createBunWebhookServer(adapter, options?)`

```ts
import { createBunWebhookServer } from "@wats/http";
const server = createBunWebhookServer(adapter, {
  port: 8787,
  hostname: "0.0.0.0"
});
// server.port, server.hostname, server.stop(true)
```

Thin wrapper over `Bun.serve`. Throws if the `Bun` global is
unavailable (e.g. plain Node).

### `createNodeWebhookHandler(adapter)`

```ts
import { createServer } from "node:http";
import { createNodeWebhookHandler } from "@wats/http";

const handler = createNodeWebhookHandler(adapter);
const server = createServer((req, res) => {
  handler(req, res).catch((err) => { res.statusCode = 500; res.end(); });
});
server.listen(3000);
```

Returns a `(req, res) => Promise<void>` compatible with Node's
`http.createServer` listener shape. Node-specific code is **local to
this file** and uses structural types; it does not static-import
`node:http` (per the workspace policy).

## Edge-runtime safety (WATS-25)

The fetch adapter is the edge-runtime entry point. It contains
**no node:\*** static imports — zero node:* references anywhere in
the module's static import graph. Two structural tests pin the
guarantee:

1. `packages/testing/tests/workspace-policy.test.ts` scans every
   `.ts` file under `packages/http/src/` and rejects any static
   `import ... from "node:*"` or `export ... from "node:*"`.
2. `packages/testing/edge/webhook-adapter.test.ts` greps
   `packages/http/src/adapters/fetchAdapter.ts` for any `"node:` /
   `'node:` substring, then runs a full `Request → Response`
   round-trip without node:http.

Both assertions run as part of `bun test` on every commit.

## Scope ledger (non-goals)

The adapter deliberately does NOT:

- **Rate-limit** requests. Runtime / infrastructure concern
  (Cloudflare rules, Nginx, etc.).
- **Terminate TLS / HTTPS**. Runtime concern.
- **Deprecate** `verifyWebhookChallenge` / `validateWebhookSignature`.
  The legacy primitives remain available and are reused verbatim by
  the adapter.
- **Provide retry/backoff** for failed downstream dispatches. Handler
  errors are surfaced via the logger; retry policy lives elsewhere.
- **Integrate F-13 media endpoints**.
- **Enforce concurrent-request limits**. Runtime responsibility.
- **Transform** the raw body bytes before signature verification.
  Body passes VERBATIM into the HMAC verifier.

## Body size enforcement

The adapter core enforces `maxBodyBytes` via
`bodyByteLength(body) > maxBodyBytes` inside `handleDispatch`. That
check runs only AFTER the full body is resident, which is sufficient
for a well-behaved sender but leaves a DoS window open on adapter
wrappers that buffer unbounded bytes before calling the core.

Starting with the F-12 remediation (WATS-29), the **Node** and
**Fetch** wrappers short-circuit at READ time:

- `createNodeWebhookHandler` consults `adapter.maxBodyBytes`, tracks
  a running total during chunk accumulation, and on overflow calls
  `req.destroy(new Error("payload_too_large"))` to abort the socket.
  The wrapper synthesises a `413` response without ever routing the
  oversized bytes through the adapter core. Peak memory stays
  bounded regardless of adversarial chunk sizing.
- `createFetchWebhookHandler` applies two belt-and-suspenders guards:
  1. If a `Content-Length` header is present and exceeds
     `adapter.maxBodyBytes`, the wrapper returns `413` WITHOUT
     calling `request.arrayBuffer()` or reading `request.body`.
  2. If the body is a streaming `ReadableStream` (no Content-Length),
     the wrapper reads via `getReader()`, tracks the total byte count,
     and cancels the reader with `payload_too_large` the instant the
     running total exceeds the cap.

The core's post-read `413` check remains as a third safety net for
adapter authors that do not (or cannot) thread the cap into their
wrapper.

The `WebhookAdapter` interface exposes the applied cap as
`adapter.maxBodyBytes` (readonly) so downstream wrappers can
consult it without re-reading config.

```ts
const adapter = createWebhookAdapter({ ..., maxBodyBytes: 512_000 });
adapter.maxBodyBytes; // → 512000
```

## Signature header format

The adapter accepts `X-Hub-Signature-256` in the strict Meta format:

- Exactly one `sha256=` prefix.
- Exactly 64 hex characters **lowercase** (`[a-f0-9]{64}`).
- No whitespace anywhere in the value.
- No upper-case hex; no alternative algorithms; no comma-separated
  sibling signatures; no `sha1=` fallback.

Any deviation returns `400 invalid_signature_format` (malformed) or
`401 missing_signature` (header absent) — the adapter never attempts
a lenient re-parse. The regex used internally is
`/^sha256=[a-f0-9]{64}$/`.

Callers constructing the header themselves (proxies, test harnesses)
MUST match the format exactly. This is an intentional narrow surface
that keeps the attacker cost of signature-confusion attacks
high and the adapter's validation logic short and auditable.

## See also

- `docs/guides/deploy-bun.md`
- `docs/guides/deploy-node.md`
- `docs/guides/deploy-cloudflare-workers.md`
- `docs/reference/webhook.md` (F-3 challenge + signature primitives)
- `docs/reference/webhook-normalizer.md` (F-8 `normalizeWebhookEnvelope`)
- `docs/reference/router.md` (F-10 `TypedRouter.dispatch()`)
- `docs/reference/whatsapp-facade.md` (F-10 `WhatsApp` facade)
