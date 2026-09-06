import { describe, expect, test } from "bun:test";

// WATS-200 real-Postgres concurrency test. The parent orchestrator provides
// an isolated Postgres instance via WATS_TEST_POSTGRES_URL. When the env var
// is absent, the test is SKIPPED (not a no-op pass) so CI clearly signals it
// needs a live backend. Uses dynamic import('pg') so the test file loads
// without the driver installed.
const PG_URL = process.env.WATS_TEST_POSTGRES_URL ?? "";

describe("WATS-200 real Postgres concurrency (env-gated)", () => {
  const maybeTest = PG_URL ? test : test.skip;

  maybeTest("concurrent claim + append serialize: no rollback crosstalk", async () => {
    const pg = await import("pg");
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
      const claimResult = (results[0] as PromiseFulfilledResult<{ id: string; status: string }[]>).value;
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
    const pg = await import("pg");
    const { createPostgresPersistenceWithClient } = await import("../src/postgres");

    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();

    const store = createPostgresPersistenceWithClient(client);
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
});
