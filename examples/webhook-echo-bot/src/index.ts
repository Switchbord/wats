// examples/webhook-echo-bot/src/index.ts
//
// Runnable offline echo bot. Demonstrates the
// `createWhatsApp` / `onMessage` / `sendText` loop end-to-end without
// any credentials or live Meta calls:
//
//   1. `createWhatsApp` builds a facade bound to a mock transport.
//   2. `wa.onMessage(handler)` registers an echo handler on the
//      facade's router.
//   3. A synthetic WhatsApp webhook envelope (the exact shape Meta
//      delivers) is normalized and dispatched through `wa.dispatch`.
//   4. The handler replies via `wa.sendText`; the mock transport
//      captures the Graph request locally and returns a fake wamid.
//
// Nothing leaves the machine. Run with `bun run examples:webhook-echo-bot`.

import { createWhatsApp, normalizeWebhookEnvelope } from "@wats/core";
import { createMockTransport } from "@wats/graph/testing";

// Mock transport: every Graph send returns a fake wamid. The captured
// request list lets us prove the reply actually went through Graph
// (locally).
const mock = createMockTransport({
  defaultResponse: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { messaging_product: "whatsapp", messages: [{ id: "wamid.ECHO_REPLY" }] }
  }
});

const wa = createWhatsApp({
  accessToken: "offline",
  phoneNumberId: "15550000000",
  apiVersion: "v25.0",
  transport: mock.transport
});

let captured: { from: string; text: string; replyWamid: string | undefined } | undefined;

// Register the echo handler. `wa.onMessage` is sugar for
// "fire on any inbound message update". The handler receives a
// `HandlerContext` whose `.update` is the typed inbound message. We
// narrow to text messages (the echo bot only echoes text).
wa.onMessage(async (ctx) => {
  const message = ctx.update.message;
  if (message.type !== "text") return;
  const from = message.from;
  const inboundText = message.text.body;
  const sent = await wa.sendText({
    to: from,
    text: `echo: ${inboundText}`
  });
  captured = {
    from,
    text: inboundText,
    replyWamid: sent.messages?.[0]?.id
  };
});

// A synthetic inbound webhook envelope, shaped exactly as Meta
// delivers it. `normalizeWebhookEnvelope` turns it into typed updates
// the facade can dispatch.
const envelope = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "example-waba",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550000000",
              phone_number_id: "15550000000"
            },
            messages: [
              {
                from: "15550001111",
                id: "wamid.INBOUND_ECHO",
                timestamp: "1713697100",
                type: "text",
                text: { body: "hello webhook" }
              }
            ]
          }
        }
      ]
    }
  ]
};

const normalized = normalizeWebhookEnvelope(envelope);

if (normalized.updates.length !== 1) {
  throw new Error(
    `expected one normalized update from synthetic envelope, got ${normalized.updates.length}`
  );
}

for (const update of normalized.updates) {
  await wa.dispatch(update);
}

if (!captured) {
  throw new Error("echo handler did not fire for the inbound message update");
}

if (captured.from !== "15550001111") {
  throw new Error(`unexpected sender: ${captured.from}`);
}

if (captured.text !== "hello webhook") {
  throw new Error(`unexpected inbound text: ${captured.text}`);
}

if (captured.replyWamid !== "wamid.ECHO_REPLY") {
  throw new Error(`unexpected reply wamid: ${captured.replyWamid}`);
}

if (mock.requests.length !== 1) {
  throw new Error(
    `expected exactly one captured Graph request (the reply), got ${mock.requests.length}`
  );
}

const replyBody = JSON.parse(String(mock.requests[0]?.body)) as {
  to?: string;
  type?: string;
  text?: { body?: string };
};

if (replyBody.to !== "15550001111") {
  throw new Error(`unexpected reply recipient: ${replyBody.to}`);
}

if (replyBody.text?.body !== "echo: hello webhook") {
  throw new Error(`unexpected reply text: ${replyBody.text?.body}`);
}

console.log("wats-webhook-echo-bot:ready");
console.log(`receivedFrom=${captured.from}`);
console.log(`receivedText=${captured.text}`);
console.log(`replyWamid=${captured.replyWamid}`);
console.log(`graphRequests=${mock.requests.length}`);
console.log("echo-bot:ok");
