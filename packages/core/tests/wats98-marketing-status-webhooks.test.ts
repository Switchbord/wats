import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope,
  type TypedAccountUpdate,
  type TypedStatusUpdate
} from "../src/webhookNormalizer";

function makeMessagesEnvelope(statuses: readonly unknown[]): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA-WATS98",
      time: 1713697200,
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "15550001111",
            phone_number_id: "1234567890"
          },
          statuses
        }
      }]
    }]
  };
}

function makeAccountEnvelope(changes: readonly unknown[]): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA-WATS98", time: 1713697200, changes }]
  };
}

describe("WATS-98 Marketing Messages webhook/status deltas", () => {
  test("normalizes Marketing Messages Lite status pricing and conversation origin", () => {
    const result = normalizeWebhookEnvelope(makeMessagesEnvelope([
      {
        id: "wamid.marketing-status",
        recipient_id: "15551234567",
        status: "sent",
        timestamp: "1713697201",
        conversation: {
          id: "conv-marketing-lite",
          origin: { type: "marketing_lite" }
        },
        pricing: {
          billable: true,
          pricing_model: "PMP",
          category: "marketing_lite"
        }
      }
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(1);
    const update = result.updates[0] as TypedStatusUpdate;
    expect(update.kind).toBe("status");
    expect(update.status.pricing?.category).toBe("marketing_lite");
    expect(update.status.pricing?.pricingModel).toBe("PMP");
    expect(update.status.pricing?.billable).toBe(true);
    expect(update.status.conversation?.origin?.type).toBe("marketing_lite");
  });

  test("normalizes Marketing Messages API onboarding account_update fields", () => {
    const result = normalizeWebhookEnvelope(makeAccountEnvelope([
      {
        field: "account_update",
        value: {
          event: "MM_LITE_TERMS_SIGNED",
          waba_info: {
            owner_business_id: "987654321",
            waba_id: "123456789"
          }
        }
      }
    ]));

    expect(result.skipped).toEqual([]);
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.kind).toBe("account");
    expect(update.account?.event).toBe("MM_LITE_TERMS_SIGNED");
    expect(update.account?.marketingMessages?.wabaId).toBe("123456789");
    expect(update.account?.marketingMessages?.ownerBusinessId).toBe("987654321");
  });

  test("malformed marketing account payloads do not execute accessors or throw host errors", () => {
    const wabaInfo = {} as Record<string, unknown>;
    Object.defineProperty(wabaInfo, "waba_id", {
      enumerable: true,
      get() { throw new Error("waba_id getter should not run"); }
    });

    expect(() => normalizeWebhookEnvelope(makeAccountEnvelope([
      { field: "account_update", value: { event: "MM_LITE_TERMS_SIGNED", waba_info: wabaInfo } }
    ]))).not.toThrow(TypeError);

    const result = normalizeWebhookEnvelope(makeAccountEnvelope([
      { field: "account_update", value: { event: "MM_LITE_TERMS_SIGNED", waba_info: wabaInfo } }
    ]));
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.account?.event).toBe("MM_LITE_TERMS_SIGNED");
    expect(update.account?.marketingMessages?.wabaId).toBeUndefined();
  });
});
