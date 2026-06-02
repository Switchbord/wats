# WATS Package Map

- status: active
- applies-to: `0.2.0-foundations-complete` + WATS-31/32/33/34/35/WATS-37/38/39/40/41/42A/53/54/56 consistency line
- lastReviewed: 2026-05-04

## Purpose

Canonical dependency map for the WATS workspace. Arrows point from dependent package to dependency.

## Current dependency graph

```text
                         @wats/types
                              ^
                              |
          +-------------------+-------------------+
          |                   |                   |
     @wats/crypto        @wats/graph         @wats/http
          ^                   ^                   ^
          |                   |                   |
          +-------------------+-------------------+
                              |
                         @wats/core
                              ^
                              |
                   +----------+----------+
                   |                     |
              @wats/config          @wats/cli
                   ^                     |
                   |                     |
              @wats/service --------+
                   ^
                   |
              @wats/testing
          (workspace fixtures / policy tests)
```

`@wats/internal-utils` is a published internal support package used by public runtime packages that need shared helpers. It exists to make registry installs complete; it is documented as internal and should not be treated as a stable application API.

## Current packages

### `@wats/types`

- Purpose: shared TypeScript domain contracts for config, webhook envelopes, messages, statuses, contacts, entities, and error payloads.
- Runtime targets: Bun, Node, Workers, Deno.
- Public: yes.
- Dependencies out: none.
- Stability: foundations-complete.

### `@wats/crypto`

- Purpose: `CryptoProvider` seam plus Node/Bun and WebCrypto adapters.
- Runtime targets: Bun, Node, Workers, Deno.
- Public: yes.
- Dependencies out: `@wats/types` for shared error payload contracts.
- Stability: foundations-complete.

### `@wats/graph`

- Purpose: Graph client, transport seam, endpoint registry, scoped clients, error registry, pagination, and endpoint catalog.
- Runtime targets: Bun, Node, Workers, Deno through injected `Transport` / fetch.
- Public: yes.
- Dependencies out: `@wats/types`.
- Stability: foundations-complete for client/transport/errors/pagination; endpoint breadth is expanding.

Current runtime endpoints and helpers:

- `POST /{phoneNumberId}/messages`
- WATS-98 `POST /{phoneNumberId}/marketing_messages` via `sendMarketingTemplate` and `PhoneNumberClient.sendMarketingTemplate(...)`
- `PhoneNumberClient.sendText(...)` convenience helper for arbitrary-recipient text starts (WATS-30)
- WATS-38 `PhoneNumberClient` composer helpers for media, location, contacts, reaction, interactive variants, template send, mark-as-read, and typing indicators
- WATS-94 Template Group helpers for Graph `template_groups` and `template_group_analytics` (`listTemplateGroups`, `getTemplateGroupAnalytics`)
- WATS-95 business-management helpers for Graph `block_users`, `official_business_account`, and `new_display_name` (`listBlockedUsers`, `blockUsers`, `unblockUsers`, `getOfficialBusinessAccountStatus`, `requestOfficialBusinessAccountReview`, `submitDisplayNameForReview`)
- WATS-132/WATS-133 Groups helpers for Graph `groups`, `invite_link`, `participants`, and `join_requests`, including `PhoneNumberClient.createGroup`, `PhoneNumberClient.listGroups`, `PhoneNumberClient.group(groupId)`, and `GroupClient`
- `GET /{wabaId}/phone_numbers`

Current endpoint subpaths:

- `@wats/graph/endpoints/messages`
- `@wats/graph/endpoints/media`
- `@wats/graph/endpoints/templates`
- `@wats/graph/endpoints/flows`
- `@wats/graph/endpoints/calling`
- `@wats/graph/endpoints/business-management`
- `@wats/graph/endpoints/groups`

Run `bun run api:check` after changing this list. WATS-54 checks package exports, target source files, graph-consumer package-specifier imports, `docs/reference/index.md`, `docs/architecture/public-api-surface.md`, this package map, `docs/migration/pywa-to-wats.md`, and `CHANGELOG.md` for the same Graph endpoint subpaths.

WATS-57 records the graph endpoint module split plan. WATS-65 implements the first runtime slice by moving the message-template endpoint family into `packages/graph/src/endpoints/templates/` while preserving the public `@wats/graph/endpoints/templates` subpath and root exports. WATS-66 implements the second runtime slice by moving the Flow endpoint family into `packages/graph/src/endpoints/flows/` while preserving the public `@wats/graph/endpoints/flows` subpath and root exports. WATS-67 implements the third runtime slice by moving WABA phone-number listing into `packages/graph/src/endpoints/waba/` while preserving root and `wabaEndpoints.ts` compatibility. WATS-68 implements the messages endpoint module split by moving the broad message composer internals into `packages/graph/src/endpoints/messages/` focused files while preserving the public `@wats/graph/endpoints/messages` subpath, root exports, and no payload behavior changes.

WATS-58 records the graph validation utility reuse plan. It is a graph validation utility reuse plan only: design/test-planner guidance for future private `packages/graph/src/internal/validation/` helpers, with no current runtime source movement and no public utility exports.

Current media runtime status:

- `uploadMedia` sends a single multipart `POST /{phoneNumberId}/media` with strict validation and finite upload caps.
- `downloadMedia` resolves media metadata via `GET /{mediaId}`.
- `downloadMediaBytes` fetches resolved media bytes through the injected transport with finite download caps and optional SHA-256 verification.
- `deleteMedia` calls `DELETE /{mediaId}`.
- `decryptEncryptedMedia` verifies and decrypts encrypted media bundles.
- `createUploadSession`, `uploadFileToSession`, and `getUploadSession` implement resumable upload sessions.

