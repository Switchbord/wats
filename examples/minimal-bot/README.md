# Minimal bot example

- safety default: offline by default

The smallest runnable WATS bot path for a fresh clone. It uses `@wats/service` with `MockTransport`, synthetic webhook envelope data, and placeholder identifiers only. No live Meta credentials are required.

## Run

```bash
bun run --cwd examples/minimal-bot demo
```

Expected output includes:

```text
wats-minimal-bot:ready
textStatus=200
templateIntent=recorded
syntheticWebhookUpdates=1
graphRequests=1
```

## What it demonstrates

- Creating a `createWatsServiceApp` app with synthetic secrets.
- Sending a text message through the service API against MockTransport.
- Recording a template-send intent without calling Meta.
- Calling `normalizeWebhookEnvelope(...)` on one synthetic webhook envelope to prove the inbound path shape.
- Keeping all imports on public `@wats/*` package specifiers.

The template path is intentionally an intent record, not a live template send. Live template creation, WABA approval, and credentialed Graph validation remain gated work.

## Safety

The demo does not read `.env`, does not call Meta Graph APIs, and does not require access tokens, app secrets, verify tokens, WABA IDs, or phone-number IDs. The service bearer value is a local example string used only inside the process.
