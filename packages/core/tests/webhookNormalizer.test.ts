// F-8 RED — webhookNormalizer coverage.
//
// Exhaustive behavioral tests for the typed-update normalizer. Every
// branch of the battery (sections 1, 2, 4, 6, 7, 9) is exercised. The
// GREEN commit supplies the implementation.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_EVENTS_PER_ENVELOPE,
  normalizeWebhookEnvelope,
  WebhookNormalizationError,
  type NormalizedWebhookResult,
  type SkippedUpdate,
  type TypedAccountUpdate,
  type TypedMessageUpdate,
  type TypedStatusUpdate,
  type TypedUnknownUpdate,
  type TypedUpdate
} from "../src/webhookNormalizer";

// ---------- fixture builders ----------

function makeMessageChange(overrides?: {
  field?: string;
  phoneNumberId?: string;
  messages?: readonly unknown[];
  statuses?: readonly unknown[];
}): Record<string, unknown> {
  return {
    field: overrides?.field ?? "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "15550001111",
        phone_number_id: overrides?.phoneNumberId ?? "1234567890"
      },
      ...(overrides?.messages !== undefined
        ? { messages: overrides.messages }
        : {}),
      ...(overrides?.statuses !== undefined
        ? { statuses: overrides.statuses }
        : {})
    }
  };
}

function makeMessage(overrides?: {
  id?: unknown;
  type?: string;
  timestamp?: string;
  body?: string;
}): Record<string, unknown> {
  return {
    from: "15551234567",
    id: overrides?.id ?? "wamid.ABC123",
    timestamp: overrides?.timestamp ?? "1713697198",
    type: overrides?.type ?? "text",
    text: { body: overrides?.body ?? "hello" }
  };
}

function makeStatus(overrides?: {
  id?: unknown;
  status?: string;
  timestamp?: string;
}): Record<string, unknown> {
  return {
    id: overrides?.id ?? "wamid.STATUS1",
    recipient_id: "15551234567",
    status: overrides?.status ?? "sent",
    timestamp: overrides?.timestamp ?? "1713697200"
  };
}

function makeEnvelope(changes: readonly unknown[], wabaId = "WABA123"): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        time: 1713697200,
        changes
      }
    ]
  };
}

// ---------- Section 1: envelope-level input rejection (throw) ----------

