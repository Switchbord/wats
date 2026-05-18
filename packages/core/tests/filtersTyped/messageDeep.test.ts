// WATS-43A RED — typed filters for normalized message body families.
// Tests public filtersTyped.message built-ins only; no implementation imports.

import { describe, expect, test } from "bun:test";
import type { TypedMessageUpdate, TypedStatusUpdate } from "../../src/webhookNormalizer";
import { FilterValidationError, message } from "../../src/filtersTyped/index";

function msg(type: string, body: Record<string, unknown>): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: `wamid.${type}`,
    phoneNumberId: "1234567890",
    wabaId: "WABA-DEEP",
    receivedAt: 1,
    message: {
      from: "15551234567",
      id: `wamid.${type}`,
      timestamp: "1",
      type,
      [type]: body
    } as TypedMessageUpdate["message"],
    rawChange: {} as TypedMessageUpdate["rawChange"]
  };
}

function statusUpdate(): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: "wamid.STATUS",
    phoneNumberId: "1234567890",
    wabaId: "WABA-DEEP",
    receivedAt: 1,
    status: {
      id: "wamid.STATUS",
      recipientId: "15551234567",
      status: "delivered",
      timestamp: "1"
    },
    rawChange: {} as TypedStatusUpdate["rawChange"]
  };
}

describe("WATS-43A message media typed filters", () => {
  test("media() and per-media helpers match only normalized media subtypes", () => {
    const image = msg("image", { id: "img", mimeType: "image/jpeg" });
    const video = msg("video", { id: "vid", mimeType: "video/mp4" });
    const audio = msg("audio", { id: "aud", mimeType: "audio/ogg" });
    const document = msg("document", { id: "doc", mimeType: "application/pdf", filename: "x.pdf" });
    const sticker = msg("sticker", { id: "stk", mimeType: "image/webp" });
    const location = msg("location", { latitude: 1, longitude: 2 });

    expect(message.media().predicate(image)).toBe(true);
    expect(message.media().predicate(video)).toBe(true);
    expect(message.media().predicate(audio)).toBe(true);
    expect(message.media().predicate(document)).toBe(true);
    expect(message.media().predicate(sticker)).toBe(true);
    expect(message.media().predicate(location)).toBe(false);
    expect(message.image().predicate(image)).toBe(true);
    expect(message.image().predicate(video)).toBe(false);
    expect(message.video().predicate(video)).toBe(true);
    expect(message.audio().predicate(audio)).toBe(true);
    expect(message.document().predicate(document)).toBe(true);
    expect(message.sticker().predicate(sticker)).toBe(true);
    expect(message.media().predicate(statusUpdate())).toBe(false);
  });
});

describe("WATS-43A message location/reaction typed filters", () => {
  test("location() matches only location messages", () => {
    expect(message.location().predicate(msg("location", { latitude: 1, longitude: 2 }))).toBe(true);
    expect(message.location().predicate(msg("text", { body: "hi" }))).toBe(false);
    expect(message.location().predicate(statusUpdate())).toBe(false);
  });

  test("reaction helpers match added/removed and optional exact emoji", () => {
    const added = msg("reaction", { messageId: "wamid.ORIG", emoji: "👍" });
    const removed = msg("reaction", { messageId: "wamid.ORIG", emoji: "" });

    expect(message.reaction().predicate(added)).toBe(true);
    expect(message.reaction("👍").predicate(added)).toBe(true);
    expect(message.reaction("🔥").predicate(added)).toBe(false);
    expect(message.reactionAdded().predicate(added)).toBe(true);
    expect(message.reactionAdded().predicate(removed)).toBe(false);
    expect(message.reactionRemoved().predicate(removed)).toBe(true);
    expect(message.reactionRemoved().predicate(added)).toBe(false);
    expect(message.reaction().predicate(statusUpdate())).toBe(false);
  });

  test("reaction(emoji) rejects null, empty, and whitespace-only exact-match values", () => {
    for (const bad of [null, "", "   "] as unknown[]) {
      try {
        message.reaction(bad as string);
        throw new Error("expected FilterValidationError");
      } catch (err) {
        expect(err).toBeInstanceOf(FilterValidationError);
        expect((err as FilterValidationError).code).toBe(
          typeof bad === "string" ? "empty_substring" : "invalid_predicate"
        );
      }
    }
  });
});

