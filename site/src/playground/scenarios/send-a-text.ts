import { GraphClient, PhoneNumberClient } from "@wats/graph"
import { createMockTransport } from "@wats/graph/testing"

// Send a WhatsApp text. The mock transport captures the exact Graph request
// WATS would POST to Meta — nothing leaves the browser.
const mock = createMockTransport({
  defaultResponse: {
    status: 200,
    body: { messages: [{ id: "wamid.DEMO_SENT" }] },
  },
})

const graphClient = new GraphClient({
  accessToken: "demo-token",
  apiVersion: "v25.0",
  baseUrl: "https://graph.facebook.com",
  transport: mock.transport,
})

const phone = new PhoneNumberClient({
  graphClient,
  phoneNumberId: "1234567890",
})

const sent = await phone.sendText({ to: "15550001111", text: "hello from WATS" })
console.log("message id:", sent.messages?.[0]?.id ?? "(none)")

report(mock)
