// WATS-43A RED — deep message webhook normalization.
// Behavioral coverage for credential-free message body families, descriptor-safe
// nested reads, rawChange preservation, limit behavior, and malformed-payload
// no-raw-throw guarantees. Implementation is intentionally absent in RED.

import { describe, expect, test } from "bun:test";
import type { InteractiveReply, WhatsAppMessage } from "@wats/types";
import {
  MAX_ID_LENGTH,
  WebhookNormalizationError,
  normalizeWebhookEnvelope,
  type TypedMessageUpdate
} from "../src/webhookNormalizer";

// Narrow a message union on its `.type` discriminant before reading variant
// fields. Also asserts the discriminant at runtime, strengthening the test.
function asType<K extends WhatsAppMessage["type"]>(
  m: WhatsAppMessage,
  t: K
): Extract<WhatsAppMessage, { type: K }> {
  if (m.type !== t) throw new Error(`expected ${t}, got ${m.type}`);
  return m as Extract<WhatsAppMessage, { type: K }>;
}

// Same narrowing for the nested interactive reply union.
function asInteractive<K extends InteractiveReply["type"]>(
  r: InteractiveReply,
  t: K
): Extract<InteractiveReply, { type: K }> {
  if (r.type !== t) throw new Error(`expected ${t}, got ${r.type}`);
  return r as Extract<InteractiveReply, { type: K }>;
}

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

    expect<unknown>(image.rawChange).toBe(change); // rawChange is WhatsAppWebhookChange; the fixture is a Record — compare by identity
    expect(image.message.type).toBe("image");
    const imageMsg = asType(image.message, "image");
    const videoMsg = asType(video.message, "video");
    const audioMsg = asType(audio.message, "audio");
    const documentMsg = asType(document.message, "document");
    const stickerMsg = asType(sticker.message, "sticker");
    expect(imageMsg.image.id).toBe("media-image");
    expect(imageMsg.image.mimeType).toBe("image/jpeg");
    expect("mime_type" in (imageMsg.image as unknown as Record<string, unknown>)).toBe(false);
    expect(videoMsg.video.mimeType).toBe("video/mp4");
    expect(audioMsg.audio.mimeType).toBe("audio/ogg");
    expect(documentMsg.document.filename).toBe("invoice.pdf");
    expect(stickerMsg.sticker.mimeType).toBe("image/webp");
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
    const interactive0 = asType(updates[0]!.message, "interactive");
    const interactive1 = asType(updates[1]!.message, "interactive");
    const interactive2 = asType(updates[2]!.message, "interactive");
    const buttonMsg = asType(updates[3]!.message, "button");
    const buttonReply = asInteractive(interactive0.interactive, "button_reply");
    const listReply = asInteractive(interactive1.interactive, "list_reply");
    const nfmReply = asInteractive(interactive2.interactive, "nfm_reply");
    expect(interactive0.interactive.type).toBe("button_reply");
    expect(buttonReply.buttonReply.id).toBe("btn-1");
    expect("button_reply" in (interactive0.interactive as unknown as Record<string, unknown>)).toBe(false);
    expect(listReply.listReply.description).toBe("Row desc");
    expect(nfmReply.nfmReply.responseJson).toBe("{\"flow\":true}");
    expect(buttonMsg.button.payload).toBe("payload-1");
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
    const locationMsg = asType(updates[0]!.message, "location");
    const reaction1 = asType(updates[1]!.message, "reaction");
    const reaction2 = asType(updates[2]!.message, "reaction");
    expect(locationMsg.location.latitude).toBe(37.422);
    expect(locationMsg.location.longitude).toBe(-122.084);
    expect(reaction1.reaction.messageId).toBe("wamid.ORIGINAL");
    expect(reaction1.reaction.emoji).toBe("👍");
    expect(reaction2.reaction.emoji).toBe("");
    expect("message_id" in (reaction1.reaction as unknown as Record<string, unknown>)).toBe(false);
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

    const normalizedContext = asType(updates[0]!.message, "text").context as unknown as Record<string, unknown>;
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
    expect(asType((atLimit.updates[0] as TypedMessageUpdate).message, "image").image.mimeType).toBe("image/jpeg");

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

  // WATS-77 slice 3 — call_permission_reply: real wire response values accept/reject,
  // plus is_permanent → isPermanent and response_source → responseSource. Back-compat
  // for accepted/rejected preserved; malformed replies must not throw.
  test("normalizes call_permission_reply accept with isPermanent + responseSource (WATS-77)", () => {
    const updates = normalizedMessages([
      baseMessage("wamid.CPA", "interactive", {
        type: "call_permission_reply",
        call_permission_reply: {
          response: "accept",
          is_permanent: true,
          response_source: "user_action",
          expiration_timestamp: "1718000099"
        }
      })
    ]);

    expect(updates.length).toBe(1);
    const interactive = asType(updates[0]!.message, "interactive");
    const reply = asInteractive(interactive.interactive, "call_permission_reply");
    expect(reply.callPermissionReply.response).toBe("accept");
    expect(reply.callPermissionReply.isPermanent).toBe(true);
    expect(reply.callPermissionReply.responseSource).toBe("user_action");
    expect(reply.callPermissionReply.expirationTimestamp).toBe("1718000099");
    // snake_case wire keys must not leak into the normalized body.
    const rawReply = reply.callPermissionReply as unknown as Record<string, unknown>;
    expect("is_permanent" in rawReply).toBe(false);
    expect("response_source" in rawReply).toBe(false);
  });

  test("normalizes call_permission_reply reject (WATS-77)", () => {
    const updates = normalizedMessages([
      baseMessage("wamid.CPR", "interactive", {
        type: "call_permission_reply",
        call_permission_reply: {
          response: "reject",
          is_permanent: false,
          response_source: "automatic"
        }
      })
    ]);

    expect(updates.length).toBe(1);
    const interactive = asType(updates[0]!.message, "interactive");
    const reply = asInteractive(interactive.interactive, "call_permission_reply");
    expect(reply.callPermissionReply.response).toBe("reject");
    expect(reply.callPermissionReply.isPermanent).toBe(false);
    expect(reply.callPermissionReply.responseSource).toBe("automatic");
    expect(reply.callPermissionReply.expirationTimestamp).toBeUndefined();
  });

  test("handles malformed call_permission_reply payloads without throwing (WATS-77)", () => {
    const malformedBodies: unknown[] = [null, "accept", 42, true, ["accept"]];
    for (const body of malformedBodies) {
      const messages = [
        {
          from: "15551234567",
          id: "wamid.CPBAD",
          timestamp: "1713697198",
          type: "interactive",
          interactive: {
            type: "call_permission_reply",
            call_permission_reply: body
          }
        }
      ];
      expect(() =>
        normalizeWebhookEnvelope(envelopeForChange(changeWithMessages(messages)))
      ).not.toThrow();
    }

    // Unknown response value is dropped (not asserted onto the normalized body).
    const updates = normalizedMessages([
      baseMessage("wamid.CPU", "interactive", {
        type: "call_permission_reply",
        call_permission_reply: { response: "maybe", is_permanent: "yes", response_source: "spoofed" }
      })
    ]);
    expect(updates.length).toBe(1);
    const interactive = asType(updates[0]!.message, "interactive");
    const reply = asInteractive(interactive.interactive, "call_permission_reply");
    const rawReply = reply.callPermissionReply as unknown as Record<string, unknown>;
    expect("response" in rawReply).toBe(false);
    expect("isPermanent" in rawReply).toBe(false); // non-boolean is_permanent ignored
    expect("responseSource" in rawReply).toBe(false); // unknown source ignored
  });
});
