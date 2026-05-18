// WATS-43A RED — deep message webhook normalization.
// Behavioral coverage for credential-free message body families, descriptor-safe
// nested reads, rawChange preservation, limit behavior, and malformed-payload
// no-raw-throw guarantees. Implementation is intentionally absent in RED.

import { describe, expect, test } from "bun:test";
import {
  MAX_ID_LENGTH,
  WebhookNormalizationError,
  normalizeWebhookEnvelope,
  type TypedMessageUpdate
} from "../src/webhookNormalizer";

function changeWithMessages(messages: readonly unknown[]): Record<string, unknown> {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "15550001111",
        phone_number_id: "1234567890"
      },
      messages
    }
  };
}

function envelopeForChange(change: unknown): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-DEEP",
        time: 1713697200,
        changes: [change]
      }
    ]
  };
}

function baseMessage(id: string, type: string, body: Record<string, unknown>): Record<string, unknown> {
  return {
    from: "15551234567",
    id,
    timestamp: "1713697198",
    type,
    [type]: body
  };
}

function normalizedMessages(messages: readonly unknown[], opts?: { maxEventsPerEnvelope?: number }) {
  const result = normalizeWebhookEnvelope(envelopeForChange(changeWithMessages(messages)), opts);
  return result.updates.filter((u): u is TypedMessageUpdate => u.kind === "message");
}