describe("F-8 normalizeWebhookEnvelope — envelope-level input rejection", () => {
  test("null envelope throws WebhookNormalizationError invalid_envelope", () => {
    let captured: unknown;
    try {
      normalizeWebhookEnvelope(null);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WebhookNormalizationError);
    expect((captured as WebhookNormalizationError).code).toBe("invalid_envelope");
  });

  test("undefined envelope throws WebhookNormalizationError invalid_envelope", () => {
    expect(() => normalizeWebhookEnvelope(undefined)).toThrow(
      WebhookNormalizationError
    );
  });

  test("string envelope throws WebhookNormalizationError invalid_envelope", () => {
    let captured: unknown;
    try {
      normalizeWebhookEnvelope("not an object");
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WebhookNormalizationError);
    expect((captured as WebhookNormalizationError).code).toBe("invalid_envelope");
  });

  test("array envelope throws WebhookNormalizationError invalid_envelope", () => {
    let captured: unknown;
    try {
      normalizeWebhookEnvelope([]);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WebhookNormalizationError);
    expect((captured as WebhookNormalizationError).code).toBe("invalid_envelope");
  });

  test("empty object (no `object` field) throws missing_object_field", () => {
    let captured: unknown;
    try {
      normalizeWebhookEnvelope({});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WebhookNormalizationError);
    expect((captured as WebhookNormalizationError).code).toBe(
      "missing_object_field"
    );
  });

  test("wrong object discriminator throws unsupported_object", () => {
    let captured: unknown;
    try {
      normalizeWebhookEnvelope({ object: "page", entry: [] });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WebhookNormalizationError);
    expect((captured as WebhookNormalizationError).code).toBe(
      "unsupported_object"
    );
  });

  test("null entry throws invalid_entry_array", () => {
    let captured: unknown;
    try {
      normalizeWebhookEnvelope({
        object: "whatsapp_business_account",
        entry: null
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WebhookNormalizationError);
    expect((captured as WebhookNormalizationError).code).toBe(
      "invalid_entry_array"
    );
  });

  test("non-array entry throws invalid_entry_array", () => {
    let captured: unknown;
    try {
      normalizeWebhookEnvelope({
        object: "whatsapp_business_account",
        entry: { id: "x" }
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(WebhookNormalizationError);
    expect((captured as WebhookNormalizationError).code).toBe(
      "invalid_entry_array"
    );
  });

  test("empty entry array returns empty result (no throw)", () => {
    const result = normalizeWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: []
    });
    expect(result.updates.length).toBe(0);
    expect(result.skipped.length).toBe(0);
    expect(result.limitError).toBeUndefined();
  });

  test("WebhookNormalizationError is an instance of Error (sibling-class check)", () => {
    const err = new WebhookNormalizationError({ code: "invalid_envelope" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WebhookNormalizationError);
    // Sibling-NOT: must not be confused with TypeError.
    expect(err).not.toBeInstanceOf(TypeError);
  });
});

// ---------- Section 1+4: entry / change / field skip accumulation ----------

describe("F-8 normalizeWebhookEnvelope — entry/change skip accumulation (never throws)", () => {
  test("entry missing id is skipped with malformed_entry", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [{ changes: [] }]
    };
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped.length).toBeGreaterThanOrEqual(1);
    expect(result.skipped[0]?.reason).toBe("malformed_entry");
  });

  test("entry with non-array changes is skipped with malformed_entry", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [{ id: "WABA1", changes: "nope" }]
    };
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_entry");
  });

  test("non-object entry is skipped with malformed_entry", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [null, "x", 5]
    };
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped.length).toBe(3);
    for (const s of result.skipped) {
      expect(s.reason).toBe("malformed_entry");
    }
  });

  test("entry id with CRLF is skipped with malformed_entry (WATS-12 L6)", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [{ id: "WABA\r\nINJ", changes: [] }]
    };
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_entry");
  });

  test("entry id with NUL is skipped (WATS-12 L6)", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [{ id: "WABA\u0000X", changes: [] }]
    };
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_entry");
  });

  test("change without field is skipped with malformed_change", () => {
    const envelope = makeEnvelope([{ value: {} }, null]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped.length).toBe(2);
    for (const s of result.skipped) {
      expect(s.reason).toBe("malformed_change");
    }
  });

  test("change with non-string field is skipped with malformed_change", () => {
    const envelope = makeEnvelope([{ field: 123, value: {} }]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.skipped[0]?.reason).toBe("malformed_change");
  });

  test("change with non-object value is skipped with malformed_change", () => {
    const envelope = makeEnvelope([{ field: "messages", value: "nope" }]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.skipped[0]?.reason).toBe("malformed_change");
  });

  test("skipped entries include a path pointer", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [null]
    };
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.skipped[0]?.path).toContain("entry[0]");
  });
});

// ---------- Section 1: message normalization ----------

