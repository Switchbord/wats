# Changelog

## [0.3.18] - 2026-06-02

### Added

- **Groups service routes + OpenAPI (WATS-137).** `@wats/service` gains an explicit `enableGroupRoutes` opt-in (default `false`, so non-group deployments keep the pre-Groups route set). When enabled it exposes bearer-protected `GET|POST /groups`, `GET|POST|DELETE /groups/{groupId}`, invite-link, participants, and join-request routes under `profile.service.apiPrefix`, and accepts Groups text and pin/unpin composer bodies on `POST /messages`. The generated OpenAPI document only includes group paths/schemas when `enableGroupRoutes` is set; the default document is unchanged. The WATS-130 sanitized Graph error envelope is preserved and the service bearer token is never forwarded to Graph.

### Release

- Release metadata is aligned for 0.3.18: all publishable `@wats/*` packages, the service OpenAPI default version, README, and release-contract locks move together.

## [0.3.17] - 2026-06-02

### Added

- **Groups filters + facade ergonomics (WATS-136).** `@wats/core` adds `filtersTyped.group` with `participantsUpdate()`, `lifecycleUpdate()`, `settingsUpdate()`, `statusUpdate()`, and `fromGroup(groupId)` composition over the WATS-135 normalized group updates. The `WhatsApp` facade gains `createGroup`, `sendGroupMessage`, `group(groupId)`, and `listen({ groupId })` ergonomics over the existing typed router/listener substrate.

### Changed

- Groups public responses now stay camelCase (`requestId`, `inviteLink`, `joinApprovalMode`, `creationTimestamp`, `totalParticipantCount`, `joinRequestId`, `waId`); snake_case remains only at the Graph wire boundary. The `@wats/graph/endpoints/groups` subpath is unchanged for consumers (internally reorganized into `callables`/`responses`/`types` modules).

### Release

- Release metadata is aligned for 0.3.17: all publishable `@wats/*` packages, the service OpenAPI default version, README, and release-contract locks move together.

## [0.3.16] - 2026-06-02

### Added

- **Groups webhook normalization (WATS-135).** `@wats/core` `normalizeWebhookEnvelope` now emits typed group updates for `group_lifecycle_update`, `group_participants_update`, `group_settings_update`, and `group_status_update`, mapping Meta snake_case fields to camelCase public shapes and preserving `rawChange`. Inbound group `messages` surface `message.groupId`; group status webhooks preserve `recipientType: "group"` and `recipientParticipantId` (including group pricing categories such as `group_service`). Unknown future group fields still become `TypedUnknownUpdate`, and malformed group payloads with unsafe or missing `group_id` / `phone_number_id` are reported in `skipped[]` instead of throwing.

### Release

- Release metadata is aligned for 0.3.16: all publishable `@wats/*` packages, the service OpenAPI default version, README, and release-contract locks move together.

## [0.3.15] - 2026-06-02

### Added

- **Groups send-to-group + pin/unpin (WATS-134).** Message builders and `sendMessage` now accept `recipientType: "group"`, emitting Graph `recipient_type: "group"` with an opaque group id in `to` for text, media, and standard template sends. Adds `buildSendPinPayload({ to, pinType, messageId, expirationDays })` for group pin/unpin (`type: "pin"`, `expiration_days` 1..30). Group-context interactive, commerce, marketing/auth templates (including missing/auth `templateCategory`), and phone-number-shaped group recipients are rejected before transport; calling, edit, delete, disappearing, and view-once remain unsupported for Groups.

### Release

- Release metadata is aligned for 0.3.15: all publishable `@wats/*` packages, the service OpenAPI default version, README, and release-contract locks move together.

## [0.3.14] - 2026-06-02

### Added

- **Groups scoped clients (WATS-133).** `@wats/graph` now ships a scoped `GroupClient` exposing `getInfo`, `update`, `delete`, `getInviteLink`, `resetInviteLink`, `removeParticipants`, `getJoinRequests`, `approveJoinRequests`, and `rejectJoinRequests`, plus `PhoneNumberClient.createGroup`, `PhoneNumberClient.listGroups`, and a `PhoneNumberClient.group(groupId)` factory. These delegate to the WATS-132 `@wats/graph/endpoints/groups` endpoint family with no new wire surface.

### Release

- Release metadata is aligned for 0.3.14: all publishable `@wats/*` packages, the service OpenAPI default version, README, and release-contract locks move together.

## [0.3.13] - 2026-06-01

Patch alpha compatibility and local-operator release. Begins the WhatsApp Groups API — a WATS framework addition with no pywa equivalent — as composable, opt-in surfaces.

### WATS-131 — Groups type foundation

- Adds the `@wats/types/groups` subpath: group entity types (`WatsGroup`, `GroupParticipant`, `GroupJoinRequest`, `GroupInviteLink`), `GroupJoinApprovalMode`/`GroupRecipientType` unions, and the four group webhook field-value types (`group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update`), with the `WATS_TYPES_GROUPS_EXPORTS` documentation manifest. camelCase over Meta's snake_case wire; no runtime behavior beyond the manifest.

