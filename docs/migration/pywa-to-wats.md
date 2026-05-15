# Migration: pywa to WATS

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo, WATS-44]
- owner: WATS maintainers
- lastReviewed: 2026-05-01

## Purpose

This guide helps teams migrate Python `pywa` integrations to WATS without overstating current live Meta parity. WATS is a Bun-first TypeScript implementation with async-only APIs, camelCase public names, package-scoped primitives, strict runtime validation, and MockTransport-first tests.

Use this guide together with:

- `docs/parity/pywa-parity-matrix.md` for capability status.
- `docs/parity/live-testing-campaign.md` for the future credentialed validation runbook.
- `packages/testing/fixtures/*/verify-imports.ts` for executable package-specifier examples.

## Status labels

WATS-44 uses these labels in migration tables:

| Label | Meaning |
| --- | --- |
| Implemented, credential-free | Covered by local tests, MockTransport, synthetic webhooks, and consumer fixtures. |
| Implemented, live pending | Runtime surface exists, but actual Meta/WhatsApp behavior still needs credentials. |
| Read-only only | Safe inventory/read helper exists; mutation remains deferred or credential-gated. |
| Typed-only | Type or sentinel surface exists, but no dedicated runtime behavior should be inferred. |
| Deferred | No first-class WATS equivalent yet. Track follow-up work in Linear, not repo-local ledgers. |

A row marked implemented does not mean live Meta parity unless the row explicitly says live validation has been completed.

## Package and construction map

| pywa concept | WATS equivalent | Status | Notes |
| --- | --- | --- | --- |
| `pywa.WhatsApp(...)` | `new GraphClient(...)` plus `new WhatsApp({ graphClient, phoneNumberId?, wabaId? })` from `@switchbord/core` | Implemented, credential-free | WATS separates Graph transport from facade orchestration. |
| `pywa_async.WhatsApp` | WATS Promise-returning APIs | Implemented, credential-free | WATS is async-only; there is no sync API. |
| `wa.api` / low-level Graph API | `GraphClient.request`, `requestRaw`, `defineEndpoint` | Implemented, credential-free | Prefer first-class endpoints before custom `defineEndpoint`. |
| `phone_id`-bound methods | `PhoneNumberClient` or `WhatsApp` with `phoneNumberId` | Implemented, credential-free | Constructor-bound ids are validated and cannot be caller-overridden. |
| `business_account_id` / WABA methods | `WABAClient` or `WhatsApp` with `wabaId` | Implemented, credential-free | Templates, Flows, and read-only admin inventory hang from WABA. |
| pywa server config | `@switchbord/http` adapter or `@switchbord/service` | Implemented, credential-free | WATS keeps standalone service separate from SDK primitives. |
| pywa env/token constructor args | `@switchbord/config` env-secret references | Implemented, credential-free | WATS config stores `{ env: "..." }`, never raw secrets. |

## Client construction and auth

pywa commonly puts token, phone id, WABA id, server, webhook, and app secret into one `WhatsApp(...)` constructor. WATS separates those responsibilities:

```ts
import { GraphClient, createFetchTransport } from "@switchbord/graph";
import { WhatsApp } from "@switchbord/core";

const graphClient = new GraphClient({
  accessToken: process.env.WATS_ACCESS_TOKEN!,
  apiVersion: "v25.0",
  transport: createFetchTransport()
});

const wa = new WhatsApp({
  graphClient,
  phoneNumberId: process.env.WATS_PHONE_NUMBER_ID,
  wabaId: process.env.WATS_WABA_ID
});
```

Migration notes:

- Public WATS options are camelCase: `phoneNumberId`, `wabaId`, `accessToken`, `apiVersion`.
- Graph wire names remain snake_case only at the HTTP boundary.
- WATS constructors reject unsafe ids before transport.
- WATS does not resolve env-secret refs in the SDK; config/service/CLI boundaries own env indirection.

## Message sending map

