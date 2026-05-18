# WATS credentialed live-testing campaign

- status: planned
- decisionStatus: locked
- labels: [WATS-44, credentialed, liveValidation, redaction]
- owner: WATS maintainers
- lastReviewed: 2026-05-01

## Purpose

This runbook defines how to validate WATS against live Meta/WhatsApp assets after the user provides credentials and explicit authorization. It is not a default test path, not CI, and not permission to call live Graph endpoints during credential-free implementation.

The campaign covers live validation for the currently implemented credential-free surfaces:

- WATS-37 media runtime.
- WATS-38 outbound message composers.
- WATS-39 template management and template sends.
- WATS-40 Flow management helpers.
- WATS-41 Calling API request/webhook helpers.
- WATS-42A read-only business/admin inventory.

## Scope and non-goals

Included:

- Verify that Meta accepts WATS request shapes for implemented surfaces.
- Verify response shapes against current WATS types and docs.
- Observe webhook/status side effects where applicable.
- Record redacted evidence and cleanup state.
- Update docs/tests only after secrets and PII are removed.

Not included by default:

- Admin mutations beyond explicitly authorized sandbox resources.
- Production WABA/phone/catalog/template/Flow changes.
- Phone registration/deregistration.
- Callback URL overrides.
- OAuth/token exchange.
- Public release/publish operations.
- Any operation not guarded by `WATS_LIVE_ENABLE=1` and, for mutations, a domain-specific opt-in flag.

## Credential inventory

Baseline environment placeholders:

```text
WATS_LIVE_ENABLE=1
WATS_GRAPH_BASE_URL=https://graph.facebook.com
WATS_GRAPH_API_VERSION=v25.0
WATS_ACCESS_TOKEN=<redacted>
WATS_WABA_ID=<redacted>
WATS_PHONE_NUMBER_ID=<redacted>
WATS_TEST_RECIPIENT_E164=<redacted>
WATS_TEST_RECIPIENT_WA_ID=<redacted-if-used>
WATS_TEST_RUN_ID=<generated-per-run>
WATS_TEST_RESOURCE_PREFIX=wats-live-<run-id>
```

Webhook placeholders:

```text
WATS_APP_SECRET=<redacted>
WATS_VERIFY_TOKEN=<redacted>
WATS_PUBLIC_WEBHOOK_URL=<redacted-or-test-url>
WATS_WEBHOOK_PATH=/webhook
```

Media placeholders:

```text
WATS_MEDIA_FIXTURE_IMAGE_PATH=/path/to/small-test-image.jpg
WATS_MEDIA_FIXTURE_DOCUMENT_PATH=/path/to/small-test-document.pdf
WATS_MEDIA_FIXTURE_MIME_TYPE=image/jpeg
WATS_MAX_UPLOAD_BYTES=5242880
WATS_MAX_DOWNLOAD_BYTES=5242880
```

Template placeholders:

```text
WATS_EXISTING_APPROVED_TEMPLATE_NAME=<redacted-or-test-name>
WATS_EXISTING_APPROVED_TEMPLATE_LANGUAGE=en_US
WATS_TEMPLATE_NAME_PREFIX=wats_live_<run_id>
WATS_ENABLE_TEMPLATE_MUTATIONS=1
```

Flow placeholders:

```text
WATS_FLOW_NAME_PREFIX=wats-live-<run-id>
WATS_FLOW_ENDPOINT_URI=<test-endpoint-only>
WATS_ENABLE_FLOW_MUTATIONS=1
WATS_ENABLE_FLOW_PUBLISH=1
```

Calling placeholders:

```text
WATS_CALL_TEST_RECIPIENT_E164=<redacted>
WATS_ENABLE_CALLING_LIVE=1
WATS_ENABLE_CALL_ACCEPT_WEBRTC=1
```

Commerce placeholders:

```text
WATS_CATALOG_ID=<redacted>
WATS_PRODUCT_RETAILER_ID=<redacted>
WATS_ENABLE_COMMERCE_MESSAGES=1
```

Deferred admin mutation placeholders, for a separate issue/campaign only:

```text
WATS_APP_ID=<redacted>
WATS_APP_ACCESS_TOKEN=<redacted>
WATS_BUSINESS_ID=<redacted>
WATS_PHONE_NUMBER_PIN=<redacted>
WATS_PREVIOUS_CALLBACK_URL=<captured-before-change>
WATS_PREVIOUS_PUBLIC_KEY_ID=<captured-before-change>
WATS_ENABLE_ADMIN_MUTATIONS=1
WATS_ENABLE_DESTRUCTIVE=1
```

Rules:

