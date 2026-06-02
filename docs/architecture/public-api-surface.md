# WATS Public API Surface

- status: active
- applies-to: `0.2.0-foundations-complete` + WATS-31/32/33/34/35/WATS-37/38/39/40/41/42A/44/53/54/55 development line
- lastReviewed: 2026-05-02

## Purpose

Compact ledger of public surfaces that exist today. It separates shipped APIs from planned parity work so docs do not overstate WhatsApp Business Platform coverage.

For full signatures and behavior, use `docs/reference/index.md`.

Credential-free implementation status is separate from live Meta validation status. MockTransport, local crypto, synthetic webhook, docs-lock, consumer-fixture, `docs:check`, and `api:check` evidence can prove a WATS API shape is implemented without proving Meta accepted that behavior in a live account. Live validation belongs to the WATS-44 live-testing campaign and remains explicitly credential-gated; the default repository checks make no live Meta checks.

## Current package surfaces

### `@wats/types`

Shared TypeScript contracts for WhatsApp domain payloads.

Primary exports:

- client config types
- webhook envelope/change/value types
- 14-variant `WhatsAppMessage` union
- status, contact, and error payload types

Status: foundations-complete for shared domain contracts; deeper runtime normalization continues under parity work.

### `@wats/crypto`

Portable crypto provider seam.

Primary exports:

- `CryptoProvider`
- `createCryptoProvider`
- Node/Bun adapter subpath: `@wats/crypto/node`
- WebCrypto adapter subpath: `@wats/crypto/webcrypto`
- typed crypto errors

Status: foundations-complete.

### `@wats/graph`

Graph transport and endpoint substrate.

Primary exports:

- `GraphClient`
- `createFetchTransport`
- `createMockTransport` via `@wats/graph/testing`
- `Transport` types
- `defineEndpoint`
- `sendMessage` for `POST /{phoneNumberId}/messages`
- WATS-98 `sendMarketingTemplate` / `buildSendMarketingTemplatePayload` for `POST /{phoneNumberId}/marketing_messages`
- Calling API lifecycle callables: `initiateCall`, `preAcceptCall`, `acceptCall`, `rejectCall`, `terminateCall`
- outbound message payload builders for text plus WATS-38 media/location/contacts/reaction/interactive/template/read/typing sends and WATS-98 Marketing Messages sends
- `PhoneNumberClient` with `.sendMessage(...)`, `.sendText(...)`, `.sendMarketingTemplate(...)`, WATS-38 composer helpers, WATS-41 calling lifecycle helpers, WATS-42A read-only phone inventory/profile helpers (`getInfo`, `getSettings`, `getBusinessProfile`, `getCommerceSettings`), WATS-95 Block API/OBA/display-name helpers (`listBlockedUsers`, `blockUsers`, `unblockUsers`, `getOfficialBusinessAccountStatus`, `requestOfficialBusinessAccountReview`, `submitDisplayNameForReview`), and WATS-133 Groups helpers (`createGroup`, `listGroups`, `group(groupId)`)
- `GroupClient` with bound-id Groups methods for `getInfo`, `update`, `delete`, invite links, participants, and join requests (WATS-133)
- `WABAClient` with `.getInfo(...)`, `.listSubscribedApps(...)`, and enhanced `.listPhoneNumbers({ fields?, limit?, after?, before? })`
- business/admin inventory and compatibility callables/types: `getWabaInfo`, `listSubscribedApps`, enhanced `listPhoneNumbers`, `getPhoneNumberInfo`, `getPhoneNumberSettings`, `getBusinessProfile`, `getCommerceSettings`, WATS-95 `listBlockedUsers`, `blockUsers`, `unblockUsers`, `getOfficialBusinessAccountStatus`, `requestOfficialBusinessAccountReview`, and `submitDisplayNameForReview`, exported at root and at `./endpoints/business-management`
- public endpoint subpaths for already-shipped Graph families: WATS-53 added `@wats/graph/endpoints/media`, `@wats/graph/endpoints/templates`, and `@wats/graph/endpoints/flows`; the full checked set is `@wats/graph/endpoints/messages`, `@wats/graph/endpoints/media`, `@wats/graph/endpoints/templates`, `@wats/graph/endpoints/flows`, `@wats/graph/endpoints/calling`, `@wats/graph/endpoints/business-management`, and the WATS-132 Groups API subpath `@wats/graph/endpoints/groups`; WATS-54 keeps package exports, fixture imports, docs, and changelog mentions aligned with `bun run api:check`
- `paginate` / `paginateAll`
- Graph error classes and pywa-seeded error registry helpers
- media runtime: `uploadMedia`, `downloadMedia`, `downloadMediaBytes`, `deleteMedia`, `decryptEncryptedMedia`, upload-session helpers, `MediaValidationError`, `MediaCryptoError`, `MediaIntegrityError`, and finite media cap constants

