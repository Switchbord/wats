import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient,
  buildSendButtonsPayload,
  buildSendImagePayload,
  buildSendMarketingTemplatePayload,
  buildSendPinPayload,
  buildSendProductPayload,
  buildSendTemplatePayload,
  buildSendTextPayload,
  sendMessage,
  type GraphMessagesSendBody
} from "../src";
import { createMockTransport } from "../src/createMockTransport";

function clientWithMock() {
  const handle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messaging_product: "whatsapp", messages: [{ id: "wamid.GROUP" }] }
    }
  });
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function parsedBody(handle: ReturnType<typeof createMockTransport>): Record<string, unknown> {
  expect(typeof handle.requests[0]?.body).toBe("string");
  return JSON.parse(String(handle.requests[0]?.body)) as Record<string, unknown>;
}

describe("WATS-134 group message sends", () => {
  test("text, media, and template builders emit recipient_type group wire bodies", async () => {
    expect(buildSendTextPayload({
      to: "grp-release-1",
      recipientType: "group",
      text: "hello group"
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "text",
      text: { body: "hello group" }
    });

    expect(buildSendImagePayload({
      to: "grp-release-1",
      recipientType: "group",
      mediaId: "MEDIA_ID",
      caption: "image"
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "image",
      image: { id: "MEDIA_ID", caption: "image" }
    });

    expect(buildSendTemplatePayload({
      to: "grp-release-1",
      recipientType: "group",
      name: "weekly_update",
      languageCode: "en_US"
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "template",
      template: { name: "weekly_update", language: { code: "en_US" } }
    });

    const { client, handle } = clientWithMock();
    await sendMessage(client, { phoneNumberId: "555" }, buildSendTextPayload({
      to: "grp-release-1",
      recipientType: "group",
      text: "via registry"
    }));
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/555/messages");
    expect(parsedBody(handle)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "text",
      text: { body: "via registry" }
    });
  });

  test("PhoneNumberClient legacy text helper can send to a group recipient", async () => {
    const { client, handle } = clientWithMock();
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "555" });
    await phone.sendText({ to: "grp-release-1", recipientType: "group", text: "scoped" });
    expect(parsedBody(handle)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "text",
      text: { body: "scoped" }
    });
  });

  test("recipientType group rejects phone-number-like to values before transport", async () => {
    expect(() => buildSendTextPayload({
      to: "15551230000",
      recipientType: "group",
      text: "wrong target"
    })).toThrow(GraphRequestValidationError);

    const { client, handle } = clientWithMock();
    await expect(sendMessage(client, { phoneNumberId: "555" }, {
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "15551230000",
      type: "text",
      text: { body: "wrong target" }
    })).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("group context rejects interactive, commerce, auth template, and marketing-template sends", async () => {
    expect(() => buildSendButtonsPayload({
      to: "grp-release-1",
      recipientType: "group",
      bodyText: "pick",
      buttons: [{ id: "a", title: "A" }]
    } as never)).toThrow(GraphRequestValidationError);

    expect(() => buildSendProductPayload({
      to: "grp-release-1",
      recipientType: "group",
      catalogId: "CAT",
      productRetailerId: "SKU"
    } as never)).toThrow(GraphRequestValidationError);

    expect(() => buildSendTemplatePayload({
      to: "grp-release-1",
      recipientType: "group",
      templateCategory: "AUTHENTICATION",
      name: "login_code",
      languageCode: "en_US"
    } as never)).toThrow(GraphRequestValidationError);

    expect(() => buildSendMarketingTemplatePayload({
      to: "grp-release-1",
      recipientType: "group",
      name: "promo_offer",
      languageCode: "en_US"
    } as never)).toThrow(GraphRequestValidationError);

    const { client, handle } = clientWithMock();
    await expect(sendMessage(client, { phoneNumberId: "555" }, {
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "interactive",
      interactive: { type: "button" }
    } as GraphMessagesSendBody)).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);

    const { client: unsupportedClient, handle: unsupportedHandle } = clientWithMock();
    await expect(sendMessage(unsupportedClient, { phoneNumberId: "555" }, {
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "location",
      location: { latitude: 1, longitude: 2 }
    } as GraphMessagesSendBody)).rejects.toThrow(GraphRequestValidationError);
    expect(unsupportedHandle.requests.length).toBe(0);
  });

  test("pin and unpin builders emit exact group pin bodies and validate expiration_days", () => {
    expect(buildSendPinPayload({
      to: "grp-release-1",
      pinType: "pin",
      messageId: "wamid.TARGET",
      expirationDays: 30
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "pin",
      pin: { type: "pin", message_id: "wamid.TARGET", expiration_days: 30 }
    });

    expect(buildSendPinPayload({
      to: "grp-release-1",
      pinType: "unpin",
      messageId: "wamid.TARGET",
      expirationDays: 1
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "pin",
      pin: { type: "unpin", message_id: "wamid.TARGET", expiration_days: 1 }
    });

    expect(() => buildSendPinPayload({
      to: "1234567890123456",
      pinType: "pin",
      messageId: "wamid.TARGET",
      expirationDays: 1
    })).not.toThrow();

    expect(() => buildSendPinPayload({
      to: "15551230000",
      pinType: "pin",
      messageId: "wamid.TARGET",
      expirationDays: 1
    })).toThrow(GraphRequestValidationError);

    for (const expirationDays of [0, 31, 1.5, Number.NaN]) {
      expect(() => buildSendPinPayload({
        to: "grp-release-1",
        pinType: "pin",
        messageId: "wamid.TARGET",
        expirationDays
      })).toThrow(GraphRequestValidationError);
    }
  });

  test("raw sendMessage validates group pin bodies before transport", async () => {
    const { client, handle } = clientWithMock();
    await sendMessage(client, { phoneNumberId: "555" }, {
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "pin",
      pin: { type: "pin", message_id: "wamid.TARGET", expiration_days: 1 }
    } as GraphMessagesSendBody);
    expect(parsedBody(handle)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "pin",
      pin: { type: "pin", message_id: "wamid.TARGET", expiration_days: 1 }
    });

    const { client: badClient, handle: badHandle } = clientWithMock();
    await expect(sendMessage(badClient, { phoneNumberId: "555" }, {
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "grp-release-1",
      type: "pin",
      pin: { type: "pin", message_id: "wamid.TARGET", expiration_days: 31 }
    } as GraphMessagesSendBody)).rejects.toThrow(GraphRequestValidationError);
    expect(badHandle.requests.length).toBe(0);
  });
});
