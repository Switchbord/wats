// WATS-79 RED — first slice webhook-family normalization.
//
// user_preferences, system, and chat_opened should graduate from
// TypedUnknownUpdate into typed updates with camelCase helper payloads.

import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope,
  type TypedChatOpenedUpdate,
  type TypedSystemUpdate,
  type TypedUserPreferencesUpdate
} from "../src/webhookNormalizer";

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

describe("WATS-79 webhook-family normalization", () => {
  test("user_preferences opt-out update is typed and camelCase", () => {
    const result = normalizeWebhookEnvelope(envelope("user_preferences", {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15551230000", phone_number_id: "PN123" },
      user_preferences: [
        {
          wa_id: "15551234567",
          category: "marketing_messages",
          preference: "opt_out",
          timestamp: "1713697000"
        }
      ]
    }));

    expect(result.skipped.length).toBe(0);
    const update = result.updates[0] as TypedUserPreferencesUpdate;
    expect(update.kind).toBe("userPreferences");
    expect(update.updateId).toBe("userPreferences:WABA123:PN123:15551234567:marketing_messages:1713697000");
    expect(update.phoneNumberId).toBe("PN123");
    expect(update.preference.waId).toBe("15551234567");
    expect(update.preference.category).toBe("marketing_messages");
    expect(update.preference.preference).toBe("opt_out");
    expect(update.preference.timestamp).toBe("1713697000");
    expect(update.receivedAt).toBe(1713697000000);
  });

  test("system phone-number and identity changes are typed sibling updates", () => {
    const result = normalizeWebhookEnvelope(envelope("system", {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15551230000", phone_number_id: "PN123" },
      system: [
        {
          type: "phone_number_change",
          mobile_display_name: "Support",
          old_phone_number: "15551110000",
          new_phone_number: "15552220000",
          timestamp: "1713697100"
        },
        {
          type: "identity_change",
          wa_id: "15551234567",
          acknowledged: false,
          created_timestamp: "1713697200",
          hash: "identity-hash"
        }
      ]
    }));

    expect(result.skipped.length).toBe(0);
    const phoneChange = result.updates[0] as TypedSystemUpdate;
    const identityChange = result.updates[1] as TypedSystemUpdate;
    expect(phoneChange.kind).toBe("system");
    expect(phoneChange.system.type).toBe("phoneNumberChange");
    expect(phoneChange.system.phoneNumberChange?.mobileDisplayName).toBe("Support");
    expect(phoneChange.system.phoneNumberChange?.oldPhoneNumber).toBe("15551110000");
    expect(phoneChange.system.phoneNumberChange?.newPhoneNumber).toBe("15552220000");
    expect(identityChange.kind).toBe("system");
    expect(identityChange.system.type).toBe("identityChange");
    expect(identityChange.system.identityChange?.waId).toBe("15551234567");
    expect(identityChange.system.identityChange?.acknowledged).toBe(false);
    expect(identityChange.system.identityChange?.createdTimestamp).toBe("1713697200");
    expect(identityChange.system.identityChange?.hash).toBe("identity-hash");
  });

  test("chat_opened REQUEST_WELCOME update is typed", () => {
    const result = normalizeWebhookEnvelope(envelope("chat_opened", {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15551230000", phone_number_id: "PN123" },
      contacts: [{ wa_id: "15551234567", profile: { name: "Ada" } }],
      chat_opened: {
        type: "REQUEST_WELCOME",
        from: "15551234567",
        timestamp: "1713697300"
      }
    }));

    expect(result.skipped.length).toBe(0);
    const update = result.updates[0] as TypedChatOpenedUpdate;
    expect(update.kind).toBe("chatOpened");
    expect(update.phoneNumberId).toBe("PN123");
    expect(update.chatOpened.type).toBe("REQUEST_WELCOME");
    expect(update.chatOpened.from).toBe("15551234567");
    expect(update.chatOpened.contact?.waId).toBe("15551234567");
    expect(update.chatOpened.contact?.profile?.name).toBe("Ada");
  });

  test("malformed first-slice payloads skip instead of emitting unknown or throwing host errors", () => {
    const poisoned = { messaging_product: "whatsapp", metadata: { phone_number_id: "PN123" } } as Record<string, unknown>;
    Object.defineProperty(poisoned, "user_preferences", { get() { throw new TypeError("getter should not run"); } });

    expect(() => normalizeWebhookEnvelope(envelope("user_preferences", poisoned))).not.toThrow(TypeError);
    const result = normalizeWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: [{
        id: "WABA123",
        changes: [
          { field: "user_preferences", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "bad\nPN" }, user_preferences: [] } },
          { field: "system", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PN123" }, system: [{ type: "phone_number_change" }] } },
          { field: "chat_opened", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PN123" }, chat_opened: { type: "REQUEST_WELCOME" } } }
        ]
      }]
    });

    expect(result.updates.length).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(["malformed_field", "malformed_field", "malformed_field"]);
  });
});