### WATS-132 — Groups Graph endpoint family

- Adds the `@wats/graph/endpoints/groups` subpath with `defineEndpoint` callables: `createGroup` and `listGroups` (`POST`/`GET /<phoneNumberId>/groups`), `getGroup`/`updateGroup`/`deleteGroup` (`GET`/`POST`/`DELETE /<groupId>`), `getGroupInviteLink`/`resetGroupInviteLink` (`GET`/`POST /<groupId>/invite_link`), `removeGroupParticipants` (`DELETE /<groupId>/participants`), and `listGroupJoinRequests`/`approveGroupJoinRequests`/`rejectGroupJoinRequests` (`GET`/`POST`/`DELETE /<groupId>/join_requests`).
- camelCase public input mapped to the snake_case Graph wire only at the transport boundary; enforces Groups limits (subject ≤128, description ≤2048, ≤8 participants) and the shared path-segment / prototype-poison guards. Group mutations are asynchronous: callables return the `request_id` correlator and the terminal outcome arrives via the matching `group_*_update` webhook.
- Exported at the root barrel and tracked by `bun run api:check`.

### WATS-133 — Groups scoped clients

- Adds `PhoneNumberClient.createGroup(...)`, `PhoneNumberClient.listGroups(...)`, and `PhoneNumberClient.group(groupId)` over the WATS-132 Groups endpoint family. The phone-number client binds the constructor `phoneNumberId`; caller params cannot override that scope.
- Adds `GroupClient` with construction-time `groupId` validation and scoped methods for `getInfo`, `update`, `delete`, `getInviteLink`, `resetInviteLink`, `removeParticipants`, `getJoinRequests`, `approveJoinRequests`, and `rejectJoinRequests`. Each method injects the bound group id and preserves the WATS-132 wire methods and snake_case bodies.

### Release metadata

- Release metadata is aligned for 0.3.13 across the root manifest and the publishable `@wats/*` packages, preserving the canonical `@wats/*` package scope and credential-gated live `wats serve` flow.

## [0.3.12] - 2026-06-01

Patch alpha compatibility and local-operator release. Adds an opt-in native PaaS serve mode so `wats serve` works on managed platforms without an external container entrypoint shim.

### WATS-129 — native PaaS serve mode (`--paas`)

- Adds an opt-in `wats serve --paas` flag. In PaaS mode the CLI reads the platform-injected `$PORT` and binds `0.0.0.0` by default, so managed platforms (Railway, Fly, Render, Cloud Run) no longer need an external entrypoint shim to map `$PORT`/`0.0.0.0` onto the static `--host`/`--port` flags.
- Explicit `--host` and `--port` always override the PaaS defaults. Serve fails closed when `--paas` needs `$PORT` but it is missing or not a canonical integer in `1..65535` (leading zeros and non-numeric forms are rejected).
- `$PORT` is consulted only when `--paas` is passed, so default and local behavior is byte-identical for forks that do not deploy to a PaaS. `--print-routes` under `--paas` validates and prints the route inventory without binding and never requires `$PORT`.
- `--paas` composes with both dry-run and live serve; it changes only the bind host/port and never the resolved secrets, webhook, or auth configuration. Serve output stays status-only with no secret, env-name, profile-name, or config-path leakage.

### Release metadata

- Release metadata is aligned for 0.3.12 across the root manifest and the publishable `@wats/*` packages, preserving the canonical `@wats/*` package scope and credential-gated live `wats serve` flow.

## [0.3.11] - 2026-05-30

Patch alpha compatibility and local-operator release. Surfaces PII-safe Meta Graph error diagnostics from service send routes.

### Service Graph error diagnostics

- `POST /api/messages/text` and `POST /api/messages` 502 responses now preserve the stable `graph_request_failed` code while adding sanitized Meta details when available: `metaCode`, `metaSubcode`, `metaType`, and `fbtraceId`.
- The service deliberately omits Meta's free-form `error.message` because it may quote request/account identifiers; no access token, service bearer, app secret, verify token, authorization header, or request body is returned.
- The OpenAPI `ErrorEnvelope` and service reference now document the optional diagnostic fields.

### Release metadata

- Release metadata is aligned for 0.3.11 across the root manifest and the publishable `@wats/*` packages, preserving the canonical `@wats/*` package scope and credential-gated live `wats serve` flow.

## [0.3.10] - 2026-05-30

Patch alpha compatibility and local-operator release. Adds opt-in ky-like Graph transport reliability without introducing a dependency.

### Opt-in reliable transport

