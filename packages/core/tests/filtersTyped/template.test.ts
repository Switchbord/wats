// WATS-39 RED — typed template webhook filters.
//
// Behavioral coverage for template status/quality/category account updates:
// normalized payloads expose template helper fields and filtersTyped.template
// built-ins match without throwing on sibling kinds or malformed payloads.

import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope,
  type TypedAccountUpdate,
  type TypedMessageUpdate,
  type TypedUnknownUpdate
} from "../../src/webhookNormalizer";
import {
  FilterValidationError,
  template
} from "../../src/filtersTyped/index";

function envelope(field: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA123",
        time: 1713697200,
        changes: [{ field, value }]
      }
    ]
  };
}

function messageSibling(): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.1",
    phoneNumberId: "111",
    wabaId: "WABA123",
    receivedAt: 1,
    message: { id: "wamid.1", from: "1", timestamp: "1", type: "text", text: { body: "hi" } } as TypedMessageUpdate["message"],
    rawChange: {} as TypedMessageUpdate["rawChange"]
  };
}

function unknownSibling(): TypedUnknownUpdate {
  return {
    kind: "unknown",
    updateId: "u1",
    wabaId: "WABA123",
    receivedAt: 1,
    field: "future",
    rawChange: {} as TypedUnknownUpdate["rawChange"]
  };
}

describe("WATS-39 template webhook normalization", () => {
  test("message_template_status_update exposes normalized template fields", () => {
    const result = normalizeWebhookEnvelope(envelope("message_template_status_update", {
      event: "APPROVED",
      message_template_id: "tpl1",
      message_template_name: "order_ready",
      message_template_language: "en_US",
      reason: "NONE"
    }));
    expect(result.skipped.length).toBe(0);
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.kind).toBe("account");
    expect(update.eventName).toBe("message_template_status_update");
    expect(update.template?.event).toBe("APPROVED");
    expect(update.template?.id).toBe("tpl1");
    expect(update.template?.name).toBe("order_ready");
    expect(update.template?.language).toBe("en_US");
    expect(update.template?.reason).toBe("NONE");
  });

  test("template quality/category/component sibling account events expose template helper fields", () => {
    const result = normalizeWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: [{
        id: "WABA123",
        changes: [
          { field: "message_template_quality_update", value: { message_template_id: "tpl1", message_template_name: "n", message_template_language: "en_US", new_quality_score: "GREEN", previous_quality_score: "YELLOW" } },
          { field: "template_category_update", value: { message_template_id: "tpl2", message_template_name: "n2", message_template_language: "en_US", new_category: "UTILITY", previous_category: "MARKETING" } },
          { field: "message_template_components_update", value: { message_template_id: "tpl3", message_template_name: "n3", message_template_language: "en_US", components: [{ type: "BODY", text: "Hi" }] } }
        ]
      }]
    });
    const templates = result.updates.map((u) => (u as TypedAccountUpdate).template);
    expect(templates[0]?.qualityScore).toBe("GREEN");
    expect(templates[0]?.previousQualityScore).toBe("YELLOW");
    expect(templates[1]?.category).toBe("UTILITY");
    expect(templates[1]?.previousCategory).toBe("MARKETING");
    expect(Array.isArray(templates[2]?.components)).toBe(true);
  });

  test("malformed template webhook payloads never throw raw host errors", () => {
    const result = normalizeWebhookEnvelope(envelope("message_template_status_update", {
      event: 42,
      message_template_id: { nested: true },
      message_template_name: null,
      message_template_language: undefined
    }));
    expect(result.updates.length).toBe(1);
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.template).toBeUndefined();

    const accessorPayload = {
      message_template_id: "tpl1",
      message_template_name: "order_ready",
      message_template_language: "en_US"
    } as Record<string, unknown>;
    Object.defineProperty(accessorPayload, "event", { get() { throw new TypeError("event getter should not run"); } });
    expect(() => normalizeWebhookEnvelope(envelope("message_template_status_update", accessorPayload))).not.toThrow(TypeError);
    const accessorResult = normalizeWebhookEnvelope(envelope("message_template_status_update", accessorPayload));
    const accessorUpdate = accessorResult.updates[0] as TypedAccountUpdate;
    expect(accessorUpdate.kind).toBe("account");
    expect(accessorUpdate.template?.event).toBeUndefined();
  });

  test("unsafe template webhook helper id strings are not normalized", () => {
    const result = normalizeWebhookEnvelope(envelope("message_template_status_update", {
      event: "APPROVED",
      message_template_id: "tpl\n1",
      message_template_name: "order_ready",
      message_template_language: "en_US"
    }));
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.template).toBeUndefined();
    expect(update.kind).toBe("account");
  });

  test("template components helper is cloned and unsafe arrays are omitted", () => {
    const components = [{ type: "BODY", text: "Hi" }];
    const result = normalizeWebhookEnvelope(envelope("message_template_components_update", {
      message_template_id: "tpl1",
      message_template_name: "order_ready",
      message_template_language: "en_US",
      components
    }));
    const update = result.updates[0] as TypedAccountUpdate;
    components[0] = { type: "BODY", text: "mutated" };
    expect(update.template?.components?.[0]).toEqual({ type: "BODY", text: "Hi" });

    const sparse: unknown[] = [];
    sparse[1] = { type: "BODY", text: "Hi" };
    const sparseResult = normalizeWebhookEnvelope(envelope("message_template_components_update", {
      message_template_id: "tpl1",
      message_template_name: "order_ready",
      message_template_language: "en_US",
      components: sparse
    }));
    expect((sparseResult.updates[0] as TypedAccountUpdate).template?.components).toBeUndefined();

    const cyclicComponents: unknown[] = [];
    cyclicComponents.push(cyclicComponents);
    expect(() => normalizeWebhookEnvelope(envelope("message_template_components_update", {
      message_template_id: "tpl1",
      message_template_name: "order_ready",
      message_template_language: "en_US",
      components: cyclicComponents
    }))).not.toThrow(RangeError);

    const withAccessor = { type: "BODY" } as Record<string, unknown>;
    Object.defineProperty(withAccessor, "text", { get() { throw new TypeError("component getter should not run"); } });
    const unsafeComponentResult = normalizeWebhookEnvelope(envelope("message_template_components_update", {
      message_template_id: "tpl1",
      message_template_name: "order_ready",
      message_template_language: "en_US",
      components: [withAccessor]
    }));
    expect((unsafeComponentResult.updates[0] as TypedAccountUpdate).template?.components).toBeUndefined();
  });
});