describe("F-8 normalizeWebhookEnvelope — message updates", () => {
  test("single message change produces 1 TypedMessageUpdate", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ messages: [makeMessage()] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    expect(result.skipped.length).toBe(0);
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.kind).toBe("message");
    expect(u.updateId).toBe("wamid.ABC123");
    expect(u.wabaId).toBe("WABA123");
    expect(u.phoneNumberId).toBe("1234567890");
    expect(typeof u.receivedAt).toBe("number");
    expect(u.rawChange).toBeDefined();
  });

  test("receivedAt derived from message.timestamp (unix seconds → ms)", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ messages: [makeMessage({ timestamp: "1713697198" })] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.receivedAt).toBe(1713697198 * 1000);
  });

  test("clockNow fallback used when message.timestamp missing", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [{ from: "x", id: "wamid.NT", type: "text", text: { body: "h" } }]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope, {
      clockNow: () => 42_000
    });
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.receivedAt).toBe(42_000);
  });

  test("multiple messages in one change yield multiple TypedMessageUpdates", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [
          makeMessage({ id: "wamid.A" }),
          makeMessage({ id: "wamid.B" }),
          makeMessage({ id: "wamid.C" })
        ]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(3);
    expect((result.updates[0] as TypedMessageUpdate).updateId).toBe("wamid.A");
    expect((result.updates[2] as TypedMessageUpdate).updateId).toBe("wamid.C");
  });

  test("message missing id is skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [{ from: "x", timestamp: "1", type: "text", text: { body: "hi" } }]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("message with non-string id is skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: 42 })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("message id with CR/LF rejected with malformed_field (WATS-12 L6)", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.X\r\nY" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("message id with NUL rejected with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.\u0000X" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("phone_number_id with CRLF → skipped with malformed_field (WATS-12 L6)", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "bad\r\nphone",
        messages: [makeMessage()]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
    expect(result.skipped[0]?.path).toContain("metadata");
  });

  test("phone_number_id with NUL → skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "bad\u0000phone",
        messages: [makeMessage()]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("non-string phone_number_id → all messages in change skipped", () => {
    const envelope = makeEnvelope([
      {
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: 5 },
          messages: [makeMessage()]
        }
      }
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("text body preserves CR/LF/Unicode verbatim (no content sanitization)", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ body: "line1\r\nline2\u0000end" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    const change = (result.updates[0] as TypedMessageUpdate)
      .rawChange as { value: { messages: { text: { body: string } }[] } };
    expect(change.value.messages[0]?.text.body).toBe("line1\r\nline2\u0000end");
  });

  test("sibling-class: TypedMessageUpdate.kind === 'message' (NOT 'status')", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ messages: [makeMessage()] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    const u = result.updates[0] as TypedUpdate;
    expect(u.kind).toBe("message");
    expect(u.kind).not.toBe("status");
    expect(u.kind).not.toBe("account");
    expect(u.kind).not.toBe("unknown");
  });
});

// ---------- status normalization ----------