- Adds `createReliableTransport(inner, options?)` to `@wats/graph`: a composable `Transport` decorator for retries, bounded exponential full-jitter backoff, `Retry-After` handling, and per-attempt timeouts.
- Reliability is explicit and default-off. `GraphClient` still uses the bare fetch transport unless callers pass the decorator. No `ky` or other dependency is added.
- The decorator retries transient `GET`/`DELETE` failures plus HTTP `429` rate limits across methods, preserves final errors/responses, composes native `AbortSignal.timeout` / `AbortSignal.any`, cancels discarded retry response bodies, and avoids ambiguous non-idempotent POST `5xx`/network retries by default.

### Docs and release metadata

- Documents the reliability recipe in the Transport and Testing guide, client reference, migration guide, and parity matrix.
- Release metadata is aligned for 0.3.10 across the root manifest and the publishable `@wats/*` packages, preserving the canonical `@wats/*` package scope and credential-gated live `wats serve` flow.

## [0.3.9] - 2026-05-30

Patch alpha compatibility and local-operator release. Makes the opt-in demo auto-reply observable.

### Observable echo auto-reply

- The `WATS_ECHO_REPLY` demo responder now logs a PII-safe outcome for each attempt: `wats.echo.reply` with `outcome: "sent"` (and whether a Meta message id was returned), or `outcome: "failed"` with the mapped Meta error code/subcode and error name. No message text, sender id, or secrets are logged. This makes a reply blocked by WhatsApp's 24-hour customer-service window observable instead of silently swallowed; send failures still never affect webhook acknowledgement.

### Release metadata

- Release metadata is aligned for 0.3.9 across the root manifest and the publishable `@wats/*` packages, preserving the canonical `@wats/*` package scope, the credential-gated live `wats serve` flow, and the WATS-126 CLI version/upgrade UX.

## [0.3.8] - 2026-05-29

Patch alpha compatibility and local-operator release. Enriches inbound-webhook observability and adds an opt-in demo auto-reply, validated against live Meta infrastructure (operator-authorized disposable test asset).

### Enriched webhook observability

- `WATS_LOG_WEBHOOK_EVENTS=1` now logs a PII-safe `detail` alongside each dispatched update: the normalized message type (`text`, `image`, `interactive`, `reaction`, ...) for `message` updates, or the status value (`sent`/`delivered`/`read`/...) for `status` updates. No message text or sender id is logged.

### Opt-in demo auto-reply

- Adds `WATS_ECHO_REPLY=1` to `@wats/service`: the service-built facade replies to inbound text messages with a fixed acknowledgement, exercising the dispatch-to-send round-trip in a single process. Auto-reply failures never affect webhook acknowledgement. Isolated and fork-strippable; unset (default) registers no responder.

### Live validation

- Live-validated on the container deployment: outbound text/template/interactive sends, the full `sent`/`delivered`/`read` status lifecycle, inbound `text` and `interactive` (button-tap) messages, all verified, normalized, and dispatched end to end. See `docs/parity/live-testing-campaign.md` Execution log.
- No automatic live Meta validation campaign execution, token validation against Meta, credential collection, or production publication is performed by default; live runs require explicit operator authorization and gated flags.

### Release metadata

- Release metadata is aligned for 0.3.8 across the root manifest and the publishable `@wats/*` packages, preserving the canonical `@wats/*` package scope, the credential-gated live `wats serve` flow, and the WATS-126 CLI version/upgrade UX.

## [0.3.7] - 2026-05-29

Patch alpha compatibility and local-operator release for WATS. This release adds a container deployment recipe and opt-in inbound-webhook observability, validated against live Meta infrastructure with an operator-authorized disposable test asset.

### Container deployment (Railway)

- Adds `Dockerfile`, `railway.json`, and `deploy/railway/` (Bun multi-stage image, `$PORT`/`0.0.0.0` entrypoint shim, healthcheck config-as-code, deploy README). Railway auto-detects the Dockerfile and provides the public HTTPS callback URL Meta requires.
- The entrypoint maps the platform environment onto explicit `wats serve` flags and materializes the live env-file/config at startup from service variables; secrets are never baked into image layers.
- Published Docker registry images, background outbox workers, and production hosting remain out of scope.

### Opt-in inbound webhook observability

- Adds `WATS_LOG_WEBHOOK_EVENTS=1` to `@wats/service`: logs a compact, redaction-safe summary (`kind`, `updateId`, `wabaId`, `phoneNumberId`, timestamp) of each dispatched webhook update to stdout. No message text or recipient PII is logged.
- Isolated and fork-strippable: unset (default) registers no handler and leaves behavior unchanged. Only attached to a service-built facade.

### Live validation execution log

- Records an operator-authorized live run (see `docs/parity/live-testing-campaign.md` Execution log): outbound text and approved-template sends returned real Meta message ids, and Meta-delivered `status` webhooks were verified and dispatched end to end.
- No automatic live Meta validation campaign execution, token validation against Meta, credential collection, or production publication is performed by default; live runs require explicit operator authorization and gated flags.

### Release metadata