| pywa usage | WATS usage | Status | Notes |
| --- | --- | --- | --- |
| pywa `send_message` / `send_text` | WATS `PhoneNumberClient.sendText` or `WhatsApp.startChat` | Implemented, credential-free | Sends text to arbitrary E.164-ish recipients without contact lookup. |
| `send_image`, `send_video`, `send_audio`, `send_document`, `send_sticker` | `PhoneNumberClient.sendImage` / `.sendVideo` / `.sendAudio` / `.sendDocument` / `.sendSticker` or matching `WhatsApp` helpers | Implemented, live pending | WATS accepts existing media ids or http(s) links for message sends. |
| pywa local file / bytes / file-like media sends | `uploadMedia` first, then send by returned media id | Partially implemented | pywa auto-upload polymorphism is not yet a one-call WATS helper. |
| `send_location` / `request_location` | `sendLocation` / `requestLocation` | Implemented, live pending | MockTransport-backed. |
| `send_contact` | `sendContacts` | Implemented, live pending | WATS uses bounded arrays and strict contact shapes. |
| `send_reaction` / `remove_reaction` | `sendReaction` / `removeReaction` | Implemented, live pending | Reactions route through `POST /{phoneNumberId}/messages`. |
| pywa buttons / lists / CTA objects | `sendButtons`, `sendList`, `sendCtaUrl` | Implemented, live pending | WATS exposes separate helpers rather than pywa's overloaded `send_message(buttons=...)`. |
| pywa catalog/product sends | `sendCatalog`, `sendProduct`, `sendProducts` | Implemented, live pending | Requires commerce/catalog assets for live validation. |
| `mark_message_as_read` / `indicate_typing` | `markMessageAsRead` / `indicateTyping` | Implemented, live pending | Only use on test conversations during live campaigns. |
| pywa `tracker` | WATS `bizOpaqueCallbackData`-style inputs where supported | Partial | Check the specific WATS helper; WATS uses camelCase. |

## Media map

| pywa usage | WATS usage | Status | Notes |
| --- | --- | --- | --- |
| `upload_media` | `uploadMedia` | Implemented, live pending | Validates caps and body shape locally. |
| `get_media_url` / metadata | `downloadMedia` | Implemented, live pending | Returns Meta media metadata / resolved URL shape. |
| `download_media` / `get_media_bytes` | `downloadMediaBytes` | Implemented, live pending | Use `maxBytes` and integrity checks. |
| `delete_media` | `deleteMedia` | Implemented, live pending | Destructive; cleanup-only in live campaign. |
| encrypted media decrypt helpers | `decryptEncryptedMedia` | Implemented, credential-free | Uses WATS crypto/integrity checks locally. |
| resumable upload sessions | `createUploadSession`, `uploadFileToSession`, `getUploadSession` | Implemented, live pending | Import from `@switchbord/graph` or `@switchbord/graph/endpoints/media`; no `PhoneNumberClient.uploadMedia` convenience yet. |

## Templates map

| pywa usage | WATS usage | Status | Notes |
| --- | --- | --- | --- |
| pywa `create_template` / `get_templates` / `delete_template` | WATS `WABAClient.createMessageTemplate`, `.listMessageTemplates`, `.getMessageTemplate`, `.updateMessageTemplate`, `.deleteMessageTemplate` | Implemented, live pending | Live template mutations require explicit opt-in. |
| pywa `send_template` | `PhoneNumberClient.sendTemplate` or `WhatsApp.sendTemplate` | Implemented, live pending | Parameter-count validation exists locally. |
| pywa template component DSL | WATS component builders such as `buildTemplateHeaderComponent` | Partial | Core HEADER/BODY/FOOTER/BUTTONS helpers exist; pywa's larger DSL is broader. |
| template status/category/quality/components handlers | `normalizeWebhookEnvelope` account helpers plus `filtersTyped.template` | Implemented, credential-free | Synthetic webhook coverage; live webhook validation pending. |
| `compare_templates`, `migrate_templates`, `unpause_template`, bulk auth/library helpers | No first-class WATS helper yet | Deferred | Track in Linear if needed after WATS-44. |

## Flows map

| pywa usage | WATS usage | Status | Notes |
| --- | --- | --- | --- |
| pywa `create_flow` / `get_flows` / `publish_flow` | WATS `WABAClient.createFlow`, `.listFlows`, `.getFlow`, `.publishFlow` | Implemented, live pending | Publish/deprecate are state transitions; require explicit live opt-in. |
| update metadata / JSON | `updateFlowMetadata`, `updateFlowJson` | Implemented, live pending | Flow JSON validation is bounded and descriptor-safe. |
| delete / deprecate / assets | `deleteFlow`, `deprecateFlow`, `getFlowAssets` | Implemented, live pending | Delete/deprecate only resources created by the test run. |
| Flow response builders | `buildFlowScreenResponse`, `buildFlowCloseResponse`, `buildFlowErrorResponse` | Implemented, credential-free | Local data-exchange response construction only. |
| encrypted Flow request decrypt/encrypt and Flow hosting | No first-class WATS runtime yet | Deferred | WATS-44 campaign documents requirements; implementation belongs in later slices. |
| Flow metrics / migration | No first-class WATS helper yet | Deferred | Credentialed and account-dependent. |

