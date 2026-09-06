// WATS-200 storage typed-error hardening (Q1/Q2). Confirmed leaks:
//  - SQLite claimServiceRequest/recordServiceRequest/completeServiceRequest/
//    markOutboxItem{Failed,Succeeded} throw RAW bun:sqlite SQLiteError on a
//    backend fault (dropped table) that passes #assertOpen. The driver error
//    is unmediated and could carry caller input in a real fault.
//  - Postgres claim/complete/record/markFailed/markSucceeded/getMessage/
//    health/migrate leak RAW driver errors that ECHO caller-supplied
//    secret-like input (requestHash, id, waMessageId) appearing in the
//    rejected query text / driver message.
//
// Both are contract/quality gaps, not spec gaps: every behavioral test passes.
// These tests pin the typed PersistenceError contract on a backend fault,
// assert the static message + correct code, and assert the caller's
// secret-like payload never appears in any serialization of the error.
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  PersistenceError,
  createSqlitePersistence,
  type PersistenceStore
} from "../src/index";
import {
  createPostgresPersistenceWithClient,
  type PostgresClientLike,
  type PostgresQueryResult
} from "../src/postgres";

const ISO = "2026-09-06T00:00:00.000Z";
// A secret-like caller value that MUST NOT appear anywhere in the serialized
// error (message, code, JSON.stringify, toString, name:message shape).
const SECRET_HASH = "sha256:" + "SECRET_HASH".padEnd(56, "a");
const SECRET_ID = "SECRET_ID_wamid_value";