### `@wats/http`

- Purpose: webhook challenge/signature primitives, runtime-neutral `WebhookAdapter`, and Bun/Node/Fetch wrappers.
- Runtime targets: Bun, Node, Workers, Deno-style Fetch runtimes.
- Public: yes.
- Dependencies out: `@wats/crypto`, `@wats/core`, `@wats/types`.
- Stability: foundations-complete.

`@wats/http` depends on `@wats/core` for the normalizer. Its adapter accepts only a structural `{ dispatch(update) }` facade-like object at runtime.

### `@wats/core`

- Purpose: typed webhook normalization, typed filters, raw filters, routers, listener registry, and `WhatsApp` facade composition root.
- Runtime targets: Bun, Node, Workers, Deno where dependencies are available.
- Public: yes.
- Dependencies out: `@wats/types`, `@wats/graph`.
- Stability: foundations-complete.

The facade binds a `GraphClient`, optional `PhoneNumberClient` / `WABAClient`, a `TypedRouter`, and optional listener registry support. WATS-30 adds `WhatsApp.startChat(...)`, which delegates through the bound `PhoneNumberClient` to start a text conversation with any valid phone-number-like recipient without contacts lookup. WATS-38 adds facade composer helpers for media, location, contacts, reaction, interactive variants, template send, mark-as-read, and typing indicators; they require a bound `phoneNumberId` and use the same phone-number client.

### `@wats/config`

- Purpose: YAML/JSON config schema, env-secret references, config loading, validation, and redaction.
- Runtime targets: Bun and Node-compatible ESM; config parsing itself is runtime-light.
- Public: yes, experimental in WATS-32.
- Dependencies out: `@wats/internal-utils` for shared object guards.
- Stability: experimental until the CLI/service config contract settles.

### `@wats/cli`

- Purpose: package-manager CLI surface for safe config validation, OpenAPI export, help, and local webhook token generation.
- Runtime targets: Bun now; Node-compatible ESM is the direction for the publishable CLI.
- Public: yes, experimental in WATS-33.
- Dependencies out: `@wats/config`, `@wats/service`.
- Stability: experimental until init/doctor/serve process behavior settles.

### `@wats/service`

- Purpose: runtime-neutral standalone webhook/API service foundation plus generated OpenAPI 3.1 document for the service routes.
- Runtime targets: Bun and Web Fetch-compatible runtimes for the core `Request -> Response` app; Node/Bun server wrappers are later work.
- Public: yes, experimental in WATS-34/WATS-35.
- Dependencies out: `@wats/config`, `@wats/core`, `@wats/http`, `@wats/graph`, `@wats/crypto`.
- Stability: experimental until CLI serve/openapi integration and broader route coverage settle.

### `@wats/persistence`

- Purpose: experimental persistence contracts plus the WATS-120 SQLite local adapter and migration runner.
- Runtime targets: Bun for `@wats/persistence/sqlite`; root contracts are TypeScript-only.
- Public: yes, experimental.
- Published subpaths: `@wats/persistence`, `@wats/persistence/sqlite`.
- Future subpaths: `@wats/persistence/postgres`, `@wats/persistence/testing`.
- Dependencies out: none.
- Dependency direction: `@wats/service` may later consume `@wats/persistence` through injected stores, not direct env reads; `@wats/cli` may later compose config/service/persistence for doctor and serve lifecycle checks.
- Stability: experimental until WATS-121 service integration and WATS-125 Postgres semantics settle.

### `@wats/internal-utils`

- Purpose: internal support package for shared pure helpers required by public runtime packages.
- Public: yes for package-manager completeness; application code should not treat it as stable public API.
- Published: yes in the 0.2.1 alpha package set because `@wats/config` depends on it at runtime.
- Dependencies out: none.

### `@wats/testing`

- Purpose: private workspace tests, consumer fixtures, fixture payloads, and policy checks.
- Runtime targets: Bun test runner only.
- Public: no.
- Published: no.
- Dependencies out: workspace packages under test.

## Invariants

1. `@wats/types` has no runtime dependencies.
2. `@wats/graph`, `@wats/http`, and `@wats/crypto` expose portable seams and keep runtime-specific behavior behind adapters.
3. `@wats/core` is the SDK composition root; app-layer packages compose it rather than duplicating router/webhook semantics.
4. `@wats/internal-utils` may be published only as an internal support package required by public runtime packages; `@wats/testing` remains private and must not be published.
5. Consumer fixtures import through package specifiers, never relative source paths.
6. Roadmap/deferred work is tracked in Linear.

## Runtime-target matrix

| package | Bun | Node | Workers | Deno | notes |
| --- | :---: | :---: | :---: | :---: | --- |
| `@wats/types` | Y | Y | Y | Y | type-first |
| `@wats/crypto` | Y | Y | Y | Y | adapter chosen at runtime |
| `@wats/graph` | Y | Y | Y | Y | injected transport |
| `@wats/http` | Y | Y | Y | Y | runtime wrappers |
| `@wats/core` | Y | Y | Y | Y | no server binding |
| `@wats/config` | Y | Y | possible | possible | boundary validation; file loading runtime-dependent |
| `@wats/cli` | Y | planned | N | N | config validation + OpenAPI export + package-manager UX |
| `@wats/internal-utils` | Y | Y | possible | possible | internal support package |
| `@wats/testing` | Y | N | N | N | Bun tests only |
| `@wats/service` | Y | planned | possible | possible | runtime-neutral app plus OpenAPI generator; server wrappers later |
