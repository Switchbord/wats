# Getting Started with WATS

- status: canonical
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- lastReviewed: 2026-04-22
- applies-to: `[0.2.0-foundations-complete]`

This is the single end-to-end walkthrough for WATS consumers. Read it
top-to-bottom. Every code block is runnable against the in-memory
`MockTransport` — you do **not** need live Meta credentials to follow
along. When you want to swap in live credentials, see the
`credential gate` note at the end.

## 60-second offline onramp

The fastest fresh-clone path is the WATS-113 minimal bot:

```bash
bun run --cwd examples/minimal-bot demo
```

It starts from `examples/minimal-bot`, creates the service app in-process, uses MockTransport for Graph calls, sends one text message through the local service API, records a template intent without a live template send, and normalizes a synthetic webhook envelope. No live Meta credentials are required.

The demo runs in-process with `app.fetch(...)`; it does not leave a server listening on `127.0.0.1`. The equivalent local service API shape is:

```ts
await app.fetch(new Request("http://127.0.0.1:8787/api/messages/text", {
  method: "POST",
  headers: {
    authorization: `Bearer ${DEMO_SERVICE_TOKEN}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({ to: "15550001111", text: "hello from WATS" })
}));
```

The local example bearer variable above is a non-secret fixture scoped to the offline demo. Replace it only in ignored local files when you intentionally move to credential-gated live validation.

## 1. What's in the box

The foundations pivot shipped four packages of primitives:

| Package              | What's inside                                                       |
| -------------------- | ------------------------------------------------------------------- |
| `@wats/types`        | Discriminated-union domain types (message / status / contact / …). |
| `@wats/crypto`       | `CryptoProvider` seam + Node/Bun/WebCrypto adapters.                |
| `@wats/graph`        | `GraphClient`, `Transport`, `defineEndpoint`, sub-clients, pagination. |
| `@wats/core`         | `normalizeWebhookEnvelope`, typed filters, `TypedRouter`, `WhatsApp` facade, listener substrate. |
| `@wats/http`         | Webhook signature + challenge primitives, `WebhookAdapter`, Bun/Node/Fetch wrappers. |

The `WhatsApp` facade in `@wats/core` is the **composition root** — most
consumers start there and reach down to the lower-level primitives
only when they need to.

## 2. Install

Install the packages you need:

```bash
bun add @wats/core @wats/graph @wats/http
```

`@wats/types` and `@wats/crypto` are pulled in transitively. Inside
this monorepo the packages are `workspace:*` — no install needed.

## 3. Construct a `GraphClient` + `WhatsApp` facade

`GraphClient` is the low-level HTTP client. The `WhatsApp` facade
wraps it and auto-derives scoped sub-clients from `phoneNumberId` /
`wabaId`.

```ts
import { GraphClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";
import { WhatsApp } from "@wats/core";

// For a real deployment, drop createMockTransport and let the
// GraphClient build a fetch-backed Transport for you.
const handle = createMockTransport({
  defaultResponse: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { ok: true }
  }
});

const graphClient = new GraphClient({
  accessToken: "test-token",
  apiVersion: "v25.0",
  baseUrl: "https://graph.facebook.com",
  transport: handle.transport
});

const wa = new WhatsApp({
  graphClient,
  phoneNumberId: "1234567890",
  wabaId: "9999999999"
});

// Sub-clients are auto-derived from ids. Absent id → undefined
// (explicitly — not an empty object).
console.log(wa.phoneNumberClient?.phoneNumberId); // "1234567890"
console.log(wa.wabaClient?.wabaId);               // "9999999999"
```

Validation is construction-time. Invalid `accessToken`, `apiVersion`,
`baseUrl`, `phoneNumberId`, or `wabaId` throw a typed
`GraphRequestValidationError` or `WhatsAppFacadeConfigError`
immediately — you find the bug at boot, not on the first request.

## 4. Send a message through the scoped sub-client

The `PhoneNumberClient` exposes `sendMessage` bound to the
construction-time `phoneNumberId`:

```ts
const res = await wa.phoneNumberClient!.sendMessage({
  messaging_product: "whatsapp",
  to: "15551230000",
  type: "text",
  text: { body: "hello from WATS" }
});
// Against MockTransport the URL captured is:
//   https://graph.facebook.com/v25.0/1234567890/messages
```

Errors route through the F-5 registry. Narrow via `instanceof`:

```ts
import {
  GraphAuthError,
  GraphRateLimitError,
  InvalidParameterError,
  UnsupportedMessageTypeError
} from "@wats/graph";

try {
  await wa.phoneNumberClient!.sendMessage({ /* ... */ } as never);
} catch (err) {
  if (err instanceof GraphAuthError)       { /* 401/403 paths */ }
  if (err instanceof GraphRateLimitError)  { /* 429 paths */ }
  if (err instanceof InvalidParameterError){ /* code 100 */ }
  if (err instanceof UnsupportedMessageTypeError) { /* ... */ }
}
```

## 5. Business/admin inventory (read-only)

WATS-42A includes first-class, credential-free read-only business/admin inventory helpers. Use these before reaching for custom endpoints:

```ts
import {
  getBusinessProfile,
  getCommerceSettings,
  getPhoneNumberSettings,
  getWabaInfo
} from "@wats/graph";