describe("WATS-39 filtersTyped.template built-ins", () => {
  const approved = normalizeWebhookEnvelope(envelope("message_template_status_update", {
    event: "APPROVED",
    message_template_id: "tpl1",
    message_template_name: "order_ready",
    message_template_language: "en_US"
  })).updates[0] as TypedAccountUpdate;
  const rejected = normalizeWebhookEnvelope(envelope("message_template_status_update", {
    event: "REJECTED",
    message_template_id: "tpl2",
    message_template_name: "order_failed",
    message_template_language: "en_US"
  })).updates[0] as TypedAccountUpdate;
  const quality = normalizeWebhookEnvelope(envelope("message_template_quality_update", {
    message_template_id: "tpl1",
    message_template_name: "order_ready",
    message_template_language: "en_US",
    new_quality_score: "GREEN"
  })).updates[0] as TypedAccountUpdate;

  test("template.status matches only template status account updates", () => {
    const f = template.status();
    expect(f.predicate(approved)).toBe(true);
    expect(f.predicate(rejected)).toBe(true);
    expect(f.predicate(quality)).toBe(false);
    expect(f.predicate(messageSibling())).toBe(false);
    expect(f.predicate(unknownSibling())).toBe(false);
  });

  test("template.status(event) filters by event", () => {
    const f = template.status("APPROVED");
    expect(f.predicate(approved)).toBe(true);
    expect(f.predicate(rejected)).toBe(false);
  });

  test("template.name/id/language built-ins filter normalized helper fields", () => {
    expect(template.name("order_ready").predicate(approved)).toBe(true);
    expect(template.name("order_failed").predicate(approved)).toBe(false);
    expect(template.id("tpl1").predicate(approved)).toBe(true);
    expect(template.language("en_US").predicate(approved)).toBe(true);
  });

  test("template filters reject malformed construction inputs with FilterValidationError", () => {
    expect(() => template.status("")).toThrow(FilterValidationError);
    expect(() => template.status(42 as never)).toThrow(FilterValidationError);
    expect(() => template.name("")).toThrow(FilterValidationError);
    expect(() => template.id(null as never)).toThrow(FilterValidationError);
    expect(() => template.language("   ")).toThrow(FilterValidationError);
  });
});
