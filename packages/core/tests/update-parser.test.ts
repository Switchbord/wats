import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWebhookUpdate } from "../src/updateParser";

function readFixture(name: string): unknown {
  const fixturePath = join(import.meta.dir, "../../testing/fixtures/updates", name);
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

describe("C2 update parser", () => {
  test("parses valid envelope fixture into normalized events", () => {
    const envelope = readFixture("incoming-text-message.json");
    const result = parseWebhookUpdate(envelope);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected parser success");
    }

    expect(result.events.length).toBe(1);
    expect(result.skippedEntries).toBe(0);
    expect(result.skippedChanges).toBe(0);

    const event = result.events[0];
    expect(event.discriminator.field).toBe("messages");
    expect(event.discriminator.subtype).toBeUndefined();
    expect(event.discriminator.eventType).toBe("messages");
    expect(event.entry.index).toBe(0);
    expect(event.change.index).toBe(0);
    expect(event.entry.id).toBe("WABA123456");
    expect(event.object).toBe("whatsapp_business_account");
  });

  test("returns typed parser error for malformed envelope", () => {
    const malformed: unknown = { object: "whatsapp_business_account", entry: "oops" };
    const result = parseWebhookUpdate(malformed);

    expect(result).toEqual({
      ok: false,
      events: [],
      error: {
        code: "invalid_envelope",
        message: "Webhook envelope must include an entry array."
      }
    });
  });

  test("rejects unsupported webhook object with typed error", () => {
    const envelope: unknown = {
      object: "instagram",
      entry: []
    };

    const result = parseWebhookUpdate(envelope);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parser error");
    }

    expect(result.error.code).toBe("unsupported_object");
    expect(result.error.message).toContain("Unsupported webhook object");
  });

  test("enforces maxEntries parser limit", () => {
    const envelope: unknown = {
      object: "whatsapp_business_account",
      entry: [{ changes: [] }, { changes: [] }]
    };

    const result = parseWebhookUpdate(envelope, { maxEntries: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parser error");
    }

    expect(result.error.code).toBe("entries_limit_exceeded");
  });

  test("enforces maxChangesPerEntry parser limit", () => {
    const envelope: unknown = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            { field: "messages", value: {} },
            { field: "messages", value: {} }
          ]
        }
      ]
    };

    const result = parseWebhookUpdate(envelope, { maxChangesPerEntry: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parser error");
    }

    expect(result.error.code).toBe("changes_limit_exceeded");
  });

  test("enforces maxTotalEvents parser limit", () => {
    const envelope: unknown = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            { field: "messages", value: {} },
            { field: "messages", value: {} }
          ]
        }
      ]
    };

    const result = parseWebhookUpdate(envelope, { maxTotalEvents: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parser error");
    }

    expect(result.error.code).toBe("events_limit_exceeded");
  });

  test("returns skipped counters for nested malformed records", () => {
    const envelope: unknown = {
      object: "whatsapp_business_account",
      entry: [
        null,
        {
          id: "entry-1",
          changes: [
            null,
            { field: 123, value: {} },
            { field: "messages", value: null },
            { field: "messages", value: { ok: true } }
          ]
        }
      ]
    };

    const result = parseWebhookUpdate(envelope);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected parser success");
    }

    expect(result.events.length).toBe(1);
    expect(result.skippedEntries).toBe(1);
    expect(result.skippedChanges).toBe(3);
  });

  test("extracts discriminator and preserves change value reference", () => {
    const envelope = readFixture("outgoing-status-read.json") as {
      entry: Array<{ changes: Array<{ value: unknown }> }>;
    };

    const result = parseWebhookUpdate(envelope);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected parser success");
    }

    expect(result.events.length).toBe(1);
    expect(result.skippedEntries).toBe(0);
    expect(result.skippedChanges).toBe(0);

    const event = result.events[0];
    expect(event.discriminator.field).toBe("messages");
    expect(event.discriminator.subtype).toBe("message_status");
    expect(event.discriminator.eventType).toBe("messages.message_status");
    expect(event.change.value).toBe(envelope.entry[0]?.changes[0]?.value);
  });
});
