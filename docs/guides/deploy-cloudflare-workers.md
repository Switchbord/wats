# Deploying a WATS webhook on Cloudflare Workers

> Status: guide (F-12). Sketch only — WATS-25 closes the edge-runtime
> shape invariant; the full Miniflare integration test is tracked
> for a later step.

This guide covers deploying a WATS webhook on **Cloudflare Workers**
using `createFetchWebhookHandler`. The same pattern works on Deno
(`Deno.serve`), on Vercel Edge Functions, and on any other runtime
that implements the WinterCG fetch handler contract.

## Why the fetch adapter works on Workers

`@wats/http`'s `createFetchWebhookHandler` produces a pure
`(request: Request) => Promise<Response>` function. The file
`packages/http/src/adapters/fetchAdapter.ts` contains **zero static
`node:*` imports** — this invariant is enforced by two structural
tests (`packages/testing/tests/workspace-policy.test.ts` +
`packages/testing/edge/webhook-adapter.test.ts`) so regressions can't
sneak in.

## Install

```bash
npm install @wats/http @wats/core @wats/graph @wats/crypto
```

Workers require `"nodejs_compat"` **only** for `node:buffer`-style
Node shims. WATS does not need any of them.

## wrangler.toml

```toml
name = "wats-webhook"
main = "src/index.ts"
compatibility_date = "2024-10-01"

[vars]
VERIFY_TOKEN = "..."

[[secrets]]
binding = "APP_SECRET"

[[secrets]]
binding = "META_ACCESS_TOKEN"
```

## Worker entry

```ts
// src/index.ts
import {
  createFetchWebhookHandler,
  createWebhookAdapter
} from "@wats/http";
import { GraphClient, createFetchTransport } from "@wats/graph";
import { WhatsApp, message } from "@wats/core";

export interface Env {
  VERIFY_TOKEN: string;
  APP_SECRET: string;
  META_ACCESS_TOKEN: string;
  WA_PHONE_NUMBER_ID: string;
}

let handler: ((req: Request) => Promise<Response>) | undefined;

function buildHandler(env: Env) {
  const graphClient = new GraphClient({
    accessToken: env.META_ACCESS_TOKEN,
    apiVersion: "v21.0",
    transport: createFetchTransport()
  });

  const wa = new WhatsApp({
    graphClient,
    phoneNumberId: env.WA_PHONE_NUMBER_ID
  });

  wa.on(message, async (update) => {
    // handler body — fire-and-forget from the Worker's perspective.
    console.log("received:", update.message.from);
  });

  const adapter = createWebhookAdapter({
    verifyToken: env.VERIFY_TOKEN,
    appSecret: env.APP_SECRET,
    whatsapp: wa
  });

  return createFetchWebhookHandler(adapter);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (handler === undefined) handler = buildHandler(env);
    return handler(request);
  }
};
```

## Deno

```ts
import { createFetchWebhookHandler, createWebhookAdapter } from "@wats/http";
// ... build adapter as above ...
const handler = createFetchWebhookHandler(adapter);
Deno.serve(handler);
```

## Request body size on Workers

Cloudflare Workers cap request bodies at runtime-plan-specific
limits (100 MiB on paid plans as of 2024). WATS's default
`maxBodyBytes` is 1 MiB — well within any realistic WhatsApp webhook
payload. Raise it via `createWebhookAdapter({ ..., maxBodyBytes })`
if your deployment genuinely needs larger envelopes.

## Observability on Workers

Use `tail`ed logs or a platform logging binding — `logger` fires
synchronously and the Worker's execution-context model is compatible
with a non-async logger callback.

## See also

- `docs/reference/webhook-adapter.md`
- `docs/guides/deploy-bun.md`
- `docs/guides/deploy-node.md`