describe("F-8 normalizeWebhookEnvelope — status updates", () => {
  test("status change produces TypedStatusUpdate", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ statuses: [makeStatus()] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedStatusUpdate;
    expect(u.kind).toBe("status");
    expect(u.updateId).toBe("wamid.STATUS1");
  });

  test("status missing id skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ statuses: [{ status: "sent", recipient_id: "x" }] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("status with CR/LF in id rejected (WATS-12 L6)", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ statuses: [makeStatus({ id: "wamid.\r\n" })] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });

  test("sibling-class: status kind is 'status' not 'message'", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ statuses: [makeStatus()] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    const u = result.updates[0] as TypedUpdate;
    expect(u.kind).toBe("status");
    expect(u.kind).not.toBe("message");
  });

  test("mixed messages + statuses in a single change both emit", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.M" })],
        statuses: [makeStatus({ id: "wamid.S" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(2);
    const kinds = result.updates.map((u) => u.kind);
    expect(kinds).toContain("message");
    expect(kinds).toContain("status");
  });
});

// ---------- account normalization ----------

describe("F-8 normalizeWebhookEnvelope — account + unknown updates", () => {
  test("account_update field yields TypedAccountUpdate", () => {
    const envelope = makeEnvelope([
      { field: "account_update", value: { decision: "APPROVED" } }
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedAccountUpdate;
    expect(u.kind).toBe("account");
    expect(u.eventName).toBe("account_update");
    expect(u.wabaId).toBe("WABA123");
  });

  test("account_review_update field yields TypedAccountUpdate", () => {
    const envelope = makeEnvelope([
      { field: "account_review_update", value: { decision: "REJECTED" } }
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect((result.updates[0] as TypedAccountUpdate).eventName).toBe(
      "account_review_update"
    );
  });

  test("message_template_status_update field yields TypedAccountUpdate", () => {
    const envelope = makeEnvelope([
      {
        field: "message_template_status_update",
        value: { event: "APPROVED", message_template_id: "t1" }
      }
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates[0]?.kind).toBe("account");
  });

  test("unknown field yields TypedUnknownUpdate", () => {
    const envelope = makeEnvelope([
      { field: "some_new_feature_2026", value: { raw: true } }
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedUnknownUpdate;
    expect(u.kind).toBe("unknown");
    expect(u.field).toBe("some_new_feature_2026");
  });

  test("sibling-class: account !== unknown", () => {
    const envelope = makeEnvelope([
      { field: "account_update", value: {} }
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates[0]?.kind).toBe("account");
    expect(result.updates[0]?.kind).not.toBe("unknown");
  });
});

// ---------- duplicate-id dedup within envelope ----------

describe("F-8 normalizeWebhookEnvelope — duplicate id dedup (WATS-14 L8)", () => {
  test("two messages with same id: first wins, second skipped with duplicate_update_id", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [
          makeMessage({ id: "wamid.DUP", body: "first" }),
          makeMessage({ id: "wamid.DUP", body: "second" })
        ]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.updateId).toBe("wamid.DUP");
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.reason).toBe("duplicate_update_id");
  });

  test("duplicate across different changes in the same envelope is deduped", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ messages: [makeMessage({ id: "wamid.X" })] }),
      makeMessageChange({ messages: [makeMessage({ id: "wamid.X" })] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    expect(result.skipped[0]?.reason).toBe("duplicate_update_id");
  });

  test("status + message with same id: both kept (different kinds → different ids)", () => {
    // The dedup key includes kind to avoid false-positive collisions when
    // a message-id happens to match a status-id from Meta.
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.SHARE" })],
        statuses: [makeStatus({ id: "wamid.SHARE" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(2);
  });
});

// ---------- soft-truncate limit ----------

describe("F-8 normalizeWebhookEnvelope — maxEventsPerEnvelope soft-truncate (WATS-2 / WATS-7)", () => {
  test("default limit exposed as DEFAULT_MAX_EVENTS_PER_ENVELOPE (finite positive integer)", () => {
    expect(DEFAULT_MAX_EVENTS_PER_ENVELOPE).toBe(1000);
    expect(Number.isSafeInteger(DEFAULT_MAX_EVENTS_PER_ENVELOPE)).toBe(true);
  });

  test("under the limit: no limitError", () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage({ id: `wamid.U${i}` })
    );
    const envelope = makeEnvelope([makeMessageChange({ messages })]);
    const result = normalizeWebhookEnvelope(envelope, {
      maxEventsPerEnvelope: 10
    });
    expect(result.updates.length).toBe(5);
    expect(result.limitError).toBeUndefined();
  });

  test("exactly at the limit: no limitError", () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMessage({ id: `wamid.E${i}` })
    );
    const envelope = makeEnvelope([makeMessageChange({ messages })]);
    const result = normalizeWebhookEnvelope(envelope, {
      maxEventsPerEnvelope: 10
    });
    expect(result.updates.length).toBe(10);
    expect(result.limitError).toBeUndefined();
  });

  test("over the limit: soft-truncate with limitError populated", () => {
    const messages = Array.from({ length: 11 }, (_, i) =>
      makeMessage({ id: `wamid.O${i}` })
    );
    const envelope = makeEnvelope([makeMessageChange({ messages })]);
    const result = normalizeWebhookEnvelope(envelope, {
      maxEventsPerEnvelope: 10
    });
    expect(result.updates.length).toBe(10);
    expect(result.limitError).toBeDefined();
    expect(result.limitError?.limit).toBe(10);
    expect(result.limitError?.count).toBeGreaterThan(10);
  });

  test("soft-truncate preserves first-N (not last-N) deterministic order", () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage({ id: `wamid.ORD${i}` })
    );
    const envelope = makeEnvelope([makeMessageChange({ messages })]);
    const result = normalizeWebhookEnvelope(envelope, {
      maxEventsPerEnvelope: 3
    });
    const ids = result.updates.map((u) => u.updateId);
    expect(ids).toEqual(["wamid.ORD0", "wamid.ORD1", "wamid.ORD2"]);
  });
});

// ---------- error taxonomy — partial failure (Section 6) ----------

describe("F-8 normalizeWebhookEnvelope — partial-failure observability (Section 6)", () => {
  test("10 changes, 3 malformed → 7 updates + 3 skipped", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ messages: [makeMessage({ id: "wamid.1" })] }),
      { field: "messages" }, // malformed_change (no value)
      makeMessageChange({ messages: [makeMessage({ id: "wamid.2" })] }),
      null, // malformed_change
      makeMessageChange({ messages: [makeMessage({ id: "wamid.3" })] }),
      makeMessageChange({ messages: [makeMessage({ id: "wamid.4" })] }),
      { field: 7, value: {} }, // malformed_change (non-string field)
      makeMessageChange({ messages: [makeMessage({ id: "wamid.5" })] }),
      makeMessageChange({ messages: [makeMessage({ id: "wamid.6" })] }),
      makeMessageChange({ messages: [makeMessage({ id: "wamid.7" })] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(7);
    expect(result.skipped.length).toBe(3);
    for (const s of result.skipped) {
      expect(s.reason).toBe("malformed_change");
    }
  });

  test("each SkippedUpdate carries a reason code AND a path pointer", () => {
    const envelope = makeEnvelope([
      { field: "messages" } // malformed
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    const skipped = result.skipped[0] as SkippedUpdate;
    expect(typeof skipped.reason).toBe("string");
    expect(typeof skipped.path).toBe("string");
    expect(skipped.path.length).toBeGreaterThan(0);
  });
});

// ---------- multi-entry ----------

describe("F-8 normalizeWebhookEnvelope — multiple entries", () => {
  test("two entries produce updates tagged with distinct wabaIds", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-A",
          changes: [makeMessageChange({ messages: [makeMessage({ id: "wamid.A" })] })]
        },
        {
          id: "WABA-B",
          changes: [makeMessageChange({ messages: [makeMessage({ id: "wamid.B" })] })]
        }
      ]
    };
    const result: NormalizedWebhookResult = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(2);
    const wabas = new Set(result.updates.map((u) => u.wabaId));
    expect(wabas.has("WABA-A")).toBe(true);
    expect(wabas.has("WABA-B")).toBe(true);
  });
});

