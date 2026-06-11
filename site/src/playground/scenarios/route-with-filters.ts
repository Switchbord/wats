import { filtersTyped, normalizeWebhookEnvelope, TypedRouter } from "@wats/core"

// A TypedRouter dispatches each typed update to the first matching handler.
// Filters are composable and type-narrowing: message.text("order") only fires
// on text messages whose body contains "order".
const router = new TypedRouter()

// `message` is a discriminated union intersected with an optional groupId.
// Pull the text body defensively so this stays correct across message types.
function textBody(msg: { type: string }): string | undefined {
  return msg.type === "text" && "text" in msg
    ? (msg as { text: { body: string } }).text.body
    : undefined
}

router.on(filtersTyped.message.text("order"), (ctx) => {
  if (ctx.update.kind !== "message") return
  console.log("order handler <-", textBody(ctx.update.message))
  return "stop"
})

router.on(filtersTyped.message, (ctx) => {
  if (ctx.update.kind !== "message") return
  console.log("fallback handler <-", textBody(ctx.update.message))
})

// Build two synthetic inbound text messages through the real normalizer so the
// router receives genuine TypedUpdate values.
function inbound(body: string, id: string) {
  return {
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
              messages: [
                {
                  from: "15550001111",
                  id,
                  timestamp: "1713697100",
                  type: "text",
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

for (const env of [
  inbound("I want to order", "wamid.ORDER"),
  inbound("hello", "wamid.HELLO"),
]) {
  for (const update of normalizeWebhookEnvelope(env).updates) {
    await router.dispatch(update)
  }
}
