import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope,
  type TypedAccountUpdate
} from "../src/webhookNormalizer";

function makeEnvelope(changes: readonly unknown[]): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA-WATS95", time: 1713697200, changes }]
  };
}

describe("WATS-95 business webhook alert deltas", () => {
  test("normalizes phone_number_quality_update throughput upgrade and unlimited tier values", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      {
        field: "phone_number_quality_update",
        value: {
          display_phone_number: "15550783881",
          event: "THROUGHPUT_UPGRADE",
          old_limit: "TIER_100K",
          current_limit: "TIER_UNLIMITED",
          max_daily_conversations_per_business: "TIER_UNLIMITED"
        }
      }
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(1);
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.kind).toBe("account");
    expect(update.eventName).toBe("phone_number_quality_update");
    expect(update.account?.event).toBe("THROUGHPUT_UPGRADE");
    expect(update.account?.phoneNumberQuality?.displayPhoneNumber).toBe("15550783881");
    expect(update.account?.phoneNumberQuality?.currentLimit).toBe("TIER_UNLIMITED");
    expect(update.account?.phoneNumberQuality?.maxDailyConversationsPerBusiness).toBe("TIER_UNLIMITED");
  });

  test("normalizes account_alerts PROFILE_PICTURE_LOST alert_info without throwing on siblings", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      {
        field: "account_alerts",
        value: {
          entity_type: "PHONE_NUMBER",
          entity_id: "506914307656634",
          alert_info: {
            alert_severity: "WARNING",
            alert_status: "ACTIVE",
            alert_type: "PROFILE_PICTURE_LOST",
            alert_description: "Please reupload your profile picture"
          }
        }
      }
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(1);
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.kind).toBe("account");
    expect(update.eventName).toBe("account_alerts");
    expect(update.account?.alert?.entityType).toBe("PHONE_NUMBER");
    expect(update.account?.alert?.entityId).toBe("506914307656634");
    expect(update.account?.alert?.type).toBe("PROFILE_PICTURE_LOST");
    expect(update.account?.alert?.description).toBe("Please reupload your profile picture");
  });

  test("malformed alert payloads are account updates but do not execute accessors or throw host errors", () => {
    const alertInfo = {} as Record<string, unknown>;
    Object.defineProperty(alertInfo, "alert_type", {
      enumerable: true,
      get() { throw new Error("alert_type getter should not run"); }
    });

    expect(() => normalizeWebhookEnvelope(makeEnvelope([
      { field: "account_alerts", value: { entity_type: "PHONE_NUMBER", entity_id: "506914307656634", alert_info: alertInfo } }
    ]))).not.toThrow(TypeError);

    const result = normalizeWebhookEnvelope(makeEnvelope([
      { field: "account_alerts", value: { entity_type: "PHONE_NUMBER", entity_id: "506914307656634", alert_info: alertInfo } },
      { field: "phone_number_quality_update", value: { event: "THROUGHPUT_UPGRADE", current_limit: null } }
    ]));

    expect(result.updates.length).toBe(2);
    const alertUpdate = result.updates[0] as TypedAccountUpdate;
    const qualityUpdate = result.updates[1] as TypedAccountUpdate;
    expect(alertUpdate.kind).toBe("account");
    expect(alertUpdate.account?.alert).toBeUndefined();
    expect(qualityUpdate.account?.phoneNumberQuality?.currentLimit).toBeUndefined();
    expect(qualityUpdate.account?.event).toBe("THROUGHPUT_UPGRADE");
  });
});
