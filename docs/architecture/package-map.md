# WATS Package Map

- status: active
- applies-to: `0.2.0-foundations-complete` + WATS-31/32/33/34/35/WATS-37/38/39/40/41/42A/53/54/56 consistency line
- lastReviewed: 2026-05-04

## Purpose

Canonical dependency map for the WATS workspace. Arrows point from dependent package to dependency.

## Current dependency graph

```text
                         @switchbord/types
                              ^
                              |
          +-------------------+-------------------+
          |                   |                   |
     @switchbord/crypto        @switchbord/graph         @switchbord/http
          ^                   ^                   ^
          |                   |                   |
          +-------------------+-------------------+
                              |
                         @switchbord/core
                              ^
                              |
                   +----------+----------+
                   |                     |
              @switchbord/config          @switchbord/cli
                   ^                     |
                   |                     |
              @switchbord/service --------+ 
                   ^
                   |
              @switchbord/testing
          (private fixtures / policy tests)
```

`@switchbord/internal-utils` is a published internal support package used by public runtime packages that need shared helpers. It exists to make registry installs complete; it is documented as internal and should not be treated as a stable application API.

## Current packages

### `@switchbord/types`

- Purpose: shared TypeScript domain contracts for config, webhook envelopes, messages, statuses, contacts, entities, and error payloads.
- Runtime targets: Bun, Node, Workers, Deno.
- Public: yes.
- Dependencies out: none.
- Stability: foundations-complete.

### `@switchbord/crypto`

- Purpose: `CryptoProvider` seam plus Node/Bun and WebCrypto adapters.
- Runtime targets: Bun, Node, Workers, Deno.
- Public: yes.
- Dependencies out: `@switchbord/types` for shared error payload contracts.
- Stability: foundations-complete.

### `@switchbord/graph`

- Purpose: Graph client, transport seam, endpoint registry, scoped clients, error registry, pagination, and endpoint catalog.
- Runtime targets: Bun, Node, Workers, Deno through injected `Transport` / fetch.
- Public: yes.
- Dependencies out: `@switchbord/types`.
- Stability: foundations-complete for client/transport/errors/pagination; endpoint breadth is expanding.

Current runtime endpoints and helpers:

- `POST /{phoneNumberId}/messages`
- `PhoneNumberClient.sendText(...)` convenience helper for arbitrary-recipient text starts (WATS-30)
- WATS-38 `PhoneNumberClient` composer helpers for media, location, contacts, reaction, interactive variants, template send, mark-as-read, and typing indicators
- `GET /{wabaId}/phone_numbers`

Current endpoint subpaths:

- `@switchbord/graph/endpoints/messages`
- `@switchbord/graph/endpoints/media`
- `@switchbord/graph/endpoints/templates`
- `@switchbord/graph/endpoints/flows`
- `@switchbord/graph/endpoints/calling`
- `@switchbord/graph/endpoints/business-management`

Run `bun run api:check` after changing this list. WATS-54 checks package exports, target source files, graph-consumer package-specifier imports, `docs/reference/index.md`, `docs/architecture/public-api-surface.md`, this package map, `docs/migration/pywa-to-wats.md`, and `CHANGELOG.md` for the same Graph endpoint subpaths.

WATS-57 records the graph endpoint module split plan. WATS-65 implements the first runtime slice by moving the message-template endpoint family into `packages/graph/src/endpoints/templates/` while preserving the public `@switchbord/graph/endpoints/templates` subpath and root exports. WATS-66 implements the second runtime slice by moving the Flow endpoint family into `packages/graph/src/endpoints/flows/` while preserving the public `@switchbord/graph/endpoints/flows` subpath and root exports. WABA phone-number listing and message-composer splits remain separate follow-up slices.

WATS-58 records the graph validation utility reuse plan. It is a graph validation utility reuse plan only: design/test-planner guidance for future private `packages/graph/src/internal/validation/` helpers, with no current runtime source movement and no public utility exports.

Current media runtime status:

- `uploadMedia` sends a single multipart `POST /{phoneNumberId}/media` with strict validation and finite upload caps.
- `downloadMedia` resolves media metadata via `GET /{mediaId}`.
- `downloadMediaBytes` fetches resolved media bytes through the injected transport with finite download caps and optional SHA-256 verification.
- `deleteMedia` calls `DELETE /{mediaId}`.
- `decryptEncryptedMedia` verifies and decrypts encrypted media bundles.
- `createUploadSession`, `uploadFileToSession`, and `getUploadSession` implement resumable upload sessions.

### `@switchbord/http`

- Purpose: webhook challenge/signature primitives, runtime-neutral `WebhookAdapter`, and Bun/Node/Fetch wrappers.
- Runtime targets: Bun, Node, Workers, Deno-style Fetch runtimes.
- Public: yes.
- Dependencies out: `@switchbord/crypto`, `@switchbord/core`, `@switchbord/types`.
- Stability: foundations-complete.

`@switchbord/http` depends on `@switchbord/core` for the normalizer. Its adapter accepts only a structural `{ dispatch(update) }` facade-like object at runtime.