## Calling map

| pywa usage | WATS usage | Status | Notes |
| --- | --- | --- | --- |
| pywa `initiate_call` / `accept_call` / `terminate_call` | WATS `PhoneNumberClient.initiateCall`, `.acceptCall`, `.terminateCall` | Implemented, live pending | Also includes `preAcceptCall` and `rejectCall`. |
| call connect/status/terminate handlers | `normalizeWebhookEnvelope` calling variants plus `filtersTyped.call` | Implemented, credential-free | Synthetic payloads only. |
| call permission request/update | No complete WATS equivalent yet | Deferred | pywa has richer permission models and waiters. |
| calling settings/SIP models | Read-only `getPhoneNumberSettings`; mutating settings deferred | Read-only only | `includeSipCredentials` may return secret-bearing SIP material. |
| live WebRTC/media orchestration | No first-class WATS equivalent yet | Deferred | Requires real calling-enabled phone numbers and explicit authorization. |

## Business and admin map

| pywa usage | WATS usage | Status | Notes |
| --- | --- | --- | --- |
| pywa `get_business_account` | `WABAClient.getInfo` / `getWabaInfo` | Read-only only | WATS-42A. |
| pywa `get_business_phone_numbers` | `WABAClient.listPhoneNumbers` | Read-only only | Supports `fields`, `limit`, `after`, `before`. |
| pywa `get_business_phone_number_settings` | `PhoneNumberClient.getSettings` | Read-only only | `includeSipCredentials` is sensitive. |
| pywa `get_business_profile` / `get_commerce_settings` | WATS `PhoneNumberClient.getBusinessProfile` / `.getCommerceSettings` | Read-only only | Mutations are deferred. |
| register/deregister phone, callback overrides, public key, profile/settings/commerce updates | No first-class WATS helper yet | Deferred / credential-gated | Separate issue and explicit user authorization required. |
| QR code CRUD, block/unblock users, token exchange | No first-class WATS helper yet | Deferred | Capture as Linear follow-ups if needed. |

## Webhook, handler, filter, and listener migration

pywa decorators such as `@wa.on_message`, `@wa.on_callback_button`, `@wa.on_flow_completion`, and `@wa.on_call_status` map to WATS router/listener primitives:

```ts
import { WhatsApp, filtersTyped } from "@switchbord/core";

wa.on(filtersTyped.message.text("hello"), async (update) => {
  await wa.startChat({ to: update.message.from, text: "hi" });
});
```

Migration differences:

- WATS `TypedRouter.on(...)` returns a registration handle with `unregister()` instead of pywa decorator registration.
- WATS handlers receive `TypedUpdate` variants rather than pywa Python classes.
- WATS `wa.listen(...)` replaces some conversational one-shot waits, but pywa sent-update waiters such as `SentMessage.wait_for_reply`, `wait_until_read`, `wait_for_click`, and `wait_for_completion` do not yet have object-method equivalents.
- WATS filters use function composition (`and`, `or`, `not`, `custom`) rather than Python `&`, `|`, and `~` operators.
- WATS-43A deep-normalizes common inbound message body families and adds typed filters for media, location, reaction, interactive button/list/nfm Flow-completion replies, and quick-reply buttons. This covers the most common `@wa.on_callback_button`, `@wa.on_callback_selection`, and `@wa.on_flow_completion` migration paths while keeping the update kind as `"message"`.
- WATS still has fewer first-class typed update families than pywa for user preferences, phone/identity system events, call permission updates, and several status/account details.

## Error handling migration

pywa raises `WhatsAppError` subclasses keyed from Graph error codes. WATS exposes `GraphApiError` subclasses and a seeded registry mirroring pywa error codes where possible:

