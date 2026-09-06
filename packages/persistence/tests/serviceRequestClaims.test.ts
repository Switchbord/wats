import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PersistenceError, createSqlitePersistence } from "../src/index";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats200-claims-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ISO = "2026-09-06T00:00:00.000Z";
const RESP = JSON.stringify({ messages: [{ id: "wamid.ONE" }] });

interface ClaimApi {
  claimServiceRequest(input: { idempotencyKey: string; requestHash: string; createdAt: string }): Promise<"claimed" | "pending" | "conflict" | { responseJson: string }>;
  completeServiceRequest(input: { idempotencyKey: string; requestHash: string; responseJson: string; createdAt: string }): Promise<void>;
}

function claims(store: unknown): ClaimApi {
  return store as unknown as ClaimApi;
}

describe("WATS-200 service request claims", () => {
  test("first claim reserves the request and returns 'claimed'", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const result = await claims(store).claimServiceRequest({ idempotencyKey: "key-1", requestHash: "sha256:req-a", createdAt: ISO });
      expect(result).toBe("claimed");
    } finally {
      await store.close();
    }
  });

  test("second claim with same key+hash returns 'pending' (no blind resend)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await claims(store).claimServiceRequest({ idempotencyKey: "key-2", requestHash: "sha256:req-b", createdAt: ISO });
      const result = await claims(store).claimServiceRequest({ idempotencyKey: "key-2", requestHash: "sha256:req-b", createdAt: ISO });
      expect(result).toBe("pending");
    } finally {
      await store.close();
    }
  });

  test("claim with same key but different hash returns 'conflict'", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await claims(store).claimServiceRequest({ idempotencyKey: "key-3", requestHash: "sha256:req-c", createdAt: ISO });
      const result = await claims(store).claimServiceRequest({ idempotencyKey: "key-3", requestHash: "sha256:req-d", createdAt: ISO });
      expect(result).toBe("conflict");
    } finally {
      await store.close();
    }
  });

  test("complete after claim stores the response; subsequent claim replays it", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      expect(await claims(store).claimServiceRequest({ idempotencyKey: "key-4", requestHash: "sha256:req-e", createdAt: ISO })).toBe("claimed");
      await claims(store).completeServiceRequest({ idempotencyKey: "key-4", requestHash: "sha256:req-e", responseJson: RESP, createdAt: ISO });
      const result = await claims(store).claimServiceRequest({ idempotencyKey: "key-4", requestHash: "sha256:req-e", createdAt: ISO });
      expect(result).toEqual({ responseJson: RESP });
    } finally {
      await store.close();
    }
  });

  test("complete with mismatched hash fails with typed PersistenceError", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await claims(store).claimServiceRequest({ idempotencyKey: "key-5", requestHash: "sha256:req-f", createdAt: ISO });
      await expect(claims(store).completeServiceRequest({ idempotencyKey: "key-5", requestHash: "sha256:wrong", responseJson: RESP, createdAt: ISO }))
        .rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await store.close();
    }
  });

  test("complete without a prior claim fails with typed PersistenceError", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await expect(claims(store).completeServiceRequest({ idempotencyKey: "key-6", requestHash: "sha256:req-g", responseJson: RESP, createdAt: ISO }))
        .rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await store.close();
    }
  });

  test("old recordServiceRequest does not overwrite a claim", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await claims(store).claimServiceRequest({ idempotencyKey: "key-7", requestHash: "sha256:req-h", createdAt: ISO });
      await store.recordServiceRequest({ idempotencyKey: "key-7", requestHash: "sha256:req-h", responseJson: RESP, createdAt: ISO });
      const result = await claims(store).claimServiceRequest({ idempotencyKey: "key-7", requestHash: "sha256:req-h", createdAt: ISO });
      expect(result).toBe("pending");
    } finally {
      await store.close();
    }
  });

  test("old getServiceRequest returns null for a claimed-but-not-completed row", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await claims(store).claimServiceRequest({ idempotencyKey: "key-8", requestHash: "sha256:req-i", createdAt: ISO });
      const result = await store.getServiceRequest({ idempotencyKey: "key-8", requestHash: "sha256:req-i" });
      expect(result).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("old getServiceRequest replays a completed claim normally", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await claims(store).claimServiceRequest({ idempotencyKey: "key-8b", requestHash: "sha256:req-i2", createdAt: ISO });
      await claims(store).completeServiceRequest({ idempotencyKey: "key-8b", requestHash: "sha256:req-i2", responseJson: RESP, createdAt: ISO });
      const result = await store.getServiceRequest({ idempotencyKey: "key-8b", requestHash: "sha256:req-i2" });
      expect(result).toEqual({ responseJson: RESP });
    } finally {
      await store.close();
    }
  });

  test("claims persist across restart indefinitely (new store instance, same file)", async () => {
    const db = tempDb();
    const store1 = await createSqlitePersistence({ filename: db });
    await store1.migrate();
    await claims(store1).claimServiceRequest({ idempotencyKey: "key-9", requestHash: "sha256:req-j", createdAt: ISO });
    await store1.close();

    const store2 = await createSqlitePersistence({ filename: db });
    await store2.migrate();
    try {
      const result = await claims(store2).claimServiceRequest({ idempotencyKey: "key-9", requestHash: "sha256:req-j", createdAt: ISO });
      expect(result).toBe("pending");
    } finally {
      await store2.close();
    }
  });

  test("completed claim also persists across restart and replays", async () => {
    const db = tempDb();
    const store1 = await createSqlitePersistence({ filename: db });
    await store1.migrate();
    await claims(store1).claimServiceRequest({ idempotencyKey: "key-10", requestHash: "sha256:req-k", createdAt: ISO });
    await claims(store1).completeServiceRequest({ idempotencyKey: "key-10", requestHash: "sha256:req-k", responseJson: RESP, createdAt: ISO });
    await store1.close();

    const store2 = await createSqlitePersistence({ filename: db });
    await store2.migrate();
    try {
      const result = await claims(store2).claimServiceRequest({ idempotencyKey: "key-10", requestHash: "sha256:req-k", createdAt: ISO });
      expect(result).toEqual({ responseJson: RESP });
    } finally {
      await store2.close();
    }
  });

  test("malformed claim/complete inputs throw PersistenceError without leaking", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      await expect(claims(store).claimServiceRequest({ idempotencyKey: "", requestHash: "sha256:x", createdAt: ISO } as never))
        .rejects.toBeInstanceOf(PersistenceError);
      await expect(claims(store).claimServiceRequest({ idempotencyKey: "k", requestHash: "", createdAt: ISO } as never))
        .rejects.toBeInstanceOf(PersistenceError);
      await expect(claims(store).claimServiceRequest({ idempotencyKey: "k", requestHash: "sha256:x", createdAt: "no" } as never))
        .rejects.toBeInstanceOf(PersistenceError);
      await expect(claims(store).claimServiceRequest(null as never))
        .rejects.toBeInstanceOf(PersistenceError);
      await expect(claims(store).completeServiceRequest({ idempotencyKey: "k", requestHash: "sha256:x", responseJson: "", createdAt: ISO } as never))
        .rejects.toBeInstanceOf(PersistenceError);
      await expect(claims(store).completeServiceRequest({ idempotencyKey: "k", requestHash: "sha256:x", responseJson: "{bad", createdAt: ISO } as never))
        .rejects.toBeInstanceOf(PersistenceError);
    } finally {
      await store.close();
    }
  });
});