### `@switchbord/core`

- Purpose: typed webhook normalization, typed filters, raw filters, routers, listener registry, and `WhatsApp` facade composition root.
- Runtime targets: Bun, Node, Workers, Deno where dependencies are available.
- Public: yes.
- Dependencies out: `@switchbord/types`, `@switchbord/graph`.
- Stability: foundations-complete.

The facade binds a `GraphClient`, optional `PhoneNumberClient` / `WABAClient`, a `TypedRouter`, and optional listener registry support. WATS-30 adds `WhatsApp.startChat(...)`, which delegates through the bound `PhoneNumberClient` to start a text conversation with any valid phone-number-like recipient without contacts lookup. WATS-38 adds facade composer helpers for media, location, contacts, reaction, interactive variants, template send, mark-as-read, and typing indicators; they require a bound `phoneNumberId` and use the same phone-number client.

### `@switchbord/config`

- Purpose: YAML/JSON config schema, env-secret references, config loading, validation, and redaction.
- Runtime targets: Bun and Node-compatible ESM; config parsing itself is runtime-light.
- Public: yes, experimental in WATS-32.
- Dependencies out: `@switchbord/internal-utils` for shared object guards.
- Stability: experimental until the CLI/service config contract settles.

### `@switchbord/cli`

- Purpose: package-manager CLI surface for safe config validation, OpenAPI export, help, and local webhook token generation.
- Runtime targets: Bun now; Node-compatible ESM is the direction for the publishable CLI.
- Public: yes, experimental in WATS-33.
- Dependencies out: `@switchbord/config`, `@switchbord/service`.
- Stability: experimental until init/doctor/serve process behavior settles.

### `@switchbord/service`

- Purpose: runtime-neutral standalone webhook/API service foundation plus generated OpenAPI 3.1 document for the service routes.
- Runtime targets: Bun and Web Fetch-compatible runtimes for the core `Request -> Response` app; Node/Bun server wrappers are later work.
- Public: yes, experimental in WATS-34/WATS-35.
- Dependencies out: `@switchbord/config`, `@switchbord/core`, `@switchbord/http`, `@switchbord/graph`, `@switchbord/crypto`.
- Stability: experimental until CLI serve/openapi integration and broader route coverage settle.

## WATS-48 planned package boundary

WATS-48 defines a design target, not current package surface until implementation lands.

Future public package and subpaths:

- `@switchbord/persistence`
- `@switchbord/persistence/sqlite`
- `@switchbord/persistence/postgres`
- `@switchbord/persistence/testing`

Intended dependency direction:

- `@switchbord/persistence` may depend on `@switchbord/types` and `@switchbord/internal-utils`.
- `@switchbord/service` may later consume `@switchbord/persistence` through injected stores, not direct env reads.
- `@switchbord/cli` may later compose config/service/persistence for doctor and serve lifecycle checks.
- The current dependency graph does not include `@switchbord/persistence`.

### `@switchbord/internal-utils`

- Purpose: internal support package for shared pure helpers required by public runtime packages.
- Public: yes for package-manager completeness; application code should not treat it as stable public API.
- Published: yes in the 0.2.1 alpha package set because `@switchbord/config` depends on it at runtime.
- Dependencies out: none.

### `@switchbord/testing`

- Purpose: private workspace tests, consumer fixtures, fixture payloads, and policy checks.
- Runtime targets: Bun test runner only.
- Public: no.
- Published: no.
- Dependencies out: workspace packages under test.

## Invariants

1. `@switchbord/types` has no runtime dependencies.
2. `@switchbord/graph`, `@switchbord/http`, and `@switchbord/crypto` expose portable seams and keep runtime-specific behavior behind adapters.
3. `@switchbord/core` is the SDK composition root; app-layer packages compose it rather than duplicating router/webhook semantics.
4. `@switchbord/internal-utils` may be published only as an internal support package required by public runtime packages; `@switchbord/testing` remains private and must not be published.
5. Consumer fixtures import through package specifiers, never relative source paths.
6. Roadmap/deferred work is tracked in Linear.

## Runtime-target matrix

| package | Bun | Node | Workers | Deno | notes |
| --- | :---: | :---: | :---: | :---: | --- |
| `@switchbord/types` | Y | Y | Y | Y | type-first |
| `@switchbord/crypto` | Y | Y | Y | Y | adapter chosen at runtime |
| `@switchbord/graph` | Y | Y | Y | Y | injected transport |
| `@switchbord/http` | Y | Y | Y | Y | runtime wrappers |
| `@switchbord/core` | Y | Y | Y | Y | no server binding |
| `@switchbord/config` | Y | Y | possible | possible | boundary validation; file loading runtime-dependent |
| `@switchbord/cli` | Y | planned | N | N | config validation + OpenAPI export + package-manager UX |
| `@switchbord/internal-utils` | Y | Y | possible | possible | internal support package |
| `@switchbord/testing` | Y | N | N | N | Bun tests only |
| `@switchbord/service` | Y | planned | possible | possible | runtime-neutral app plus OpenAPI generator; server wrappers later |
