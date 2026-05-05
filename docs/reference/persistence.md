# Persistence Reference

- status: design
- applies-to: WATS-48
- package: future `@switchbord/persistence`
- lastReviewed: 2026-05-01

## Design target

WATS-48 defines the public persistence design target for future durable runtime state. The design covers a `PersistenceStore`, SQLite adapter target, Postgres adapter target, schema migration contract, webhook event idempotency, service request idempotency, and redacted diagnostics.

## Current implementation status

`@switchbord/persistence is not exported yet`. There is no package export yet, no adapters implemented in this slice, no config schema field, no service persistence integration, and no migration runner.

This page is public so future CLI/service/deployment work can align before behavior lands.

## Intended package surface

Future package targets:

```ts
import type {
  PersistenceStore,
  PersistenceAdapter,
  PersistenceTransaction,
  MigrationReport,
  PersistenceHealth
} from "@switchbord/persistence";
```

Potential subpaths:

```ts
import { createSqlitePersistence } from "@switchbord/persistence/sqlite";
import { createPostgresPersistence } from "@switchbord/persistence/postgres";
```

These imports are not available in the current implementation.

## Core concepts

### `PersistenceStore`

The top-level lifecycle object. It exposes schema version, health checks, migrations, transactions, and close behavior.

### `PersistenceAdapter`

The dialect-specific implementation boundary. SQLite and Postgres must satisfy the same public contract before either is documented as implemented.

### `PersistenceTransaction`

A scoped transactional handle for migration metadata, webhook idempotency, and service request idempotency writes.

## SQLite adapter target

SQLite is the local/dev default target once implemented. It should use deterministic local tests, safe file paths, foreign keys, WAL mode, busy timeouts, and clear docs that SQLite is not the multi-replica production recommendation.

## Postgres adapter target

Postgres is the optional deploy/production target once implemented. Database URLs must come from env-secret references such as `WATS_DATABASE_URL`, and diagnostics must never print credentials or connection strings.

## Schema migration contract

The schema migration contract is forward-only for alpha. Migrations must be idempotent, versioned, checksummed, and guarded by a migration lock. Unsupported schema versions fail closed. Destructive migrations require explicit release notes and review before implementation.

## Webhook event idempotency

Webhook event idempotency records scoped event keys and hashes so duplicate deliveries do not trigger duplicate processing. The default design stores safe metadata and hashes only, with no raw webhook payload persistence by default.

## Service request idempotency

Service request idempotency records scoped request keys and request hashes. The same idempotency key with the same request hash may replay a stored response; the same key with a different request hash conflicts.

## Redacted diagnostics

Persistence diagnostics must not print:

- access tokens
- app secrets
- webhook verify tokens
- service bearer tokens
- authorization headers
- database URLs
- raw webhook bodies
- message text or contact payloads

## Credential-free tests

WATS-48 requires credential-free tests. Future Postgres tests should be opt-in or mocked until an explicit local/integration environment is available; default CI must not require database credentials or live Meta credentials.

## Non-goals

- no package export yet
- no adapter implementation yet
- no production ready persistence
- no raw webhook body storage by default
- no service persistence integration
- no config persistence schema
- no Docker/deploy packaging
- no live Meta validation
- no second repository

## Related

- `docs/architecture/wats48-persistence-contract-design.md`
- `docs/architecture/alpha-cli-runtime-operations-plan.md`
- `docs/reference/config.md`
- `docs/reference/service.md`
