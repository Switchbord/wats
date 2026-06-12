import { GraphClient, PhoneNumberClient } from "@wats/graph"
import { createMockTransport } from "@wats/graph/testing"

// Groups: create an invite-only business group, then send a text into it.
// shape-only: the request shape is implemented and captured here; behavior
// against live Meta is not yet verified.
const mock = createMockTransport({
  responses: [
    { status: 200, body: { request_id: "req-create", success: true } },
    { status: 200, body: { messages: [{ id: "wamid.GROUP_MSG" }] } },
  ],
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

const created = await phone.createGroup({ subject: "Launch crew" })
console.log("created group, success=", created.success)

// Send a text addressed to the group id (recipientType: "group").
const groupId = "120363000000000000"
const sent = await phone.sendText({
  to: groupId,
  recipientType: "group",
  text: "welcome to the group",
})
console.log("group message id:", sent.messages?.[0]?.id ?? "(none)")

console.log("shape-only: implemented, live-validation pending")
report(mock)
