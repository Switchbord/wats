import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  PersistenceError,
  canSendFreeForm,
  createSqlitePersistence,
  getConversationWindowState,
  type ConversationWindowState,
  type PersistenceStore
} from "../src/index";
import {
  createPostgresPersistenceWithClient,
  type PostgresClientLike,
  type PostgresQueryResult
} from "../src/postgres";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats175b-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = "2026-07-05T12:00:00.000Z";
const PHONE = "15550001111";
const OTHER_PHONE = "15550002222";

interface InboundSeed {
  readonly rowId: string;
  readonly waMessageId: string;
  readonly fromPhone?: string;
  readonly createdAt: string;
  readonly direction?: "inbound" | "outbound";
  readonly toPhone?: string;
}

async function seedInbound(store: PersistenceStore, rows: readonly InboundSeed[]): Promise<void> {
  for (const row of rows) {
    await store.recordMessage({
      rowId: row.rowId,
      waMessageId: row.waMessageId,
      direction: row.direction ?? "inbound",
      fromPhone: row.fromPhone ?? PHONE,
      toPhone: row.toPhone,
      type: "text",
      status: "received",
      createdAt: row.createdAt,
      updatedAt: row.createdAt
    });
  }
}

function isoMinus(ms: number): string {
  return new Date(new Date(NOW).getTime() - ms).toISOString();
}

// ---- SQLite (real in-memory-backed file store) ----