- Release metadata is aligned for 0.3.7 across the root manifest and the publishable `@wats/*` packages, preserving the canonical `@wats/*` package scope, the credential-gated live `wats serve` flow, and the WATS-126 CLI version/upgrade UX.

## [0.3.6] - 2026-05-25

Patch alpha persistence and local-operator release for WATS. This release publishes the post-0.3.5 SQLite persistence foundation, service idempotency integration, and CLI package version/upgrade UX.

### WATS-126 — CLI version and package upgrades

- Adds `wats --version` for the installed `@wats/cli` package version.
- Adds `wats upgrade` plus `wats update` alias to run Bun updates for the public WATS package set: `@wats/cli`, `@wats/core`, `@wats/graph`, `@wats/http`, `@wats/config`, and `@wats/service`.
- Extends `wats doctor` with an offline package-version check that reads `package.json` only and warns when listed WATS dependencies appear older than the installed CLI.
- Keeps upgrade/version diagnostics credential-free: no `.env.local` reads, no Meta Graph calls, and no token/app-secret output.

### WATS-120/WATS-121 — SQLite persistence and service idempotency foundation

- Adds experimental `@wats/persistence` root contracts and a SQLite adapter subpath for local/single-instance runtime state.
- Adds a forward-only SQLite migration runner with schema metadata, checksum verification, a migration lock table, webhook-event/request-idempotency/outbox tables, and redacted health diagnostics.
- Adds optional `PersistenceStore` injection to `@wats/service`; the service does not read database env vars directly.
- Uses persistence to acknowledge duplicate signed webhook deliveries without redispatch and to support `Idempotency-Key` replay/conflict behavior on service message send routes.
- Keeps conversation APIs, CLI thread navigation, observed status UI wiring, Postgres, raw webhook body storage, background outbox workers, production hosting, and live Meta validation out of scope.

### Release metadata and safety boundaries

- Release metadata is aligned for 0.3.6 across root/package manifests, public internal dependency ranges, service OpenAPI default version, generated OpenAPI docs, and release-policy tests.
- This is an alpha compatibility/local-operator patch release, not a 1.0 stability claim.
- No automatic live Meta validation campaign execution, token validation against Meta, credential collection, Docker image publication, production hosting, or background outbox worker is included in the release gates.

## [0.3.5] - 2026-05-25

Patch alpha live-testing/onboarding release for WATS. This release batches post-0.3.3 CLI setup hardening, scoped Bun command docs, public docs trust/onboarding updates, package README/API policy docs, the minimal offline bot onramp, release-governance maintainer docs, and credential-gated local live serve.

### WATS-101 — live serve and tunnel quickstart

- Adds credential-gated live `wats serve` for local live testing with explicit `--live --yes-live --env-file .env.local` guardrails.
- Resolves config env-secret refs only from the explicit env file plus process environment; `.env.local` is not read implicitly and serve output stays status-only.
- Updates quick-start docs to recommend ngrok or equivalent HTTPS tunnel because Meta requires a public secure HTTPS webhook callback for local testing.
- No Docker image publication, background outbox worker, or production-hosting guarantee is included.

### CLI setup and public-onboarding docs hardening

- Keeps `wats setup` interactive prompts on one TTY readline session so hidden token/app-secret prompts remain masked while later prompts keep consuming terminal input in order.
- Adds explicit `Input hidden` hints to access-token/app-secret prompts and optional verify/service-token prompts so operators know pasted secret values intentionally do not echo and optional local tokens can be generated by pressing Enter.
- Adds a non-TTY buffered prompt path so scripted/piped `wats setup` runs consume all answers in order and exit without waiting for stdin producers that stay open after enough answers.
- Adds dist-level setup regressions for closed piped stdin, open stdin after setup answers, and no-prompt `--help` commands with open stdin; no Meta calls or credential validation are added.
- Fixes WATS-118 CLI guide drift by listing the implemented `wats onboarding` command and removing the unimplemented `wats init --yes` command from executable first-run examples.
- Documents the WATS-119 private `@wats/testing` version policy in the release policy and package README.
- Adds the WATS-111 privacy and telemetry stance: WATS sends no maintainer-owned telemetry by default, the CLI does not phone home, and future telemetry would be opt-in and documented.
- Expands WATS-114 per-package README coverage so every publishable `@wats/*` package has install commands, a usage example, docs link, and MIT license line for npm rendering.
- Adds the WATS-115 API stability policy, marking stable-for-0.x, experimental, and internal surfaces; Flow and Calling endpoint barrels now carry `@experimental` JSDoc markers checked by `bun run api:check`.
- Adds the WATS-113 60-second offline getting-started onramp with a runnable `examples/minimal-bot` package, CI smoke wiring, and credential-free MockTransport/service demo output.
- Adds WATS-109 repo settings hygiene docs plus Dependabot/CodeQL configuration for release-governance readiness.
- Adds WATS-117 launch-day checklist and announce draft as maintainer docs; this is docs-only work and does not claim that provenance, npm publish, or GitHub Release side effects have already happened.