- Secrets must remain environment variables or `@wats/config` env-secret refs.
- Do not paste raw secrets into docs, commits, memory, skills, Linear, or chat.
- `WATS_LIVE_ENABLE=1` is necessary but not sufficient for mutations; require domain flags such as `WATS_ENABLE_TEMPLATE_MUTATIONS=1`.

## Safe ordering

The campaign order is read-only before side-effecting before destructive.

### Phase 0 — authorization and dry run

- Confirm explicit user authorization for the exact assets and phases.
- Confirm WABA, phone number, recipient, catalog, template, and Flow assets are sandbox/test-safe.
- Generate `WATS_TEST_RUN_ID` and `WATS_TEST_RESOURCE_PREFIX`.
- Run local `bun test && bun run typecheck` first.
- Validate config without resolving or printing secret values.
- Confirm CI/default scripts do not run live tests.

### Phase 1 — read-only discovery

Run low-risk reads first:

- `getWabaInfo`
- `listSubscribedApps`
- `listPhoneNumbers`
- `getPhoneNumberInfo`
- `getPhoneNumberSettings({ includeSipCredentials: false })`
- `getBusinessProfile`
- `getCommerceSettings`
- `listMessageTemplates`
- `getMessageTemplate` for a known test template
- `listFlows`
- `getFlow` for a known test Flow
- `getFlowAssets`
- `downloadMedia` only for a known test media id
- `downloadMediaBytes` only with strict `maxBytes`
- `getUploadSession` only for known test sessions

### Phase 2 — webhook passive validation

- Start a local or service webhook behind an authorized public URL/tunnel.
- Validate GET challenge with `WATS_VERIFY_TOKEN`.
- Validate signed POST locally with `WATS_APP_SECRET` and synthetic payload.
- Trigger one inbound test message from the opt-in recipient.
- Confirm normalizer/router/listener behavior.
- Do not override callback URLs in this phase.

### Phase 3 — low-impact message sends

- Send text to the test recipient.
- Observe status webhook when possible.
- Use mark-as-read and typing indicators only on test messages.
- Exercise location, contacts, reaction/remove-reaction, buttons/list/CTA URL.
- Send an existing approved template.
- Send catalog/product messages only when test catalog placeholders are configured.

### Phase 4 — media lifecycle

- Upload a small fixture.
- Resolve media metadata.
- Download bytes with `maxBytes` and integrity checks.
- Send uploaded media by media id.
- Delete only media created by this run.
- Record cleanup status in the run manifest.

### Phase 5 — template mutations

Only if `WATS_ENABLE_TEMPLATE_MUTATIONS=1`:

- Create a uniquely prefixed template.
- List/get the created template.
- Update only fields that are safe under Meta review/status rules.
- Delete only templates created by this run.
- Never mutate production templates.

### Phase 6 — Flow draft management

Only if `WATS_ENABLE_FLOW_MUTATIONS=1`:

- Create a draft Flow with a unique prefix.
- Read/list/assets.
- Update metadata and JSON.
- Publish only if `WATS_ENABLE_FLOW_PUBLISH=1` and the user explicitly accepts state-transition risk.
- Delete only draft Flows created by this run.
- Treat deprecate as irreversible unless Meta guarantees otherwise.

### Phase 7 — Calling

Only if `WATS_ENABLE_CALLING_LIVE=1`:

- Confirm the business phone is calling-enabled.
- Confirm the test recipient is available.
- Prefer permission/readiness checks when implemented.
- Initiate a minimal test call.
- Reject or terminate quickly.
- Accept/pre-accept/WebRTC flows require `WATS_ENABLE_CALL_ACCEPT_WEBRTC=1` and separate confirmation.

### Phase 8 — deferred admin mutations

Separate future issue/campaign only:

- Callback URL overrides.
- Public key mutation.
- Business profile/settings/commerce updates.
- Phone registration/deregistration.
- Token flows.
- QR code CRUD.
- Block/unblock users.

### Phase 9 — cleanup and final verification

- Execute cleanup plan.
- Re-run read-only discovery for touched resource families.
- Produce sanitized final report.
- List any resources needing manual cleanup.

## Endpoint risk classification

### Read-only / discovery first

| Surface | Helpers |
| --- | --- |
| WATS-42A business/admin inventory | `getWabaInfo`, `listSubscribedApps`, `listPhoneNumbers`, `getPhoneNumberInfo`, `getPhoneNumberSettings`, `getBusinessProfile`, `getCommerceSettings` |
| Templates | `listMessageTemplates`, `getMessageTemplate` |
| Flows | `listFlows`, `getFlow`, `getFlowAssets` |
| Media metadata/download | `downloadMedia`, `downloadMediaBytes` with caps |
| Upload sessions | `getUploadSession` |
| Webhook challenge/local signature | GET verify, local signed POST validation |

