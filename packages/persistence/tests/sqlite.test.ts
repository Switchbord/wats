import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  createSqlitePersistence
} from "../src/index";

const tempDirs: string[] = [];
const ORIGINAL_001_CHECKSUM = "sha256:wats-persistence-001-initial-v1";
const ORIGINAL_001_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wats_schema_migrations (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wats_persistence_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    holder TEXT NOT NULL,
    acquired_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wats_webhook_events (
    event_key TEXT PRIMARY KEY,
    event_hash TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wats_service_requests (
    idempotency_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS wats_outbox (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_attempt_at TEXT,
    payload_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`
]);

function tempDb(name = "wats.sqlite"): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats120-"));
  tempDirs.push(dir);
  return join(dir, name);
}

function applyOriginalV1Migration(filename: string): void {
  const database = new Database(filename, { create: true });
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const statement of ORIGINAL_001_STATEMENTS) database.run(statement);
    database.run(
      "INSERT INTO wats_schema_migrations (id, version, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ["001_initial", 1, ORIGINAL_001_CHECKSUM, "2026-05-24T00:00:00.000Z"]
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

function outboxColumns(filename: string): string[] {
  const database = new Database(filename, { readonly: true });
  try {
    return database.query<{ name: string }, []>("PRAGMA table_info(wats_outbox)").all().map((column) => column.name);
  } finally {
    database.close();
  }
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("WATS-120 SQLite persistence", () => {
  test("migrates an empty SQLite file and reports idempotent current schema", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    try {
      const first = await store.migrate();
      expect(first.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(first.appliedMigrations.length).toBeGreaterThan(0);
      expect(first.alreadyCurrent).toBe(false);

      const second = await store.migrate();
      expect(second.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(second.appliedMigrations).toEqual([]);
      expect(second.alreadyCurrent).toBe(true);

      const health = await store.health();
      expect(health.ok).toBe(true);
      expect(health.backend).toBe("sqlite");
      expect(health.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(health.redactedLocation).toBe("[REDACTED_SQLITE_DATABASE]");
    } finally {
      await store.close();
    }
  });

  test("rejects unsafe sqlite filenames without echoing raw input", async () => {
    const unsafe = [
      "",
      "   ",
      "../wats.sqlite",
      "safe/../../wats.sqlite",
      "safe%2f..%2fwats.sqlite",
      "safe%252f..%252fwats.sqlite",
      "file:review.sqlite",
      "sqlite:review.sqlite",
      "postgres://user:***@example.test/db",
      "secret-token.sqlite",
      "line\nbreak.sqlite",
      42,
      null,
      undefined
    ];

    for (const filename of unsafe) {
      try {
        await createSqlitePersistence({ filename: filename as never });
        throw new Error("expected createSqlitePersistence to reject unsafe filename");
      } catch (error) {
        expect(error).toBeInstanceOf(PersistenceError);
        const message = error instanceof Error ? error.message : String(error);
        if (typeof filename === "string" && filename.length > 0) {
          expect(message).not.toContain(filename);
        }
        expect(message).not.toContain("postgres://");
        expect(message).not.toContain("secret-token");
      }
    }
  });

  test("detects migration checksum drift for already-applied migrations", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    try {
      await store.migrate();
      const tampered = store as unknown as {
        __unsafeTamperMigrationChecksumForTesting(id: string, checksum: string): void;
      };
      tampered.__unsafeTamperMigrationChecksumForTesting("001_initial", "sha256:tampered");
      try {
        await store.migrate();
        throw new Error("expected checksum drift to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(PersistenceError);
        expect((error as PersistenceError).code).toBe("migration_checksum_mismatch");
      }
    } finally {
      await store.close();
    }
  });

  test("keeps migration 001 compatible with the originally shipped v1 checksum", async () => {
    const filename = tempDb();
    applyOriginalV1Migration(filename);
    const store = await createSqlitePersistence({ filename });
    try {
      const report = await store.migrate();
      expect(report.currentVersion).toBe(3);
      expect(report.appliedMigrations).toEqual(["002_outbox_lease_id", "003_message_projection"]);
      expect(report.alreadyCurrent).toBe(false);
      expect(outboxColumns(filename)).toContain("lease_id");
      const health = await store.health();
      expect(health.currentVersion).toBe(3);
    } finally {
      await store.close();
    }
  });

  test("pins migration 001 checksum and table shape", async () => {
    const filename = tempDb();
    const store = await createSqlitePersistence({ filename });
    try {
      const report = await store.migrate();
      expect(report.currentVersion).toBe(3);
      expect(report.appliedMigrations).toEqual(["001_initial", "002_outbox_lease_id", "003_message_projection"]);
      const database = new Database(filename, { readonly: true });
      try {
        const first = database.query<{ checksum: string; version: number }, [string]>(
          "SELECT version, checksum FROM wats_schema_migrations WHERE id = ?"
        ).get("001_initial");
        expect(first).toEqual({ version: 1, checksum: ORIGINAL_001_CHECKSUM });
      } finally {
        database.close();
      }
    } finally {
      await store.close();
    }
  });

  test("held migration locks fail closed with a typed migration_lock_failed error", async () => {
    const filename = tempDb();
    const database = new Database(filename, { create: true });
    const heldLock = "held_lock";
    database.run(`CREATE TABLE IF NOT EXISTS wats_persistence_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      holder TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    )`);
    database.run(
      "INSERT INTO wats_persistence_lock (id, holder, acquired_at) VALUES (?, ?, ?)",
      [1, heldLock, "2026-06-01T00:00:00.000Z"]
    );
    database.close();

    const store = await createSqlitePersistence({ filename });
    try {
      try {
        await store.migrate();
        throw new Error("expected held migration lock to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(PersistenceError);
        expect((error as PersistenceError).code).toBe("migration_lock_failed");
        expect(error instanceof Error ? error.message : String(error)).toContain("SQLite migration lock is already held.");
      }
    } finally {
      await store.close();
    }

    const afterFailure = await createSqlitePersistence({ filename });
    try {
      const lockRow = new Database(filename, { readonly: true })
        .query<{ holder: string }, []>("SELECT holder FROM wats_persistence_lock WHERE id = 1")
        .get();
      expect(lockRow?.holder).toBe(heldLock);
    } finally {
      await afterFailure.close();
    }
  });

  test("closed stores fail with typed store_closed errors", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.close();
    try {
      await store.health();
      throw new Error("expected closed store health to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceError);
      expect((error as PersistenceError).code).toBe("store_closed");
    }
  });

  test("does not leak raw database locations or secret-like payloads in diagnostics", async () => {
    const filename = tempDb("wats-redaction.sqlite");
    const store = await createSqlitePersistence({ filename });
    try {
      await store.migrate();
      const health = await store.health();
      const serialized = JSON.stringify(health);
      expect(serialized).toContain("[REDACTED_SQLITE_DATABASE]");
      expect(serialized).not.toContain(filename);
      expect(serialized).not.toContain("wats-redaction.sqlite");
    } finally {
      await store.close();
    }
  });
});
