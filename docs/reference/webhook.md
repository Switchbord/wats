# Webhook primitives reference

- status: active
- applies-to: `@switchbord/http`, `@switchbord/core` (`0.2.0-foundations-complete`)
- lastReviewed: 2026-04-28

## Purpose

This page documents the low-level webhook primitives. Most applications should start with `createWebhookAdapter` in `docs/reference/webhook-adapter.md`; use these primitives when you need to wire your own HTTP boundary.

## Recommended lifecycle

1. Receive the raw HTTP request body without modification.
2. Verify Meta's GET challenge with `verifyWebhookChallenge(...)`, or verify POST signatures with `validateWebhookSignature(...)`.
3. Parse JSON only after signature verification succeeds.
4. Normalize the parsed body with `normalizeWebhookEnvelope(...)` from `@switchbord/core`.
5. Dispatch each `TypedUpdate` through `WhatsApp.dispatch(...)` or a compatible router/facade.

`createWebhookAdapter` performs these steps for Bun, Node, Fetch/Workers, and Deno-style runtimes.

## `verifyWebhookChallenge(input)`

```ts
import { verifyWebhookChallenge } from "@switchbord/http";

const result = await verifyWebhookChallenge({
  mode: url.searchParams.get("hub.mode"),
  challenge: url.searchParams.get("hub.challenge"),
  verifyToken: url.searchParams.get("hub.verify_token"),
  expectedVerifyToken: process.env.WATS_VERIFY_TOKEN!
});
```

Input:

- `mode: string | null | undefined`
- `challenge: string | null | undefined`
- `verifyToken: string | null | undefined`
- `expectedVerifyToken: string`
- `crypto?: CryptoProvider`

Returns:

- success: `{ ok: true, challenge: string }`
- failure: `{ ok: false, error: { code, status, message } }`

Failure codes:

- `invalid_expected_verify_token`
- `invalid_mode`
- `invalid_verify_token`
- `missing_challenge`
- `crypto_provider_unavailable`

Verify-token comparison uses the `CryptoProvider` timing-safe comparison after a length gate.

## `validateWebhookSignature(input)`

```ts
import { validateWebhookSignature } from "@switchbord/http";

const result = await validateWebhookSignature({
  appSecret: process.env.WATS_APP_SECRET!,
  rawBody,
  signatureHeader: request.headers.get("x-hub-signature-256")
});
```

Input:

- `appSecret: string`
- `rawBody: string | Uint8Array | ArrayBuffer | ArrayBufferView`
- `signatureHeader: string | null | undefined`
- `crypto?: CryptoProvider`

Returns:

- success: `{ ok: true }`
- failure: `{ ok: false, error: { code, message } }`

Failure codes:

- `invalid_app_secret`
- `invalid_raw_body`
- `missing_signature`
- `invalid_signature_format`
- `signature_mismatch`
- `crypto_provider_unavailable`

Accepted body types:

| Input type | Accepted | Notes |
| --- | ---: | --- |
| `string` | yes | UTF-8 encoded. |
| `Uint8Array` | yes | Preserves bytes. |
| `ArrayBuffer` | yes | Wrapped as `Uint8Array`. |
| `ArrayBufferView` | yes | Preserves `byteOffset` / `byteLength`. |
| Node/Bun `Buffer` | yes | Treated as `ArrayBufferView`. |
| `SharedArrayBuffer`-backed view | no | Rejected to avoid concurrent mutation during HMAC. |
| detached buffer/view | no | Rejected with typed `invalid_raw_body`. |
| `null`, `undefined`, object, number, boolean, array, symbol, function | no | Rejected with typed `invalid_raw_body`. |

The signature header must match `sha256=<64 lowercase hex chars>`. HMAC-SHA256 is computed over the exact raw body bytes.

## `normalizeWebhookEnvelope(rawEnvelope, options?)`

After signature verification and JSON parsing, normalize the parsed envelope:

```ts
import { normalizeWebhookEnvelope } from "@switchbord/core";

const normalized = normalizeWebhookEnvelope(parsedBody, {
  maxEventsPerEnvelope: 1000
});

for (const update of normalized.updates) {
  await wa.dispatch(update);
}
```

`normalizeWebhookEnvelope` emits `TypedUpdate` values and records skipped malformed nested entries. Envelope-level shape errors throw `WebhookNormalizationError`; nested malformed entries/changes are captured in `skipped[]` when possible.

See `docs/reference/webhook-normalizer.md` for the complete normalization contract.

### Calling updates (WATS-41)

`normalizeWebhookEnvelope(...)` now promotes synthetic `field: "calls"` changes
into typed calling updates when the payload shape is stable and safe:

- `value.calls[].event === "connect"` → `kind: "callConnect"`
- `value.calls[].event === "terminate"` → `kind: "callTerminate"`
- `value.statuses[].status ∈ { "RINGING", "ACCEPTED", "REJECTED" }` → `kind: "callStatus"`

Every emitted calling update carries `updateId`, `wabaId`, `phoneNumberId`,
`receivedAt`, `rawChange`, and a `call` or `callStatus` payload with the guarded
wire fields. Malformed nested calling objects, missing/unsafe ids, unsafe
`metadata.phone_number_id`, unsupported call events, unsupported call statuses,
and accessor-backed nested fields are recorded in `skipped[]` with
`reason: "malformed_field"`; they do not throw host errors. Live webhook
fixtures remain credential-gated.

## When to use the adapter instead

Prefer `createWebhookAdapter` unless you need custom HTTP behavior that the adapter cannot express. The adapter already provides:

- GET challenge handling
- POST signature verification
- JSON parse failure mapping
- typed normalization
- dispatch through a facade-shaped object
- body-size cap enforcement
- Bun, Node, and Fetch wrappers
- status-code taxonomy

See `docs/reference/webhook-adapter.md` and the deploy guides under `docs/guides/`.
