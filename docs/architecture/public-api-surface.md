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
- Calling API lifecycle callables: `initiateCall`, `preAcceptCall`, `acceptCall`, `rejectCall`, `terminateCall`
- outbound message payload builders for text plus WATS-38 media/location/contacts/reaction/interactive/template/read/typing sends
- `PhoneNumberClient` with `.sendMessage(...)`, `.sendText(...)`, WATS-38 composer helpers, WATS-41 calling lifecycle helpers, and WATS-42A read-only phone inventory/profile helpers (`getInfo`, `getSettings`, `getBusinessProfile`, `getCommerceSettings`)
- `WABAClient` with `.getInfo(...)`, `.listSubscribedApps(...)`, and enhanced `.listPhoneNumbers({ fields?, limit?, after?, before? })`
- read-only business/admin inventory callables and types: `getWabaInfo`, `listSubscribedApps`, enhanced `listPhoneNumbers`, `getPhoneNumberInfo`, `getPhoneNumberSettings`, `getBusinessProfile`, `getCommerceSettings`, exported at root and at `./endpoints/business-management`
- public endpoint subpaths for already-shipped Graph families: WATS-53 added `@wats/graph/endpoints/media`, `@wats/graph/endpoints/templates`, and `@wats/graph/endpoints/flows`; the full checked set is `@wats/graph/endpoints/messages`, `@wats/graph/endpoints/media`, `@wats/graph/endpoints/templates`, `@wats/graph/endpoints/flows`, `@wats/graph/endpoints/calling`, and `@wats/graph/endpoints/business-management`; WATS-54 keeps package exports, fixture imports, docs, and changelog mentions aligned with `bun run api:check`
- `paginate` / `paginateAll`
- Graph error classes and pywa-seeded error registry helpers
- media runtime: `uploadMedia`, `downloadMedia`, `downloadMediaBytes`, `deleteMedia`, `decryptEncryptedMedia`, upload-session helpers, `MediaValidationError`, `MediaCryptoError`, `MediaIntegrityError`, and finite media cap constants

Status: foundations-complete for Graph plumbing; endpoint breadth is expanding. WATS-37 media runtime, WATS-38 outbound composers, WATS-39 template management, WATS-40 Flow helpers, WATS-41 Calling API lifecycle requests, and WATS-42A read-only business/admin inventory are complete for credential-free MockTransport-backed behavior. Live Meta checks and mutating admin APIs remain credential-gated.

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
- `wats serve --help`
- `wats webhook token`

Status: experimental CLI foundation. It generates WATS config/env placeholder files with `wats init`, validates config files safely, exports WATS service OpenAPI, and generates local webhook verify tokens without resolving env-secret values or calling Meta Graph. It does not yet start a server process.

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

Status: experimental service foundation. It composes config profile shape, explicit resolved secrets, Graph client, WebhookAdapter, WhatsApp facade, and a generated OpenAPI 3.1 document for current WATS service routes. It does not yet provide server process wrappers or a public docs UI.

### Internal support and private packages

- `@wats/internal-utils` — published internal support package required by public runtime packages such as `@wats/config`; application code should not treat it as a stable public API.
- `@wats/testing` — private workspace fixtures and policy tests; not for external import or publication.

## Explicit non-surfaces today

These are not implemented as runtime APIs yet:

- live credentialed template mutations/validation and high-level template library/bulk-authentication helpers
- live Flow mutations/hosting/encrypted data-exchange APIs beyond WATS-40 credential-free helpers
- live calling sessions and WebRTC/media signaling beyond WATS-41 credential-free Calling API request/webhook helpers
- mutating WABA/phone-number/business-management/admin APIs beyond WATS-42A read-only inventory
- catalog/product management APIs beyond WATS-42A read-only getCommerceSettings
- full Meta Graph API OpenAPI generation
- CLI config generation / real `wats serve` server process
- `@wats/persistence` package and SQLite/Postgres adapters are WATS-48 design targets only. In docs-lock wording, @wats/persistence package and SQLite/Postgres adapters are WATS-48 design targets only. No current package export, no service persistence integration, no config persistence schema, and no migration runner exists yet.
- no supported Dockerfile, Compose file, container image, or container-registry publication yet. WATS-49 keeps Docker/deployment as a design scaffold until `wats serve` exists.
- registry-publishable dist builds

Track these through Linear roadmap issues and `docs/architecture/roadmap-to-whatsapp-pywa-parity.md`.

## Release compatibility labels

- Stable foundations: `@wats/types`, `@wats/crypto`, Graph transport/client/error substrate, webhook adapter, normalizer, filters, router, listeners, facade.
- Experimental / expanding: endpoint catalog breadth, media runtime, template/Flow/calling management helpers, config, CLI, service, OpenAPI, docs site.
- Internal support/private: `@wats/internal-utils` is published internal support for runtime dependency closure; `@wats/testing` remains private.

See `docs/architecture/release-policy.md` for versioning rules.
