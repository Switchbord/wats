import { describe, expect, test } from "bun:test";
import type { TypedMessageUpdate, TypedStatusUpdate } from "../src/webhookNormalizer";
import { status } from "../src/filtersTyped/index";

function statusUpdate(kind: "sent" | "delivered" | "read" | "played" | "failed" | "deleted" | "warning"): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: `wamid.${kind}`,
    phoneNumberId: "123",
    wabaId: "WABA",
    receivedAt: 1,
    status: { id: `wamid.${kind}`, recipientId: "15551234567", status: kind, timestamp: "1" },
    rawChange: {} as TypedStatusUpdate["rawChange"]
  };
}

function messageUpdate(): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.msg",
    phoneNumberId: "123",
    wabaId: "WABA",
    receivedAt: 1,
    message: { type: "text", id: "wamid.msg", from: "15551234567", timestamp: "1", text: { body: "hi" } },
    rawChange: {} as TypedMessageUpdate["rawChange"]
  };
}

describe("WATS-89 played status typed filter", () => {
  test("status.played matches only played statuses and is sibling-kind safe", () => {
    const f = status.played();
    expect(f.predicate(statusUpdate("played"))).toBe(true);
    expect(f.predicate(statusUpdate("read"))).toBe(false);
    expect(f.predicate(statusUpdate("failed"))).toBe(false);
    expect(f.predicate(messageUpdate())).toBe(false);
    expect(f.describe()).toBe("status.played()");
  });
});
