import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  PersistenceError,
  createSqlitePersistence,
  runOutboxWorkerOnce,
  type OutboxItem
} from "../src/index";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats87-outbox-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

function hash(hex: string): string {
  return `sha256:${hex.repeat(64).slice(0, 64)}`;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("WATS-87 SQLite outbox records", () => {
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
        nextAttemptAt: "2026-06-01T00:05:00.000Z",
        updatedAt: "2026-06-01T00:00:02.000Z"
      });

      await expect(store.claimOutboxItems({ now: "2026-06-01T00:04:59.999Z", limit: 10 })).resolves.toEqual([]);
      const retry = await store.claimOutboxItems({ now: "2026-06-01T00:05:00.000Z", limit: 10 });
      expect(retry).toHaveLength(1);
      expect(retry[0]?.attempts).toBe(2);

      await store.markOutboxItemSucceeded({ id: "outbox-message-1", updatedAt: "2026-06-01T00:05:01.000Z" });
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
