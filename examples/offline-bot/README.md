# Offline MockTransport bot example

- safety default: offline by default

This example is docs-only by design. It demonstrates the shape of a safe community bot without adding behavior-bearing runtime code.

## Contract

- Graph calls use MockTransport.
- Webhook inputs are synthetic webhook payloads/envelopes.
- No credentials, live WABA ids, live phone-number ids, service bearer values, webhook values, app values, or database URLs are required.
- Any webhook tunnel exercise is credential-gated webhook tunnel guidance and is not part of default tests.

## Sketch

```ts
import { normalizeWebhookEnvelope, TypedRouter, filtersTyped } from "@wats/core";
import { GraphClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";

const transport = createMockTransport({
  defaultResponse: { status: 200, body: { messages: [{ id: "wamid.OFFLINE_BOT" }] } }
});

const graph = new GraphClient({
  accessToken: process.env.WATS_ACCESS_TOKEN ?? "offline",
  apiVersion: "v25.0",
  baseUrl: "https://graph.test/",
  transport: transport.transport
});

const router = new TypedRouter();
router.on(filtersTyped.message.text(), async (update) => {
  await graph.request({ method: "POST", path: "/00000000000/messages", body: { text: update.text.body } });
});

const normalized = normalizeWebhookEnvelope({
  object: "whatsapp_business_account",
  entry: []
});

for (const update of normalized.updates) await router.dispatch(update);
```

If this sketch becomes runnable code later, keep imports public (`@wats/core`, `@wats/graph`, `@wats/graph/testing`) and keep it offline by default.

For a runnable version of this pattern, see `../webhook-echo-bot` — it implements the receive-a-message → reply-to-it loop offline using `createWhatsApp`, `onMessage`, and `sendText` with a mock transport and a synthetic webhook envelope.
