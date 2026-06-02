# Groups quickstart

- status: WATS-138 credential-free quickstart; live validation pending WATS-139
- safety default: offline by default with MockTransport

This guide shows the Groups flow WATS supports today: create a group, read the group id and invite link from the lifecycle webhook, send the invite link, approve a join request, then message the group.

Use placeholder values in docs and examples. For live Meta verification, Meta requires a public HTTPS callback URL; use ngrok or an equivalent HTTPS tunnel for local testing. Do not paste live access tokens, app secrets, verify tokens, WABA ids, phone-number ids, group ids, or invite links into docs, issues, logs, or examples.

## 1. Create the group

```ts
import { GraphClient, PhoneNumberClient, createFetchTransport } from "@wats/graph";

const graphClient = new GraphClient({
  accessToken: process.env.WATS_ACCESS_TOKEN!,
  apiVersion: "v25.0",
  transport: createFetchTransport()
});

const phone = new PhoneNumberClient({
  graphClient,
  phoneNumberId: process.env.WATS_PHONE_NUMBER_ID!
});

const created = await phone.createGroup({
  subject: "Launch operators",
  description: "Short-lived launch coordination",
  joinApprovalMode: "approval_required"
});

console.log(created.request_id);
```

The create call returns an async `request_id`. The new group id and first invite link arrive later through `group_lifecycle_update`; they do not come back in the create HTTP response.

## 2. Read the lifecycle webhook

In tests and local examples, use synthetic group webhook payloads/envelopes with `normalizeWebhookEnvelope(...)`:

```ts
import { normalizeWebhookEnvelope } from "@wats/core";

const result = normalizeWebhookEnvelope({
  object: "whatsapp_business_account",
  entry: [{
    id: "EXAMPLE_WABA",
    changes: [{
      field: "group_lifecycle_update",
      value: {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: "15550000000",
          phone_number_id: "15550000000"
        },
        type: "group_create",
        request_id: "req-example",
        group_id: "GROUP_ID_FROM_WEBHOOK",
        subject: "Launch operators",
        invite_link: "https://chat.whatsapp.com/EXAMPLE_INVITE",
        join_approval_mode: "approval_required"
      }
    }]
  }]
});

const lifecycle = result.updates.find((update) => update.kind === "groupLifecycle");
```

For live runs, expose the webhook through a public HTTPS tunnel before Meta webhook verification. Keep `WATS_APP_SECRET`, `WATS_VERIFY_TOKEN`, and `WATS_ACCESS_TOKEN` in your local env or secret store only.

## 3. Get the invite link and send it

Once you have `GROUP_ID_FROM_WEBHOOK`, bind a `GroupClient` and read the current invite link:

```ts
const group = phone.group("GROUP_ID_FROM_WEBHOOK");
const invite = await group.getInviteLink();

await phone.sendText({
  to: "15551234567",
  text: `Join the group: ${invite.invite_link}`
});
```

Joining is invite-link only. There is no direct participant add endpoint.

## 4. Approve a join request

When approval is required, Meta sends `group_participants_update` with `group_join_request_created`. Approve by join-request id:

```ts
await group.approveJoinRequests({
  joinRequestIds: ["JOIN_REQUEST_ID_FROM_WEBHOOK"]
});
```

Reject uses `GroupClient.rejectJoinRequests(...)` and maps to `DELETE /{groupId}/join_requests`. Removing participants maps to `DELETE /{groupId}/participants` and accepts at most 8 ids.

## 5. Message the group

```ts
await phone.sendText({
  to: "GROUP_ID_FROM_WEBHOOK",
  recipientType: "group",
  text: "Welcome to the launch group"
});
```

The `WhatsApp` facade also exposes `sendGroupMessage(...)` when constructed with a bound `phoneNumberId`:

```ts
await wa.sendGroupMessage({
  groupId: "GROUP_ID_FROM_WEBHOOK",
  text: "Welcome"
});
```

A `200` send response means Graph accepted the request. It does not prove delivered/read; those states require observed webhook/event-store evidence, not send success.

## Service route smoke

`@wats/service` keeps Groups routes opt-in:

```ts
const app = createWatsServiceApp({
  profile,
  secrets,
  transport: mock.transport,
  enableGroupRoutes: true
});
```

With `enableGroupRoutes: true`, the service exposes `GET|POST /groups`, `GET|POST|DELETE /groups/{groupId}`, invite-link, participants, and join-request routes under `profile.service.apiPrefix`. This is safe to exercise with `MockTransport`. Do not verify Meta webhooks against plain localhost; use a public HTTPS tunnel such as ngrok for credential-gated local live checks.

## Runnable example

Run the credential-free example:

```bash
bun run examples:groups
```

It uses MockTransport plus a synthetic group webhook and prints the generated request paths. It does not call Meta Graph or require live credentials.