describe("WATS-175b conversation window — SQLite", () => {
  test("no inbound history: closed, null, zero remaining", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state).toEqual({
        open: false,
        lastInboundAt: null,
        expiresAt: null,
        remainingMs: 0
      });
      expect(await canSendFreeForm(store, { phone: PHONE, now: NOW })).toBe(false);
    } finally {
      await store.close();
    }
  });

  test("inbound just now: open with ~full remaining", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await seedInbound(store, [{ rowId: "r1", waMessageId: "wamid.1", createdAt: NOW }]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.open).toBe(true);
      expect(state.lastInboundAt).toBe(NOW);
      expect(state.remainingMs).toBe(DAY_MS);
      expect(state.expiresAt).toBe(new Date(new Date(NOW).getTime() + DAY_MS).toISOString());
      expect(await canSendFreeForm(store, { phone: PHONE, now: NOW })).toBe(true);
    } finally {
      await store.close();
    }
  });

  test("inbound 23h59m ago: open with small remaining", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const elapsed = DAY_MS - 60_000; // 1 minute short of 24h
      const lastInboundAt = isoMinus(elapsed);
      await seedInbound(store, [{ rowId: "r1", waMessageId: "wamid.1", createdAt: lastInboundAt }]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.open).toBe(true);
      expect(state.lastInboundAt).toBe(lastInboundAt);
      expect(state.remainingMs).toBe(60_000);
    } finally {
      await store.close();
    }
  });

  test("inbound exactly 24h ago: closed (boundary is strictly less than windowMs)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const lastInboundAt = isoMinus(DAY_MS);
      await seedInbound(store, [{ rowId: "r1", waMessageId: "wamid.1", createdAt: lastInboundAt }]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.open).toBe(false);
      expect(state.remainingMs).toBe(0);
      expect(state.lastInboundAt).toBe(lastInboundAt);
      expect(state.expiresAt).toBe(new Date(new Date(lastInboundAt).getTime() + DAY_MS).toISOString());
      expect(await canSendFreeForm(store, { phone: PHONE, now: NOW })).toBe(false);
    } finally {
      await store.close();
    }
  });

  test("inbound 25h ago: closed", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const lastInboundAt = isoMinus(DAY_MS + 60 * 60 * 1000);
      await seedInbound(store, [{ rowId: "r1", waMessageId: "wamid.1", createdAt: lastInboundAt }]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.open).toBe(false);
      expect(state.remainingMs).toBe(0);
    } finally {
      await store.close();
    }
  });

  test("future-dated inbound (clock skew): treated as open with full remaining", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const future = new Date(new Date(NOW).getTime() + 5 * 60 * 1000).toISOString();
      await seedInbound(store, [{ rowId: "r1", waMessageId: "wamid.1", createdAt: future }]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.open).toBe(true);
      expect(state.lastInboundAt).toBe(future);
      expect(state.remainingMs).toBe(DAY_MS);
      expect(await canSendFreeForm(store, { phone: PHONE, now: NOW })).toBe(true);
    } finally {
      await store.close();
    }
  });

  test("multiple inbound rows: picks the latest createdAt", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await seedInbound(store, [
        { rowId: "old", waMessageId: "wamid.old", createdAt: isoMinus(DAY_MS - 60_000) },
        { rowId: "new", waMessageId: "wamid.new", createdAt: isoMinus(60_000) },
        { rowId: "mid", waMessageId: "wamid.mid", createdAt: isoMinus(120_000) }
      ]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.lastInboundAt).toBe(isoMinus(60_000));
      expect(state.open).toBe(true);
    } finally {
      await store.close();
    }
  });

  test("outbound rows are ignored", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await seedInbound(store, [
        { rowId: "out1", waMessageId: "wamid.out1", createdAt: isoMinus(60_000), direction: "outbound", toPhone: PHONE, fromPhone: undefined }
      ]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.open).toBe(false);
      expect(state.lastInboundAt).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("rows from other phones are ignored", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await seedInbound(store, [{ rowId: "other", waMessageId: "wamid.other", fromPhone: OTHER_PHONE, createdAt: isoMinus(60_000) }]);
      const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
      expect(state.open).toBe(false);
      expect(state.lastInboundAt).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("getLatestInboundMessageAt returns the createdAt directly", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await seedInbound(store, [
        { rowId: "a", waMessageId: "wamid.a", createdAt: isoMinus(3 * 60 * 1000) },
        { rowId: "b", waMessageId: "wamid.b", createdAt: isoMinus(60_000) }
      ]);
      const latest = await store.getLatestInboundMessageAt({ phone: PHONE });
      expect(latest).toBe(isoMinus(60_000));
      const missing = await store.getLatestInboundMessageAt({ phone: OTHER_PHONE });
      expect(missing).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("custom windowMs shifts the boundary", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const lastInboundAt = isoMinus(2 * 60 * 60 * 1000); // 2h ago
      await seedInbound(store, [{ rowId: "r1", waMessageId: "wamid.1", createdAt: lastInboundAt }]);
      const oneHourWindow = await getConversationWindowState(store, { phone: PHONE, now: NOW, windowMs: 60 * 60 * 1000 });
      expect(oneHourWindow.open).toBe(false);
      const threeHourWindow = await getConversationWindowState(store, { phone: PHONE, now: NOW, windowMs: 3 * 60 * 60 * 1000 });
      expect(threeHourWindow.open).toBe(true);
      expect(threeHourWindow.remainingMs).toBe(60 * 60 * 1000);
    } finally {
      await store.close();
    }
  });

  test("validation rejects bad phone / now / windowMs", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await expect(getConversationWindowState(store, { phone: "", now: NOW })).rejects.toBeInstanceOf(PersistenceError);
      await expect(getConversationWindowState(store, { phone: PHONE, now: "not-a-timestamp" })).rejects.toBeInstanceOf(PersistenceError);
      await expect(getConversationWindowState(store, { phone: PHONE, now: NOW, windowMs: 0 })).rejects.toBeInstanceOf(PersistenceError);
      await expect(getConversationWindowState(store, { phone: PHONE, now: NOW, windowMs: 1.5 })).rejects.toBeInstanceOf(PersistenceError);
      await expect(getConversationWindowState(store, { phone: PHONE, now: NOW, windowMs: 7 * 24 * 60 * 60 * 1000 + 1 })).rejects.toBeInstanceOf(PersistenceError);
      await expect(getConversationWindowState(store, { phone: `bad\nphone`, now: NOW })).rejects.toBeInstanceOf(PersistenceError);
      // non-object input
      await expect(getConversationWindowState(store, null as never)).rejects.toBeInstanceOf(PersistenceError);
      // getLatestInboundMessageAt validates too
      await expect(store.getLatestInboundMessageAt({ phone: "" })).rejects.toBeInstanceOf(PersistenceError);
      await expect(store.getLatestInboundMessageAt({ phone: `ctrl\tphone` })).rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await store.close();
    }
  });
});

// ---- Postgres (mock-client pattern) ----

class ScriptedPgClient implements PostgresClientLike {
  readonly queries: { sql: string; params: readonly unknown[] }[] = [];
  readonly responses: PostgresQueryResult[];
  closed = false;
  constructor(responses: readonly PostgresQueryResult[] = []) {
    this.responses = responses.slice();
  }
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ sql, params });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as PostgresQueryResult<Row>;
  }
  async end(): Promise<void> {
    this.closed = true;
  }
}

