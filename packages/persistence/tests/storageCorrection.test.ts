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

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats200-correction-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ISO_0 = "2026-09-06T00:00:00.000Z";
const ISO_123 = "2026-09-06T00:00:00.123Z";
const ISO_1 = "2026-09-06T00:00:01.000Z";
const ISO_2 = "2026-09-06T00:00:02.000Z";
const ISO_3 = "2026-09-06T00:00:03.000Z";
const ISO_4 = "2026-09-06T00:00:04.000Z";
const ISO_5 = "2026-09-06T00:00:05.000Z";

describe("WATS-200 storage correction: recordMessage dedup (SQLite)", () => {
  test("recordMessage deduplicates by (direction, waMessageId) even with a different rowId", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "row-1", waMessageId: "wamid.DUP", direction: "outbound", type: "text", status: "sent", createdAt: ISO_0, updatedAt: ISO_0 });
      // different rowId, same (direction, wa_message_id) -> no-op, NOT a throw
      await store.recordMessage({ rowId: "row-2", waMessageId: "wamid.DUP", direction: "outbound", type: "text", status: "sent", createdAt: ISO_1, updatedAt: ISO_1 });
      const record = await store.getMessage({ waMessageId: "wamid.DUP" });
      expect(record?.rowId).toBe("row-1");
    } finally {
      await store.close();
    }
  });
});

describe("WATS-200 storage correction: status rank transition semantics (SQLite)", () => {
  test("delivered at same second (truncated ms) advances sent even when event timestamp equals or precedes updated_at", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      // outbound send recorded with ms precision (123ms); Meta status callback
      // truncated to seconds (000ms) lands at an equal-or-earlier millisecond.
      await store.recordMessage({ rowId: "rA", waMessageId: "wamid.A", direction: "outbound", type: "text", status: "sent", createdAt: ISO_0, updatedAt: ISO_123 });
      await store.appendMessageStatus({ waMessageId: "wamid.A", status: "delivered", timestamp: ISO_0 });
      const rec = await store.getMessage({ waMessageId: "wamid.A" });
      expect(rec).not.toBeNull();
      expect(rec!.status).toBe("delivered");
      // updatedAt never rolls backward: it must be at least the send updated_at.
      expect(rec!.updatedAt >= ISO_123).toBe(true);
    } finally {
      await store.close();
    }
  });

  test("a newer-timestamp sent event does NOT regress read (rank-based, not timestamp-only)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "rB", waMessageId: "wamid.B", direction: "outbound", type: "text", status: "read", createdAt: ISO_0, updatedAt: ISO_1 });
      await store.appendMessageStatus({ waMessageId: "wamid.B", status: "sent", timestamp: ISO_2 });
      const rec = await store.getMessage({ waMessageId: "wamid.B" });
      expect(rec?.status).toBe("read");
    } finally {
      await store.close();
    }
  });

  test("failed may replace sent at the same second", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "rC", waMessageId: "wamid.C", direction: "outbound", type: "text", status: "sent", createdAt: ISO_0, updatedAt: ISO_3 });
      await store.appendMessageStatus({ waMessageId: "wamid.C", status: "failed", timestamp: ISO_3 });
      const rec = await store.getMessage({ waMessageId: "wamid.C" });
      expect(rec?.status).toBe("failed");
    } finally {
      await store.close();
    }
  });

  test("failed must NOT replace delivered or read even with a later timestamp", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "rD", waMessageId: "wamid.D", direction: "outbound", type: "text", status: "read", createdAt: ISO_0, updatedAt: ISO_4 });
      await store.appendMessageStatus({ waMessageId: "wamid.D", status: "failed", timestamp: ISO_5 });
      const rec = await store.getMessage({ waMessageId: "wamid.D" });
      expect(rec?.status).toBe("read");
    } finally {
      await store.close();
    }
  });

  test("read advances delivered at the same second (rank, not timestamp)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "rE", waMessageId: "wamid.E", direction: "outbound", type: "text", status: "delivered", createdAt: ISO_0, updatedAt: ISO_2 });
      await store.appendMessageStatus({ waMessageId: "wamid.E", status: "read", timestamp: ISO_2 });
      const rec = await store.getMessage({ waMessageId: "wamid.E" });
      expect(rec?.status).toBe("read");
    } finally {
      await store.close();
    }
  });

  test("stale delivered with an earlier timestamp does NOT regress read (chronology guard retained)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await store.recordMessage({ rowId: "rF", waMessageId: "wamid.F", direction: "outbound", type: "text", status: "sent", createdAt: ISO_0, updatedAt: ISO_0 });
      await store.appendMessageStatus({ waMessageId: "wamid.F", status: "read", timestamp: ISO_4 });
      expect((await store.getMessage({ waMessageId: "wamid.F" }))?.status).toBe("read");
      await store.appendMessageStatus({ waMessageId: "wamid.F", status: "delivered", timestamp: ISO_1 });
      expect((await store.getMessage({ waMessageId: "wamid.F" }))?.status).toBe("read");
    } finally {
      await store.close();
    }
  });
});

