# Deploying a WATS webhook on Node

> Status: guide (F-12). Shipped with WATS-22 (Arch-K). WATS-96 adds the v25 webhook mTLS boundary note.

This guide covers deploying a WATS webhook server under **Node.js**
using `createNodeWebhookHandler` and the standard `node:http`
module's `http.createServer` factory.
For Bun, see `docs/guides/deploy-bun.md`. For Cloudflare Workers /
Deno, see `docs/guides/deploy-cloudflare-workers.md`.

## Install

```bash
npm install @wats/http @wats/core @wats/graph @wats/crypto
```

## Minimal server

```ts
// server.ts
import { createServer } from "node:http";
import {
  createNodeWebhookHandler,
  createWebhookAdapter
} from "@wats/http";
import { GraphClient, createFetchTransport } from "@wats/graph";
import { WhatsApp, message } from "@wats/core";

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

## WATS-96 webhook mTLS and HMAC boundary

`createNodeWebhookHandler` verifies Meta webhook POST bodies at the WATS app layer with HMAC-SHA256 from `X-Hub-Signature-256`. Keep that app-level HMAC verification enabled even if your Node deployment also sits behind TLS or mTLS infrastructure.

Optional Meta webhook mTLS is an infrastructure-level client certificate validation control. During Meta's CA transition, configure your TLS terminator, reverse proxy, load balancer, CDN, platform ingress, or your own HTTPS server to trust Meta's owned root `meta-outbound-api-ca-2025-12.pem` only if you choose that deployment pattern. WATS does not vendor the CA file, does not include PEM contents, and does not configure user infrastructure automatically; obtain and rotate the CA from Meta's authoritative channel.

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