describe("WATS-175b conversation window — Postgres (mock client)", () => {
  test("getLatestInboundMessageAt issues a parameterized inbound query and returns createdAt", async () => {
    const client = new ScriptedPgClient([
      { rows: [{ created_at: "2026-07-05T11:00:00.000Z" }], rowCount: 1 }
    ]);
    const store = createPostgresPersistenceWithClient(client);
    const latest = await store.getLatestInboundMessageAt({ phone: PHONE });
    expect(latest).toBe("2026-07-05T11:00:00.000Z");
    const q = client.queries[0]!;
    expect(q.sql).toContain("direction = 'inbound'");
    expect(q.sql).toContain("from_phone = $1");
    expect(q.sql).toContain("ORDER BY created_at DESC");
    expect(q.params).toEqual([PHONE]);
    await store.close();
    expect(client.closed).toBe(true);
  });

  test("getLatestInboundMessageAt returns null when no rows match", async () => {
    const client = new ScriptedPgClient([{ rows: [], rowCount: 0 }]);
    const store = createPostgresPersistenceWithClient(client);
    const latest = await store.getLatestInboundMessageAt({ phone: PHONE });
    expect(latest).toBeNull();
    await store.close();
  });

  test("getLatestInboundMessageAt rejects malformed phone input", async () => {
    const client = new ScriptedPgClient([]);
    const store = createPostgresPersistenceWithClient(client);
    await expect(store.getLatestInboundMessageAt({ phone: "" })).rejects.toBeInstanceOf(PersistenceError);
    await expect(store.getLatestInboundMessageAt({ phone: `x\ny` })).rejects.toBeInstanceOf(PersistenceError);
    expect(client.queries.length).toBe(0);
    await store.close();
  });

  test("getConversationWindowState resolves open=true from a mock store returning a recent inbound", async () => {
    const client = new ScriptedPgClient([
      { rows: [{ created_at: isoMinus(60_000) }], rowCount: 1 }, // getConversationWindowState
      { rows: [{ created_at: isoMinus(60_000) }], rowCount: 1 }  // canSendFreeForm
    ]);
    const store = createPostgresPersistenceWithClient(client);
    const state: ConversationWindowState = await getConversationWindowState(store, { phone: PHONE, now: NOW });
    expect(state.open).toBe(true);
    expect(state.lastInboundAt).toBe(isoMinus(60_000));
    expect(state.remainingMs).toBe(DAY_MS - 60_000);
    expect(await canSendFreeForm(store, { phone: PHONE, now: NOW })).toBe(true);
    await store.close();
  });

  test("getConversationWindowState resolves closed when the mock store returns no rows", async () => {
    const client = new ScriptedPgClient([{ rows: [], rowCount: 0 }]);
    const store = createPostgresPersistenceWithClient(client);
    const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
    expect(state).toEqual({ open: false, lastInboundAt: null, expiresAt: null, remainingMs: 0 });
    expect(await canSendFreeForm(store, { phone: PHONE, now: NOW })).toBe(false);
    await store.close();
  });

  test("getConversationWindowState handles clock skew from the mock store", async () => {
    const future = new Date(new Date(NOW).getTime() + 10 * 60 * 1000).toISOString();
    const client = new ScriptedPgClient([{ rows: [{ created_at: future }], rowCount: 1 }]);
    const store = createPostgresPersistenceWithClient(client);
    const state = await getConversationWindowState(store, { phone: PHONE, now: NOW });
    expect(state.open).toBe(true);
    expect(state.remainingMs).toBe(DAY_MS);
    await store.close();
  });

  test("validation rejects before the query is issued (mock store)", async () => {
    const client = new ScriptedPgClient([]);
    const store = createPostgresPersistenceWithClient(client);
    await expect(getConversationWindowState(store, { phone: "", now: NOW })).rejects.toBeInstanceOf(PersistenceError);
    await expect(getConversationWindowState(store, { phone: PHONE, now: "nope" })).rejects.toBeInstanceOf(PersistenceError);
    await expect(getConversationWindowState(store, { phone: PHONE, now: NOW, windowMs: -1 })).rejects.toBeInstanceOf(PersistenceError);
    expect(client.queries.length).toBe(0);
    await store.close();
  });
});