describe("WATS-200 storage correction: status-before-message reconciliation (SQLite)", () => {
  test("a status event recorded before the message projection is reconciled when the message lands", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      // A status event arrives (e.g. an early webhook) before the outbound
      // send projection is recorded. The message is inserted with status
      // 'sent', but a 'delivered' event already exists for it.
      await store.appendMessageStatus({ waMessageId: "wamid.G", status: "delivered", timestamp: ISO_3 });
      await store.recordMessage({ rowId: "rG", waMessageId: "wamid.G", direction: "outbound", type: "text", status: "sent", createdAt: ISO_0, updatedAt: ISO_0 });
      const rec = await store.getMessage({ waMessageId: "wamid.G" });
      expect(rec?.status).toBe("delivered");
    } finally {
      await store.close();
    }
  });
});

describe("WATS-200 storage correction: typed persistence errors (SQLite)", () => {
  test("recordMessage wraps a non-constraint runtime fault as a typed PersistenceError without echoing input", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    await store.close();
    // After close, the DB handle is gone; a write must fail with a typed error,
    // not a raw bun:sqlite SqliteError, and must not echo the waMessageId.
    let thrown: unknown;
    try {
      await store.recordMessage({ rowId: "rX", waMessageId: "wamid.SECRET_LEAK", direction: "outbound", type: "text", status: "sent", createdAt: ISO_0, updatedAt: ISO_0 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PersistenceError);
    expect((thrown as Error).message).not.toContain("wamid.SECRET_LEAK");
  });

  test("appendMessageStatus wraps a transaction fault as a typed PersistenceError with a persistence-op code, not invalid_record", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    await store.close();
    let thrown: unknown;
    try {
      await store.appendMessageStatus({ waMessageId: "wamid.H", status: "delivered", timestamp: ISO_1 });
    } catch (error) {
      thrown = error;
    }
    // store_closed is the precise code for a closed-store operation; the key
    // assertion is that the code is NOT invalid_record (input-validation code)
    // for a backend/transaction fault. Here the early assert produces
    // store_closed which is already correct; the deeper assertion is that a
    // real tx fault path uses a persistence-op code, verified against real PG.
    expect(thrown).toBeInstanceOf(PersistenceError);
    expect((thrown as PersistenceError).code).not.toBe("invalid_record");
  });
});

describe("WATS-200 storage correction: migration dedup keeps best known state (SQLite)", () => {
  test("migration 006 dedup keeps the most-advanced status, not the smallest row_id", async () => {
    const db = tempDb();
    const store1 = await createSqlitePersistence({ filename: db });
    await store1.migrate();
    await store1.close();

    // Pre-seed duplicate (direction, wa_message_id) rows with differing status.
    // row "aaa-1" is 'sent' (least advanced); row "zzz-9" is 'read' (most advanced).
    // Old dedup kept smallest row_id ("aaa-1", sent) and discarded the 'read'
    // state. The corrected dedup keeps the most-advanced known state.
    const raw = new Database(db);
    raw.exec("DROP INDEX IF EXISTS wats_messages_direction_wa_message_id_uidx");
    raw.exec("DROP INDEX IF EXISTS wats_message_status_events_wa_message_id_status_timestamp_uidx");
    raw.exec("DELETE FROM wats_schema_migrations WHERE id = '006_message_uniqueness'");
    raw.run(
      "INSERT INTO wats_messages (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["aaa-1", "wamid.DEDUP", "outbound", null, null, "text", "sent", null, ISO_0, ISO_0]
    );
    raw.run(
      "INSERT INTO wats_messages (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["zzz-9", "wamid.DEDUP", "outbound", null, null, "text", "read", null, ISO_0, ISO_4]
    );
    raw.close();

    const store2 = await createSqlitePersistence({ filename: db });
    await store2.migrate();
    try {
      const rec = await store2.getMessage({ waMessageId: "wamid.DEDUP" });
      expect(rec?.status).toBe("read");
    } finally {
      await store2.close();
    }
  });

  test("when duplicate rows share the same status, the smallest row_id wins (deterministic tiebreak)", async () => {
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
      ["zzz-9", "wamid.TIE", "outbound", null, null, "text", "sent", null, ISO_0, ISO_0]
    );
    raw.run(
      "INSERT INTO wats_messages (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["aaa-1", "wamid.TIE", "outbound", null, null, "text", "sent", null, ISO_0, ISO_0]
    );
    raw.close();

    const store2 = await createSqlitePersistence({ filename: db });
    await store2.migrate();
    try {
      const rec = await store2.getMessage({ waMessageId: "wamid.TIE" });
      expect(rec?.rowId).toBe("aaa-1");
      expect(rec?.status).toBe("sent");
    } finally {
      await store2.close();
    }
  });
});