const wabaInfo = await getWabaInfo(graphClient, {
  wabaId: "9999999999",
  fields: ["id", "name", "business_verification_status"]
});

const profile = await getBusinessProfile(graphClient, {
  phoneNumberId: "1234567890",
  fields: ["about", "description", "websites"]
});

const settings = await getPhoneNumberSettings(graphClient, {
  phoneNumberId: "1234567890",
  fields: "calling",
  includeSipCredentials: false
});

const commerce = await getCommerceSettings(graphClient, {
  phoneNumberId: "1234567890",
  fields: ["is_cart_enabled", "is_catalog_visible"]
});
```

The same surfaces are available through the scoped clients created above:

```ts
await wa.wabaClient!.getInfo({ fields: ["id", "name"] });
await wa.wabaClient!.listSubscribedApps();
await wa.wabaClient!.listPhoneNumbers({ limit: "25" });

await wa.phoneNumberClient!.getBusinessProfile({ fields: ["about"] });
```

These helpers are MockTransport-backed and read-only.
`getPhoneNumberSettings({ includeSipCredentials: true })` may return sensitive
SIP credential material in the Graph response, so treat that response as
secret-bearing and avoid logging it. Mutating admin operations remain
credential-gated roadmap work.

## 6. Define a custom endpoint with `defineEndpoint`

Anything beyond the first-class helpers above remains one `defineEndpoint` call away. Prefer a first-class WATS helper when one exists; use custom endpoints for app-specific or not-yet-modeled Graph surfaces.

Validation happens at both define-time (duplicate / unbalanced /
empty placeholders; unknown param kinds; non-function `buildBody`)
and call-time (unknown / missing params; unsafe path segments; CRLF
in query values).

## 7. Register handlers + listeners + observer

The router lives on the facade. `wa.on(filter, handler)` returns a
`RegistrationHandle` with an idempotent `.unregister()`:

```ts
import { and, message, status } from "@wats/core/filtersTyped";

const h1 = wa.on(message, async (update, ctx) => {
  // update is narrowed to TypedMessageUpdate
  console.log("message from", update.message.from);
});

const h2 = wa.on(
  and(message, message.textMatches(/^ping$/i)),
  async () => "stop"                          // halt further dispatch
);

const h3 = wa.on(status, async (update) => {
  console.log("status kind:", update.status.status);
});

// Later:
h1.unregister();
```

Handlers fire in registration order. Thrown exceptions and rejected
promises are captured on the `DispatchReport` — `dispatch()` never
rejects. Attach an observer to watch the lifecycle:

```ts
import { WhatsApp, TypedRouter } from "@wats/core";

const wa2 = new WhatsApp({
  graphClient,
  router: new TypedRouter({
    observer: {
      onBeforeDispatch:  ({ dispatchId, update }) => { /* ... */ },
      onHandlerMatch:    ({ dispatchId, handleId }) => { /* ... */ },
      onHandlerError:    ({ dispatchId, handleId, error }) => { /* ... */ },
      onAfterDispatch:   ({ dispatchId, report }) => { /* ... */ }
    }
  })
});
```

For one-shot awaitable waits, use the listener substrate:

```ts
const listener = wa.listen({
  type: "message",
  from: "15551230000",         // optional narrower
  timeoutMs: 30_000
});

try {
  const msg = await listener.promise;        // typed TypedMessageUpdate
  console.log(msg.message.from);
} catch (err) {
  // ListenerTimeoutError / ListenerAbortError
}
```

Listeners fire **before** the handler loop and do NOT short-circuit
it — both receive the same update.

## 8. Wire up the `WebhookAdapter` + `Bun.serve`

The `WebhookAdapter` is runtime-neutral. Pick one wrapper per runtime:

```ts
import { createWebhookAdapter, createBunWebhookServer } from "@wats/http";

const adapter = createWebhookAdapter({
  verifyToken: process.env.WA_VERIFY_TOKEN!,
  appSecret:   process.env.WA_APP_SECRET!,
  whatsapp:    wa,                 // any { dispatch(update) } works
  maxBodyBytes: 1_048_576          // 1 MiB default
});