## [0.3.3] - 2026-05-24

Patch alpha compatibility and community-governance release for WATS. This release keeps the 0.3.2 package-manager fix line, adds the post-0.3.2 credential-free WhatsApp/Graph compatibility deltas, and publishes the WATS-108 public community governance files.

### WATS-108 — community governance files


- Adds a Contributor Covenant 2.1 `CODE_OF_CONDUCT.md`, GitHub issue forms with public-secret safety prompts, a blank-issue-off config, and a pull request template that asks for issue tracking, docs-in-lockstep verification, non-goals, and credential/no-live-call boundaries.
- The GitHub issue templates use the canonical `@wats/*` package scope and avoid stale `@switchbord/*` package names.
- No package code, live Meta calls, credential validation, CI workflow side effects, npm publish, GitHub release, or git tag are included by the WATS-108 governance-file slice itself.

### WATS-68 — messages endpoint module split

- Moves the broad messages endpoint composer internals into focused `packages/graph/src/endpoints/messages/` modules while preserving root `@wats/graph`, `@wats/graph/endpoints/messages`, `GraphMessagesEndpoint`, `sendMessage`, and Marketing Messages helper exports.
- This messages endpoint module split is an internal maintainability change with no payload behavior changes, no new live Meta calls, no package publication, no tag, and no release side effects.

### WATS-98 — Marketing Messages API compatibility surfaces

- Adds credential-free `sendMarketingTemplate` / `buildSendMarketingTemplatePayload` helpers for `POST /{phoneNumberId}/marketing_messages`, including `product_policy`, `message_activity_sharing`, BSUID `recipient`, and `messages[].message_status` response typing (`accepted`, `held_for_quality_assessment`, `paused`).
- Normalizes current Marketing Messages status/onboarding values: `pricing.category = "marketing_lite"`, `conversation.origin.type = "marketing_lite"`, and `account.marketingMessages` for `MM_LITE_TERMS_SIGNED` / `marketing_messages_onboarding_status` / deprecated `marketing_messages_lite_api_status` fields.
- No live Meta calls, credential validation, Ads Manager dashboards, ACO claims, marketing automation, npm publish, tag, or GitHub release are included.

### WATS-95 — business-management Block API and alert deltas

- Adds credential-free MockTransport helpers for Meta `block_users`: `listBlockedUsers`, `blockUsers`, `unblockUsers`, and matching `PhoneNumberClient` methods.
- Adds OBA/display-name helpers: `getOfficialBusinessAccountStatus`, `requestOfficialBusinessAccountReview`, and `submitDisplayNameForReview`, mapping `official_business_account`, `new_display_name`, `business_website_url`, and `primary_country_of_operation` wire fields.
- Normalizes WATS-95 webhook deltas: `phone_number_quality_update` values including `THROUGHPUT_UPGRADE` / `TIER_UNLIMITED`, plus `account_alerts` `PROFILE_PICTURE_LOST`; no live Meta calls, credential validation, policy/appeal automation, or automatic user-block decisions are included.


### WATS-97 — webhook media ID retention docs

- Documents current behavior: webhook media IDs received via webhook are downloadable for 7 days after 2025-10-09.
- Cites the Linear WATS-97 source evidence from the WhatsApp changelog dated 2025-09-24, where Meta reduced the webhook media ID downloadability window from 30 days to 7 days.
- Recommends that applications promptly download webhook media and persist it in durable application-owned storage if they need media beyond the current retention window; no automatic media persistence, byte-limit changes, or live Meta calls are included.


### WATS-96 — Graph v25 metadata and webhook mTLS docs

- Documents that Meta Graph v25 deprecates `metadata=1` metadata/introspection usage and that WATS does not send `metadata=1`, append it to runtime Graph requests, or use it during docs/OpenAPI generation.
- Documents Meta webhook mTLS CA transition guidance for the Meta-owned root `meta-outbound-api-ca-2025-12.pem` while preserving the required app-level HMAC `X-Hub-Signature-256` verification boundary.
- Clarifies that infrastructure-level client certificate validation is operator-managed and optional: WATS does not vendor the Meta CA certificate, does not include PEM contents, and does not configure user infrastructure automatically.


### WATS-94 — template groups and analytics

- Adds Template Group endpoint callables and WABAClient helpers: `listTemplateGroups`, `createTemplateGroup`, `getTemplateGroup`, `updateTemplateGroup`, `deleteTemplateGroup`, and `getTemplateGroupAnalytics`.
- Maps Graph `template_groups` and `template_group_analytics` request shapes through MockTransport-tested direct callables and scoped WABA methods.
- Documents analytics as structural/pass-through only; WATS does not claim an analytics dashboard or undocumented metric schema.


### WATS-93 — auth-template nesting and local-storage settings

