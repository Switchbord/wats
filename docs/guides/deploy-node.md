# Deploying a WATS webhook on Node

> Status: guide (F-12). Shipped with WATS-22 (Arch-K).

This guide covers deploying a WATS webhook server under **Node.js**
using `createNodeWebhookHandler` and the standard `node:http`
module's `http.createServer` factory.
For Bun, see `docs/guides/deploy-bun.md`. For Cloudflare Workers /
Deno, see `docs/guides/deploy-cloudflare-workers.md`.

## Install

```bash
npm install @switchbord/http @switchbord/core @switchbord/graph @switchbord/crypto
```

## Minimal server

```ts
// server.ts
import { createServer } from "node:http";
import {
  createNodeWebhookHandler,
  createWebhookAdapter
} from "@switchbord/http";
import { GraphClient, createFetchTransport } from "@switchbord/graph";
import { WhatsApp, message } from "@switchbord/core";

const graphClient = new GraphClient({
  accessToken: process.env.META_ACCESS_TOKEN!,
  apiVersion: "v21.0",
  transport: createFetchTransport()
});

const wa = new WhatsApp({
  graphClient,
  phoneNumberId: process.env.WA_PHONE_NUMBER_ID!
});

wa.on(message, async (update) => {
  console.log("received:", update.message.from, update.message.type);
});

const adapter = createWebhookAdapter({
  verifyToken: process.env.VERIFY_TOKEN!,
  appSecret: process.env.APP_SECRET!,
  whatsapp: wa
});

const handler = createNodeWebhookHandler(adapter);

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    // The adapter already maps internal failures to 500; this catch
    // is only hit if the adapter itself rejects, which should never
    // happen under normal flow.
    console.error("webhook handler error:", err);
    try {
      res.statusCode = 500;
      res.end();
    } catch {
      /* best effort */
    }
  });
});

server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () => {
  console.log("WATS webhook listening on port", server.address());
});
```

## Bodies and streams

`createNodeWebhookHandler` reads the request body into memory as a
`Uint8Array` before handing it to the adapter core. The default
`maxBodyBytes` (1 MiB) applies — requests with `Content-Length`
exceeding the cap are rejected with `413`.

## Behind a reverse proxy

When running behind Nginx / Caddy / a cloud load balancer, make sure
the proxy forwards the raw request body unchanged. Any transform
applied before the body reaches WATS will invalidate the HMAC
signature and cause 401 responses.

## Graceful shutdown

```ts
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
```

## See also

- `docs/reference/webhook-adapter.md`
- `docs/guides/deploy-bun.md`
- `docs/guides/deploy-cloudflare-workers.md`