describe("WATS-43A normalizeWebhookEnvelope deep message normalization", () => {
  test("normalizes media messages to safe camelCase own-data bodies and preserves rawChange", () => {
    const change = changeWithMessages([
      baseMessage("wamid.IMG", "image", {
        id: "media-image",
        mime_type: "image/jpeg",
        sha256: "sha-image",
        caption: "image caption"
      }),
      baseMessage("wamid.VID", "video", {
        id: "media-video",
        mime_type: "video/mp4",
        sha256: "sha-video",
        caption: "video caption"
      }),
      baseMessage("wamid.AUD", "audio", {
        id: "media-audio",
        mime_type: "audio/ogg",
        sha256: "sha-audio"
      }),
      baseMessage("wamid.DOC", "document", {
        id: "media-document",
        mime_type: "application/pdf",
        sha256: "sha-document",
        caption: "doc caption",
        filename: "invoice.pdf"
      }),
      baseMessage("wamid.STK", "sticker", {
        id: "media-sticker",
        mime_type: "image/webp",
        sha256: "sha-sticker"
      })
    ]);

    const result = normalizeWebhookEnvelope(envelopeForChange(change));
    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(5);

    const image = result.updates[0] as TypedMessageUpdate;
    const video = result.updates[1] as TypedMessageUpdate;
    const audio = result.updates[2] as TypedMessageUpdate;
    const document = result.updates[3] as TypedMessageUpdate;
    const sticker = result.updates[4] as TypedMessageUpdate;

    expect(image.rawChange).toBe(change);
    expect(image.message.type).toBe("image");
    expect(image.message.image.id).toBe("media-image");
    expect(image.message.image.mimeType).toBe("image/jpeg");
    expect("mime_type" in (image.message.image as unknown as Record<string, unknown>)).toBe(false);
    expect(video.message.video.mimeType).toBe("video/mp4");
    expect(audio.message.audio.mimeType).toBe("audio/ogg");
    expect(document.message.document.filename).toBe("invoice.pdf");
    expect(sticker.message.sticker.mimeType).toBe("image/webp");
  });

  test("normalizes interactive button/list/nfm replies and quick-reply buttons", () => {
    const updates = normalizedMessages([
      baseMessage("wamid.IB", "interactive", {
        type: "button_reply",
        button_reply: { id: "btn-1", title: "Yes" }
      }),
      baseMessage("wamid.IL", "interactive", {
        type: "list_reply",
        list_reply: { id: "row-1", title: "Row", description: "Row desc" }
      }),
      baseMessage("wamid.IN", "interactive", {
        type: "nfm_reply",
        nfm_reply: { response_json: "{\"flow\":true}", body: "Done", name: "flow-name" }
      }),
      baseMessage("wamid.BTN", "button", {
        text: "Quick reply",
        payload: "payload-1"
      })
    ]);

    expect(updates.length).toBe(4);
    expect(updates[0]?.message.interactive.type).toBe("button_reply");
    expect(updates[0]?.message.interactive.buttonReply.id).toBe("btn-1");
    expect("button_reply" in (updates[0]?.message.interactive as unknown as Record<string, unknown>)).toBe(false);
    expect(updates[1]?.message.interactive.listReply.description).toBe("Row desc");
    expect(updates[2]?.message.interactive.nfmReply.responseJson).toBe("{\"flow\":true}");
    expect(updates[3]?.message.button.payload).toBe("payload-1");
  });

  test("normalizes location and reaction messages including reaction removal", () => {
    const updates = normalizedMessages([
      baseMessage("wamid.LOC", "location", {
        latitude: 37.422,
        longitude: -122.084,
        name: "Googleplex",
        address: "1600 Amphitheatre Pkwy"
      }),
      baseMessage("wamid.REACT", "reaction", {
        message_id: "wamid.ORIGINAL",
        emoji: "👍"
      }),
      baseMessage("wamid.REMOVE", "reaction", {
        message_id: "wamid.ORIGINAL",
        emoji: ""
      })
    ]);

    expect(updates.length).toBe(3);
    expect(updates[0]?.message.location.latitude).toBe(37.422);
    expect(updates[0]?.message.location.longitude).toBe(-122.084);
    expect(updates[1]?.message.reaction.messageId).toBe("wamid.ORIGINAL");
    expect(updates[1]?.message.reaction.emoji).toBe("👍");
    expect(updates[2]?.message.reaction.emoji).toBe("");
    expect("message_id" in (updates[1]?.message.reaction as unknown as Record<string, unknown>)).toBe(false);
  });

  test("normalizes context to camelCase and omits unsafe prototype keys and cyclic extras", () => {
    const context: Record<string, unknown> = {
      id: "wamid.PARENT",
      from: "15550000000",
      forwarded: true,
      frequently_forwarded: true
    };
    Object.defineProperty(context, "__proto__", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(context, "constructor", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(context, "prototype", { value: { polluted: true }, enumerable: true });
    context.self = context;

    const updates = normalizedMessages([
      {
        from: "15551234567",
        id: "wamid.CTX",
        timestamp: "1713697198",
        type: "text",
        text: { body: "reply" },
        context
      }
    ]);

    const normalizedContext = updates[0]?.message.context as unknown as Record<string, unknown>;
    expect(normalizedContext.messageId).toBe("wamid.PARENT");
    expect(normalizedContext.frequentlyForwarded).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(normalizedContext, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(normalizedContext, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(normalizedContext, "prototype")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(normalizedContext, "self")).toBe(false);
  });

  test("malformed nested payloads and accessor array slots skip or omit without raw host throws", () => {
    let arraySlotGetterExecuted = false;
    const accessorMessages: unknown[] = [];
    Object.defineProperty(accessorMessages, "0", {
      enumerable: true,
      get() {
        arraySlotGetterExecuted = true;
        throw new Error("array slot getter must not run");
      }
    });

    expect(() => normalizeWebhookEnvelope(envelopeForChange(changeWithMessages(accessorMessages)))).not.toThrow();
    const skippedSlot = normalizeWebhookEnvelope(envelopeForChange(changeWithMessages(accessorMessages)));
    expect(arraySlotGetterExecuted).toBe(false);
    expect(skippedSlot.updates.length).toBe(0);
    expect(skippedSlot.skipped[0]?.reason).toBe("malformed_field");

    let nestedGetterExecuted = false;
    const mediaBody: Record<string, unknown> = { mime_type: "image/jpeg" };
    Object.defineProperty(mediaBody, "id", {
      enumerable: true,
      get() {
        nestedGetterExecuted = true;
        throw new Error("nested getter must not run");
      }
    });
    const noThrow = normalizedMessages([baseMessage("wamid.BADMEDIA", "image", mediaBody)]);
    expect(nestedGetterExecuted).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(noThrow[0]?.message ?? {}, "image")).toBe(false);

    const timestampTrap: Record<string, unknown> = {
      from: "15551234567",
      id: "wamid.TSTRAP",
      type: "text",
      text: { body: "fallback" }
    };
    Object.defineProperty(timestampTrap, "timestamp", {
      enumerable: true,
      get() {
        throw new Error("timestamp getter must not run");
      }
    });
    const result = normalizeWebhookEnvelope(envelopeForChange(changeWithMessages([timestampTrap])), {
      clockNow: () => 123_456
    });
    expect((result.updates[0] as TypedMessageUpdate).receivedAt).toBe(123_456);
  });

  test("deep message normalization composes with at-limit and over-limit soft truncation", () => {
    const atLimit = normalizeWebhookEnvelope(
      envelopeForChange(
        changeWithMessages([
          baseMessage("wamid.L1", "image", { id: "m1", mime_type: "image/jpeg" }),
          baseMessage("wamid.L2", "location", { latitude: 1, longitude: 2 })
        ])
      ),
      { maxEventsPerEnvelope: 2 }
    );
    expect(atLimit.updates.length).toBe(2);
    expect(atLimit.limitError).toBeUndefined();
    expect(((atLimit.updates[0] as TypedMessageUpdate).message.image.mimeType)).toBe("image/jpeg");

    const overLimit = normalizeWebhookEnvelope(
      envelopeForChange(
        changeWithMessages([
          baseMessage("wamid.O1", "image", { id: "m1", mime_type: "image/jpeg" }),
          baseMessage("wamid.O2", "location", { latitude: 1, longitude: 2 }),
          baseMessage("wamid.O3", "reaction", { message_id: "wamid.O1", emoji: "🔥" })
        ])
      ),
      { maxEventsPerEnvelope: 2 }
    );
    expect(overLimit.updates.length).toBe(2);
    expect(overLimit.limitError?.limit).toBe(2);
    expect((overLimit.limitError?.count ?? 0) > 2).toBe(true);
  });

  test("WATS-43A boundary checks keep existing typed error taxonomy", () => {
    expect(MAX_ID_LENGTH).toBe(256);
    expect(() =>
      normalizeWebhookEnvelope(envelopeForChange(changeWithMessages([])), {
        maxEventsPerEnvelope: Number.NaN
      })
    ).toThrow(WebhookNormalizationError);

    const tooLongId = "x".repeat(MAX_ID_LENGTH + 1);
    const result = normalizeWebhookEnvelope(
      envelopeForChange(changeWithMessages([baseMessage(tooLongId, "image", { id: "m", mime_type: "image/jpeg" })]))
    );
    expect(result.updates.length).toBe(0);
    expect(result.skipped[0]?.reason).toBe("malformed_field");
  });
});