- Adds authentication-template OTP button support for nested `supported_apps` records from `supportedApps: [{ packageName, signatureHash }]`, emitting Graph `package_name` / `signature_hash`.
- Adds `updatePhoneNumberSettings(...)` and `PhoneNumberClient.updateSettings({ storageConfiguration })` for `POST /{phoneNumberId}/settings` with `storage_configuration`.
- Documents that WATS does not emit `data_localization_region` on registration helpers; local-storage configuration uses the settings endpoint instead.


### WATS-92 — WhatsApp and Marketing Messages error registry refresh

- Adds v21-v25 diagnostic code mappings for `131050`, `132018`, `131059`, `131064`, and Marketing Messages Lite `134100`, `134101`, `134102`, and `134103`.
- Adds `InvalidTemplateParameterError`, `TemplateClassificationRateLimitError`, and Marketing Messages Lite subclasses such as `MarketingMessagesLiteUnsupportedMessageTypeError`, `MarketingMessagesLiteUnsupportedTemplateCategoryError`, `MarketingMessagesLiteInvalidFlowError`, and `MarketingMessagesLiteUnsupportedTemplateStructureError`.
- Documents remediation guidance without suppressing Graph errors or adding broad automatic retry policy.


### WATS-91 — business messaging limits and template cursors

- Adds typed WABA/phone-number response fields for `whatsapp_business_manager_messaging_limit` and v24+ `messaging_limit_tier` portfolio semantics.
- Adds `before` cursor support to `listMessageTemplates(...)` and `WABAClient.listMessageTemplates(...)`, preserving existing `after` support.
- Adds `InvalidTemplateCursorError` for Graph code `131059` and documents the opt-in retry without before/after cursor pattern for `message_templates`.


### WATS-89 — v24/v25 webhook schema refresh

- Adds `played` to `WhatsAppMessageStatusKind` and `filtersTyped.status.played()` for voice playback receipts.
- Normalizes inbound webhook media `url` to public `media.url` and documents that status `conversation` is optional / absent by default in v24+.
- Preserves unsupported details for removed/unsupported message shapes such as `request_welcome` while keeping raw fallback.
- Promotes Coexistence account events including `PARTNER_REMOVED`, `account_offboarded`, `account_reconnected`, and `disconnectionInfo` in credential-free synthetic webhook coverage.

### WATS-90 — v24 message builders

- Adds `buildSendCallPermissionRequestPayload(...)` and `PhoneNumberClient.sendCallPermissionRequest(...)` for Graph `interactive.type = "call_permission_request"` / `action.name = "call_permission_request"` bodies.
- Adds audio voice-message designation via `buildSendAudioPayload({ to, mediaId, voice: true })` and `PhoneNumberClient.sendAudio({ ..., voice: true })`.
- Updates service `/messages` composer docs for `type: "callPermissionRequest"` and audio `voice: true`; all coverage is credential-free MockTransport only.

### CI maintenance

- Updates GitHub Actions checkout steps to `actions/checkout@v5` so the credential-free CI and release dry-run workflows are ready for GitHub's Node 24 action runtime.

## [0.3.2] - 2026-05-18

Patch alpha package release for WATS. This release keeps the 0.3.1 setup-wizard/tooling behavior and publishes corrected `@wats/*` npm packages with package-manager-safe ESM imports and CLI bin metadata.

### Package release correction

- Publishes the canonical npm scope as `@wats/*` for all nine public packages.
- Corrects built package artifacts so emitted ESM uses explicit `.js`/`index.js` relative specifiers that work from npm installs in Node and Bun.
- Corrects the `@wats/cli` bin metadata to `dist/bin.js`, preserving the executable `wats` command for package-manager installs.
- `0.3.1` should be treated as superseded on npm; use `0.3.2` or `latest`.


### CLI setup wizard

- `wats setup [dir] [--profile <name>]` remains the safe non-live credential setup wizard for one local profile.
- Release metadata is aligned for 0.3.2 across root/package manifests, public internal dependency ranges, service OpenAPI default version, and release-policy tests.

### Release and safety boundaries

- This is an alpha tooling/package correction release, not a 1.0 stability claim.
- No live Meta calls, token validation against Meta, multi-profile credential editor, live-capable `wats serve`, `--env-file` live secret resolution, Docker image publication, persistence/outbox, or live Meta validation campaign execution are included.

## [0.3.1] - 2026-05-16

Patch alpha tooling release for WATS. This release added WATS-104's safe single-profile credential setup wizard on top of the 0.3.0 operator tooling line. The npm `@wats/*@0.3.1` artifacts were superseded by `0.3.2` before GitHub Release because the corrected package-manager install line is `0.3.2`.

## [0.3.0] - 2026-05-15

Alpha tooling release for WATS. This release prepares the next public package line after 0.2.1 and collects the post-0.2.1 CLI, service, Graph-internal, docs, and release-metadata work into a truthful 0.3.0 train.

