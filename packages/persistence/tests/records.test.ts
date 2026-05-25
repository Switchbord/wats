import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  PersistenceError,
  createSqlitePersistence
} from "../src/index";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats121-records-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("WATS-121 persistence idempotency records", () => {
  test("records webhook event keys once and reports duplicates without raw payload storage", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const recorder = store as unknown as {
        recordWebhookEvent(input: { eventKey: string; eventHash: string; receivedAt: string }): Promise<"recorded" | "duplicate">;
      };

      await expect(recorder.recordWebhookEvent({
        eventKey: "message:123456789012345:15551234567:wamid.WEBHOOK",
        eventHash: "sha256:webhook-shape-only",
        receivedAt: "2026-05-25T00:00:00.000Z"
      })).resolves.toBe("recorded");

      await expect(recorder.recordWebhookEvent({
        eventKey: "message:123456789012345:15551234567:wamid.WEBHOOK",
        eventHash: "sha256:webhook-shape-only",
        receivedAt: "2026-05-25T00:00:01.000Z"
      })).resolves.toBe("duplicate");
    } finally {
      await store.close();
    }
  });

  test("replays matching service idempotency records and rejects hash conflicts", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const serviceRequests = store as unknown as {
        getServiceRequest(input: { idempotencyKey: string; requestHash: string }): Promise<null | "conflict" | { responseJson: string }>;
        recordServiceRequest(input: { idempotencyKey: string; requestHash: string; responseJson: string; createdAt: string }): Promise<void>;
      };

      await expect(serviceRequests.getServiceRequest({
        idempotencyKey: "wats-local-send-1",
        requestHash: "sha256:request-a"
      })).resolves.toBeNull();

      await serviceRequests.recordServiceRequest({
        idempotencyKey: "wats-local-send-1",
        requestHash: "sha256:request-a",
        responseJson: JSON.stringify({ messages: [{ id: "wamid.ONE" }] }),
        createdAt: "2026-05-25T00:00:00.000Z"
      });

      await expect(serviceRequests.getServiceRequest({
        idempotencyKey: "wats-local-send-1",
        requestHash: "sha256:request-a"
      })).resolves.toEqual({ responseJson: JSON.stringify({ messages: [{ id: "wamid.ONE" }] }) });

      await expect(serviceRequests.getServiceRequest({
        idempotencyKey: "wats-local-send-1",
        requestHash: "sha256:request-b"
      })).resolves.toBe("conflict");
    } finally {
      await store.close();
    }
  });

  test("record APIs reject malformed keys and timestamps with typed non-leaking errors", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    try {
      const recorder = store as unknown as {
        recordWebhookEvent(input: { eventKey: string; eventHash: string; receivedAt: string }): Promise<"recorded" | "duplicate">;
      };
      await expect(recorder.recordWebhookEvent({
        eventKey: "token\nsecret",
        eventHash: "sha256:webhook-shape-only",
        receivedAt: "2026-05-25T00:00:00.000Z"
      })).rejects.toBeInstanceOf(PersistenceError);
      for (const receivedAt of ["1", "2026-05-25", "Mon, 25 May 2026 00:00:00 GMT"]) {
        await expect(recorder.recordWebhookEvent({
          eventKey: `message:bad-time:${receivedAt}`,
          eventHash: "sha256:webhook-shape-only",
          receivedAt
        })).rejects.toBeInstanceOf(PersistenceError);
      }
    } finally {
      await store.close();
    }
  });
});
