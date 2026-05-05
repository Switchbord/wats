# WATS-48 Persistence Contract Design

- status: design
- applies-to: WATS-48
- lastReviewed: 2026-05-01
- owner: Linear roadmap; Linear remains the source of truth for issue-level scope and deferrals

## Purpose

WATS-48 defines the persistence contract for future WATS runtime operations. It is design/docs/test-planner only: no package export, adapter, schema migration runner, config field, service integration, or CLI behavior is implemented in this slice.

ADR-007 keeps persistence in the WATS monorepo. There is no second repository for runtime persistence, SQLite/Postgres adapters, migrations, config templates, or operator docs during alpha.

## Scope ledger

Included:

- future `@switchbord/persistence` package boundary
- `PersistenceStore`, `PersistenceAdapter`, and `PersistenceTransaction` design target
- SQLite local/dev default target
- Postgres optional deploy/production target
- schemaVersion and migrate contract
- transaction contract
- webhook event idempotency and service request idempotency
- migration safety and redacted diagnostics
- CLI doctor/serve integration expectations for later WATS-47 implementation slices

Not included:

- no `@switchbord/persistence` package export
- no SQLite adapter
- no Postgres adapter
- no migration runner
- no config persistence schema
- no service persistence integration
- no Docker/deploy packaging
- no live Meta calls
- no raw webhook payload persistence by default
- no second repository

## Design goals

1. Preserve the WATS no-live default: persistence work must not call Meta.
2. Keep `@switchbord/service` runtime-neutral: callers inject persistence instead of letting the service read database environment variables.
3. Make SQLite the boring local/dev default once implemented.
4. Make Postgres optional for deploy/production and multi-process service operation once implemented.
5. Keep raw secrets out of diagnostics and storage.
6. Store enough runtime state for idempotency and safe recovery without turning WATS into an analytics warehouse.

## Future package boundary

The future package should be public only after behavior and consumer fixtures exist:

```text
@switchbord/persistence
@switchbord/persistence/sqlite
@switchbord/persistence/postgres
@switchbord/persistence/testing
```

The base package owns portable interfaces, errors, migration descriptors, redaction helpers, and contract tests. Runtime adapters live behind subpaths so SQLite and Postgres dependencies do not leak into every consumer.

Dependency direction:

- `@switchbord/persistence` may depend on `@switchbord/types` and shared internal utility helpers.
- `@switchbord/service` may later accept a `PersistenceStore` through explicit injection.
- `@switchbord/cli` may later compose config, service, and persistence for doctor/serve/migration commands.
- `@switchbord/config` validates persistence config shape only after a schema field is intentionally added.
- `@switchbord/persistence` must not depend on `@switchbord/cli`.

## Core contract concepts

Design target:

```ts
export interface PersistenceStore {
  readonly adapter: PersistenceAdapter;
  readonly schemaVersion: number;
  health(): Promise<PersistenceHealth>;
  migrate(options?: MigrationOptions): Promise<MigrationReport>;
  transaction<T>(fn: (tx: PersistenceTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface PersistenceAdapter {
  readonly dialect: "sqlite" | "postgres";
  readonly capabilities: PersistenceCapabilities;
}

export interface PersistenceTransaction {
  readonly migrations: MigrationStore;
  readonly webhookEvents: WebhookEventLedger;
  readonly serviceIdempotency: ServiceIdempotencyStore;
}
```

The exact TypeScript names may change during implementation, but the conceptual boundary should remain: a store manages lifecycle, an adapter owns dialect behavior, and a transaction scopes idempotency/migration writes.

## State buckets

### Schema/migration metadata

A migration ledger records applied versions, names, checksums, applied time, and execution duration. Unsupported schema versions fail closed.

Required behavior:

- idempotent `migrate`
- forward-only migrations for alpha
- transaction-wrapped migration execution when the dialect supports it
- migration lock to prevent two migrators from applying the same version concurrently
- destructive SQL requires explicit reviewed release notes before implementation

