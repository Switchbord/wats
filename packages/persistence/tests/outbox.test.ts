import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  PersistenceError,
  createSqlitePersistence,
  runOutboxWorkerOnce,
  type OutboxItem
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

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats87-outbox-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

function applyOriginalV1Migration(filename: string): void {
  const database = new Database(filename, { create: true });
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const statement of ORIGINAL_001_STATEMENTS) database.run(statement);
    database.run(
      "INSERT INTO wats_schema_migrations (id, version, checksum, applied_at) VALUES (?, ?, ?, ?)",
      "001_initial",
      1,
      ORIGINAL_001_CHECKSUM,
      "2026-05-24T00:00:00.000Z"
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

function hash(hex: string): string {
  return `sha256:${hex.repeat(64).slice(0, 64)}`;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("WATS-87 SQLite outbox records", () => {
  test("claims and fences outbox rows after upgrading an originally shipped v1 database", async () => {
    const filename = tempDb();
    applyOriginalV1Migration(filename);
    const store = await createSqlitePersistence({ filename });
    await store.migrate();
    try {
      await store.enqueueOutboxItem({
        id: "outbox-message-upgraded",
        payloadHash: hash("1"),
        createdAt: "2026-06-01T00:00:00.000Z"
      });

      const claimed = await store.claimOutboxItems({ now: "2026-06-01T00:00:00.000Z", limit: 10 });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.leaseId).toBe(1);

      await store.markOutboxItemSucceeded({
        id: "outbox-message-upgraded",
        leaseId: claimed[0]?.leaseId ?? 0,
        updatedAt: "2026-06-01T00:00:01.000Z"
      });
      await expect(store.claimOutboxItems({ now: "2026-06-01T00:05:00.000Z", limit: 10 })).resolves.toEqual([]);
    } finally {
      await store.close();
    }
  });

  test("enqueues each outbox item once and claims only due retries", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await expect(store.enqueueOutboxItem({
        id: "outbox-message-1",
        payloadHash: hash("a"),
        createdAt: "2026-06-01T00:00:00.000Z",
        nextAttemptAt: "2026-06-01T00:00:01.000Z"
      })).resolves.toBe("enqueued");

      await expect(store.enqueueOutboxItem({
        id: "outbox-message-1",
        payloadHash: hash("a"),
        createdAt: "2026-06-01T00:00:00.000Z"
      })).resolves.toBe("duplicate");

      await expect(store.claimOutboxItems({ now: "2026-06-01T00:00:00.500Z", limit: 10 })).resolves.toEqual([]);

      const first = await store.claimOutboxItems({ now: "2026-06-01T00:00:01.000Z", limit: 10 });
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        id: "outbox-message-1",
        status: "processing",
        attempts: 1,
        payloadHash: hash("a"),
        nextAttemptAt: null
      });

      await store.markOutboxItemFailed({
        id: "outbox-message-1",
        leaseId: first[0]?.leaseId ?? 0,
        nextAttemptAt: "2026-06-01T00:05:00.000Z",
        updatedAt: "2026-06-01T00:00:02.000Z"
      });

      await expect(store.claimOutboxItems({ now: "2026-06-01T00:04:59.999Z", limit: 10 })).resolves.toEqual([]);
      const retry = await store.claimOutboxItems({ now: "2026-06-01T00:05:00.000Z", limit: 10 });
      expect(retry).toHaveLength(1);
      expect(retry[0]?.attempts).toBe(2);

      await store.markOutboxItemSucceeded({
        id: "outbox-message-1",
        leaseId: retry[0]?.leaseId ?? 0,
        updatedAt: "2026-06-01T00:05:01.000Z"
      });
      await expect(store.claimOutboxItems({ now: "2026-06-01T00:10:00.000Z", limit: 10 })).resolves.toEqual([]);
    } finally {
      await store.close();
    }
  });

  test("reclaims stale processing items so a worker crash cannot strand outbox records", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.enqueueOutboxItem({
        id: "outbox-message-stale",
        payloadHash: hash("e"),
        createdAt: "2026-06-01T02:00:00.000Z"
      });

      const first = await store.claimOutboxItems({ now: "2026-06-01T02:00:00.000Z", limit: 10 });
      expect(first).toHaveLength(1);
      expect(first[0]?.attempts).toBe(1);
      expect(first[0]?.leaseId).toBe(1);

      await expect(store.claimOutboxItems({
        now: "2026-06-01T02:04:59.999Z",
        limit: 10
      })).resolves.toEqual([]);

      const reclaimed = await store.claimOutboxItems({
        now: "2026-06-01T02:05:00.000Z",
        limit: 10
      });
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]?.id).toBe("outbox-message-stale");
      expect(reclaimed[0]?.attempts).toBe(2);
      expect(reclaimed[0]?.leaseId).toBe(2);
    } finally {
      await store.close();
    }
  });

  test("rejects stale outbox completions after a reclaimed worker receives a newer lease", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.enqueueOutboxItem({
        id: "outbox-message-fenced",
        payloadHash: hash("f"),
        createdAt: "2026-06-01T03:00:00.000Z"
      });

      const workerA = await store.claimOutboxItems({ now: "2026-06-01T03:00:00.000Z", limit: 10 });
      expect(workerA).toHaveLength(1);
      expect(workerA[0]?.leaseId).toBe(1);

      const workerB = await store.claimOutboxItems({ now: "2026-06-01T03:05:00.000Z", limit: 10 });
      expect(workerB).toHaveLength(1);
      expect(workerB[0]?.leaseId).toBe(2);

      await expect(store.markOutboxItemSucceeded({
        id: "outbox-message-fenced",
        leaseId: workerA[0]?.leaseId ?? 0,
        updatedAt: "2026-06-01T03:05:01.000Z"
      })).rejects.toBeInstanceOf(PersistenceError);

      await expect(store.markOutboxItemFailed({
        id: "outbox-message-fenced",
        leaseId: workerA[0]?.leaseId ?? 0,
        nextAttemptAt: "2026-06-01T03:05:30.000Z",
        updatedAt: "2026-06-01T03:05:01.500Z"
      })).rejects.toBeInstanceOf(PersistenceError);

      await store.markOutboxItemFailed({
        id: "outbox-message-fenced",
        leaseId: workerB[0]?.leaseId ?? 0,
        nextAttemptAt: "2026-06-01T03:06:00.000Z",
        updatedAt: "2026-06-01T03:05:02.000Z"
      });

      await expect(store.claimOutboxItems({ now: "2026-06-01T03:05:59.999Z", limit: 10 })).resolves.toEqual([]);
      const retry = await store.claimOutboxItems({ now: "2026-06-01T03:06:00.000Z", limit: 10 });
      expect(retry).toHaveLength(1);
      expect(retry[0]?.leaseId).toBe(3);
    } finally {
      await store.close();
    }
  });

  test("rejects malformed outbox ids, hashes, timestamps, and claim limits with typed errors", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await expect(store.enqueueOutboxItem({
        id: "outbox\nmessage",
        payloadHash: hash("c"),
        createdAt: "2026-06-01T00:00:00.000Z"
      })).rejects.toBeInstanceOf(PersistenceError);
      await expect(store.enqueueOutboxItem({
        id: "outbox-message-bad-hash",
        payloadHash: "raw message text should not be stored",
        createdAt: "2026-06-01T00:00:00.000Z"
      })).rejects.toBeInstanceOf(PersistenceError);
      await expect(store.enqueueOutboxItem({
        id: "outbox-message-bad-time",
        payloadHash: hash("d"),
        createdAt: "2026-06-01"
      })).rejects.toBeInstanceOf(PersistenceError);
      await expect(store.claimOutboxItems({
        now: "2026-06-01T00:00:00.000Z",
        limit: 0
      })).rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await store.close();
    }
  });

  test("worker schedules retry without storing raw payloads or leaking handler errors", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.enqueueOutboxItem({
        id: "outbox-message-2",
        payloadHash: hash("b"),
        createdAt: "2026-06-01T01:00:00.000Z"
      });

      const seen: OutboxItem[] = [];
      const report = await runOutboxWorkerOnce(store, {
        now: "2026-06-01T01:00:00.000Z",
        limit: 5,
        retryDelayMs: 30_000,
        async handler(item) {
          seen.push(item);
          throw new Error("raw message text secret-token should not leak");
        }
      });

      expect(seen).toHaveLength(1);
      expect(report).toEqual({ processed: 1, succeeded: 0, failed: 1 });
      expect(JSON.stringify(report)).not.toContain("raw message text");
      expect(JSON.stringify(report)).not.toContain("secret-token");

      await expect(store.claimOutboxItems({ now: "2026-06-01T01:00:29.999Z", limit: 5 })).resolves.toEqual([]);
      const retry = await store.claimOutboxItems({ now: "2026-06-01T01:00:30.000Z", limit: 5 });
      expect(retry).toHaveLength(1);
      expect(retry[0]?.id).toBe("outbox-message-2");
    } finally {
      await store.close();
    }
  });
});
