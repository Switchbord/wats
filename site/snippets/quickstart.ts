import { createWhatsApp, normalizeWebhookEnvelope } from "@wats/core";
import { createMockTransport } from "@wats/graph/testing";

// Mock transport: Graph calls are captured locally. Nothing leaves the machine.
const mock = createMockTransport({
  defaultResponse: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { messaging_product: "whatsapp", messages: [{ id: "wamid.DEMO_REPLY" }] },
  },
});

// createWhatsApp wires the Graph client, typed router, and listener registry
// behind one facade. accessToken is required but never sent anywhere — the
// mock transport intercepts every request.
const wa = createWhatsApp({
  accessToken: "demo-token",
  phoneNumberId: "15550000000",
  apiVersion: "v25.0",
  transport: mock.transport,
});

// onMessage registers a handler fired for every inbound message update.
wa.onMessage(async (ctx) => {
  const message = ctx.update.message;
  if (message.type !== "text") return;
  await wa.sendText({ to: message.from, text: `pong: ${message.text.body}` });
});

// A synthetic inbound webhook, shaped exactly as Meta delivers it.
const envelope = {
  object: "whatsapp_business_account",
  entry: [{ id: "demo-waba", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550000000", phone_number_id: "15550000000" },
    messages: [{ from: "15550001111", id: "wamid.INBOUND", timestamp: "1713697100",
      type: "text", text: { body: "ping" } }],
  } }] }],
};

for (const update of normalizeWebhookEnvelope(envelope).updates) {
  await wa.dispatch(update);
}

console.log(`replied to 15550001111 with wamid.DEMO_REPLY`);
console.log(`graph requests captured by mock: ${mock.requests.length}`);