### Install

```bash
bun add @wats/cli
bunx --bun @wats/cli --help

bun add @wats/core @wats/graph @wats/http
bun add @wats/config @wats/service
```

The packages are standard npm registry packages, so Bun installs them with `bun add ...`. Release checks remain credential-free and verify package build, pack, publish dry-run, release dry-run, docs, and policy tests before any side-effecting publish/tag/release step is allowed.

### CLI diagnostics and dry-run service

- `wats setup [dir] [--profile <name>]` runs a safe credential setup wizard for one local profile, writing `wats.config.yaml` with env-secret references plus an ignored `.env.local` for local values, while refusing overwrites and making no Meta calls.
- `wats onboarding --public-url <https URL>` prints an operator-facing Meta webhook setup checklist with a safe callback URL, locally generated verify/service tokens, and a clear list of user-side Meta values to store outside git.
- `wats doctor --config <path>` runs offline diagnostics for runtime/package imports, config/profile checks, service route collisions, OpenAPI generation, and optional env presence counts without printing env names or values.
- `wats serve --config <path> --dry-run` starts the standalone `@wats/service` app through a local Bun process wrapper with synthetic in-memory secrets, a no-network Graph transport, health/readiness/OpenAPI routes, `--print-routes`, and graceful shutdown.
- The exported `runCli` helper remains embeddable: process signal handling and `process.exit` stay isolated to the executable bin wrapper, with regression coverage in both direct tests and the external `@wats/cli` consumer fixture.
- `wats serve` recognizes the WATS-72 live-intent/acknowledgement guard (`--live` + `--yes-live`, or paired `WATS_LIVE_ENABLE=1` / `WATS_YES_LIVE=1`) but still fails closed before secret resolution, env-file parsing, service bind, or Meta Graph calls.

### Service message routes

- `@wats/service` `POST {apiPrefix}/messages` accepts WATS media composer bodies for image, video, audio, document, sticker, location, contacts, reaction, remove-reaction, and interactive button/list/CTA URL/product/product-list/catalog/location-request messages.
- The service converts supported message bodies through the existing SDK builders, preserves generic text body compatibility, and keeps remaining non-message route expansion as later issues.
- The service OpenAPI default and generated docs now align with the 0.3.0 release version while continuing to describe WATS service routes only, not the full Meta Graph API.

### Graph endpoint internals

- WATS-65 moves the message-template endpoint family into `packages/graph/src/endpoints/templates/` modules while preserving root `@wats/graph`, `@wats/graph/endpoints/templates`, and `WABAClient` behavior.
- WATS-66 moves the Flow endpoint family into `packages/graph/src/endpoints/flows/` modules while preserving root `@wats/graph`, `@wats/graph/endpoints/flows`, and `WABAClient` behavior.
- WATS-67 moves WABA phone-number listing into `packages/graph/src/endpoints/waba/` modules while preserving root `@wats/graph`, `wabaEndpoints.ts`, and `WABAClient.listPhoneNumbers` behavior.
- These are internal endpoint-family splits only: no new live Meta behavior, no new WABA/admin mutations, and no package export breakage.

### Docs and release hygiene

- Public docs now separate the implemented dry-run/local operator tooling from live/production operator modes that remain future work.
- Release metadata is aligned for 0.3.0 across root/package manifests and release dry-run scripts derive the release version from the root manifest instead of stale hard-coded 0.2.1 constants.
- `bun run check-publish` includes the 0.3.0 release contract test in addition to existing WATS-31/WATS-83/WATS-85/0.2.1 historical release checks.
- Credential-free dry-runs still perform no package publication and No GitHub release/tag creation.

### Release and safety boundaries

- This is an alpha tooling release, not a 1.0 stability claim.
- test account credentials are not required for this release, default install, local tests, CI, docs generation, package build, or package-manager smoke checks.
- No live Meta calls are part of the release checks.
- No WhatsApp access tokens, app secrets, WABA IDs, phone-number IDs, or webhook payloads are committed.
- Live Meta validation remains gated behind WATS-80/WATS-81 and explicit credentials.
- No live Meta validation campaign execution yet.
- No live-capable `wats serve` startup or `--env-file` secret resolution yet; WATS-72 currently provides guard recognition only.
- No Docker image publication.
- No persistence, idempotency, or outbox runtime yet.

### Verification gates

- `bun run typecheck`
- `bun run build:packages`
- `bun run pack:smoke`
- `bun run publish:dry-run` (`npm publish --dry-run` equivalent checks only; no package publication)
- `bun run release:dry-run`
- `bun run docs:check`
- `bun run docs:build`
- targeted release policy tests including `packages/testing/tests/wats030-release-contract.test.ts`

## [0.2.1] - 2026-05-04

Alpha launch release for WATS. This was the first release line intended for public repository visibility and package-manager installation from the Bun/npm ecosystem.

