import { describe, expect, test } from "bun:test";
import {
  createSqlitePersistence,
  type PersistenceStore,
  type ServiceRequestClaimInput,
  type ServiceRequestClaimResult,
  type ServiceRequestCompletionInput
} from "@wats/persistence";

// WATS-200 package-specifier consumer fixture. Imports via the published
// @wats/persistence specifier (resolves to dist/) and verifies the new
// claim/complete public API has the correct runtime shape and behavior, so
// downstream consumers can reach it without a relative-path self-import.

describe("WATS-200 persistence consumer fixture (package specifier)", () => {
  test("claimServiceRequest and completeServiceRequest are callable via the package specifier", async () => {
    const store: PersistenceStore = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    try {
      // Assert the new methods exist with correct runtime type.
      expect(typeof store.claimServiceRequest).toBe("function");
      expect(typeof store.completeServiceRequest).toBe("function");

      // First claim reserves the request and returns 'claimed'.
      const claimInput: ServiceRequestClaimInput = {
        idempotencyKey: "consumer-key",
        requestHash: "sha256:consumer-req",
        createdAt: "2026-09-06T00:00:00.000Z"
      };
      const firstClaim: ServiceRequestClaimResult = await store.claimServiceRequest(claimInput);
      expect(firstClaim).toBe("claimed");

      // Second claim with same key+hash returns 'pending' (no blind resend).
      const secondClaim: ServiceRequestClaimResult = await store.claimServiceRequest(claimInput);
      expect(secondClaim).toBe("pending");

      // Complete stores the response.
      const completionInput: ServiceRequestCompletionInput = {
        idempotencyKey: "consumer-key",
        requestHash: "sha256:consumer-req",
        responseJson: JSON.stringify({ messages: [{ id: "wamid.consumer" }] }),
        createdAt: "2026-09-06T00:00:01.000Z"
      };
      await store.completeServiceRequest(completionInput);

      // Subsequent claim replays the completed response.
      const replayClaim: ServiceRequestClaimResult = await store.claimServiceRequest(claimInput);
      expect(replayClaim).toEqual({ responseJson: completionInput.responseJson });
    } finally {
      await store.close();
    }
  });
});
