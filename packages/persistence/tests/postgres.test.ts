import { describe, expect, test } from "bun:test";
import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError
} from "../src/index";
import {
  REDACTED_POSTGRES_LOCATION,
  createPostgresPersistence,
  createPostgresPersistenceWithClient,
  type PostgresClientLike,
  type PostgresQueryResult
} from "../src/postgres";

type Query = { sql: string; params: readonly unknown[] };

class ScriptedPgClient implements PostgresClientLike {
  readonly queries: Query[] = [];
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

function successLockMigrationResponses(): PostgresQueryResult[] {
  return [
    { rows: [], rowCount: 0 }, // CREATE lock table
    { rows: [], rowCount: 0 }, // CREATE migrations table
    { rows: [], rowCount: 1 }, // lock acquired
    { rows: [], rowCount: 0 }, // validate checksums
    { rows: [], rowCount: 0 }, // migration 1 existing?
    { rows: [], rowCount: 0 }, // BEGIN
    { rows: [], rowCount: 0 }, // migration 1 stmt 1
    { rows: [], rowCount: 0 }, // migration 1 stmt 2
    { rows: [], rowCount: 0 }, // migration 1 stmt 3
    { rows: [], rowCount: 0 }, // migration 1 stmt 4
    { rows: [], rowCount: 0 }, // migration 1 stmt 5
    { rows: [], rowCount: 1 }, // record migration 1
    { rows: [], rowCount: 0 }, // COMMIT
    { rows: [], rowCount: 0 }, // migration 2 existing?
    { rows: [], rowCount: 0 }, // BEGIN
    { rows: [], rowCount: 0 }, // migration 2 stmt
    { rows: [], rowCount: 1 }, // record migration 2
    { rows: [], rowCount: 0 }, // COMMIT
    { rows: [], rowCount: 0 }, // migration 3 existing?
    { rows: [], rowCount: 0 }, // BEGIN
    { rows: [], rowCount: 0 }, // migration 3 stmt 1
    { rows: [], rowCount: 0 }, // migration 3 stmt 2
    { rows: [], rowCount: 0 }, // migration 3 stmt 3
    { rows: [], rowCount: 0 }, // migration 3 stmt 4
    { rows: [], rowCount: 0 }, // migration 3 stmt 5
    { rows: [], rowCount: 1 }, // record migration 3
    { rows: [], rowCount: 0 }, // COMMIT
    { rows: [], rowCount: 0 }, // migration 4 existing?
    { rows: [], rowCount: 0 }, // BEGIN
    { rows: [], rowCount: 0 }, // migration 4 stmt
    { rows: [], rowCount: 1 }, // record migration 4
    { rows: [], rowCount: 0 }, // COMMIT
    { rows: [], rowCount: 1 } // release lock
  ];
}

describe("WATS-125 Postgres persistence adapter", () => {
  test("createPostgresPersistence validates connectionString without echoing secrets before lazy pg import", async () => {
    const secretUrl = "postgres://user:secret-password@example.test/db";
    for (const bad of [null, "", "   ", "http://example.test/db", `postgres://bad\n${secretUrl}`] as const) {
      let thrown: unknown;
      try {
        await createPostgresPersistence({ connectionString: bad as never });
      } catch (error) {
        thrown = error;
      }
      const err = thrown as Error;
      expect(err).toBeInstanceOf(PersistenceError);
      expect(err.message).not.toContain("secret-password");
    }
  });

  test("createPostgresPersistence reports missing optional pg package without echoing the URL", async () => {
    const secretUrl = "postgres://user:secret-password@example.test/db";
    let thrown: unknown;
    try {
      await createPostgresPersistence({ connectionString: secretUrl });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as Error;
    expect(err).toBeInstanceOf(PersistenceError);
    expect(err.message).toContain("optional 'pg' package");
    expect(err.message).not.toContain("secret-password");
    expect(err.message).not.toContain(secretUrl);
  });

  test("migrate applies schema version 3 including message projection tables", async () => {
    const client = new ScriptedPgClient(successLockMigrationResponses());
    const store = createPostgresPersistenceWithClient(client);

    const report = await store.migrate();

    expect(report.currentVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(report.currentVersion).toBe(4);
    expect(report.appliedMigrations).toEqual(["001_initial", "002_outbox_lease_id", "003_message_projection", "004_inbound_window_index"]);
    const joined = client.queries.map((q) => q.sql).join("\n");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS wats_messages");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS wats_message_status_events");
    expect(joined).toContain("wats_messages_created_at_idx");
    expect(joined).toContain("wats_messages_direction_from_phone_created_at_idx");
  });

  test("health returns redacted Postgres location", async () => {
    const client = new ScriptedPgClient([{ rows: [{ version: 3 }], rowCount: 1 }]);
    const store = createPostgresPersistenceWithClient(client);

    const health = await store.health();

    expect(health).toEqual({ ok: true, backend: "postgres", currentVersion: 3, redactedLocation: REDACTED_POSTGRES_LOCATION });
  });

  test("message projection methods use parameterized queries and composite cursor pagination", async () => {
    const client = new ScriptedPgClient([
      { rows: [], rowCount: 1 }, // recordMessage
      { rows: [], rowCount: 1 }, // append begin
      { rows: [], rowCount: 1 }, // insert status
      { rows: [], rowCount: 1 }, // update status
      { rows: [], rowCount: 1 }, // append commit
      { rows: [{ row_id: "row-1", wa_message_id: "wamid.1", direction: "outbound", from_phone: null, to_phone: "1555", type: "text", status: "delivered", graph_message_id: "wamid.1", created_at: "2026-06-21T00:00:00.000Z", updated_at: "2026-06-21T00:00:01.000Z" }], rowCount: 1 }, // getMessage
      { rows: [{ row_id: "cursor", created_at: "2026-06-21T00:00:01.000Z" }], rowCount: 1 }, // cursor lookup
      { rows: [
        { row_id: "older-a", wa_message_id: "wamid.a", direction: "outbound", from_phone: null, to_phone: null, type: "text", status: "sent", graph_message_id: null, created_at: "2026-06-21T00:00:00.000Z", updated_at: "2026-06-21T00:00:00.000Z" },
        { row_id: "older-b", wa_message_id: "wamid.b", direction: "outbound", from_phone: null, to_phone: null, type: "text", status: "sent", graph_message_id: null, created_at: "2026-06-20T00:00:00.000Z", updated_at: "2026-06-20T00:00:00.000Z" },
        { row_id: "extra", wa_message_id: "wamid.extra", direction: "outbound", from_phone: null, to_phone: null, type: "text", status: "sent", graph_message_id: null, created_at: "2026-06-19T00:00:00.000Z", updated_at: "2026-06-19T00:00:00.000Z" }
      ], rowCount: 3 }
    ]);
    const store = createPostgresPersistenceWithClient(client);

    await store.recordMessage({ rowId: "row-1", waMessageId: "wamid.1", direction: "outbound", toPhone: "1555", type: "text", status: "sent", graphMessageId: "wamid.1", createdAt: "2026-06-21T00:00:00.000Z", updatedAt: "2026-06-21T00:00:00.000Z" });
    await store.appendMessageStatus({ waMessageId: "wamid.1", status: "delivered", timestamp: "2026-06-21T00:00:01.000Z" });
    const message = await store.getMessage({ waMessageId: "wamid.1" });
    const page = await store.listMessages({ limit: 2, beforeRowId: "cursor" });

    expect(message?.status).toBe("delivered");
    expect(page.items.map((item) => item.rowId)).toEqual(["older-a", "older-b"]);
    expect(page.nextCursor).toBe("older-b");
    const listSql = client.queries.at(-1)!.sql;
    expect(listSql).toContain("created_at < $1 OR (created_at = $2 AND row_id < $3)");
    expect(client.queries.at(-1)!.params).toEqual(["2026-06-21T00:00:01.000Z", "2026-06-21T00:00:01.000Z", "cursor", 3]);
  });

  test("outbox operations use rowCount leases and close ends the client", async () => {
    const client = new ScriptedPgClient([
      { rows: [], rowCount: 1 }, // enqueue
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [{ id: "item-1", status: "pending", attempts: 0, lease_id: 0, next_attempt_at: null, payload_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", created_at: "2026-06-21T00:00:00.000Z", updated_at: "2026-06-21T00:00:00.000Z" }], rowCount: 1 }, // select
      { rows: [], rowCount: 1 }, // update
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 1 }, // failed
      { rows: [], rowCount: 1 } // succeeded
    ]);
    const store = createPostgresPersistenceWithClient(client);
    const hash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    expect(await store.enqueueOutboxItem({ id: "item-1", payloadHash: hash, createdAt: "2026-06-21T00:00:00.000Z" })).toBe("enqueued");
    const claimed = await store.claimOutboxItems({ now: "2026-06-21T00:00:01.000Z", limit: 10 });
    expect(claimed[0]?.leaseId).toBe(1);
    await store.markOutboxItemFailed({ id: "item-1", leaseId: 1, nextAttemptAt: "2026-06-21T00:00:02.000Z", updatedAt: "2026-06-21T00:00:01.000Z" });
    await store.markOutboxItemSucceeded({ id: "item-1", leaseId: 1, updatedAt: "2026-06-21T00:00:03.000Z" });
    await store.close();
    expect(client.closed).toBe(true);
  });
});