const server = createBunWebhookServer(adapter, { port: 3000 });
// server.stop(true) to tear down.
```

Status codes: `200` verify challenge or successful dispatch, `400`
malformed body / header / query, `401` missing or mismatched signature
or wrong verify token, `405` method not GET/POST, `413` body over
cap, `500` rare internal failure.

For Workers / Deno / edge runtimes:

```ts
import { createFetchWebhookHandler } from "@wats/http";
const handler = createFetchWebhookHandler(adapter);
export default { fetch: handler };
```

For Node `http`:

```ts
import { createNodeWebhookHandler } from "@wats/http";
import { createServer } from "node:http";
const handler = createNodeWebhookHandler(adapter);
createServer(handler).listen(3000);
```

## 9. Dispatch a real webhook payload end-to-end

Here is the full loop — adapter, signature verification,
normalization, dispatch — driven from one process with no network:

```ts
import { createWebhookAdapter, createFetchWebhookHandler } from "@wats/http";
import { createCryptoProvider } from "@wats/crypto";
import { WhatsApp } from "@wats/core";
import { message } from "@wats/core/filtersTyped";
import { GraphClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";

const handle = createMockTransport({
  defaultResponse: { status: 200, body: { ok: true } }
});
const graphClient = new GraphClient({
  accessToken: "t",
  apiVersion: "v25.0",
  transport: handle.transport
});
const wa = new WhatsApp({ graphClient, phoneNumberId: "555" });

const fired: string[] = [];
wa.on(message, async (u) => { fired.push(u.message.from); });

const adapter = createWebhookAdapter({
  verifyToken: "local-verify",
  appSecret:   "local-app-secret",
  whatsapp:    wa
});
const fetchHandler = createFetchWebhookHandler(adapter);

// Build a legitimate signed POST.
const envelope = {
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA-LOCAL",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "555" },
        messages: [{
          from: "15550001",
          id: "wamid.LOCAL",
          timestamp: "1",
          type: "text",
          text: { body: "hello adapter" }
        }]
      }
    }]
  }]
};
const body = JSON.stringify(envelope);
const provider = await createCryptoProvider();
const digest = await provider.hmacSha256("local-app-secret", body);
const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");

const res = await fetchHandler(new Request("https://example.test/webhook", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": `sha256=${hex}`
  },
  body
}));
// res.status === 200 && fired[0] === "15550001"
```

## 10. Use `paginate()` on a cursor-based list

`paginate` walks any F-6 endpoint whose response matches
`PaginatedPage<T>`:

```ts
import { defineEndpoint, GraphClient, paginate, paginateAll } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";
import type { PaginatedPage } from "@wats/graph";

const listItems = defineEndpoint<
  { accountId: string; after?: string },
  never,
  PaginatedPage<{ readonly id: string }>
>({
  method: "GET",
  pathTemplate: "/{accountId}/items",
  params: {
    accountId: { in: "path",  required: true },
    after:     { in: "query", required: false }
  }
});

const page = (ids: string[], next?: string) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: {
    data: ids.map((id) => ({ id })),
    paging: next !== undefined
      ? {
          cursors: { after: next },
          next: `https://graph.facebook.com/v25.0/acct/items?after=${next}`
        }
      : { cursors: {} }
  }
});
const mock = createMockTransport({
  responses: [page(["a", "b"], "c1"), page(["c"], "c2"), page(["d", "e"])]
});
const client = new GraphClient({
  accessToken: "t",
  apiVersion: "v25.0",
  transport: mock.transport
});

// Streaming iteration — pages are NOT accumulated in memory.
for await (const item of paginate(client, listItems, { accountId: "acct" })) {
  console.log(item.id);                  // a, b, c, d, e
}

// Or: drive to completion with a summary.
const result = await paginateAll(client, listItems, { accountId: "acct" }, {
  maxPages: 10
});
// result.items.length === 5
// result.pagesConsumed === 3
// result.pageLimitReached === false
// result.aborted === false
```

`paginate` + `paginateAll` accept `maxPages` (default 1000), `pageSize`
(merged as `limit` in the first request), and an `AbortSignal`.
Endpoint errors mid-stream surface as
`PaginationError('page_fetch_failed', …, { cause })` with the
original error preserved on `.cause`.

## 11. Testing your integration

Every primitive is constructable against `createMockTransport` and a
facade-shaped stub. The workspace's consumer fixtures under
`packages/testing/fixtures/*` are the canonical reference — start by
reading `packages/testing/fixtures/graph-consumer/verify-imports.ts`
and `packages/testing/fixtures/core-consumer/verify-imports.ts`.

For the signature primitives use `createCryptoProvider()` to generate
the HMAC digest you need to attach as `X-Hub-Signature-256` in tests.

## 12. Reference + next steps

- [`docs/reference/index.md`](./reference/index.md) — curated reference index.
- [`docs/parity/pywa-parity-matrix.md`](./parity/pywa-parity-matrix.md) — feature coverage + post-foundations roadmap.
- [`docs/parity/live-testing-campaign.md`](./parity/live-testing-campaign.md) — credential-gated live validation campaign plan.

## Credential gate

Everything above runs without any Meta credential. The foundations
pivot and current MockTransport-backed app-layer/media slices stop here.
The next credential-gated phase — real message types, templates, flows,
live media checks and live webhook verification against Meta's app secret — **requires access
tokens and WABA ids**. Halt here and confirm with your user before
proceeding with credentialed work.
