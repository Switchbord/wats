import { filtersTyped, normalizeWebhookEnvelope, WhatsApp } from "@wats/core";
import type { TransportRequest } from "@wats/graph";
import { GraphClient, PhoneNumberClient } from "@wats/graph";
import { buildSendPinPayload } from "@wats/graph/endpoints/messages";
import { createMockTransport } from "@wats/graph/testing";

const GROUP_ID_FROM_WEBHOOK = "GROUP_ID_FROM_WEBHOOK";
const JOIN_REQUEST_ID_FROM_WEBHOOK = "JOIN_REQUEST_ID_FROM_WEBHOOK";

const mock = createMockTransport({
  responses: [
    { status: 200, body: { request_id: "req-create-group" } },
    { status: 200, body: { invite_link: "https://chat.whatsapp.com/EXAMPLE_INVITE" } },
    { status: 200, body: { request_id: "req-approve-join" } },
    { status: 200, body: { messaging_product: "whatsapp", messages: [{ id: "wamid.GROUP.TEXT" }] } },
    { status: 200, body: { messaging_product: "whatsapp", messages: [{ id: "wamid.GROUP.PIN" }] } }
  ]
});

const graphClient = new GraphClient({
  accessToken: ["example", "graph", "token"].join("-"),
  apiVersion: "v25.0",
  transport: mock.transport
});

const phone = new PhoneNumberClient({
  graphClient,
  phoneNumberId: "15550000000"
});

const wa = new WhatsApp({
  graphClient,
  phoneNumberId: "15550000000"
});

const createAck = await phone.createGroup({
  subject: "Launch operators",
  description: "Short-lived launch coordination",
  joinApprovalMode: "approval_required"
});

const syntheticGroupWebhook = {
  object: "whatsapp_business_account",
  entry: [{
    id: "EXAMPLE_WABA",
    changes: [
      {
        field: "group_lifecycle_update",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "15550000000",
            phone_number_id: "15550000000"
          },
          type: "group_create",
          request_id: createAck.request_id ?? "req-create-group",
          group_id: GROUP_ID_FROM_WEBHOOK,
          subject: "Launch operators",
          invite_link: "https://chat.whatsapp.com/EXAMPLE_INVITE",
          join_approval_mode: "approval_required"
        }
      },
      {
        field: "group_participants_update",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "15550000000",
            phone_number_id: "15550000000"
          },
          type: "group_join_request_created",
          group_id: GROUP_ID_FROM_WEBHOOK,
          join_request_id: JOIN_REQUEST_ID_FROM_WEBHOOK,
          wa_id: "15551234567",
          reason: "invite_link"
        }
      }
    ]
  }]
};

const normalized = normalizeWebhookEnvelope(syntheticGroupWebhook);
const lifecycle = normalized.updates.find((update) => update.kind === "groupLifecycle");
const joinRequest = normalized.updates.find((update) => update.kind === "groupParticipants");

if (lifecycle?.kind !== "groupLifecycle" || lifecycle.group.groupId !== GROUP_ID_FROM_WEBHOOK) {
  throw new Error("expected synthetic group_lifecycle_update to yield GROUP_ID_FROM_WEBHOOK");
}

if (joinRequest?.kind !== "groupParticipants" || joinRequest.group.joinRequestId !== JOIN_REQUEST_ID_FROM_WEBHOOK) {
  throw new Error("expected synthetic group_participants_update to yield JOIN_REQUEST_ID_FROM_WEBHOOK");
}

const group = phone.group(GROUP_ID_FROM_WEBHOOK);
const invite = await group.getInviteLink();
await group.approveJoinRequests({ joinRequestIds: [JOIN_REQUEST_ID_FROM_WEBHOOK] });
await wa.sendGroupMessage({
  groupId: GROUP_ID_FROM_WEBHOOK,
  text: `Welcome via ${invite.invite_link ?? "placeholder invite link"}`
});
const emittedGroupRecipientType = JSON.parse(String(mock.requests[3]?.body)) as { recipient_type?: string };
if (emittedGroupRecipientType.recipient_type !== "group") {
  throw new Error("expected sendGroupMessage to emit recipient_type=group");
}

const pinBody = buildSendPinPayload({
  to: GROUP_ID_FROM_WEBHOOK,
  pinType: "pin",
  messageId: "wamid.GROUP.TEXT",
  expirationDays: 7
});
await phone.sendMessage(pinBody);

const groupOnly = filtersTyped.group.fromGroup(GROUP_ID_FROM_WEBHOOK);
if (!groupOnly.predicate({
  kind: "message",
  updateId: "wamid.GROUP.TEXT",
  phoneNumberId: "15550000000",
  wabaId: "EXAMPLE_WABA",
  receivedAt: 1,
  message: {
    from: "15551234567",
    id: "wamid.GROUP.TEXT",
    timestamp: "1780000000",
    type: "text",
    groupId: GROUP_ID_FROM_WEBHOOK,
    text: { body: "hello" }
  },
  rawChange: { field: "messages", value: {} }
})) {
  throw new Error("expected filtersTyped.group.fromGroup to match the synthetic group message");
}

console.log("wats-groups-example:ready");
console.log(`createRequestId=${createAck.request_id ?? "missing"}`);
console.log(`syntheticGroupUpdates=${normalized.updates.length}`);
console.log(`inviteLink=${invite.invite_link ?? "missing"}`);
console.log(`graphRequests=${mock.requests.length}`);
console.log(mock.requests.map((request: TransportRequest) => `${request.method} ${new URL(request.url).pathname}`).join("\n"));