// ---------- F-8 remediation (WATS-29) ----------
//
// Adversarial-review follow-up: expanded control-char rejection,
// parseTimestampMs sanity cap, id length cap, strict option validation.

describe("F-8 remediation: expanded isSafeIdString control-char rejection", () => {
  test("phoneNumberId = tab (0x09) → message skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "123\t456",
        messages: [makeMessage({ id: "wamid.TAB" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" &&
          s.path.includes("phone_number_id")
      )
    ).toBe(true);
  });

  test("phoneNumberId = DEL (0x7F) → message skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "123\u007f456",
        messages: [makeMessage({ id: "wamid.DEL" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" &&
          s.path.includes("phone_number_id")
      )
    ).toBe(true);
  });

  test("phoneNumberId = U+2028 line separator → message skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "123\u2028456",
        messages: [makeMessage({ id: "wamid.LS" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" &&
          s.path.includes("phone_number_id")
      )
    ).toBe(true);
  });

  test("phoneNumberId = U+2029 paragraph separator → message skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "123\u2029456",
        messages: [makeMessage({ id: "wamid.PS" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" &&
          s.path.includes("phone_number_id")
      )
    ).toBe(true);
  });

  test("phoneNumberId = whitespace-only → message skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "     ",
        messages: [makeMessage({ id: "wamid.WS" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" &&
          s.path.includes("phone_number_id")
      )
    ).toBe(true);
  });

  test("messageId = tab → message skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.\tBAD" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" &&
          s.path.includes("messages[")
      )
    ).toBe(true);
  });

  test("entry.id containing tab → entry skipped with malformed_entry", () => {
    const envelope: Record<string, unknown> = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA\tX",
          changes: [makeMessageChange({ messages: [makeMessage({ id: "wamid.E" })] })]
        }
      ]
    };
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_entry" && s.path === "entry[0]"
      )
    ).toBe(true);
  });
});

describe("F-8 remediation: parseTimestampMs sanity cap", () => {
  test("absurd timestamp '9999999999999999999' falls back to clockNow, not 1e22", () => {
    const fixedNow = 1_700_000_000_000;
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.TS1", timestamp: "9999999999999999999" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope, {
      clockNow: () => fixedNow
    });
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.receivedAt).toBe(fixedNow);
  });

  test("negative timestamp falls back to clockNow", () => {
    const fixedNow = 1_700_000_000_000;
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.TS2", timestamp: "-1" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope, {
      clockNow: () => fixedNow
    });
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.receivedAt).toBe(fixedNow);
  });

  test("timestamp '0' falls back to clockNow", () => {
    const fixedNow = 1_700_000_000_000;
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "wamid.TS3", timestamp: "0" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope, {
      clockNow: () => fixedNow
    });
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.receivedAt).toBe(fixedNow);
  });
});