### Install

```bash
bun add @wats/cli
bunx --bun @wats/cli --help

bun add @wats/core @wats/graph @wats/http
bun add @wats/config @wats/service
```

The packages are standard npm registry packages, so Bun can install them with `bun add ...` after publication. The release pipeline also verifies `npm pack --dry-run` package contents and Bun runtime import smoke tests before any publish command is allowed.

### Highlights

- Ships the WATS TypeScript/Bun foundations: Graph client, endpoint definitions, error taxonomy, pagination, media runtime, template/Flow/calling helpers, read-only business-management inventory, webhook verification/adapters, typed update normalization, filters, router, listeners, and the `WhatsApp` facade.
- Adds safe app-layer onboarding packages: `@wats/config`, `@wats/cli`, and `@wats/service`.
- Implements `wats init [dir] --dry-run --format yaml|json --profile <name>` for credential-safe config/env placeholder generation, plus `wats onboarding --public-url <https URL>` to print the webhook callback address, locally generated verify/service tokens, and the Meta-side credentials the user must provide.
- Adds public release hygiene from WATS-31, WATS-36A, WATS-83, WATS-84, and WATS-85: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, public docs site checks, builds and verifies `dist` package artifacts during release checks, packed-output smoke tests, internal support package guards, private package guards, credential-free release dry-run workflow, and credential-free provenance preflight.
- Prepares the publication-ready package set at version `0.2.1`: `@wats/types`, `@wats/crypto`, `@wats/graph`, `@wats/core`, `@wats/http`, `@wats/internal-utils`, `@wats/config`, `@wats/service`, and `@wats/cli`.

### Included historical milestone coverage

This alpha launch consolidates the implemented WATS/F milestone surface into the 0.2.1 train. Representative surfaces include WATS-51 config/env templates at `examples/config/wats.config.example.yaml`, `examples/config/wats.config.example.json`, and `.env.example`; WATS-53 graph endpoint subpaths `@wats/graph/endpoints/messages`, `@wats/graph/endpoints/media`, `@wats/graph/endpoints/templates`, `@wats/graph/endpoints/flows`, `@wats/graph/endpoints/calling`, and `@wats/graph/endpoints/business-management`; WATS-55 reference status metadata; public policy files; scoped clients; typed updates; filters; router/facade; listeners; webhook adapters; pagination; and media runtime helpers.

Historical foundations covered by this launch include [0.2.0-f7] `PhoneNumberClient` / `WABAClient`, [0.2.0-f8] `normalizeWebhookEnvelope`, [0.2.0-f9] `TypedFilter`, `createTypedFilter`, `FilterValidationError`, and `@wats/core/filtersTyped`, [0.2.0-f10] `TypedRouter`, `WhatsApp`, `DispatchReport`, `RegistrationHandle`, and observer seams, [0.2.0-f11] `ListenerRegistry`, `ListenerHandle`, `ListenerTimeoutError`, `ListenerAbortError`, first-match-wins listener behavior, `onListenerMatch`, timeout handling, and `AbortSignal` support, [0.2.0-f12] `createWebhookAdapter`, `createFetchWebhookHandler`, `createBunWebhookServer`, and `createNodeWebhookHandler`, edge-runtime adapters, and [0.2.0-f13] `paginate`, `PaginationError`, `maxPages`, and WATS-37 media runtime helpers including `MediaValidationError`, `MediaCryptoError`, `MediaIntegrityError`, `uploadMedia`, `downloadMediaBytes`, `decryptEncryptedMedia`, and `createUploadSession`.

### WATS-55 — Reference status taxonomy refresh

WATS-55 separate credential-free implementation status from live validation status. Boundary: docs-lock/status metadata only; no runtime Graph behavior, no live Meta calls, and no package export changes.

Boundaries preserved in this launch: no persistence package export, no persistence adapters, no config schema changes for persistence, no root Dockerfile/Compose, no live Meta calls, no package publication during dry-runs, and no new public package exports beyond the documented package set.

### Release and safety boundaries

- This is an alpha launch release, not a 1.0 stability claim.
- test account credentials are not required for this release, default install, local tests, CI, docs generation, package build, or package-manager smoke checks.
- No live Meta calls are part of the release checks.
- No WhatsApp access tokens, app secrets, WABA IDs, phone-number IDs, or webhook payloads are committed.
- Live Meta validation remains gated behind future WATS-80/WATS-81 work and explicit credentials.
- No package publication occurs during release dry-runs. No package publication is performed by these checks.

### Verification gates

- `bun run typecheck`
- `bun run build:packages`
- `bun run pack:smoke`
- `bun run publish:dry-run` (`npm publish --dry-run` equivalent checks only; no package publication)
- `bun run release:dry-run`
- `bun run docs:check`
- `bun run docs:build`
- targeted release policy tests including `packages/testing/tests/wats021-alpha-release.test.ts`
