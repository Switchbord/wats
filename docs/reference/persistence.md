# Persistence Reference

- status: experimental
- applies-to: WATS-48, WATS-87, WATS-120, WATS-121
- package: `@wats/persistence`
- lastReviewed: 2026-05-25

## Current implementation status

WATS ships an experimental persistence package:

```ts
import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  runOutboxWorkerOnce,
  type MigrationReport,
  type OutboxItem,
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

The migration runner creates:

- `wats_schema_migrations`
- `wats_persistence_lock`
- `wats_webhook_events`
- `wats_service_requests`
- `wats_outbox`

Migrations are forward-only for alpha. Already-applied migration checksums must match the package migration definitions. Checksum drift fails closed with `PersistenceError`. A held migration lock fails closed with `PersistenceError` code `migration_lock_failed`.

## Runtime contract

`PersistenceStore` exposes:

- `backend`
- `migrate(): Promise<MigrationReport>`
- `health(): Promise<PersistenceHealth>`
- `recordWebhookEvent(...)`
- `getServiceRequest(...)`
- `recordServiceRequest(...)`
- `enqueueOutboxItem(...)`
- `claimOutboxItems(...)`
- `markOutboxItemFailed(...)`
- `markOutboxItemSucceeded(...)`
- `close(): Promise<void>`

Webhook event records store safe event keys and hashes, not raw webhook bodies. Duplicate event keys return `"duplicate"` so service can acknowledge Meta retries without dispatching the same update twice.

Service request idempotency stores an idempotency key, request hash, and response JSON. A matching key/body hash replays the stored response. The same key with a different body hash conflicts.

## Outbox

WATS-87 adds first-slice outbox record APIs for at-least-once local work scheduling:

```ts
await store.enqueueOutboxItem({
  id: "send-1",
  payloadHash: "sha256:...",
  createdAt: new Date().toISOString()
});

const report = await runOutboxWorkerOnce(store, {
  now: new Date().toISOString(),
  limit: 10,
  retryDelayMs: 30_000,
  async handler(item: OutboxItem) {
    // Reconstruct/send from application-owned state keyed by item.id.
  }
});
```

The persistence table stores only payload hashes, status, attempt counts, `leaseId`, and retry timestamps. It does not store raw webhook bodies, does not store message text, and does not store Graph request bodies, contacts, or other payload content. `runOutboxWorkerOnce(...)` claims due `pending` items, calls the handler, marks successes as `succeeded`, and reschedules failures with `nextAttemptAt = now + retryDelayMs`. Claimed items use a five-minute processing lease; stale `processing` rows become claimable again so a killed worker does not strand records forever. The lease is fenced: `markOutboxItemFailed(...)` and `markOutboxItemSucceeded(...)` require the current `leaseId`, so stale workers cannot mark a newer reclaimed lease as succeeded or failed.

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

`@wats/service` can now accept an injected `PersistenceStore`. The service does not read database environment variables directly.

When persistence is injected:

- signed webhook POSTs are recorded by event key/hash and duplicates are acknowledged without redispatch;
- service send routes honor `Idempotency-Key` for replay/conflict behavior;
- injected stores must expose the WATS-87 outbox methods as part of the accepted service persistence contract.

Current `@wats/cli` has no database navigation commands. WATS-123 will add thread/message navigation after service exposes persisted conversation/event-store APIs.

## Postgres target

Postgres remains a follow-up adapter target. It must satisfy the same root contract and keep database URLs secret. Default CI must not require Postgres credentials.

## Non-goals

- no Postgres adapter yet
- no CLI thread navigation yet
- no observed delivery/read status UI yet
- no raw webhook body storage by default
- no automatic service send enqueueing yet
- no production hosting guarantee
- no live Meta validation

## Related

- `docs/reference/config.md`
- `docs/reference/service.md`
- `docs/architecture/package-map.md`
- `docs/architecture/public-api-surface.md`
