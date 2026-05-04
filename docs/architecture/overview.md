# Architecture Overview

- status: active
- applies-to: `0.2.0-foundations-complete`
- lastReviewed: 2026-05-01

WATS is a Bun-first TypeScript monorepo for WhatsApp operations. The repo is organized around small packages with explicit dependency direction rather than one large framework package.

## Package layers

```text
@wats/types
  shared domain contracts

@wats/crypto        @wats/graph        @wats/http
  crypto seam         graph client        webhook HTTP boundary
  adapters            endpoints           runtime adapters

@wats/core
  typed updates, filters, router, listeners, WhatsApp facade

@wats/testing
  private fixtures and workspace policy tests
```

Application-edge packages sit above these foundations:

```text
@wats/config   config schema, YAML/JSON loading, env-secret references
@wats/service  standalone webhook/API service, OpenAPI 3.1
@wats/cli      init, validate, doctor, serve, openapi commands
```

Those app-layer packages may depend on `@wats/core`; lower-level packages should not. ADR-007 keeps the alpha CLI/runtime/operator layer in this monorepo by default rather than splitting it into a second repository.

## Request flow

A Graph request starts in either user code or a scoped client:

1. `PhoneNumberClient`, `WABAClient`, or a custom `defineEndpoint` callable builds path/query/body options.
2. `GraphClient` validates the path, query, headers, base URL, API version, token, and body handling.
3. The injected `Transport` sends the request.
4. Graph failures map into the typed error taxonomy and pywa-seeded error registry.

This lets endpoint breadth grow without duplicating transport, auth, validation, or error plumbing.

## Webhook flow

A webhook request enters through `@wats/http`:

1. A runtime wrapper adapts Bun, Node, or Fetch `Request` shapes to the runtime-neutral `WebhookAdapter`.
2. The adapter verifies the Meta challenge or `X-Hub-Signature-256` signature.
3. The raw JSON body is normalized by `normalizeWebhookEnvelope` into `TypedUpdate` values.
4. The supplied facade-shaped object dispatches each update.
5. `TypedRouter` evaluates listeners and handlers, preserving dispatch reports and isolating user-code failures.

The adapter acknowledges valid webhooks even when downstream handlers fail, preventing Meta retry storms caused by application bugs.

## Extension points

- `Transport` for retries, tracing, auth refresh, mocks, and offline tests.
- `defineEndpoint` for adding typed Graph endpoints ahead of first-class wrappers.
- `TypedFilter` and filter combinators for handler/listener matching.
- `RouterObserver` and webhook logger hooks for observability.
- `CryptoProvider` for Node/Bun/WebCrypto portability.
- Future config/service/CLI layers for package-manager adoption and standalone operation.

## Invariants

- Public API names are camelCase-only.
- Public APIs are async-only where work may cross I/O or runtime seams.
- Low-level packages stay runtime-portable; runtime-specific code is isolated behind adapters.
- Consumer fixtures import through package specifiers, never relative source paths.
- Docs, changelog, parity matrix, and Linear roadmap move with implementation.
- Deferred work is tracked in Linear, not in repo-local deferred ledgers.

See also:

- `docs/architecture/package-map.md`
- `docs/architecture/public-api-surface.md`
- `docs/architecture/release-policy.md`
- `docs/architecture/alpha-cli-runtime-operations-plan.md`
- `docs/architecture/decisions/ADR-007-alpha-cli-runtime-operator-layer.md`
- `docs/parity/pywa-parity-matrix.md`