describe("F-8 remediation: id length cap (MAX_ID_LENGTH = 256)", () => {
  test("phoneNumberId length 257 → skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "a".repeat(257),
        messages: [makeMessage({ id: "wamid.L1" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" &&
          s.path.includes("phone_number_id")
      )
    ).toBe(true);
  });

  test("phoneNumberId length 256 → accepted", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        phoneNumberId: "a".repeat(256),
        messages: [makeMessage({ id: "wamid.L2" })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(1);
    const u = result.updates[0] as TypedMessageUpdate;
    expect(u.phoneNumberId.length).toBe(256);
  });

  test("messageId length 257 → skipped with malformed_field", () => {
    const envelope = makeEnvelope([
      makeMessageChange({
        messages: [makeMessage({ id: "a".repeat(257) })]
      })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    expect(result.updates.length).toBe(0);
    expect(
      result.skipped.some(
        (s: SkippedUpdate) =>
          s.reason === "malformed_field" && s.path.includes("messages[")
      )
    ).toBe(true);
  });
});

describe("F-8 remediation: strict maxEventsPerEnvelope option validation", () => {
  function validEnvelope(): Record<string, unknown> {
    return makeEnvelope([
      makeMessageChange({ messages: [makeMessage({ id: "wamid.OPT" })] })
    ]);
  }

  test("maxEventsPerEnvelope = 0 throws WebhookNormalizationError with code invalid_option", () => {
    try {
      normalizeWebhookEnvelope(validEnvelope(), { maxEventsPerEnvelope: 0 });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookNormalizationError);
      expect((err as WebhookNormalizationError).code).toBe("invalid_option");
    }
  });

  test("maxEventsPerEnvelope = -1 throws WebhookNormalizationError", () => {
    expect(() =>
      normalizeWebhookEnvelope(validEnvelope(), { maxEventsPerEnvelope: -1 })
    ).toThrow(WebhookNormalizationError);
  });

  test("maxEventsPerEnvelope = NaN throws WebhookNormalizationError", () => {
    expect(() =>
      normalizeWebhookEnvelope(validEnvelope(), { maxEventsPerEnvelope: Number.NaN })
    ).toThrow(WebhookNormalizationError);
  });

  test("maxEventsPerEnvelope = Infinity throws WebhookNormalizationError", () => {
    expect(() =>
      normalizeWebhookEnvelope(validEnvelope(), {
        maxEventsPerEnvelope: Number.POSITIVE_INFINITY
      })
    ).toThrow(WebhookNormalizationError);
  });

  test("maxEventsPerEnvelope = 0.5 throws WebhookNormalizationError", () => {
    expect(() =>
      normalizeWebhookEnvelope(validEnvelope(), { maxEventsPerEnvelope: 0.5 })
    ).toThrow(WebhookNormalizationError);
  });

  test("maxEventsPerEnvelope = 1 is accepted", () => {
    const result = normalizeWebhookEnvelope(validEnvelope(), {
      maxEventsPerEnvelope: 1
    });
    expect(result.updates.length).toBe(1);
  });
});

// ---------- discriminated-union compile-time narrowing ----------

describe("F-8 TypedUpdate discriminated union narrowing", () => {
  test("narrowing on kind yields field-specific access without casting", () => {
    const envelope = makeEnvelope([
      makeMessageChange({ messages: [makeMessage({ id: "wamid.N1" })] })
    ]);
    const result = normalizeWebhookEnvelope(envelope);
    const u = result.updates[0]!;
    let seenPhoneNumberId = "";
    switch (u.kind) {
      case "message":
        // No cast — `phoneNumberId` is on TypedMessageUpdate.
        seenPhoneNumberId = u.phoneNumberId;
        break;
      case "status":
        seenPhoneNumberId = u.phoneNumberId;
        break;
      case "account":
        seenPhoneNumberId = "";
        break;
      case "unknown":
        seenPhoneNumberId = "";
        break;
    }
    expect(seenPhoneNumberId).toBe("1234567890");
  });
});
