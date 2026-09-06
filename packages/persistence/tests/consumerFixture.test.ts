import { describe, expect, test } from "bun:test";
import {
  createSqlitePersistence,
  type PersistenceStore
} from "@wats/persistence";

// WATS-200 package-specifier consumer fixture. Imports via the published
// @wats/persistence specifier (resolves to dist/) and verifies the new
// claim/complete public API has the correct runtime shape, so downstream
// consumers can reach it without a relative-path self-import.

describe("WATS-200 persistence consumer fixture (package specifier)", () => {
  test("claimServiceRequest and completeServiceRequest are callable on a store created via the package specifier", async () => {
    const store: PersistenceStore = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    try {
      expect(typeof (store as unknown as Record<string, unknown>).claimServiceRequest).toBe("function");
      expect(typeof (store as unknown as Record<string, unknown>).completeServiceRequest).toBe("function");

      const result = await (
        store as unknown as {
          claimServiceRequest(input: { idempotencyKey: string; requestHash: string; createdAt: string }): Promise<unknown>;
        }
      ).claimServiceRequest({ idempotencyKey: "consumer-key", requestHash: "sha256:consumer-req", createdAt: "2026-09-06T00:00:00.000Z" });
      expect(result).toBe("claimed");
    } finally {
      await store.close();
    }
  });
});
