import { filtersTyped, normalizeWebhookEnvelope, TypedRouter } from "@wats/core"

// One envelope, three entries: a text message, a delivery status, and a
// malformed entry whose message has no id. The normalizer keeps the first two
// and skips the third with a reason and a path — nothing throws, nothing is
// silently dropped.
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
                id: "wamid.ORDER_42",
                timestamp: "1713697100",
                type: "text",
                text: { body: "order #42 where is it" },
              },
            ],
          },
        },
      ],
    },
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
            statuses: [
              {
                id: "wamid.OUTBOUND_RECEIPT",
                status: "delivered",
                timestamp: "1713697160",
                recipient_id: "15550001111",
              },
            ],
          },
        },
      ],
    },
    {
      // Meta's wire format is not a contract you can trust. This message has
      // no id, so the normalizer skips it instead of handing you garbage.
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
            messages: [
              {
                from: "15550001111",
                timestamp: "1713697200",
                type: "text",
                text: { body: "this one never had an id" },
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
for (const skip of result.skipped) {
  console.log("skipped:", skip.reason, "at", skip.path, "—", skip.detail)
}
for (const update of result.updates) {
  reportUpdate(update)
}

// `message` is a discriminated union intersected with an optional groupId.
// Pull the text body defensively so this stays correct across message types.
function textBody(msg: { type: string }): string | undefined {
  return msg.type === "text" && "text" in msg
    ? (msg as { text: { body: string } }).text.body
    : undefined
}

const router = new TypedRouter()

router.on(filtersTyped.message.text("order"), (ctx) => {
  if (ctx.update.kind !== "message") return
  console.log("orders handler <-", textBody(ctx.update.message))
  return "stop"
})

router.on(filtersTyped.status, (ctx) => {
  if (ctx.update.kind !== "status") return
  console.log("status handler <-", ctx.update.status.status, ctx.update.status.id)
})

for (const update of result.updates) {
  await router.dispatch(update)
}

// The skipped entry never reaches the router. Full skip taxonomy:
// /docs/reference/webhook-normalizer
