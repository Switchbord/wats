# Groups example

- safety default: offline by default

This example exercises the Groups flow without live Meta credentials. It uses `@wats/graph`, `@wats/core`, MockTransport, and synthetic `value.groups[]` group webhook data.

## Run

```bash
bun run examples:groups
```

Expected output includes:

```text
wats-groups-example:ready
createRequestId=req-create-group
syntheticGroupUpdates=2
inviteLink=https://chat.whatsapp.com/EXAMPLE_INVITE
graphRequests=5
```

## What it demonstrates

- Creating a group with `PhoneNumberClient.createGroup`.
- Reading `GROUP_ID_FROM_WEBHOOK` and `JOIN_REQUEST_ID_FROM_WEBHOOK` from synthetic `group_lifecycle_update` and `group_participants_update` payloads.
- Getting the invite link with `GroupClient.getInviteLink`.
- Approving join requests with `GroupClient.approveJoinRequests`.
- Sending a group message with `WhatsApp.sendGroupMessage`.
- Building a group pin payload with `buildSendPinPayload`.
- Matching a synthetic group message with `filtersTyped.group.fromGroup`.

## Safety

The example does not read `.env`, does not bind a local webhook server, and does not call Meta Graph. Placeholder identifiers are fixed strings. For live Meta webhook verification, use a public HTTPS tunnel such as ngrok or an equivalent HTTPS tunnel; do not point Meta at plain localhost and do not commit live tokens, app secrets, verify tokens, WABA ids, phone-number ids, group ids, or invite links.