Sensitive read note: `getPhoneNumberSettings({ includeSipCredentials: true })` may return SIP credentials. Do not run it until the campaign explicitly requires it, and never log the raw response.

### Side-effecting but controlled

| Surface | Helpers |
| --- | --- |
| WATS-38 messages | `sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendReaction`, `removeReaction`, `sendButtons`, `sendList`, `sendCtaUrl`, `sendProduct`, `sendProducts`, `sendCatalog`, `requestLocation`, `sendTemplate`, `markMessageAsRead`, `indicateTyping` |
| WATS-37 media | `uploadMedia`, `createUploadSession`, `uploadFileToSession` |
| WATS-39 templates | `createMessageTemplate`, `updateMessageTemplate` |
| WATS-40 Flows | `createFlow`, `updateFlowMetadata`, `updateFlowJson` |
| WATS-41 calling | `initiateCall`, `preAcceptCall`, `acceptCall`, `rejectCall`, `terminateCall` |

### Destructive / irreversible / cleanup-only

| Surface | Helpers |
| --- | --- |
| Media delete | `deleteMedia` |
| Template delete | `deleteMessageTemplate` |
| Flow delete/deprecate/publish | `deleteFlow`, `deprecateFlow`, `publishFlow` |
| Admin mutations | registration/deregistration, callback overrides, public key changes, profile/settings/commerce writes |

## Redaction rules

Always redact:

- `Authorization` headers and Bearer tokens.
- `WATS_ACCESS_TOKEN`, `WATS_APP_SECRET`, `WATS_VERIFY_TOKEN`, service bearer tokens, app access tokens.
- `x-hub-signature-256`.
- Webhook challenge values and verify tokens.
- Raw env var values.

Mask or hash:

- WABA ids, phone number ids, app ids, business ids.
- recipient phone numbers and `wa_id` values.
- message ids / `wamid` values.
- media ids and media URLs.
- upload session ids.
- template ids and names if production-linked.
- Flow ids.
- call ids.
- catalog/product ids.

Sensitive response fields:

- SIP credentials from phone-number settings.
- Business profile email/address/websites if production-linked.
- Signed/resolved media URLs; redact full URL or at least query strings.
- Webhook payload PII: contacts, profile names, message text, phone numbers.

Logging policy:

- Log method, endpoint group, status, and Graph code/subcode/classification.
- Do not log full URLs with query strings.
- Use stable salted hashes for correlation: `sha256(value + runSalt).slice(0, 12)`.
- Raw response capture requires a separate opt-in and must write outside the repository.

## Cleanup and rollback

Before any mutation, create a run manifest outside the repository, for example:

```text
/tmp/wats-live-${WATS_TEST_RUN_ID}.json
```

The manifest should record:

- resource type
- id/name
- creation timestamp
- endpoint used
- cleanup action
- cleanup status
- sanitized error summary, if cleanup failed

Cleanup order:

1. Terminate or reject active test calls.
2. Delete media uploaded by this run.
3. Delete templates created by this run where Meta allows.
4. Delete draft Flows created by this run.
5. Restore callback URLs/settings/profile/commerce/public key material if they were changed.
6. Stop webhook tunnel/public endpoint.
7. Re-run read-only inventory checks.
8. Rotate/revoke live test token if campaign policy requires it.
9. Produce sanitized report.

Rollback limitations:

- Sent messages, read receipts, typing indicators, and calls cannot be unsent.
- Published/deprecated Flows may not be reversible.
- Template review/status changes may persist.
- Use only test recipients and uniquely prefixed resources.

## Abort criteria

Abort immediately if:

- The WABA, phone number, app, or recipient is not the intended test asset.
- Any request would target a non-test recipient.
- Token scope is wrong or unexpectedly broad.
- Meta returns rate-limit, account-warning, integrity, or policy errors beyond the expected test condition.
- Cleanup fails for a created resource.
- A raw secret or PII value appears in logs.
- A side-effecting phase is reached without its domain-specific opt-in flag.

## Docs and test locks

Current WATS-44 docs are locked by `packages/testing/tests/wats44-pywa-migration-docs.test.ts`.

Future live harnesses must:

- stay outside normal `bun test` unless `WATS_LIVE_ENABLE=1` is set;
- require domain mutation flags for side-effecting tests;
- require `WATS_TEST_RUN_ID` and `WATS_TEST_RESOURCE_PREFIX`;
- default to dry-run/MockTransport if flags are absent;
- write manifests outside the repository;
- redact before printing any request, response, or error;
- keep GitHub Actions and default package scripts credential-free.
