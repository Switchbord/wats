// F-6 messages endpoint — RED tests (WATS-18 / Arch-D).
//
// Covers the endpoint-registry refactor of packages/graph/src/endpoints/
// messages.ts: the new named-export `sendMessage` endpoint-registry
// callable; the preserved GraphMessagesEndpoint class that delegates to
// it; and the error-registry integration when Graph returns a seeded
// error code (131051 → UnsupportedMessageTypeError).

import { describe, expect, test } from "bun:test";
import * as graph from "../src";
import * as rootMessages from "../src/endpoints/messages";
import * as splitMessages from "../src/endpoints/messages/index";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphMessagesEndpoint,
  GraphRateLimitError,
  GraphRequestValidationError,
  sendMessage
} from "../src";
import {
  InvalidParameterError,
  UnsupportedMessageTypeError
} from "../src/errorSubclasses";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(
  responses: MockTransportResponseSpec[] | MockTransportResponseSpec
) {
  const handle = createMockTransport(
    Array.isArray(responses)
      ? { responses }
      : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

describe("WATS-68 messages module split compatibility", () => {
  test("root, compatibility barrel, and focused module exports preserve identity", () => {
    expect(rootMessages.sendMessage).toBe(sendMessage);
    expect(splitMessages.sendMessage).toBe(sendMessage);
    expect(rootMessages.GraphMessagesEndpoint).toBe(GraphMessagesEndpoint);
    expect(splitMessages.GraphMessagesEndpoint).toBe(GraphMessagesEndpoint);
    expect(rootMessages.buildSendTextPayload).toBe((graph as typeof graph & { buildSendTextPayload: unknown }).buildSendTextPayload);
    expect(splitMessages.buildSendMarketingTemplatePayload).toBe((graph as typeof graph & { buildSendMarketingTemplatePayload: unknown }).buildSendMarketingTemplatePayload);
  });
});

describe("F-6 sendMessage (endpoint-registry form)", () => {
  test("POSTs to /{phoneNumberId}/messages with JSON body", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.ABC" }]
      }
    });
    const res = await sendMessage(
      client,
      { phoneNumberId: "123" },
      {
        messaging_product: "whatsapp",
        to: "15551230000",
        type: "text",
        text: { body: "hello" }
      }
    );
    expect(res.messages?.[0]?.id).toBe("wamid.ABC");
    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.method).toBe("POST");
    expect(rec?.url).toBe(
      "https://graph.facebook.com/v25.0/123/messages"
    );
    expect(rec?.headers.get("authorization")).toBe("Bearer test-token");
    expect(rec?.headers.get("content-type")).toBe("application/json");
    const parsed = JSON.parse(String(rec?.body)) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string };
    };
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.to).toBe("15551230000");
    expect(parsed.type).toBe("text");
    expect(parsed.text.body).toBe("hello");
  });

  test("error code 131051 → UnsupportedMessageTypeError (sibling-NOT InvalidParameterError)", async () => {
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "The message type is not supported.",
          code: 131051
        }
      }
    });
    let thrown: unknown;
    try {
      await sendMessage(
        client,
        { phoneNumberId: "123" },
        {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "text",
          text: { body: "hi" }
        }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnsupportedMessageTypeError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(InvalidParameterError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
  });
});

