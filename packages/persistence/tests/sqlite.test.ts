import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  createSqlitePersistence
} from "../src/index";

const tempDirs: string[] = [];

function tempDb(name = "wats.sqlite"): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats120-"));
  tempDirs.push(dir);
  return join(dir, name);
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
      1,
      heldLock,
      "2026-06-01T00:00:00.000Z"
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
        .query<{ holder: string }>("SELECT holder FROM wats_persistence_lock WHERE id = 1")
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
