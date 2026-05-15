# WATS-52 community examples and alpha launch scaffold

- status: alpha docs/examples scaffold
- applies-to: WATS-52 / WATS-52A
- safety default: offline by default, MockTransport-first, synthetic webhook payloads/envelopes only

## Purpose

WATS-52 starts the community examples surface for developers who want to learn the current public WATS package APIs without live WhatsApp credentials. This guide is intentionally a narrow scaffold: it links the safe WATS-51 config templates, shows local Request-to-Response service usage, points to offline MockTransport patterns, and records the extensibility seams that examples should build on.

The goal is community examples that are easy to copy, safe to run in CI, and honest about alpha gaps. Nothing in this guide requires a live Meta app, a real WABA, a real phone-number id, a webhook secret, a service bearer value, or a database URL.

## Example safety contract

All WATS-52 community examples are offline by default.

- Use MockTransport for Graph-facing calls.
- Use synthetic webhook payloads/envelopes for webhook/router examples.
- Keep checked-in configs credential-free and use placeholder env names only.
- Do not commit raw access tokens, bearer tokens, webhook values, app values, live WABA ids, live phone-number ids, or database URLs.
- Treat webhook tunnels and live Meta callbacks as credential-gated webhook tunnel guidance that is not run by docs tests or default example commands.
- Do not infer WhatsApp `delivered` or `read` from send success. `delivered` and `read` require observed webhook/event-store evidence, not from send success.

Config template starting points from WATS-51:

- `examples/config/wats.config.example.yaml`
- `examples/config/wats.config.example.json`
- `.env.example`

Copy those files only into ignored local paths before filling any real values. The checked-in files remain placeholders.

## Quickstart flow with checked templates

1. Read the example index in `examples/README.md`.
2. Inspect `examples/config/wats.config.example.yaml` or `examples/config/wats.config.example.json`.
3. Inspect `.env.example` to see the expected env names without real values.
4. Keep offline examples on MockTransport and synthetic webhook payloads/envelopes.
5. Use the public docs and package imports only; do not import from `packages/*/src` in community examples.

Current useful local checks:

```sh
bun test packages/testing/tests/wats52-community-examples.test.ts
bun run docs:check
```

For no-network process smoke checks, use the current dry-run `wats serve --config <path> --dry-run` flow documented in `docs/reference/cli.md`. The examples below still call `createWatsServiceApp(...).fetch(request)` directly when a test wants a pure Request-to-Response fixture instead of a process wrapper.

## Offline MockTransport bot example

The first community bot shape is a docs-first pattern: construct public WATS objects, inject MockTransport, and drive behavior with fixture data.

```ts
import { GraphClient } from "@switchbord/graph";
import { createMockTransport } from "@switchbord/graph/testing";

const mock = createMockTransport({
  defaultResponse: {
    status: 200,
    body: { messages: [{ id: "wamid.OFFLINE_EXAMPLE" }] }
  }
});

const client = new GraphClient({
  accessToken: process.env.WATS_ACCESS_TOKEN ?? "offline",
  apiVersion: "v25.0",
  baseUrl: "https://graph.test/",
  transport: mock.transport
});

await client.request({ method: "GET", path: "/me" });
console.log(mock.requests.length);
```

The fallback string above is a short offline fixture value used only with MockTransport. Replace this pattern with env-loaded local values only inside ignored files when doing credential-gated live testing.

For webhook examples, use synthetic webhook payloads/envelopes and `normalizeWebhookEnvelope` or a `WebhookAdapter` in a local test. Keep fixture sender ids and message ids clearly synthetic.

## Service app fetch and OpenAPI example

`@switchbord/service` exposes a runtime-neutral Request-to-Response app. Use it directly for local examples; do not require a server process.

```ts
import type { WatsProfileConfig } from "@switchbord/config";
import { createMockTransport } from "@switchbord/graph/testing";
import { createWatsServiceApp, createWatsServiceOpenApiDocument } from "@switchbord/service";

const profile: WatsProfileConfig = {
  graph: { apiVersion: "v25.0", baseUrl: "https://graph.test/" },
  whatsapp: { wabaId: "000000000000000", phoneNumberId: "00000000000" },
  auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
  webhook: {
    path: "/webhooks/whatsapp",
    verifyToken: { env: "WATS_VERIFY_TOKEN" },
    appSecret: { env: "WATS_APP_SECRET" },
    maxBodyBytes: 1048576
  },
  service: {
    host: "127.0.0.1",
    port: 8787,
    apiPrefix: "/api",
    bearerToken: { env: "WATS_SERVICE_TOKEN" }
  }
};

const mock = createMockTransport({
  defaultResponse: { status: 200, body: { messages: [{ id: "wamid.OFFLINE_SERVICE" }] } }
});

const app = createWatsServiceApp({
  profile,
  secrets: {
    accessToken: process.env.WATS_ACCESS_TOKEN ?? "offline",
    webhookVerifyToken: process.env.WATS_VERIFY_TOKEN ?? "offline",
    webhookAppSecret: process.env.WATS_APP_SECRET ?? "offline",
    serviceBearerToken: process.env.WATS_SERVICE_TOKEN ?? "offline"
  },
  transport: mock.transport
});

const health = await app.fetch(new Request("https://local.test/healthz"));
const openapi = createWatsServiceOpenApiDocument(profile, { serverUrl: "https://local.test" });

console.log(health.status, openapi.openapi);
```

This is a service app fetch/OpenAPI example, not a deployment recipe. It performs no live Meta calls because Graph access is routed through MockTransport.

## Webhook tunnel checklist, credential-gated

Credential-gated webhook tunnel guidance belongs behind explicit operator setup and must not run in default tests.

Checklist for a future local tunnel exercise:

- Start from ignored local copies of `examples/config/wats.config.example.yaml` and `.env.example`.
- Fill real values only in ignored local files or a secret manager.
- Choose a tunnel provider and map it to the configured webhook path.
- Register callback URL and verify token in the Meta app dashboard.
- Confirm signature verification locally with the configured app value.
- Capture only redacted logs; never paste raw webhook bodies that contain user data into issues.
- Record delivery or read state only when an observed webhook/event-store record proves it.

This checklist is intentionally credential-gated webhook tunnel guidance. WATS-52A does not add a live tunnel command, does not require a tunnel during tests, and does not validate live callbacks.

## Extensibility seams

Community examples should prefer existing public seams:

- Transport and interceptors: inject MockTransport or a custom public `Transport` to test Graph behavior without network calls.
- TypedRouter, filters, and listeners: route normalized updates with public `TypedRouter`, `filtersTyped`, and listener registries.
- WebhookAdapter: adapt Request objects to normalized webhook dispatch while keeping signature and challenge verification at the edge.
- Config/service boundaries: parse and validate config outside the service, resolve secret env refs outside checked-in examples, and pass in-memory values to `createWatsServiceApp`.
- OpenAPI boundary: call `createWatsServiceOpenApiDocument` or `app.fetch(new Request("https://local.test/openapi.json"))` for local documentation checks.

## What is not implemented yet

Current WATS now implements safe local `wats init` config/env placeholder generation, real offline `wats doctor` diagnostics, and dry-run `wats serve` for local service smoke checks. credential-gated live serve mode, live Meta validation, Dockerfiles, Compose files, release automation, image publication, and a full community gallery remain outside this scaffold.

Use Linear issue scope for future backlog. Do not add repo-local deferred ledgers for WATS-52 follow-up work.
