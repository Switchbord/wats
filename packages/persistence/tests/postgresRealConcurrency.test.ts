import { describe, expect, test } from "bun:test";
import type { OutboxItem } from "../src/index";

// WATS-200 real-Postgres concurrency test. The parent orchestrator provides
// an isolated Postgres instance via WATS_TEST_POSTGRES_URL. When the env var
// is absent, the test is SKIPPED (not a no-op pass) so CI clearly signals it
// needs a live backend. The `pg` driver is an OPTIONAL peer dependency and the
// worktree may not carry @types/pg, so the module is imported via a string
// specifier (so tsc does not try to resolve it) and narrowed to a local
// structural interface — no ambient `pg` shim, no fake types that could hide
// real driver defects. Runtime uses the real `pg` package when present.
const PG_URL = process.env.WATS_TEST_POSTGRES_URL ?? "";

// A non-literal specifier so tsc does not attempt to resolve the optional `pg`
// module (the worktree may lack @types/pg). Runtime resolves the real package.
const PG_SPECIFIER = "pg";

interface PgClient {
  connect(): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>;
  end(): Promise<void>;
}
interface PgModule {
  new (config: { readonly connectionString?: string }): PgClient;
}
interface PgClientConstructor {
  readonly Client: PgModule;
}

describe("WATS-200 real Postgres concurrency (env-gated)", () => {
  const maybeTest = PG_URL ? test : test.skip;

  maybeTest("concurrent claim + append serialize: no rollback crosstalk", async () => {
    // String specifier keeps this free of a static `pg` type dependency.
    const pg = (await import(PG_SPECIFIER)) as unknown as PgClientConstructor;
    const { createPostgresPersistenceWithClient } = await import("../src/postgres");

    // Use a real pg.Client connected to the live backend.
    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();

    // Clean slate.
    await client.query("DROP TABLE IF EXISTS wats_service_requests");
    await client.query("DROP TABLE IF EXISTS wats_messages");
    await client.query("DROP TABLE IF EXISTS wats_message_status_events");
    await client.query("DROP TABLE IF EXISTS wats_outbox");
    await client.query("DROP TABLE IF EXISTS wats_webhook_events");
    await client.query("DROP TABLE IF EXISTS wats_schema_migrations");
    await client.query("DROP TABLE IF EXISTS wats_persistence_lock");

    const store = createPostgresPersistenceWithClient(client);
    await store.migrate();
    try {
      const NOW = "2026-09-06T00:00:00.000Z";
      const hash = "sha256:" + "a".repeat(64);

      // Seed an outbox item and a message.
      await store.enqueueOutboxItem({ id: "real-claim-item", payloadHash: hash, createdAt: NOW });
      await store.recordMessage({ rowId: "real-claim-msg", waMessageId: "wamid.real-claim", direction: "outbound", type: "text", status: "sent", createdAt: NOW, updatedAt: NOW });

      // Inject a trigger that blocks 'delivered' status events, simulating a
      // failing append concurrent with an outbox claim. Pre-fix, the append's
      // ROLLBACK would discard the claim's uncommitted UPDATE on the shared
      // connection. Post-fix, serialization prevents the interleaving.
      await client.query(`
        CREATE OR REPLACE FUNCTION wats_audit_block_delivered() RETURNS trigger AS $$
        BEGIN
          IF NEW.status = 'delivered' THEN
            RAISE EXCEPTION 'injected: delivered blocked';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await client.query(`CREATE TRIGGER wats_audit_block BEFORE INSERT ON wats_message_status_events
                          FOR EACH ROW EXECUTE FUNCTION wats_audit_block_delivered();`);

      // Run a claim and a failing status append concurrently on the shared
      // client. The append should throw (trigger), but the claim must still
      // commit because the serialization prevents the append's ROLLBACK from
      // discarding the claim's uncommitted work.
      const results = await Promise.allSettled([
        store.claimOutboxItems({ now: NOW, limit: 10 }),
        store.appendMessageStatus({ waMessageId: "wamid.real-claim", status: "delivered", timestamp: NOW })
      ]);

      // The claim must succeed.
      expect(results[0]!.status).toBe("fulfilled");
      const claimResult = (results[0] as PromiseFulfilledResult<readonly OutboxItem[]>).value;
      const claimed = claimResult.find((c) => c.id === "real-claim-item");
      expect(claimed).toBeDefined();
      expect(claimed!.status).toBe("processing");

      // The append must reject (trigger fires), but it must NOT have rolled
      // back the claim.
      expect(results[1]!.status).toBe("rejected");

      // Direct DB check: the outbox item must be 'processing' (claim committed),
      // not 'pending' (which would mean the append's ROLLBACK discarded it).
      const dbCheck = await client.query<{ status: string }>("SELECT status FROM wats_outbox WHERE id = $1", ["real-claim-item"]);
      expect(dbCheck.rows[0]!.status).toBe("processing");

      // The message status must still be 'sent' (the delivered append failed).
      const msgCheck = await client.query<{ status: string }>("SELECT status FROM wats_messages WHERE wa_message_id = $1", ["wamid.real-claim"]);
      expect(msgCheck.rows[0]!.status).toBe("sent");

      // Cleanup trigger.
      await client.query("DROP TRIGGER IF EXISTS wats_audit_block ON wats_message_status_events");
      await client.query("DROP FUNCTION IF EXISTS wats_audit_block_delivered()");
    } finally {
      await store.close();
    }
  });

  maybeTest("claim/complete works against real Postgres", async () => {
    const pg = (await import(PG_SPECIFIER)) as unknown as PgClientConstructor;
    const { createPostgresPersistenceWithClient } = await import("../src/postgres");
    type ClaimingStore = ReturnType<typeof createPostgresPersistenceWithClient> & {
      claimServiceRequest(input: { idempotencyKey: string; requestHash: string; createdAt: string }): Promise<"claimed" | "pending" | "conflict" | { responseJson: string }>;
      completeServiceRequest(input: { idempotencyKey: string; requestHash: string; responseJson: string; createdAt: string }): Promise<void>;
    };

    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();

    const store = createPostgresPersistenceWithClient(client) as ClaimingStore;
    try {
      const NOW = "2026-09-06T00:00:00.000Z";
      const RESP = JSON.stringify({ messages: [{ id: "wamid.real" }] });

      // First claim.
      expect(await store.claimServiceRequest({ idempotencyKey: "pg-claim-1", requestHash: "sha256:pg-req", createdAt: NOW })).toBe("claimed");
      // Second claim is pending.
      expect(await store.claimServiceRequest({ idempotencyKey: "pg-claim-1", requestHash: "sha256:pg-req", createdAt: NOW })).toBe("pending");
      // Conflict on different hash.
      expect(await store.claimServiceRequest({ idempotencyKey: "pg-claim-1", requestHash: "sha256:other", createdAt: NOW })).toBe("conflict");
      // Complete.
      await store.completeServiceRequest({ idempotencyKey: "pg-claim-1", requestHash: "sha256:pg-req", responseJson: RESP, createdAt: NOW });
      // Replay.
      const replay = await store.claimServiceRequest({ idempotencyKey: "pg-claim-1", requestHash: "sha256:pg-req", createdAt: NOW });
      expect(replay).toEqual({ responseJson: RESP });

      // Direct DB check: status must be 'completed'.
      const dbCheck = await client.query<{ status: string; response_json: string }>("SELECT status, response_json FROM wats_service_requests WHERE idempotency_key = $1", ["pg-claim-1"]);
      expect(dbCheck.rows[0]!.status).toBe("completed");
      expect(dbCheck.rows[0]!.response_json).toBe(RESP);
    } finally {
      await store.close();
    }
  });

  // WATS-200 storage correction: recordMessage must dedup by the
  // (direction, wa_message_id) unique index, not only row_id. ON CONFLICT
  // (row_id) DO NOTHING does NOT cover that index, so a second insert with a
  // different rowId but the same (direction, wa_message_id) threw a raw 23505
  // unique_violation. The fix treats 23505 as the expected dedup no-op.
  maybeTest("recordMessage dedups by (direction, wa_message_id) without throwing on a different rowId", async () => {
    const pg = (await import(PG_SPECIFIER)) as unknown as PgClientConstructor;
    const { createPostgresPersistenceWithClient } = await import("../src/postgres");
    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();
    for (const t of ["wats_message_status_events", "wats_messages", "wats_outbox", "wats_webhook_events", "wats_service_requests", "wats_schema_migrations", "wats_persistence_lock"]) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    const store = createPostgresPersistenceWithClient(client);
    await store.migrate();
    try {
      const NOW = "2026-09-06T00:00:00.000Z";
      await store.recordMessage({ rowId: "pg-row-1", waMessageId: "wamid.PG_DUP", direction: "outbound", type: "text", status: "sent", createdAt: NOW, updatedAt: NOW });
      // different rowId, same (direction, wa_message_id) -> no-op, NOT a throw
      await store.recordMessage({ rowId: "pg-row-2", waMessageId: "wamid.PG_DUP", direction: "outbound", type: "text", status: "sent", createdAt: NOW, updatedAt: NOW });
      const rec = await store.getMessage({ waMessageId: "wamid.PG_DUP" });
      expect(rec?.rowId).toBe("pg-row-1");
    } finally {
      await store.close();
      await client.end();
    }
  });

  // WATS-200 storage correction: rank-based status transitions on real PG.
  // delivered at the same second (truncated ms) must advance sent; a later
  // sent must not regress read; failed must not replace delivered/read.
  maybeTest("appendMessageStatus rank transitions: same-second advance, no regress, failed gate", async () => {
    const pg = (await import(PG_SPECIFIER)) as unknown as PgClientConstructor;
    const { createPostgresPersistenceWithClient } = await import("../src/postgres");
    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();
    for (const t of ["wats_message_status_events", "wats_messages", "wats_outbox", "wats_webhook_events", "wats_service_requests", "wats_schema_migrations", "wats_persistence_lock"]) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    const store = createPostgresPersistenceWithClient(client);
    await store.migrate();
    try {
      // send at 123ms; delivered callback truncated to 000ms (same second).
      await store.recordMessage({ rowId: "pg-rA", waMessageId: "wamid.pgA", direction: "outbound", type: "text", status: "sent", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.123Z" });
      await store.appendMessageStatus({ waMessageId: "wamid.pgA", status: "delivered", timestamp: "2026-09-06T00:00:00.000Z" });
      expect((await store.getMessage({ waMessageId: "wamid.pgA" }))?.status).toBe("delivered");

      // a later-timestamp sent must NOT regress read.
      await store.recordMessage({ rowId: "pg-rB", waMessageId: "wamid.pgB", direction: "outbound", type: "text", status: "read", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:01.000Z" });
      await store.appendMessageStatus({ waMessageId: "wamid.pgB", status: "sent", timestamp: "2026-09-06T00:00:02.000Z" });
      expect((await store.getMessage({ waMessageId: "wamid.pgB" }))?.status).toBe("read");

      // failed must NOT replace read even with a later timestamp.
      await store.appendMessageStatus({ waMessageId: "wamid.pgB", status: "failed", timestamp: "2026-09-06T00:00:05.000Z" });
      expect((await store.getMessage({ waMessageId: "wamid.pgB" }))?.status).toBe("read");
    } finally {
      await store.close();
      await client.end();
    }
  });

  // WATS-200 storage correction: status-before-message reconciliation on real PG.
  maybeTest("status event before message projection is reconciled on recordMessage", async () => {
    const pg = (await import(PG_SPECIFIER)) as unknown as PgClientConstructor;
    const { createPostgresPersistenceWithClient } = await import("../src/postgres");
    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();
    for (const t of ["wats_message_status_events", "wats_messages", "wats_outbox", "wats_webhook_events", "wats_service_requests", "wats_schema_migrations", "wats_persistence_lock"]) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    const store = createPostgresPersistenceWithClient(client);
    await store.migrate();
    try {
      await store.appendMessageStatus({ waMessageId: "wamid.pgG", status: "delivered", timestamp: "2026-09-06T00:00:03.000Z" });
      await store.recordMessage({ rowId: "pg-rG", waMessageId: "wamid.pgG", direction: "outbound", type: "text", status: "sent", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z" });
      expect((await store.getMessage({ waMessageId: "wamid.pgG" }))?.status).toBe("delivered");
    } finally {
      await store.close();
      await client.end();
    }
  });

  // WATS-200 storage correction: migration 006 dedup keeps the most-advanced
  // status, not the smallest row_id, on real PG.
  maybeTest("migration dedup keeps most-advanced status on real Postgres", async () => {
    const pg = (await import(PG_SPECIFIER)) as unknown as PgClientConstructor;
    const { createPostgresPersistenceWithClient } = await import("../src/postgres");
    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();
    for (const t of ["wats_message_status_events", "wats_messages", "wats_outbox", "wats_webhook_events", "wats_service_requests", "wats_schema_migrations", "wats_persistence_lock"]) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    const store = createPostgresPersistenceWithClient(client);
    await store.migrate();
    // Do NOT call store.close() here — it would end() the shared client before
    // the direct re-seed queries below. The store is discarded after seeding.

    // Pre-seed duplicate (direction, wa_message_id) rows with differing status.
    await client.query("DROP INDEX IF EXISTS wats_messages_direction_wa_message_id_uidx");
    await client.query("DROP INDEX IF EXISTS wats_message_status_events_wa_message_id_status_timestamp_uidx");
    await client.query("DELETE FROM wats_schema_migrations WHERE id = '006_message_uniqueness'");
    await client.query("INSERT INTO wats_messages (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", ["aaa-1", "wamid.pgDEDUP", "outbound", null, null, "text", "sent", null, "2026-09-06T00:00:00.000Z", "2026-09-06T00:00:00.000Z"]);
    await client.query("INSERT INTO wats_messages (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", ["zzz-9", "wamid.pgDEDUP", "outbound", null, null, "text", "read", null, "2026-09-06T00:00:00.000Z", "2026-09-06T00:00:04.000Z"]);

    const store2 = createPostgresPersistenceWithClient(client);
    await store2.migrate();
    try {
      const rec = await store2.getMessage({ waMessageId: "wamid.pgDEDUP" });
      expect(rec?.status).toBe("read");
    } finally {
      await store2.close();
      await client.end();
    }
  });
});
