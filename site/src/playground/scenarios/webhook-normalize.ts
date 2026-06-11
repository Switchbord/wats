import { normalizeWebhookEnvelope } from "@wats/core"

// A raw Meta webhook envelope, shaped exactly as WhatsApp delivers it, gets
// normalized into a flat list of typed updates with a discriminated `kind`.
const envelope = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "demo-waba",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550000000",
              phone_number_id: "15550000000",
            },
            contacts: [{ profile: { name: "Ada" }, wa_id: "15550001111" }],
            messages: [
              {
                from: "15550001111",
                id: "wamid.INBOUND_PING",
                timestamp: "1713697100",
                type: "text",
                text: { body: "ping" },
              },
            ],
          },
        },
      ],
    },
  ],
}

const result = normalizeWebhookEnvelope(envelope)
console.log("updates:", result.updates.length, "skipped:", result.skipped.length)

for (const update of result.updates) {
  console.log("kind:", update.kind)
  reportUpdate(update)
}
