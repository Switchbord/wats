import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
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
    const store = createSqlitePersistence({ filename: tempDb() });
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

  test("rejects unsafe sqlite filenames without echoing raw input", () => {
    const unsafe = [
      "",
      "   ",
      "../wats.sqlite",
      "safe/../../wats.sqlite",
      "postgres://user:pass@example.test/db",
      "secret-token.sqlite",
      "line\nbreak.sqlite",
      42,
      null,
      undefined
    ];

    for (const filename of unsafe) {
      expect(() => createSqlitePersistence({ filename: filename as never })).toThrow(PersistenceError);
      try {
        createSqlitePersistence({ filename: filename as never });
      } catch (error) {
        expect(error).toBeInstanceOf(PersistenceError);
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(String(filename));
        expect(message).not.toContain("postgres://");
        expect(message).not.toContain("secret-token");
      }
    }
  });

  test("detects migration checksum drift for already-applied migrations", async () => {
    const store = createSqlitePersistence({ filename: tempDb() });
    try {
      await store.migrate();
      const tampered = store as unknown as {
        __unsafeTamperMigrationChecksumForTesting(id: string, checksum: string): void;
      };
      tampered.__unsafeTamperMigrationChecksumForTesting("001_initial", "sha256:tampered");
      await expect(store.migrate()).rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await store.close();
    }
  });

  test("does not leak raw database locations or secret-like payloads in diagnostics", async () => {
    const filename = tempDb("token-access-secret-message-body.sqlite");
    const store = createSqlitePersistence({ filename });
    try {
      await store.migrate();
      const health = await store.health();
      const serialized = JSON.stringify(health);
      expect(serialized).toContain("[REDACTED_SQLITE_DATABASE]");
      expect(serialized).not.toContain(filename);
      expect(serialized).not.toContain("token-access-secret-message-body");
    } finally {
      await store.close();
    }
  });
});