describe("F-6 GraphMessagesEndpoint class (backward-compat)", () => {
  test("class-based sendMessage still works and produces identical request", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.X" }]
      }
    });
    const res = await client.messages.sendMessage({
      phoneNumberId: "123",
      to: "15551230000",
      text: "hello"
    });
    expect(res.messages?.[0]?.id).toBe("wamid.X");
    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.method).toBe("POST");
    expect(rec?.url).toBe(
      "https://graph.facebook.com/v25.0/123/messages"
    );
    expect(rec?.headers.get("content-type")).toBe("application/json");
    const parsed = JSON.parse(String(rec?.body)) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string };
    };
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.to).toBe("15551230000");
    expect(parsed.type).toBe("text");
    expect(parsed.text.body).toBe("hello");
  });

  test("class-based sendMessage preserves F-4 typed Invalid phoneNumberId error", async () => {
    const { client, handle } = clientWith({
      status: 200,
      body: { ok: true }
    });
    let thrown: unknown;
    try {
      await client.messages.sendMessage({
        phoneNumberId: "../123?debug=true",
        to: "15551230000",
        text: "hi"
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect((thrown as Error).message).toContain("Invalid phoneNumberId");
    expect(handle.requests.length).toBe(0);
  });

  test("class and registry forms yield identical MockTransport.requests entries", async () => {
    const body = {
      messaging_product: "whatsapp" as const,
      to: "15551230000",
      type: "text" as const,
      text: { body: "equal" }
    };

    const { client: c1, handle: h1 } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    await sendMessage(c1, { phoneNumberId: "123" }, body);

    const { client: c2, handle: h2 } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    await c2.messages.sendMessage({
      phoneNumberId: "123",
      to: "15551230000",
      text: "equal"
    });

    const r1 = h1.requests[0];
    const r2 = h2.requests[0];
    expect(r1?.url).toBe(r2?.url);
    expect(r1?.method).toBe(r2?.method);
    expect(r1?.headers.get("content-type")).toBe(
      r2?.headers.get("content-type")
    );
    expect(r1?.body).toBe(r2?.body);
  });
});

describe("WATS-38 outbound media message payload builders", () => {
  const builders = {
    image: (graph as unknown as { buildSendImagePayload: (input: unknown) => unknown })
      .buildSendImagePayload,
    video: (graph as unknown as { buildSendVideoPayload: (input: unknown) => unknown })
      .buildSendVideoPayload,
    audio: (graph as unknown as { buildSendAudioPayload: (input: unknown) => unknown })
      .buildSendAudioPayload,
    document: (graph as unknown as { buildSendDocumentPayload: (input: unknown) => unknown })
      .buildSendDocumentPayload,
    sticker: (graph as unknown as { buildSendStickerPayload: (input: unknown) => unknown })
      .buildSendStickerPayload
  };

  test("builds exact Graph payloads for id/link media sends", () => {
    expect(
      builders.image({
        to: "15551230000",
        mediaId: "MEDIA_IMAGE_ID",
        caption: "image caption",
        replyToMessageId: "wamid.REPLY"
      })
    ).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "image",
      image: { id: "MEDIA_IMAGE_ID", caption: "image caption" },
      context: { message_id: "wamid.REPLY" }
    });

    expect(
      builders.video({
        to: "15551230000",
        link: "https://cdn.example.test/video.mp4",
        caption: "video caption"
      })
    ).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "video",
      video: { link: "https://cdn.example.test/video.mp4", caption: "video caption" }
    });

    expect(builders.audio({ to: "15551230000", mediaId: "MEDIA_AUDIO_ID" })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "audio",
      audio: { id: "MEDIA_AUDIO_ID" }
    });

    expect(
      builders.document({
        to: "15551230000",
        link: "https://cdn.example.test/report.pdf",
        caption: "document caption",
        filename: "report.pdf"
      })
    ).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "document",
      document: {
        link: "https://cdn.example.test/report.pdf",
        caption: "document caption",
        filename: "report.pdf"
      }
    });

    expect(
      builders.sticker({ to: "15551230000", link: "https://cdn.example.test/sticker.webp" })
    ).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "sticker",
      sticker: { link: "https://cdn.example.test/sticker.webp" }
    });
  });

  test("accepts documented at-limit media fields and rejects over-limit fields", () => {
    const atLimitMediaId = "m".repeat(2048);
    const atLimitCaption = "c".repeat(1024);
    const atLimitFilename = "f".repeat(256);
    const atLimitReply = "r".repeat(256);
    const atLimitLink = `https://cdn.example.test/${"l".repeat(2023)}`;

    expect(
      builders.document({
        to: "15551230000",
        mediaId: atLimitMediaId,
        caption: atLimitCaption,
        filename: atLimitFilename,
        replyToMessageId: atLimitReply
      })
    ).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "document",
      document: {
        id: atLimitMediaId,
        caption: atLimitCaption,
        filename: atLimitFilename
      },
      context: { message_id: atLimitReply }
    });

    expect(
      builders.image({ to: "15551230000", link: atLimitLink, caption: atLimitCaption })
    ).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "image",
      image: { link: atLimitLink, caption: atLimitCaption }
    });

    for (const bad of [
      { to: "15551230000", mediaId: "m".repeat(2049) },
      { to: "15551230000", link: `https://cdn.example.test/${"l".repeat(2024)}` },
      { to: "15551230000", mediaId: "ok", caption: "c".repeat(1025) },
      { to: "15551230000", mediaId: "ok", filename: "f".repeat(257) },
      { to: "15551230000", mediaId: "ok", replyToMessageId: "r".repeat(257) }
    ]) {
      expect(() => builders.document(bad)).toThrow(GraphRequestValidationError);
    }
  });

  test("rejects malformed media helper inputs before transport with typed validation", () => {
    const malformedInputs: readonly unknown[] = [undefined, null, "x", 123, true, []];
    for (const input of malformedInputs) {
      for (const builder of Object.values(builders)) {
        let thrown: unknown;
        try {
          builder(input);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(GraphRequestValidationError);
        expect(thrown).not.toBeInstanceOf(TypeError);
      }
    }
  });

  test("requires exactly one media reference and validates id/link syntax", () => {
    const cases: readonly unknown[] = [
      { to: "15551230000" },
      { to: "15551230000", mediaId: "MEDIA", link: "https://cdn.example.test/a.jpg" },
      { to: "15551230000", mediaId: "" },
      { to: "15551230000", mediaId: "   " },
      { to: "15551230000", mediaId: 123 },
      { to: "15551230000", mediaId: "MEDIA\rID" },
      { to: "15551230000", mediaId: "MEDIA\nID" },
      { to: "15551230000", mediaId: "MEDIA\u0000ID" },
      { to: "15551230000", link: "" },
      { to: "15551230000", link: "   " },
      { to: "15551230000", link: 123 },
      { to: "15551230000", link: "notaurl" },
      { to: "15551230000", link: "ftp://cdn.example.test/a.jpg" },
      { to: "15551230000", link: "https://cdn.example.test/a\n.jpg" },
      { to: "15551230000", link: "https://cdn.example.test/a b.jpg" },
      { to: "15551230000", link: " https://cdn.example.test/a.jpg" },
      { to: "15551230000", link: "https://cdn.example.test/a.jpg " }
    ];
    for (const input of cases) {
      let thrown: unknown;
      try {
        builders.image(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
  });

  test("rejects captions/filenames/reply context on unsupported body types", () => {
    for (const bad of [
      { to: "15551230000", mediaId: "AUD", caption: "unsupported" },
      { to: "15551230000", mediaId: "AUD", filename: "unsupported.mp3" }
    ]) {
      expect(() => builders.audio(bad)).toThrow(GraphRequestValidationError);
    }
    for (const bad of [
      { to: "15551230000", mediaId: "STK", caption: "unsupported" },
      { to: "15551230000", mediaId: "STK", filename: "unsupported.webp" }
    ]) {
      expect(() => builders.sticker(bad)).toThrow(GraphRequestValidationError);
    }
    expect(() =>
      builders.image({ to: "15551230000", mediaId: "IMG", filename: "unsupported.jpg" })
    ).toThrow(GraphRequestValidationError);
    expect(() =>
      builders.video({ to: "15551230000", mediaId: "VID", filename: "unsupported.mp4" })
    ).toThrow(GraphRequestValidationError);
  });
});


describe("WATS-38 remaining outbound message composer payload builders", () => {
  const remaining = graph as unknown as {
    buildSendLocationPayload: (input: unknown) => unknown;
    buildSendContactsPayload: (input: unknown) => unknown;
    buildSendReactionPayload: (input: unknown) => unknown;
    buildRemoveReactionPayload: (input: unknown) => unknown;
    buildSendButtonsPayload: (input: unknown) => unknown;
    buildSendListPayload: (input: unknown) => unknown;
    buildSendCtaUrlPayload: (input: unknown) => unknown;
    buildSendProductPayload: (input: unknown) => unknown;
    buildSendProductsPayload: (input: unknown) => unknown;
    buildSendCatalogPayload: (input: unknown) => unknown;
    buildRequestLocationPayload: (input: unknown) => unknown;
    buildMarkMessageAsReadPayload: (input: unknown) => unknown;
    buildTypingIndicatorPayload: (input: unknown) => unknown;
    buildSendTemplatePayload: (input: unknown) => unknown;
  };

  test("builds exact Graph payloads for location, contacts, reaction, read, typing, and template", () => {
    expect(remaining.buildSendLocationPayload({
      to: "15551230000",
      latitude: 37.4,
      longitude: -122.1,
      name: "HQ",
      address: "1 Hacker Way",
      replyToMessageId: "wamid.REPLY"
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "location",
      location: { latitude: 37.4, longitude: -122.1, name: "HQ", address: "1 Hacker Way" },
      context: { message_id: "wamid.REPLY" }
    });

    expect(remaining.buildSendContactsPayload({
      to: "15551230000",
      contacts: [{
        name: { formattedName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace" },
        phones: [{ phone: "+15551230000", type: "MOBILE", waId: "15551230000" }],
        emails: [{ email: "ada@example.test", type: "WORK" }],
        urls: [{ url: "https://example.test", type: "HOME" }]
      }]
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "contacts",
      contacts: [{
        name: { formatted_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace" },
        phones: [{ phone: "+15551230000", type: "MOBILE", wa_id: "15551230000" }],
        emails: [{ email: "ada@example.test", type: "WORK" }],
        urls: [{ url: "https://example.test", type: "HOME" }]
      }]
    });

    expect(remaining.buildSendReactionPayload({
      to: "15551230000",
      messageId: "wamid.TARGET",
      emoji: "👍"
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "reaction",
      reaction: { message_id: "wamid.TARGET", emoji: "👍" }
    });

    expect(remaining.buildRemoveReactionPayload({ to: "15551230000", messageId: "wamid.TARGET" })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "reaction",
      reaction: { message_id: "wamid.TARGET", emoji: "" }
    });

    expect(remaining.buildMarkMessageAsReadPayload({ messageId: "wamid.INBOUND" })).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.INBOUND"
    });

    expect(remaining.buildTypingIndicatorPayload({ messageId: "wamid.INBOUND" })).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.INBOUND",
      typing_indicator: { type: "text" }
    });

    expect(remaining.buildSendTemplatePayload({
      to: "15551230000",
      name: "hello_world",
      languageCode: "en_US",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }]
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "en_US" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }]
      }
    });
  });

  test("builds exact Graph payloads for interactive variants", () => {
    expect(remaining.buildSendButtonsPayload({
      to: "15551230000",
      bodyText: "Choose",
      buttons: [{ id: "yes", title: "Yes" }],
      headerText: "Header",
      footerText: "Footer"
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "text", text: "Header" },
        body: { text: "Choose" },
        footer: { text: "Footer" },
        action: { buttons: [{ type: "reply", reply: { id: "yes", title: "Yes" } }] }
      }
    });

    expect(remaining.buildSendListPayload({
      to: "15551230000",
      bodyText: "Pick",
      buttonText: "Choose",
      sections: [{ title: "A", rows: [{ id: "row1", title: "Row 1", description: "Desc" }] }]
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Pick" },
        action: { button: "Choose", sections: [{ title: "A", rows: [{ id: "row1", title: "Row 1", description: "Desc" }] }] }
      }
    });

    expect(remaining.buildSendCtaUrlPayload({
      to: "15551230000",
      bodyText: "Open",
      displayText: "Open",
      url: "https://example.test"
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "Open" },
        action: { name: "cta_url", parameters: { display_text: "Open", url: "https://example.test" } }
      }
    });

    expect(remaining.buildSendProductPayload({
      to: "15551230000", catalogId: "CAT", productRetailerId: "SKU", bodyText: "One"
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "product",
        body: { text: "One" },
        action: { catalog_id: "CAT", product_retailer_id: "SKU" }
      }
    });

    expect(remaining.buildSendProductsPayload({
      to: "15551230000",
      catalogId: "CAT",
      headerText: "Catalog",
      bodyText: "Products",
      sections: [{ title: "Phones", productItems: [{ productRetailerId: "SKU1" }] }]
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "product_list",
        header: { type: "text", text: "Catalog" },
        body: { text: "Products" },
        action: { catalog_id: "CAT", sections: [{ title: "Phones", product_items: [{ product_retailer_id: "SKU1" }] }] }
      }
    });

    expect(remaining.buildSendCatalogPayload({
      to: "15551230000", bodyText: "Catalog", thumbnailProductRetailerId: "SKU"
    })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "catalog_message",
        body: { text: "Catalog" },
        action: { name: "catalog_message", parameters: { thumbnail_product_retailer_id: "SKU" } }
      }
    });

    expect(remaining.buildRequestLocationPayload({ to: "15551230000", bodyText: "Share location" })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: { type: "location_request_message", body: { text: "Share location" }, action: { name: "send_location" } }
    });
  });

  test("remaining composer builders reject malformed inputs before transport with typed validation", () => {
    const builders = [
      remaining.buildSendLocationPayload,
      remaining.buildSendContactsPayload,
      remaining.buildSendReactionPayload,
      remaining.buildRemoveReactionPayload,
      remaining.buildSendButtonsPayload,
      remaining.buildSendListPayload,
      remaining.buildSendCtaUrlPayload,
      remaining.buildSendProductPayload,
      remaining.buildSendProductsPayload,
      remaining.buildSendCatalogPayload,
      remaining.buildRequestLocationPayload,
      remaining.buildMarkMessageAsReadPayload,
      remaining.buildTypingIndicatorPayload,
      remaining.buildSendTemplatePayload
    ];
    for (const builder of builders) {
      for (const bad of [undefined, null, "x", [], 123]) {
        let thrown: unknown;
        try { builder(bad); } catch (error) { thrown = error; }
        expect(thrown).toBeInstanceOf(GraphRequestValidationError);
        expect(thrown).not.toBeInstanceOf(TypeError);
      }
    }

    expect(() => remaining.buildSendLocationPayload({ to: "15551230000", latitude: 91, longitude: 0 })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendLocationPayload({ to: "15551230000", latitude: 0, longitude: 181 })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendContactsPayload({ to: "15551230000", contacts: [] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendReactionPayload({ to: "15551230000", messageId: "wamid", emoji: "" })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendCtaUrlPayload({ to: "15551230000", bodyText: "x", displayText: "Open", url: "javascript:alert(1)" })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendButtonsPayload({ to: "15551230000", bodyText: "x", buttons: [] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendButtonsPayload({ to: "15551230000", bodyText: "x", buttons: [{ id: "1", title: "1" }, { id: "2", title: "2" }, { id: "3", title: "3" }, { id: "4", title: "4" }] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendListPayload({ to: "15551230000", bodyText: "x", buttonText: "Choose", sections: [] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendProductsPayload({ to: "15551230000", catalogId: "CAT", headerText: "H", bodyText: "B", sections: [{ title: "T", productItems: [] }] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildMarkMessageAsReadPayload({ messageId: "bad\n" })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildTypingIndicatorPayload({ messageId: "bad\n" })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "", languageCode: "en_US" })).toThrow(GraphRequestValidationError);
  });

  test("rejects sparse arrays, unsafe contact URLs, and unsafe template parameters", () => {
    expect(() => remaining.buildSendButtonsPayload({ to: "15551230000", bodyText: "x", buttons: Array(1) })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendContactsPayload({ to: "15551230000", contacts: Array(1) })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendContactsPayload({ to: "15551230000", contacts: [{ name: { formattedName: "Ada" }, urls: [{ url: "javascript:alert(1)" }] }] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendContactsPayload({ to: "15551230000", contacts: [{ name: { formattedName: "Ada" }, urls: [{ url: "https://example.test/a b" }] }] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendListPayload({ to: "15551230000", bodyText: "x", buttonText: "Choose", sections: Array(1) })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendProductsPayload({ to: "15551230000", catalogId: "CAT", headerText: "H", bodyText: "B", sections: [{ title: "S", productItems: Array(1) }] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: Array(1) })).toThrow(GraphRequestValidationError);
    const cyclic: Record<string, unknown> = { type: "text" };
    cyclic.self = cyclic;
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [cyclic] }] })).toThrow(GraphRequestValidationError);
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [{ type: "text", text: "x".repeat(5000) }] }] })).toThrow(GraphRequestValidationError);

    const evilButtons = [{ id: "safe", title: "Safe" }];
    Object.defineProperty(evilButtons, "map", {
      value: () => [{ type: "reply", reply: { id: "bad\nid", title: "Bad" } }]
    });
    expect(() => remaining.buildSendButtonsPayload({ to: "15551230000", bodyText: "x", buttons: evilButtons })).toThrow(GraphRequestValidationError);

    const parameterWithGetter = {};
    Object.defineProperty(parameterWithGetter, "type", {
      enumerable: true,
      get: () => "text"
    });
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [parameterWithGetter] }] })).toThrow(GraphRequestValidationError);

    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [{ type: "text", text: "safe", toJSON: () => ({ type: "text", text: "bad\n" }) }] }] })).toThrow(GraphRequestValidationError);

    const inheritedToJson = Object.create({ toJSON: () => ({ type: "text", text: "bad\n" }) });
    inheritedToJson.type = "text";
    inheritedToJson.text = "safe";
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [inheritedToJson] }] })).toThrow(GraphRequestValidationError);

    const nestedArray = ["safe"] as unknown[] & { toJSON?: () => unknown };
    nestedArray.toJSON = () => ["bad\n"];
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [{ type: "text", payload: nestedArray }] }] })).toThrow(GraphRequestValidationError);

    const iteratorArray = ["safe"] as unknown[];
    Object.defineProperty(iteratorArray, Symbol.iterator, {
      value: function* () { yield "safe"; yield "bad\n"; }
    });
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [{ type: "text", payload: iteratorArray }] }] })).toThrow(GraphRequestValidationError);

    const inheritedIndexArray = [] as unknown[];
    Object.setPrototypeOf(inheritedIndexArray, { 0: "bad\n", length: 1, __proto__: Array.prototype });
    Object.defineProperty(inheritedIndexArray, "length", { value: 1 });
    expect(() => remaining.buildSendTemplatePayload({ to: "15551230000", name: "hello", languageCode: "en_US", components: [{ type: "body", parameters: [{ type: "text", payload: inheritedIndexArray }] }] })).toThrow(GraphRequestValidationError);

    const originalMap = Array.prototype.map;
    try {
      Object.defineProperty(Array.prototype, "map", {
        configurable: true,
        value: function () { return [{ type: "reply", reply: { id: "bad\nid", title: "Bad" } }]; }
      });
      expect(remaining.buildSendButtonsPayload({ to: "15551230000", bodyText: "x", buttons: [{ id: "safe", title: "Safe" }] })).toEqual({
        messaging_product: "whatsapp",
        to: "15551230000",
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "x" },
          action: { buttons: [{ type: "reply", reply: { id: "safe", title: "Safe" } }] }
        }
      });
    } finally {
      Object.defineProperty(Array.prototype, "map", { configurable: true, value: originalMap });
    }
  });
});
