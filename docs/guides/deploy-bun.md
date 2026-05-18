# Deploying a WATS webhook on Bun

> Status: guide (F-12). Shipped with WATS-22 (Arch-K) and WATS-25
> (edge-runtime) resolution.

This guide covers deploying a WATS webhook server under the **Bun
runtime** using `createBunWebhookServer`. For Node, see
`docs/guides/deploy-node.md`. For Cloudflare Workers / Deno / other
edge runtimes, see `docs/guides/deploy-cloudflare-workers.md`.

## Install

```bash
bun add @wats/http @wats/core @wats/graph @wats/crypto
```

## Minimal server

```ts
// server.ts
import {
  createBunWebhookServer,
  createWebhookAdapter
} from "@wats/http";
import { GraphClient } from "@wats/graph";
import { WhatsApp, message } from "@wats/core";
import { createFetchTransport } from "@wats/graph";

const graphClient = new GraphClient({
  accessToken: process.env.META_ACCESS_TOKEN!,
  apiVersion: "v25.0",
  transport: createFetchTransport()
});

const wa = new WhatsApp({
  graphClient,
  phoneNumberId: process.env.WA_PHONE_NUMBER_ID!
});

wa.on(message, async (update) => {
  console.log("received message:", update.message.from, update.message.type);
});

const adapter = createWebhookAdapter({
  verifyToken: process.env.VERIFY_TOKEN!,
  appSecret: process.env.APP_SECRET!,
  whatsapp: wa,
  logger: (event) => console.log("wats-http", event.type, event)
});

const server = createBunWebhookServer(adapter, {
  port: Number(process.env.PORT ?? 8787),
  hostname: "0.0.0.0"
});

console.log(`WATS webhook listening on http://${server.hostname}:${server.port}`);
```

Run it:

```bash
bun run server.ts
```

## What `createBunWebhookServer` does

`Bun.serve` already speaks WinterCG `Request → Response`, so the Bun
adapter is a thin wrapper over `createFetchWebhookHandler`. Every
request goes through the same runtime-neutral core as the fetch and
Node adapters, which means the status-code taxonomy is identical.

## Graceful shutdown

```ts
process.on("SIGINT", () => {
  server.stop(true);
  process.exit(0);
});
```

`server.stop(true)` terminates active connections. `server.stop(false)`
stops accepting new connections but lets in-flight requests finish.

## Observability

The `logger` hook fires per lifecycle stage (`request_received`,
`signature_verified`, `body_normalized`, `dispatched`, `response_sent`,
`error`). Pipe it into any observability sink:

```ts
logger: (event) => {
  metrics.increment(`wats.webhook.${event.type}`);
  if (event.type === "error") {
    errorTracker.capture(event.error, { stage: event.stage });
  }
}
```

## See also

- `docs/reference/webhook-adapter.md` — full adapter reference
- `docs/guides/deploy-node.md`
- `docs/guides/deploy-cloudflare-workers.md`
