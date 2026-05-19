import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope,
  type TypedAccountUpdate,
  type TypedMessageUpdate,
  type TypedStatusUpdate
} from "../src/webhookNormalizer";

function makeEnvelope(changes: readonly unknown[]): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA-WATS89", time: 1713697200, changes }]
  };
}

function messagesChange(value: Record<string, unknown>): Record<string, unknown> {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "15550001111",
        phone_number_id: "1234567890"
      },
      ...value
    }
  };
}

describe("WATS-89 v24/v25 webhook normalization refresh", () => {
  test("accepts played status without conversation and keeps conversation optional", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      messagesChange({
        statuses: [{
          id: "wamid.PLAYED",
          recipient_id: "15551234567",
          status: "played",
          timestamp: "1713697200"
        }]
      })
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(1);
    const update = result.updates[0] as TypedStatusUpdate;
    expect(update.kind).toBe("status");
    expect(update.status.status).toBe("played");
    expect(update.status.recipientId).toBe("15551234567");
    expect(update.status.conversation).toBeUndefined();
  });

  test("normalizes inbound media url onto public media.url", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      messagesChange({
        messages: [{
          from: "15551234567",
          id: "wamid.MEDIAURL",
          timestamp: "1713697198",
          type: "image",
          image: {
            id: "MEDIA_ID",
            mime_type: "image/jpeg",
            sha256: "sha-image",
            url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA_ID"
          }
        }]
      })
    ]));

    expect(result.skipped).toEqual([]);
    const update = result.updates[0] as TypedMessageUpdate;
    expect(update.message.type).toBe("image");
    expect(update.message.image.url).toBe("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA_ID");
    expect("mime_type" in (update.message.image as unknown as Record<string, unknown>)).toBe(false);
  });

  test("unsupported messages preserve detailed unsupported payload fields", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      messagesChange({
        messages: [{
          from: "15551234567",
          id: "wamid.UNSUPPORTED",
          timestamp: "1713697198",
          type: "unsupported",
          errors: [{ code: 131051, title: "Unsupported message type", message: "Message type is not supported" }],
          unsupported: {
            type: "request_welcome",
            title: "Request Welcome removed",
            description: "request_welcome is no longer supported"
          }
        }]
      })
    ]));

    expect(result.skipped).toEqual([]);
    const update = result.updates[0] as TypedMessageUpdate;
    expect(update.message.type).toBe("unsupported");
    expect(update.message.unsupported?.type).toBe("request_welcome");
    expect(update.message.unsupported?.title).toBe("Request Welcome removed");
    expect(update.message.errors?.[0]?.code).toBe(131051);
  });

  test("coexistence account_update PARTNER_REMOVED carries disconnection_info", () => {
    const change = {
      field: "account_update",
      value: {
        event: "PARTNER_REMOVED",
        waba_info: { id: "WABA-WATS89" },
        disconnection_info: {
          reason: "PARTNER_REMOVED",
          partner_id: "PARTNER-1",
          partner_name: "Partner One"
        }
      }
    };

    const result = normalizeWebhookEnvelope(makeEnvelope([change]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(1);
    const update = result.updates[0] as TypedAccountUpdate;
    expect(update.kind).toBe("account");
    expect(update.eventName).toBe("account_update");
    expect(update.account?.event).toBe("PARTNER_REMOVED");
    expect(update.account?.disconnectionInfo?.reason).toBe("PARTNER_REMOVED");
    expect(update.account?.disconnectionInfo?.partnerId).toBe("PARTNER-1");
  });

  test("account offboarded and reconnected fields produce typed account updates", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      { field: "account_offboarded", value: { event: "ACCOUNT_OFFBOARDED", waba_info: { id: "WABA-WATS89" } } },
      { field: "account_reconnected", value: { event: "ACCOUNT_RECONNECTED", waba_info: { id: "WABA-WATS89" } } }
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.map((u) => u.kind)).toEqual(["account", "account"]);
    const offboarded = result.updates[0] as TypedAccountUpdate;
    const reconnected = result.updates[1] as TypedAccountUpdate;
    expect(offboarded.eventName).toBe("account_offboarded");
    expect(offboarded.account?.event).toBe("ACCOUNT_OFFBOARDED");
    expect(reconnected.eventName).toBe("account_reconnected");
    expect(reconnected.account?.event).toBe("ACCOUNT_RECONNECTED");
  });
});