### Webhook event idempotency

Webhook event idempotency protects inbound processing from duplicate Meta deliveries and retry storms.

Target storage fields:

- storage scope/profile
- provider event key
- update kind
- payload hash
- received time
- processing status
- attempt count
- safe last error code

The default contract stores hashes and safe metadata. It does not store `rawChange` or raw webhook envelopes by default because those payloads can contain message text, phone numbers, contacts, media metadata, and other PII.

### Service request idempotency

Service request idempotency protects authenticated local API calls, such as future message-send routes with an `Idempotency-Key`.

Target behavior:

- same scope/key plus same request hash can replay a stored response
- same scope/key plus different request hash returns conflict
- missing idempotency key keeps current synchronous behavior
- in-flight requests have deterministic pending/conflict behavior

### Outbox is not in WATS-48

A full durable outbox worker is a likely future package/service feature, but WATS-48 design does not implement a job queue, retry scheduler, or worker. The idempotency schema must not claim exactly-once Graph delivery. If an outbox is added later, it must be documented as at-least-once.

## Adapter targets

### SQLite

SQLite is the local/dev default target.

Target behavior:

- file-backed local operation for single-process service
- WAL mode and busy timeout when implemented
- foreign keys enabled
- short transactions
- deterministic local tests with temporary files
- clear warning that SQLite is not the multi-replica production recommendation

### Postgres

Postgres is the optional deploy/production target.

Target behavior:

- one contract suite shared with SQLite
- database URL resolved through env-secret references, never raw CLI arguments
- connection strings treated as secrets
- migration lock via advisory/table locking
- env-gated integration tests skipped by default until credentials are explicitly supplied

## Redaction and data-safety policy

No secrets in persistence diagnostics.

The shorthand rule is: no secrets in persistence diagnostics.

- Meta access tokens
- app secrets
- webhook verify tokens
- service bearer tokens
- authorization headers
- database URLs such as `WATS_DATABASE_URL`
- raw webhook payloads
- raw message bodies or contact payloads

All CLI/service/doctor/migration output must pass through a redactor before reaching stdout, stderr, JSON output, or logs. Database driver errors can include connection URLs; those errors must be wrapped and redacted before being exposed.

## Config shape target

No config schema is added in WATS-48. A future config shape may look like:

```yaml
persistence:
  driver: sqlite
  migrate: auto
  retentionDays: 30
  sqlite:
    path: .wats/wats.sqlite
    busyTimeoutMs: 5000
    wal: true
```

Postgres remains env-secret-ref based:

```yaml
persistence:
  driver: postgres
  migrate: validate
  postgres:
    url:
      env: WATS_DATABASE_URL
```

Raw database credentials must not be committed, printed, or passed as CLI arguments.

## CLI and service integration target

Future `wats doctor` persistence checks:

- validate persistence config shape
- report selected driver safely
- report migration mode
- avoid creating SQLite files by default
- avoid resolving DB URL values by default
- check env presence only with an explicit flag

Future `wats serve` persistence behavior:

- dry-run uses memory or temporary storage
- SQLite opens the configured local path only after explicit service startup
- Postgres resolves DB URL env refs only when the live/env-resolution gate allows it
- readiness reflects persistence health when persistence is required
- shutdown closes the store

The current WATS-48 design does not implement these hooks.

## Test plan

Design/docs lock:

- `packages/testing/tests/wats48-persistence-contract-docs.test.ts`
- public docs manifest includes this architecture doc and the persistence reference
- docs check/build remain credential-free

Future behavior tests:

- storage contract tests shared across adapters
- migration/adversarial tests
- SQLite adapter contract tests
- Postgres adapter contract tests
- redaction tests for database URLs and raw webhook payloads
- idempotency conflict/replay tests
- transaction rollback tests
- consumer fixture importing through `@switchbord/persistence`

Every future adapter must pass the same contract suite before docs can describe it as implemented.
