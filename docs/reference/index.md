# Reference Index

- status: canonical
- applies-to: `[0.2.0-foundations-complete]` + WATS-31/32/33/34/35/WATS-37/38/39/40/41/42A/44/48/49/WATS-53/WATS-54/WATS-56 consistency line
- lastReviewed: 2026-05-02

Curated index of every WATS reference doc. Use the "When to use it" column to find the right entry point — the detailed surface lives in the linked doc.

## Graph primitives (`@wats/graph`)

| Doc | When to use it |
| --- | --- |
| [`reference/client.md`](./client.md) | Constructing a `GraphClient`; construction-time validation taxonomy; request lifecycle. |
| [`reference/endpoints.md`](./endpoints.md) | Defining a new endpoint with `defineEndpoint`; path templates, param kinds, body passthrough. |
| [`reference/scoped-clients.md`](./scoped-clients.md) | Binding a `phoneNumberId` or `wabaId` into a `PhoneNumberClient` / `WABAClient`. |
| [`reference/errors.md`](./errors.md) | The F-5 error registry; every pywa error code → WATS subclass; classification axis. |
| [`reference/pagination.md`](./pagination.md) | `paginate` / `paginateAll`; cursor extraction; `AbortSignal`; `PaginationError` taxonomy. |
| [`reference/media.md`](./media.md) | Media runtime: upload, metadata, binary download, delete, encrypted decrypt, upload sessions, validation, and integrity checks. Public Graph endpoint subpaths cover messages at `@wats/graph/endpoints/messages`, media at `@wats/graph/endpoints/media`, templates at `@wats/graph/endpoints/templates`, Flows at `@wats/graph/endpoints/flows`, calling at `@wats/graph/endpoints/calling`, and business management at `@wats/graph/endpoints/business-management`; WATS-54 keeps these aligned with `bun run api:check`. |

## Core primitives (`@wats/core`)

| Doc | When to use it |
| --- | --- |
| [`reference/webhook-normalizer.md`](./webhook-normalizer.md) | Translating a raw Meta webhook envelope into a `TypedUpdate` discriminated union. |
| [`reference/filters.md`](./filters.md) | Typed-filter surface: brand, combinators, and built-ins. |
| [`reference/router.md`](./router.md) | `TypedRouter` handle-based registration, observer seams, `DispatchReport` shape. |
| [`reference/whatsapp-facade.md`](./whatsapp-facade.md) | The `WhatsApp` composition root; what it binds, what it exposes, when to bypass it. |
| [`reference/listeners.md`](./listeners.md) | Listener substrate: `wa.listen({ ... })`, timeouts, cancellation, registry lifecycle. |

## HTTP primitives (`@wats/http`)

| Doc | When to use it |
| --- | --- |
| [`reference/webhook-adapter.md`](./webhook-adapter.md) | Wiring up a webhook endpoint: `createWebhookAdapter` core + Bun / Node / Fetch wrappers. |
| [`reference/webhook.md`](./webhook.md) | Low-level `verifyWebhookChallenge` + `validateWebhookSignature` primitives. |

## Crypto primitives (`@wats/crypto`)

| Doc | When to use it |
| --- | --- |
| [`reference/crypto.md`](./crypto.md) | `CryptoProvider` seam; Node / Bun / WebCrypto adapters; typed error hierarchy. |

## Shared types (`@wats/types`)

| Doc | When to use it |
| --- | --- |
| [`reference/types.md`](./types.md) | Discriminated-union domain types. |

## App-layer primitives

| Doc | When to use it |
| --- | --- |
| [`reference/config.md`](./config.md) | `@wats/config` YAML/JSON schema, env-secret refs, validation, redaction. |
| [`reference/cli.md`](./cli.md) | `@wats/cli` skeleton commands and planned onboarding workflow. |
| [`reference/service.md`](./service.md) | `@wats/service` runtime-neutral standalone webhook/API service foundation. |
| [`reference/persistence.md`](./persistence.md) | WATS-48 design target for durable runtime state, SQLite/Postgres adapter contract, migrations, and idempotency. |
| [`reference/openapi.md`](./openapi.md) | Generated OpenAPI 3.1 document and `GET /openapi.json` service route. |

## Guides

| Guide | When to use it |
| --- | --- |
| [`../getting-started.md`](../getting-started.md) | Start here for the foundations walkthrough. |
| [`../guides/transport-and-testing.md`](../guides/transport-and-testing.md) | Injecting `MockTransport`; consumer-fixture pattern; adversarial test hooks. |
| [`../guides/deploy-docker.md`](../guides/deploy-docker.md) | WATS-49 Docker/container deployment design scaffold, not a supported runnable image yet. |
| [`../guides/deploy-bun.md`](../guides/deploy-bun.md) | Deploying a webhook on Bun. |
| [`../guides/deploy-node.md`](../guides/deploy-node.md) | Deploying a webhook on Node `http.createServer`. |
| [`../guides/deploy-cloudflare-workers.md`](../guides/deploy-cloudflare-workers.md) | Deploying a webhook on Cloudflare Workers. |

## Architecture

- `docs/architecture/overview.md`
- `docs/architecture/package-map.md`
- `docs/architecture/public-api-surface.md`
- `docs/architecture/release-policy.md`
- `docs/architecture/roadmap-to-whatsapp-pywa-parity.md`
- `docs/reference/openapi.md`