```ts
import { ExpiredAccessTokenError, GraphApiError } from "@switchbord/graph";

try {
  await phone.sendText({ to: "+15551234567", text: "hello" });
} catch (error) {
  if (error instanceof ExpiredAccessTokenError) {
    // refresh / rotate the token
  } else if (error instanceof GraphApiError) {
    // inspect error.code, error.subcode, error.classification
  }
}
```

Migration notes:

- Do not match Python class names in TypeScript code; import WATS subclasses from `@switchbord/graph`.
- WATS validation failures reject before transport with WATS-specific validation errors.
- Rate-limit retry/backoff is still a planned transport decorator, not automatic.

## Import and subpath cheat sheet

| Need | Import |
| --- | --- |
| Graph client, scoped clients, endpoints | `@switchbord/graph` |
| Mock transport | `@switchbord/graph/testing` |
| Message endpoint helpers | `@switchbord/graph/endpoints/messages` |
| Media runtime helpers | `@switchbord/graph/endpoints/media` |
| Message-template helpers | `@switchbord/graph/endpoints/templates` |
| Flow management helpers | `@switchbord/graph/endpoints/flows` |
| Calling endpoint helpers | `@switchbord/graph/endpoints/calling` |
| Business-management read helpers | `@switchbord/graph/endpoints/business-management` |
| Facade/router/filters/listeners | `@switchbord/core` |
| Typed filter subpath | `@switchbord/core/filtersTyped` |
| Webhook adapters | `@switchbord/http` or `@switchbord/http/adapters/fetch` / `bun` / `node` |
| Config | `@switchbord/config` |
| Service app / OpenAPI document | `@switchbord/service` |
| CLI testable entry | `@switchbord/cli` |

Use consumer fixtures as the source of truth for supported package-specifier imports. WATS-54 adds `bun run api:check` to keep package exports, target source files, graph-consumer package-specifier imports, docs/reference/index.md, public API surface docs, package map, this migration cheat sheet, and CHANGELOG mentions aligned for messages, media, message-template, Flow, calling, and business-management Graph endpoint subpaths.

## Known gaps to plan around

Do not migrate code assuming WATS already has pywa parity for:

- pywa's full decorator and handler taxonomy for callback selections/buttons, Flow request sub-actions, user marketing preferences, phone-number changes, and identity changes.
- pywa sent-update waiters (`wait_for_reply`, `wait_until_read`, `wait_for_selection`, `wait_for_completion`, call permission waits).
- pywa's broad filter catalog: commands, MIME/extension filters, location radius, per-error-code status filters, user marketing filters, call permission filters.
- one-call local-file/bytes media send polymorphism.
- pywa's complete template component DSL, compare/migrate/unpause, library/authentication helper breadth.
- pywa's full Flow JSON DSL, encrypted Flow request decrypt/encrypt, Flow hosting, metrics, migration.
- calling permissions, calling settings/SIP mutations, and real call orchestration.
- mutating admin APIs, token flows, callback overrides, QR codes, block/unblock users, and phone registration/deregistration.
- full Meta Graph OpenAPI generation and live/production operator modes beyond the current credential-free `wats init`, `wats doctor`, and dry-run `wats serve` tooling.

## Migration checklist

1. Inventory pywa imports and method names.
2. Replace constructor setup with `GraphClient`, `PhoneNumberClient`, `WABAClient`, and `WhatsApp` facade composition.
3. Convert snake_case names to camelCase.
4. Move raw secrets to env vars or `@switchbord/config` env-secret refs.
5. Replace pywa send methods with WATS scoped-client methods and root builders.
6. Replace decorators with `TypedRouter.on(...)` / `WhatsApp.on(...)` and `filtersTyped`.
7. Replace conversational waits with `wa.listen(...)` where possible; flag sent-update waiter gaps.
8. Keep live operations behind the WATS-44 campaign gates.
9. Add MockTransport tests before using real credentials.
10. Track missing pywa surfaces in Linear.

## Credentialed validation campaign

WATS-44 does not run live Meta calls. The future campaign is documented in `docs/parity/live-testing-campaign.md` and must be explicitly authorized before any token, WABA id, phone number id, webhook secret, message send, template mutation, Flow mutation, calling session, or admin mutation is used.

Default ordering is read-only before side-effecting before destructive. All raw responses must be redacted before they are copied into docs, fixtures, issues, or chat.