Status: foundations-complete for Graph plumbing; endpoint breadth is expanding. WATS-37 media runtime, WATS-38 outbound composers, WATS-39 template management, WATS-40 Flow helpers, WATS-41 Calling API lifecycle requests, WATS-42A read-only business/admin inventory, and WATS-95 Block API/OBA/display-name request-shape helpers plus business-alert webhook values are complete for credential-free MockTransport-backed behavior. Live Meta checks, automatic user-block decisions, policy/appeal automation, and broader mutating admin APIs remain credential-gated.

### `@wats/core`

Runtime orchestration and typed update handling.

Primary exports:

- `normalizeWebhookEnvelope` with message/status/account/unknown plus WATS-41 calling update variants and WATS-43A deep camelCase normalization for common message body families
- legacy raw parser/router helpers: `parseWebhookUpdate`, `createUpdateRouter`
- typed filter namespace and `@wats/core/filtersTyped`, including `filtersTyped.call` and WATS-43A `message.*` helpers for media, location, reaction, interactive replies, and quick-reply buttons
- legacy raw filter namespace and `@wats/core/filters`
- `TypedRouter`
- `createListenerRegistry`
- `WhatsApp` facade, including `startChat(...)` and WATS-38 composer helpers when `phoneNumberId` is bound

The `WhatsApp` facade binds:

- a mandatory `GraphClient`
- optional `PhoneNumberClient` when `phoneNumberId` is provided
- optional `WABAClient` when `wabaId` is provided
- a `TypedRouter`
- optional listener registry support through `.listen(...)`

Status: foundations-complete for typed routing/listening/facade behavior; calling webhook variants and calling typed filters are available for credential-free synthetic payloads.

### `@wats/http`

Webhook verification and HTTP adapter boundary.

Primary exports:

- `verifyWebhookChallenge`
- `validateWebhookSignature`
- `createWebhookAdapter`
- `createFetchWebhookHandler`
- `createBunWebhookServer`
- `createNodeWebhookHandler`
- webhook adapter request/response/config/error types

Status: foundations-complete for runtime-neutral webhook ingestion.

### `@wats/config`

Application-edge config substrate.

Primary exports:

- `validateConfig`
- `parseConfig`
- `loadConfig`
- `redactConfig`
- `ConfigValidationError`
- `WatsConfig` and related config types

Status: experimental baseline for YAML/JSON onboarding and env-secret references.

### `@wats/cli`

Package-manager CLI surface for safe onboarding and local inspection.

Primary exports:

- `runCli`
- `createWebhookVerifyToken`
- `wats` bin

Current commands:

- `wats --help`
- `wats init [dir] [--dry-run] [--format yaml|json] [--profile <name>]`
- `wats init --help`
- `wats config validate <path>`
- `wats config validate --config <path>`
- `wats doctor --help`
- `wats openapi --config <path>`
- `wats openapi --config <path> --profile <name>`
- `wats openapi --config <path> --server-url <url>`
- `wats openapi --config <path> --out <path>`
- `wats openapi --help`
- `wats serve --config <path> --dry-run [--profile <name>] [--host <host>] [--port <port>] [--print-routes]`
- `wats serve --config <path> --live --yes-live --env-file .env.local [--profile <name>] [--host <host>] [--port <port>]`
- `wats serve --help`
- `wats webhook token`

