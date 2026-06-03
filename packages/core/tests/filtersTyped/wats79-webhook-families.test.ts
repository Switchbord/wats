// WATS-79 RED — typed filters for first-slice webhook families.

import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope,
  type TypedAccountUpdate,
  type TypedChatOpenedUpdate,
  type TypedSystemUpdate,
  type TypedUserPreferencesUpdate
} from "../../src/webhookNormalizer";
import { chatOpened, system, userPreferences } from "../../src/filtersTyped/index";

function envelope(field: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA123", time: 1713697200, changes: [{ field, value }] }]
  };
}

function accountSibling(): TypedAccountUpdate {
  return {
    kind: "account",
    updateId: "account-1",
    wabaId: "WABA123",
    receivedAt: 1,
    eventName: "account_update",
    payload: {},
    rawChange: {} as TypedAccountUpdate["rawChange"]
  };
}

const userOptOut = normalizeWebhookEnvelope(envelope("user_preferences", {
  messaging_product: "whatsapp",
  metadata: { phone_number_id: "PN123" },
  user_preferences: [{ wa_id: "15551234567", category: "marketing_messages", preference: "opt_out", timestamp: "1713697000" }]
})).updates[0] as TypedUserPreferencesUpdate;

const userOptIn = normalizeWebhookEnvelope(envelope("user_preferences", {
  messaging_product: "whatsapp",
  metadata: { phone_number_id: "PN123" },
  user_preferences: [{ wa_id: "15557654321", category: "marketing_messages", preference: "opt_in", timestamp: "1713697100" }]
})).updates[0] as TypedUserPreferencesUpdate;

const phoneChange = normalizeWebhookEnvelope(envelope("system", {
  messaging_product: "whatsapp",
  metadata: { phone_number_id: "PN123" },
  system: [{ type: "phone_number_change", new_phone_number: "15552220000", timestamp: "1713697100" }]
})).updates[0] as TypedSystemUpdate;

const identityChange = normalizeWebhookEnvelope(envelope("system", {
  messaging_product: "whatsapp",
  metadata: { phone_number_id: "PN123" },
  system: [{ type: "identity_change", wa_id: "15551234567", acknowledged: true, created_timestamp: "1713697200" }]
})).updates[0] as TypedSystemUpdate;

const requestWelcome = normalizeWebhookEnvelope(envelope("chat_opened", {
  messaging_product: "whatsapp",
  metadata: { phone_number_id: "PN123" },
  chat_opened: { type: "REQUEST_WELCOME", from: "15551234567", timestamp: "1713697300" }
})).updates[0] as TypedChatOpenedUpdate;

describe("WATS-79 filtersTyped webhook-family built-ins", () => {
  test("userPreferences filters by kind, preference, and category", () => {
    expect(userPreferences.predicate(userOptOut)).toBe(true);
    expect(userPreferences.predicate(accountSibling())).toBe(false);
    expect(userPreferences.preference("opt_out").predicate(userOptOut)).toBe(true);
    expect(userPreferences.preference("opt_out").predicate(userOptIn)).toBe(false);
    expect(userPreferences.category("marketing_messages").predicate(userOptOut)).toBe(true);
  });

  test("system filters by event type", () => {
    expect(system.predicate(phoneChange)).toBe(true);
    expect(system.predicate(identityChange)).toBe(true);
    expect(system.phoneNumberChange().predicate(phoneChange)).toBe(true);
    expect(system.phoneNumberChange().predicate(identityChange)).toBe(false);
    expect(system.identityChange().predicate(identityChange)).toBe(true);
    expect(system.identityChange().predicate(accountSibling())).toBe(false);
  });

  test("chatOpened filters request welcome hooks", () => {
    expect(chatOpened.predicate(requestWelcome)).toBe(true);
    expect(chatOpened.requestWelcome().predicate(requestWelcome)).toBe(true);
    expect(chatOpened.requestWelcome().predicate(userOptOut)).toBe(false);
  });
});
