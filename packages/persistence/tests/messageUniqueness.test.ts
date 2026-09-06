import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createSqlitePersistence } from "../src/index";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats200-msguniq-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ISO_A = "2026-09-06T00:00:00.000Z";
const ISO_B = "2026-09-06T00:00:01.000Z";
const ISO_C = "2026-09-06T00:00:02.000Z";

describe("WATS-200 message uniqueness", () => {
  test("recordMessage deduplicates by (direction, waMessageId) even with a different rowId", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "row-1", waMessageId: "wamid.DUP", direction: "outbound", type: "text", status: "sent", createdAt: ISO_A, updatedAt: ISO_A });
      await store.recordMessage({ rowId: "row-2", waMessageId: "wamid.DUP", direction: "outbound", type: "text", status: "sent", createdAt: ISO_B, updatedAt: ISO_B });
      const record = await store.getMessage({ waMessageId: "wamid.DUP" });
      expect(record?.rowId).toBe("row-1");
    } finally {
      await store.close();
    }
  });

  test("same waMessageId with different direction is allowed (inbound vs outbound)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "row-out", waMessageId: "wamid.SAME", direction: "outbound", type: "text", status: "sent", createdAt: ISO_A, updatedAt: ISO_A });
      await store.recordMessage({ rowId: "row-in", waMessageId: "wamid.SAME", direction: "inbound", type: "text", status: "received", createdAt: ISO_B, updatedAt: ISO_B });
      const list = await store.listMessages({ limit: 100 });
      const same = list.items.filter((r) => r.waMessageId === "wamid.SAME");
      expect(same.length).toBe(2);
    } finally {
      await store.close();
    }
  });
});

describe("WATS-200 status event dedup and monotonicity", () => {
  test("duplicate status event (same waMessageId+status+timestamp) does not create a duplicate row", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "row-s", waMessageId: "wamid.S", direction: "outbound", type: "text", status: "sent", createdAt: ISO_A, updatedAt: ISO_A });
      await store.appendMessageStatus({ waMessageId: "wamid.S", status: "delivered", timestamp: ISO_B });
      await store.appendMessageStatus({ waMessageId: "wamid.S", status: "delivered", timestamp: ISO_B });
      const record = await store.getMessage({ waMessageId: "wamid.S" });
      expect(record?.status).toBe("delivered");
    } finally {
      await store.close();
    }
  });

  test("status monotonicity: a stale event with an earlier timestamp does not regress the message status", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "row-m", waMessageId: "wamid.M", direction: "outbound", type: "text", status: "sent", createdAt: ISO_A, updatedAt: ISO_A });
      await store.appendMessageStatus({ waMessageId: "wamid.M", status: "read", timestamp: ISO_C });
      expect((await store.getMessage({ waMessageId: "wamid.M" }))?.status).toBe("read");
      await store.appendMessageStatus({ waMessageId: "wamid.M", status: "delivered", timestamp: ISO_B });
      expect((await store.getMessage({ waMessageId: "wamid.M" }))?.status).toBe("read");
    } finally {
      await store.close();
    }
  });

  test("a newer status event with a later timestamp does advance the message status", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "row-adv", waMessageId: "wamid.ADV", direction: "outbound", type: "text", status: "sent", createdAt: ISO_A, updatedAt: ISO_A });
      await store.appendMessageStatus({ waMessageId: "wamid.ADV", status: "delivered", timestamp: ISO_B });
      expect((await store.getMessage({ waMessageId: "wamid.ADV" }))?.status).toBe("delivered");
      await store.appendMessageStatus({ waMessageId: "wamid.ADV", status: "read", timestamp: ISO_C });
      expect((await store.getMessage({ waMessageId: "wamid.ADV" }))?.status).toBe("read");
    } finally {
      await store.close();
    }
  });
});

describe("WATS-200 migration dedup of preexisting duplicates", () => {
  test("migration deterministically deduplicates preexisting duplicate messages", async () => {
    const db = tempDb();
    const store1 = await createSqlitePersistence({ filename: db });
    await store1.migrate();
    await store1.close();

    const raw = new Database(db);
    raw.exec("DROP INDEX IF EXISTS wats_messages_direction_wa_message_id_uidx");
    raw.exec("DROP INDEX IF EXISTS wats_message_status_events_wa_message_id_status_timestamp_uidx");
    raw.exec("DELETE FROM wats_schema_migrations WHERE id = '006_message_uniqueness'");
    raw.run(
      "INSERT INTO wats_messages (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "dup-1", "wamid.PRE", "outbound", null, null, "text", "sent", null, ISO_A, ISO_A
    );
    raw.run(
      "INSERT INTO wats_messages (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "dup-2", "wamid.PRE", "outbound", null, null, "text", "sent", null, ISO_B, ISO_B
    );
    raw.run(
      "INSERT INTO wats_message_status_events (wa_message_id, status, timestamp) VALUES (?, ?, ?)",
      "wamid.PRE", "sent", ISO_A
    );
    raw.run(
      "INSERT INTO wats_message_status_events (wa_message_id, status, timestamp) VALUES (?, ?, ?)",
      "wamid.PRE", "sent", ISO_A
    );
    raw.close();

    const store2 = await createSqlitePersistence({ filename: db });
    await store2.migrate();
    try {
      const list = await store2.listMessages({ limit: 100 });
      const preRows = list.items.filter((r) => r.waMessageId === "wamid.PRE");
      expect(preRows.length).toBe(1);
      expect(preRows[0]?.rowId).toBe("dup-1");
    } finally {
      await store2.close();
    }
  });
});