Status: experimental CLI foundation. It generates WATS config/env placeholder files with `wats init`, validates config files safely, exports WATS service OpenAPI, runs offline diagnostics, starts a dry-run local service process with `wats serve --dry-run`, starts a credential-gated local live service with explicit `--live --yes-live --env-file .env.local`, and generates local webhook verify tokens. It does not read `.env.local` implicitly or call Meta Graph unless the operator starts live serve and hits a service route.

WATS-68 messages endpoint module split note: the public `@wats/graph/endpoints/messages` subpath and root exports are preserved while the broad message composer internals move into focused `packages/graph/src/endpoints/messages/` files; this is an internal split with no payload behavior changes.

### `@wats/service`

Runtime-neutral standalone webhook/API service foundation.

Primary exports:

- `createWatsServiceApp`
- `createWatsServiceOpenApiDocument`
- `WatsServiceApp`
- `WatsServiceConfig`
- `WatsServiceOpenApiOptions`
- `WatsServiceOpenApiDocument`
- `WatsServiceError`

Current routes:

- `GET /healthz`
- `GET /readyz`
- `GET /openapi.json`
- `GET profile.webhook.path`
- `POST profile.webhook.path`
- `POST {profile.service.apiPrefix}/messages/text`
- `POST {profile.service.apiPrefix}/messages`

Status: experimental service foundation. It composes config profile shape, explicit resolved secrets, Graph client, WebhookAdapter, WhatsApp facade, optional PersistenceStore injection, and a generated OpenAPI 3.1 document for current WATS service routes. The `@wats/cli` dry-run and local live wrappers can serve it locally; production hosting, Docker, background outbox workers, and public docs UI remain later work.

### Persistence package

Public package: `@wats/persistence`

Implemented WATS-120 surfaces:

- `PersistenceStore`
- `MigrationReport`
- `PersistenceHealth`
- `PersistenceError`
- `CURRENT_SCHEMA_VERSION`
- `createSqlitePersistence` from `@wats/persistence/sqlite`

Status: experimental local persistence foundation. SQLite migrations, schema metadata, migration locks, webhook-event/request-idempotency/outbox tables, redacted health diagnostics, and optional `@wats/service` injection exist. Conversation APIs, CLI navigation, status UI wiring, Postgres, and production hosting remain later work.

### Internal support and workspace packages

- `@wats/internal-utils` — published internal support package required by public runtime packages such as `@wats/config`; application code should not treat it as a stable public API.
- `@wats/testing` — private workspace fixtures and policy tests; not for external import or publication.

## Explicit non-surfaces today

These are not implemented as runtime APIs yet:

- live credentialed template mutations/validation and high-level template library/bulk-authentication helpers
- live Flow mutations/hosting/encrypted data-exchange APIs beyond WATS-40 credential-free helpers
- live calling sessions and WebRTC/media signaling beyond WATS-41 credential-free Calling API request/webhook helpers
- mutating WABA/phone-number/business-management/admin APIs beyond WATS-42A read-only inventory and the bounded WATS-95 request-shape helpers; no automatic user-block decisions or policy/appeal automation are implemented
- catalog/product management APIs beyond WATS-42A read-only getCommerceSettings
- full Meta Graph API OpenAPI generation
- Postgres persistence adapter, config persistence schema, CLI database navigation, conversation APIs, background outbox workers, and observed status UI are not implemented yet.
- no supported Dockerfile, Compose file, container image, or container-registry publication yet. WATS-49 keeps Docker/deployment as a design scaffold until live/deploy packaging is explicitly authorized.

Track these through Linear roadmap issues and `docs/architecture/roadmap-to-whatsapp-pywa-parity.md`.

## Release compatibility labels

- Stable foundations: `@wats/types`, `@wats/crypto`, Graph transport/client/error substrate, webhook adapter, normalizer, filters, router, listeners, facade.
- Experimental / expanding: endpoint catalog breadth, media runtime, template/Flow/calling management helpers, config, CLI, service, persistence, OpenAPI, docs site.
- Internal support/private: `@wats/internal-utils` is published internal support for runtime dependency closure; `@wats/testing` remains private.

See `docs/architecture/release-policy.md` for versioning rules and `docs/api-stability.md` for the stable-for-0.x, experimental, and internal API policy.
