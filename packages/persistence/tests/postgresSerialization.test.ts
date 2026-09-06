import { describe, expect, test } from "bun:test";
import {
  PersistenceError,
  createPostgresPersistenceWithClient,
  type PostgresClientLike,
  type PostgresQueryResult
} from "../src/index";

const ISO = "2026-09-06T00:00:00.000Z";

/**
 * Mock pg client that detects transaction-control interleaving on the shared
 * connection. A second BEGIN while a transaction is already open is the defect
 * signature: the concurrent caller joins the active transaction and a
 * ROLLBACK from either caller discards the other's uncommitted work.
 */
class SerializationProbeClient implements PostgresClientLike {
  readonly events: string[] = [];
  #openTx = 0;
  #doubleBegin = false;
  #endBeforeTxClose = false;
  closed = false;

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    _params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    const t = sql.trim().toUpperCase();
    if (t === "BEGIN") {
      if (this.#openTx > 0) this.#doubleBegin = true;
      this.#openTx += 1;
    } else if (t === "COMMIT" || t === "ROLLBACK") {
      this.#openTx = Math.max(0, this.#openTx - 1);
    }
    this.events.push(`Q:${t.slice(0, 24)}`);
    return { rows: [], rowCount: 0 } as PostgresQueryResult<Row>;
  }

  async end(): Promise<void> {
    if (this.#openTx > 0) this.#endBeforeTxClose = true;
    this.events.push("END");
    this.closed = true;
  }

  get doubleBegin(): boolean { return this.#doubleBegin; }
  get openTransactions(): number { return this.#openTx; }
  get endWhileTransactionOpen(): boolean { return this.#endBeforeTxClose; }
}

describe("WATS-200 Postgres transaction serialization", () => {
  test("concurrent claim + append do not interleave BEGIN/COMMIT on the shared client", async () => {
    const client = new SerializationProbeClient();
    const store = createPostgresPersistenceWithClient(client);

    await Promise.all([
      store.claimOutboxItems({ now: ISO, limit: 10 }),
      store.appendMessageStatus({ waMessageId: "wamid.1", status: "delivered", timestamp: ISO }),
      store.appendMessageStatus({ waMessageId: "wamid.2", status: "read", timestamp: ISO })
    ]);

    expect(client.doubleBegin).toBe(false);
    expect(client.openTransactions).toBe(0);
    await store.close();
  });

  test("concurrent single-query operations do not join an active transaction", async () => {
    const client = new SerializationProbeClient();
    const store = createPostgresPersistenceWithClient(client);

    await Promise.all([
      store.claimOutboxItems({ now: ISO, limit: 10 }),
      store.health(),
      store.countOutboxPending(),
      store.appendMessageStatus({ waMessageId: "wamid.3", status: "read", timestamp: ISO })
    ]);

    expect(client.doubleBegin).toBe(false);
    expect(client.openTransactions).toBe(0);
    await store.close();
  });

  test("close waits for in-flight operations and does not end mid-transaction", async () => {
    const client = new SerializationProbeClient();
    const store = createPostgresPersistenceWithClient(client);

    const op = store.claimOutboxItems({ now: ISO, limit: 10 });
    await store.close();
    await op;

    expect(client.endWhileTransactionOpen).toBe(false);
    expect(client.openTransactions).toBe(0);
    expect(client.closed).toBe(true);
  });

  test("operations after close fail with store_closed, not a raw client error", async () => {
    const client = new SerializationProbeClient();
    const store = createPostgresPersistenceWithClient(client);
    await store.close();

    await expect(store.claimOutboxItems({ now: ISO, limit: 10 })).rejects.toBeInstanceOf(PersistenceError);
    await expect(store.appendMessageStatus({ waMessageId: "wamid.4", status: "read", timestamp: ISO })).rejects.toBeInstanceOf(PersistenceError);
    expect(client.closed).toBe(true);
  });
});
