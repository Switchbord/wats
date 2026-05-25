# Persistence Reference

- status: experimental
- applies-to: WATS-48, WATS-87, WATS-120
- package: `@wats/persistence`
- lastReviewed: 2026-05-25

## Current implementation status

WATS-120 adds the first public persistence package:

```ts
import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  type MigrationReport,
  type PersistenceHealth,
  type PersistenceStore
} from "@wats/persistence";
import { createSqlitePersistence } from "@wats/persistence/sqlite";
```

The SQLite adapter is for local and single-instance testing. It is not a production or multi-replica recommendation.

## SQLite quickstart

```ts
const store = await createSqlitePersistence({ filename: "./wats.sqlite" });
await store.migrate();
const health = await store.health();
await store.close();
```

Use a local path or `:memory:`. Database paths are operationally sensitive and diagnostics report only `[REDACTED_SQLITE_DATABASE]`.

## Implemented schema

The WATS-120 migration runner creates:

- `wats_schema_migrations`
- `wats_persistence_lock`
- `wats_webhook_events`
- `wats_service_requests`
- `wats_outbox`

Migrations are forward-only for alpha. Already-applied migration checksums must match the package migration definitions. Checksum drift fails closed with `PersistenceError`.

## Runtime contract

`PersistenceStore` exposes:

- `backend`
- `migrate(): Promise<MigrationReport>`
- `health(): Promise<PersistenceHealth>`
- `close(): Promise<void>`

`MigrationReport` returns the current schema version, applied migration IDs, and whether the database was already current.

`PersistenceHealth` returns status-only fields: backend, current version, ok flag, and redacted location. It does not print database paths or URLs.

## Redaction boundary

Persistence diagnostics must not print:

- access tokens
- app secrets
- webhook verify tokens
- service bearer tokens
- authorization headers
- database URLs or SQLite paths
- raw webhook bodies
- message text or contact payloads

## Relationship to service and CLI

Current `@wats/service` does not consume persistence yet. WATS-121 will inject a persistence store into service for webhook deduplication and service request idempotency.

Current `@wats/cli` has no database navigation commands. WATS-123 will add thread/message navigation after service exposes persisted conversation/event-store APIs.

## Postgres target

Postgres remains a follow-up adapter target. It must satisfy the same root contract and keep database URLs secret. Default CI must not require Postgres credentials.

## Non-goals

- no Postgres adapter yet
- no service persistence integration yet
- no CLI thread navigation yet
- no observed delivery/read status UI yet
- no raw webhook body storage by default
- no production hosting guarantee
- no live Meta validation

## Related

- `docs/reference/config.md`
- `docs/reference/service.md`
- `docs/architecture/package-map.md`
- `docs/architecture/public-api-surface.md`
