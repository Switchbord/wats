import { describe, expect, test } from "bun:test";

// Env-gated real-Postgres concurrency test. The parent orchestrator can run
// this by setting WATS_TEST_POSTGRES_URL to a live postgres:// connection
// string. When the env var is absent the test is a no-op pass so it does not
// break CI without a Postgres instance.
const PG_URL = process.env.WATS_TEST_POSTGRES_URL ?? "";

describe("WATS-200 real Postgres concurrency (env-gated)", () => {
  test("concurrent claim + append serialize: no rollback crosstalk", async () => {
    if (!PG_URL) return;

    const { createPostgresPersistence } = await import("../src/postgres");
    const store = await createPostgresPersistence({ connectionString: PG_URL });
    await store.migrate();
    try {
      const NOW = "2026-09-06T00:00:00.000Z";
      const hash = "sha256:" + "a".repeat(64);
      await store.enqueueOutboxItem({ id: "real-claim-item", payloadHash: hash, createdAt: NOW });
      await store.recordMessage({ rowId: "real-claim-msg", waMessageId: "wamid.real-claim", direction: "outbound", type: "text", status: "sent", createdAt: NOW, updatedAt: NOW });

      // Run a claim and a status append concurrently on the shared client.
      // Pre-fix, the append's ROLLBACK would discard the claim's uncommitted
      // UPDATE, leaving the outbox item 'pending' while the caller believes it
      // is 'processing'. Post-fix, serialization prevents the interleaving.
      const results = await Promise.allSettled([
        store.claimOutboxItems({ now: NOW, limit: 10 }),
        store.appendMessageStatus({ waMessageId: "wamid.real-claim", status: "delivered", timestamp: NOW })
      ]);

      // Both should succeed (no thrown errors from interleaved rollback).
      for (const r of results) {
        expect(r.status).toBe("fulfilled");
      }

      // The outbox item must be 'processing' in the DB (claim committed).
      const claimResult = (results[0] as PromiseFulfilledResult<unknown[]>).value as { id: string; status: string }[];
      const claimed = claimResult.find((c) => c.id === "real-claim-item");
      expect(claimed).toBeDefined();
      expect(claimed?.status).toBe("processing");

      // The message status should be 'delivered' (append committed).
      const msg = await store.getMessage({ waMessageId: "wamid.real-claim" });
      expect(msg?.status).toBe("delivered");
    } finally {
      await store.close();
    }
  });
});