describe("WATS-43A message interactive/button typed filters", () => {
  test("interactive helpers match button/list/nfm replies and optional ids", () => {
    const button = msg("interactive", {
      type: "button_reply",
      buttonReply: { id: "btn-1", title: "Yes" }
    });
    const list = msg("interactive", {
      type: "list_reply",
      listReply: { id: "row-1", title: "Row" }
    });
    const nfm = msg("interactive", {
      type: "nfm_reply",
      nfmReply: { responseJson: "{}", body: "Done", name: "flow" }
    });

    expect(message.interactive().predicate(button)).toBe(true);
    expect(message.interactiveButtonReply().predicate(button)).toBe(true);
    expect(message.interactiveButtonReply("btn-1").predicate(button)).toBe(true);
    expect(message.interactiveButtonReply("btn-2").predicate(button)).toBe(false);
    expect(message.interactiveListReply().predicate(list)).toBe(true);
    expect(message.interactiveListReply("row-1").predicate(list)).toBe(true);
    expect(message.interactiveListReply("row-2").predicate(list)).toBe(false);
    expect(message.interactiveNfmReply().predicate(nfm)).toBe(true);
    expect(message.interactiveNfmReply().predicate(button)).toBe(false);
    expect(message.interactive().predicate(statusUpdate())).toBe(false);
  });

  test("button(payload?) matches quick-reply button messages", () => {
    const quick = msg("button", { text: "Quick", payload: "payload-1" });
    const noPayload = msg("button", { text: "Quick" });

    expect(message.button().predicate(quick)).toBe(true);
    expect(message.button("payload-1").predicate(quick)).toBe(true);
    expect(message.button("payload-2").predicate(quick)).toBe(false);
    expect(message.button().predicate(noPayload)).toBe(true);
    expect(message.button("payload-1").predicate(noPayload)).toBe(false);
    expect(message.button().predicate(statusUpdate())).toBe(false);
  });

  test("optional exact-match ids/payload reject non-string, empty, and whitespace-only", () => {
    const factories = [
      (v: unknown) => message.interactiveButtonReply(v as string),
      (v: unknown) => message.interactiveListReply(v as string),
      (v: unknown) => message.button(v as string)
    ];

    for (const factory of factories) {
      for (const bad of [42, "", " \t "] as unknown[]) {
        try {
          factory(bad);
          throw new Error("expected FilterValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(FilterValidationError);
          expect((err as FilterValidationError).code).toBe(
            typeof bad === "string" ? "empty_substring" : "invalid_predicate"
          );
        }
      }
    }
  });

  test("filters return strict booleans and do not inspect rawChange/accessor fields", () => {
    let rawChangeGetterExecuted = false;
    const update = msg("image", { id: "img", mimeType: "image/jpeg" });
    Object.defineProperty(update, "rawChange", {
      enumerable: true,
      get() {
        rawChangeGetterExecuted = true;
        throw new Error("rawChange must not be read by filters");
      }
    });

    const value = message.image().predicate(update);
    expect(value).toBe(true);
    expect(typeof value).toBe("boolean");
    expect(rawChangeGetterExecuted).toBe(false);
  });

  test("malformed/accessor nested message bodies return false without raw host throws", () => {
    let getterExecuted = false;
    const update = msg("interactive", {});
    Object.defineProperty(update.message, "interactive", {
      enumerable: true,
      get() {
        getterExecuted = true;
        throw new Error("nested message getter must not run");
      }
    });

    expect(() => message.interactive().predicate(update)).not.toThrow();
    expect(message.interactive().predicate(update)).toBe(false);
    expect(getterExecuted).toBe(false);
  });
});
