# Webhook echo bot example

- safety default: offline by default

A runnable, credential-free demonstration of the receive-a-message → reply-to-it loop using the WATS-172 facade API (`createWhatsApp`, `onMessage`, `sendText`).

No credentials, no live WABA ids, no live phone-number ids, no live Meta calls. The Graph send is captured by `createMockTransport`; the inbound message is a synthetic webhook envelope normalized by `normalizeWebhookEnvelope` and dispatched through `wa.dispatch`.

## What it shows

- `createWhatsApp({ accessToken, phoneNumberId, transport })` factory wiring with a mock transport.
- `wa.onMessage(handler)` registration of an echo handler on the facade router.
- `normalizeWebhookEnvelope` turning a synthetic Meta-shaped webhook body into typed updates.
- `wa.dispatch(update)` driving the handler, which replies via `wa.sendText`.
- The captured Graph request list proving the reply went through (locally).

## How to run

From the repo root:

```sh
bun run examples:webhook-echo-bot
```

No credentials needed. The script exits 0 on success and prints `echo-bot:ok`.

For a docs-only walkthrough of the same offline MockTransport bot pattern, see `../offline-bot/README.md`.