// Assert an error is a typed PersistenceError with the expected code and that
// no secret-like substring leaks through ANY common serialization surface.
function assertTypedNoLeak(
  thrown: unknown,
  expectedCode: string,
  ...secrets: readonly string[]
): void {
  expect(thrown).toBeInstanceOf(PersistenceError);
  const err = thrown as PersistenceError;
  expect(err.code).toBe(expectedCode);
  expect(err.name).toBe("PersistenceError");
  // Serialize across the surfaces a consumer/log pipeline might touch.
  const surfaces = [
    String(err.message ?? ""),
    String(err.code ?? ""),
    JSON.stringify(err),
    String(err),
    `${err.name}: ${err.message}`
  ];
  for (const secret of secrets) {
    for (const surface of surfaces) {
      if (surface.includes(secret)) {
        throw new Error(
          `secret-like payload leaked into error surface: ${JSON.stringify(secret)} -> ${surface.slice(0, 120)}`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SQLite: dropped table mid-call (real backend fault after #assertOpen).
// ---------------------------------------------------------------------------

async function dropSqliteTables(filename: string, ...tables: readonly string[]): Promise<void> {
  // Open a SECOND bare bun:sqlite handle and drop the tables so the store's
  // next data query hits a real "no such table" driver fault after #assertOpen
  // has already passed (validation happens before the data call).
  const mod = await import("bun:sqlite") as unknown as {
    Database: new (filename: string) => { exec(sql: string): unknown; close(): void };
  };
  const db = new mod.Database(filename);
  try {
    for (const table of tables) db.exec(`DROP TABLE ${table}`);
  } finally {
    db.close();
  }
}

function removeTmp(path: string): void {
  try { rmSync(path, { recursive: true, force: true }); } catch { /* best-effort */ }
}

describe("WATS-200 SQLite typed-error wrapping on backend fault (Q1)", () => {
  test("claimServiceRequest wraps a dropped-table fault as claim_failed PersistenceError without leaking input", async () => {
    const tmp = `/tmp/wats-red-sq-claim-${process.pid}.sqlite`;
    removeTmp(tmp);
    try {
      const store = await createSqlitePersistence({ filename: tmp });
      await store.migrate();
      await dropSqliteTables(tmp, "wats_service_requests");
      let thrown: unknown;
      try {
        await (store as unknown as {
          claimServiceRequest(input: { idempotencyKey: string; requestHash: string; createdAt: string }): Promise<unknown>;
        }).claimServiceRequest({ idempotencyKey: "k1", requestHash: SECRET_HASH, createdAt: ISO });
      } catch (error) {
        thrown = error;
      }
      assertTypedNoLeak(thrown, "claim_failed", SECRET_HASH);
      await store.close();
    } finally {
      removeTmp(tmp);
    }
  });

  test("recordServiceRequest wraps a dropped-table fault as outbox_failed PersistenceError without leaking input", async () => {
    const tmp = `/tmp/wats-red-sq-record-${process.pid}.sqlite`;
    removeTmp(tmp);
    try {
      const store = await createSqlitePersistence({ filename: tmp });
      await store.migrate();
      await dropSqliteTables(tmp, "wats_service_requests");
      let thrown: unknown;
      try {
        await store.recordServiceRequest({ idempotencyKey: "k2", requestHash: SECRET_HASH, responseJson: "{}", createdAt: ISO });
      } catch (error) {
        thrown = error;
      }
      assertTypedNoLeak(thrown, "outbox_failed", SECRET_HASH);
      await store.close();
    } finally {
      removeTmp(tmp);
    }
  });

  test("completeServiceRequest wraps a dropped-table fault as completion_failed PersistenceError without leaking input", async () => {
    const tmp = `/tmp/wats-red-sq-complete-${process.pid}.sqlite`;
    removeTmp(tmp);
    try {
      const store = await createSqlitePersistence({ filename: tmp });
      await store.migrate();
      await dropSqliteTables(tmp, "wats_service_requests");
      let thrown: unknown;
      try {
        await (store as unknown as {
          completeServiceRequest(input: { idempotencyKey: string; requestHash: string; responseJson: string; createdAt: string }): Promise<void>;
        }).completeServiceRequest({ idempotencyKey: "k1", requestHash: SECRET_HASH, responseJson: "{}", createdAt: ISO });
      } catch (error) {
        thrown = error;
      }
      assertTypedNoLeak(thrown, "completion_failed", SECRET_HASH);
      await store.close();
    } finally {
      removeTmp(tmp);
    }
  });

  test("markOutboxItemFailed wraps a dropped-table fault as outbox_failed PersistenceError without leaking input", async () => {
    const tmp = `/tmp/wats-red-sq-markf-${process.pid}.sqlite`;
    removeTmp(tmp);
    try {
      const store = await createSqlitePersistence({ filename: tmp });
      await store.migrate();
      await dropSqliteTables(tmp, "wats_outbox");
      let thrown: unknown;
      try {
        await store.markOutboxItemFailed({ id: SECRET_ID, leaseId: 1, nextAttemptAt: ISO, updatedAt: ISO });
      } catch (error) {
        thrown = error;
      }
      assertTypedNoLeak(thrown, "outbox_failed", SECRET_ID);
      await store.close();
    } finally {
      removeTmp(tmp);
    }
  });

  test("markOutboxItemSucceeded wraps a dropped-table fault as outbox_failed PersistenceError without leaking input", async () => {
    const tmp = `/tmp/wats-red-sq-marks-${process.pid}.sqlite`;
    removeTmp(tmp);
    try {
      const store = await createSqlitePersistence({ filename: tmp });
      await store.migrate();
      await dropSqliteTables(tmp, "wats_outbox");
      let thrown: unknown;
      try {
        await store.markOutboxItemSucceeded({ id: SECRET_ID, leaseId: 1, updatedAt: ISO });
      } catch (error) {
        thrown = error;
      }
      assertTypedNoLeak(thrown, "outbox_failed", SECRET_ID);
      await store.close();
    } finally {
      removeTmp(tmp);
    }
  });

  test("store_closed behavior is unchanged: a closed store still rejects with store_closed (not a backend fault)", async () => {
    const tmp = `/tmp/wats-red-sq-closed-${process.pid}.sqlite`;
    removeTmp(tmp);
    try {
      const store = await createSqlitePersistence({ filename: tmp });
      await store.migrate();
      await store.close();
      let thrown: unknown;
      try {
        await (store as unknown as {
          claimServiceRequest(input: { idempotencyKey: string; requestHash: string; createdAt: string }): Promise<unknown>;
        }).claimServiceRequest({ idempotencyKey: "k1", requestHash: SECRET_HASH, createdAt: ISO });
      } catch (error) {
        thrown = error;
      }
      assertTypedNoLeak(thrown, "store_closed", SECRET_HASH);
    } finally {
      removeTmp(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// Postgres: faulting client whose query() throws a driver error that echoes
// the caller-supplied secret-like value (rejected query text / driver
// message). Every public serialized operation must surface a typed
// PersistenceError with a static message and NO echo.
// ---------------------------------------------------------------------------

class FaultingPgClient implements PostgresClientLike {
  // When faulting, throw an Error whose message contains a caller-supplied
  // secret-like substring (simulating a driver error whose message embeds
  // the rejected query text / caller values). code "XX000" is internal_error,
  // NOT a 23505 unique_violation, so it must NOT be treated as dedup.
  faultWith: string | null = null;
  async connect(): Promise<void> {}
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    _sql: string,
    _params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>> {
    if (this.faultWith !== null) {
      const err = new Error(this.faultWith) as Error & { code?: string };
      err.code = "XX000";
      throw err;
    }
    return { rows: [], rowCount: 0 } as PostgresQueryResult<Row>;
  }
  async end(): Promise<void> {}
}

interface ClaimApi {
  claimServiceRequest(input: { idempotencyKey: string; requestHash: string; createdAt: string }): Promise<unknown>;
  completeServiceRequest(input: { idempotencyKey: string; requestHash: string; responseJson: string; createdAt: string }): Promise<void>;
}

function claims(store: PersistenceStore): ClaimApi {
  return store as unknown as ClaimApi;
}

describe("WATS-200 Postgres typed-error wrapping on driver fault (Q2)", () => {
  test("every public serialized Postgres operation surfaces typed PersistenceError with a static message and no caller-input echo", async () => {
    const cases: ReadonlyArray<{
      name: string;
      expectedCode: string;
      faultWith: string;
      op: (store: PersistenceStore) => Promise<unknown>;
    }> = [
      { name: "claimServiceRequest", expectedCode: "claim_failed", faultWith: `pg: insert ${SECRET_HASH} failed`, op: (s) =>
        claims(s).claimServiceRequest({ idempotencyKey: "k1", requestHash: SECRET_HASH, createdAt: ISO }) },
      { name: "completeServiceRequest", expectedCode: "completion_failed", faultWith: `pg: select ${SECRET_HASH} failed`, op: (s) =>
        claims(s).completeServiceRequest({ idempotencyKey: "k1", requestHash: SECRET_HASH, responseJson: "{}", createdAt: ISO }) },
      { name: "recordServiceRequest", expectedCode: "outbox_failed", faultWith: `pg: insert ${SECRET_HASH} failed`, op: (s) =>
        s.recordServiceRequest({ idempotencyKey: "k2", requestHash: SECRET_HASH, responseJson: "{}", createdAt: ISO }) },
      { name: "markOutboxItemFailed", expectedCode: "outbox_failed", faultWith: `pg: update ${SECRET_ID} failed`, op: (s) =>
        s.markOutboxItemFailed({ id: SECRET_ID, leaseId: 1, nextAttemptAt: ISO, updatedAt: ISO }) },
      { name: "markOutboxItemSucceeded", expectedCode: "outbox_failed", faultWith: `pg: update ${SECRET_ID} failed`, op: (s) =>
        s.markOutboxItemSucceeded({ id: SECRET_ID, leaseId: 1, updatedAt: ISO }) },
      { name: "enqueueOutboxItem", expectedCode: "outbox_failed", faultWith: `pg: insert ${SECRET_ID} failed`, op: (s) =>
        s.enqueueOutboxItem({ id: SECRET_ID, payloadHash: "sha256:" + "a".repeat(64), createdAt: ISO }) },
      { name: "getMessage", expectedCode: "outbox_failed", faultWith: `pg: select ${SECRET_ID} failed`, op: (s) =>
        s.getMessage({ waMessageId: SECRET_ID }) },
      { name: "health", expectedCode: "outbox_failed", faultWith: `pg: health ${SECRET_HASH} failed`, op: (s) => s.health() },
      { name: "countOutboxPending", expectedCode: "outbox_failed", faultWith: `pg: count ${SECRET_ID} failed`, op: (s) => s.countOutboxPending() },
      { name: "getServiceRequest", expectedCode: "outbox_failed", faultWith: `pg: select ${SECRET_HASH} failed`, op: (s) =>
        s.getServiceRequest({ idempotencyKey: "k1", requestHash: SECRET_HASH }) },
      { name: "recordWebhookEvent", expectedCode: "outbox_failed", faultWith: `pg: insert ${SECRET_ID} failed`, op: (s) =>
        s.recordWebhookEvent({ eventKey: SECRET_ID, eventHash: "sha256:" + "b".repeat(64), receivedAt: ISO }) },
      { name: "listMessages", expectedCode: "outbox_failed", faultWith: `pg: select ${SECRET_ID} failed`, op: (s) =>
        s.listMessages({ limit: 10 }) },
      { name: "getLatestInboundMessageAt", expectedCode: "outbox_failed", faultWith: `pg: select ${SECRET_ID} failed`, op: (s) =>
        s.getLatestInboundMessageAt({ phone: SECRET_ID }) }
    ];

    for (const c of cases) {
      const client = new FaultingPgClient();
      client.faultWith = c.faultWith;
      const store = createPostgresPersistenceWithClient(client);
      let thrown: unknown;
      try {
        await c.op(store);
        throw new Error(`expected ${c.name} to reject on a driver fault`);
      } catch (error) {
        thrown = error;
      } finally {
        client.faultWith = null;
      }
      assertTypedNoLeak(thrown, c.expectedCode, SECRET_HASH, SECRET_ID);
    }
  });

  test("recordMessage/appendMessageStatus/claimOutboxItems continue to wrap driver faults as typed PersistenceError (control group)", async () => {
    const cases: ReadonlyArray<{ expectedCode: string; faultWith: string; op: (store: PersistenceStore) => Promise<unknown> }> = [
      { expectedCode: "outbox_failed", faultWith: `pg: insert ${SECRET_HASH} failed`, op: (s) =>
        s.recordMessage({ rowId: "r1", waMessageId: SECRET_ID, direction: "outbound", toPhone: "+1", type: "text", status: "sent", createdAt: ISO, updatedAt: ISO }) },
      { expectedCode: "outbox_failed", faultWith: `pg: BEGIN ${SECRET_ID} failed`, op: (s) =>
        s.appendMessageStatus({ waMessageId: SECRET_ID, status: "delivered", timestamp: ISO }) },
      { expectedCode: "outbox_failed", faultWith: `pg: BEGIN ${SECRET_ID} failed`, op: (s) =>
        s.claimOutboxItems({ now: ISO, limit: 1 }) }
    ];
    for (const c of cases) {
      const client = new FaultingPgClient();
      client.faultWith = c.faultWith;
      const store = createPostgresPersistenceWithClient(client);
      let thrown: unknown;
      try {
        await c.op(store);
        throw new Error("expected the control-group operation to reject");
      } catch (error) {
        thrown = error;
      } finally {
        client.faultWith = null;
      }
      assertTypedNoLeak(thrown, c.expectedCode, SECRET_HASH, SECRET_ID);
    }
  });

  test("existing validation outside the lock stays typed and is unaffected (recordServiceRequest bad JSON rejects before any query)", async () => {
    const client = new FaultingPgClient();
    const store = createPostgresPersistenceWithClient(client);
    let thrown: unknown;
    try {
      await store.recordServiceRequest({ idempotencyKey: "k", requestHash: "sha256:x", responseJson: "{bad", createdAt: ISO });
    } catch (error) {
      thrown = error;
    }
    assertTypedNoLeak(thrown, "invalid_record");
    await store.close();
  });

  test("store_closed behavior is unchanged: a closed Postgres store still rejects with store_closed (not a backend fault)", async () => {
    const client = new FaultingPgClient();
    const store = createPostgresPersistenceWithClient(client);
    await store.close();
    let thrown: unknown;
    try {
      await store.health();
    } catch (error) {
      thrown = error;
    }
    assertTypedNoLeak(thrown, "store_closed", SECRET_HASH, SECRET_ID);
  });
});
