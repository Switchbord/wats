import { normalizeWebhookEnvelope } from "@wats/core";
import { GraphClient, PhoneNumberClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";

// Mock transport: Graph calls are captured locally. Nothing leaves the machine.
const mock = createMockTransport({
  defaultResponse: { status: 200, body: { messages: [{ id: "wamid.DEMO_REPLY" }] } },
});
const graphClient = new GraphClient({
  accessToken: "demo-token", // placeholder; the mock never sends it anywhere
  apiVersion: "v25.0",
  baseUrl: "https://graph.facebook.com",
  transport: mock.transport,
});
const phone = new PhoneNumberClient({ graphClient, phoneNumberId: "15550000000" });

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
  if (update.kind !== "message") continue;
  const reply = await phone.sendText({ to: update.message.from, text: "pong" });
  console.log(`replied to ${update.message.from} with ${reply.messages?.[0]?.id}`);
}
console.log(`graph requests captured by mock: ${mock.requests.length}`);
