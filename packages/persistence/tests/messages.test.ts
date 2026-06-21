import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  createSqlitePersistence
} from "../src/index";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats122-messages-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ISO_A = "2026-06-21T00:00:00.000Z";
const ISO_B = "2026-06-21T00:00:01.000Z";

describe("WATS-122 message projection", () => {
  test("migrates to schema version 3 with the message projection tables", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    try {
      const report = await store.migrate();
      expect(report.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(report.currentVersion).toBe(3);
      expect(report.appliedMigrations).toContain("003_message_projection");
      const health = await store.health();
      expect(health.currentVersion).toBe(3);
    } finally {
      await store.close();
    }
  });

  test("recordMessage then getMessage returns the record with camelCase fields", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({
        rowId: "row-1",
        waMessageId: "wamid.ONE",
        direction: "outbound",
        toPhone: "15550001111",
        type: "text",
        status: "sent",
        graphMessageId: "wamid.ONE",
        createdAt: ISO_A,
        updatedAt: ISO_A
      });
      const record = await store.getMessage({ waMessageId: "wamid.ONE" });
      expect(record).not.toBeNull();
      expect(record).toEqual({
        rowId: "row-1",
        waMessageId: "wamid.ONE",
        direction: "outbound",
        fromPhone: null,
        toPhone: "15550001111",
        type: "text",
        status: "sent",
        graphMessageId: "wamid.ONE",
        createdAt: ISO_A,
        updatedAt: ISO_A
      });
    } finally {
      await store.close();
    }
  });

  test("duplicate recordMessage with the same rowId is idempotent and does not throw", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({
        rowId: "row-dup",
        waMessageId: "wamid.DUP",
        direction: "outbound",
        type: "text",
        status: "sent",
        createdAt: ISO_A,
        updatedAt: ISO_A
      });
      await expect(store.recordMessage({
        rowId: "row-dup",
        waMessageId: "wamid.DUP",
        direction: "outbound",
        type: "text",
        status: "sent",
        createdAt: ISO_A,
        updatedAt: ISO_A
      })).resolves.toBeUndefined();
      const record = await store.getMessage({ waMessageId: "wamid.DUP" });
      expect(record?.rowId).toBe("row-dup");
    } finally {
      await store.close();
    }
  });

  test("appendMessageStatus inserts an event and updates the message status", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({
        rowId: "row-status",
        waMessageId: "wamid.STATUS",
        direction: "outbound",
        type: "text",
        status: "sent",
        createdAt: ISO_A,
        updatedAt: ISO_A
      });
      await store.appendMessageStatus({ waMessageId: "wamid.STATUS", status: "delivered", timestamp: ISO_B });
      const record = await store.getMessage({ waMessageId: "wamid.STATUS" });
      expect(record?.status).toBe("delivered");
      expect(record?.updatedAt).toBe(ISO_B);
    } finally {
      await store.close();
    }
  });

  test("listMessages returns newest-first, respects limit, and honors the cursor", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      for (let i = 0; i < 5; i += 1) {
        const ts = `2026-06-21T00:00:0${i}.000Z`;
        await store.recordMessage({
          rowId: `row-${i}`,
          waMessageId: `wamid.${i}`,
          direction: "outbound",
          type: "text",
          status: "sent",
          createdAt: ts,
          updatedAt: ts
        });
      }
      const first = await store.listMessages({ limit: 2 });
      expect(first.items.length).toBe(2);
      expect(first.items[0]!.rowId).toBe("row-4");
      expect(first.items[1]!.rowId).toBe("row-3");
      expect(first.nextCursor).toBe("row-3");

      const second = await store.listMessages({ limit: 2, beforeRowId: first.nextCursor! });
      expect(second.items.length).toBe(2);
      expect(second.items[0]!.rowId).toBe("row-2");
      expect(second.items[1]!.rowId).toBe("row-1");
      expect(second.nextCursor).toBe("row-1");

      const third = await store.listMessages({ limit: 2, beforeRowId: second.nextCursor! });
      expect(third.items.length).toBe(1);
      expect(third.items[0]!.rowId).toBe("row-0");
      expect(third.nextCursor).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("listMessages returns null nextCursor when fewer than limit remain", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({
        rowId: "solo",
        waMessageId: "wamid.SOLO",
        direction: "outbound",
        type: "text",
        status: "sent",
        createdAt: ISO_A,
        updatedAt: ISO_A
      });
      const result = await store.listMessages({ limit: 50 });
      expect(result.items.length).toBe(1);
      expect(result.nextCursor).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("getMessage for an unknown waMessageId returns null", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const record = await store.getMessage({ waMessageId: "wamid.MISSING" });
      expect(record).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("malformed inputs throw PersistenceError", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await expect(store.recordMessage({
        rowId: "",
        waMessageId: "wamid.BAD",
        direction: "outbound",
        type: "text",
        status: "sent",
        createdAt: ISO_A,
        updatedAt: ISO_A
      })).rejects.toBeInstanceOf(PersistenceError);

      await expect(store.recordMessage({
        rowId: "row-bad-dir",
        waMessageId: "wamid.BAD",
        direction: "sideways" as never,
        type: "text",
        status: "sent",
        createdAt: ISO_A,
        updatedAt: ISO_A
      })).rejects.toBeInstanceOf(PersistenceError);

      await expect(store.recordMessage({
        rowId: "row-bad-ts",
        waMessageId: "wamid.BAD",
        direction: "outbound",
        type: "text",
        status: "sent",
        createdAt: "not-a-timestamp",
        updatedAt: ISO_A
      })).rejects.toBeInstanceOf(PersistenceError);

      await expect(store.recordMessage({
        rowId: "row-control",
        waMessageId: "wamid.BAD",
        direction: "outbound",
        type: "text",
        status: "sent",
        createdAt: ISO_A,
        updatedAt: ISO_A,
        toPhone: "bad\nphone"
      })).rejects.toBeInstanceOf(PersistenceError);

      await expect(store.listMessages({ limit: 0 })).rejects.toBeInstanceOf(PersistenceError);
      await expect(store.listMessages({ limit: 101 })).rejects.toBeInstanceOf(PersistenceError);
      await expect(store.listMessages({ limit: 1.5 })).rejects.toBeInstanceOf(PersistenceError);

      await expect(store.appendMessageStatus({
        waMessageId: "",
        status: "delivered",
        timestamp: ISO_A
      })).rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await store.close();
    }
  });
});
