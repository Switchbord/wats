import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphClient,
  GraphRateLimitError,
  GraphRequestValidationError,
  PhoneNumberClient,
  buildSendMarketingTemplatePayload,
  sendMarketingTemplate,
  type GraphMessagesTemplateComponentInput
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";
import {
  MarketingMessagesLiteUnsupportedMessageTypeError
} from "../src/errorSubclasses";

function ok(body: object = {
  messaging_product: "whatsapp",
  contacts: [{ input: "15551234567", wa_id: "15551234567", user_id: "bsuid-1" }],
  messages: [{ id: "wamid.marketing", message_status: "held_for_quality_assessment" }]
}): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec = ok()) {
  const handle = createMockTransport(
    Array.isArray(responses) ? { responses } : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") return JSON.parse(body) as Record<string, unknown>;
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  throw new Error(`unexpected body type: ${typeof body}`);
}

const templateComponent: GraphMessagesTemplateComponentInput = {
  type: "body",
  parameters: [{ type: "text", text: "Ada" }]
};

describe("WATS-98 Marketing Messages API request-shape helpers", () => {
  test("builds strict marketing template payloads with product policy and activity sharing", () => {
    expect(buildSendMarketingTemplatePayload({
      to: "15551234567",
      name: "promo_offer",
      languageCode: "en_US",
      components: [templateComponent],
      productPolicy: "STRICT",
      messageActivitySharing: false
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "15551234567",
      type: "template",
      template: {
        name: "promo_offer",
        language: { code: "en_US" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }]
      },
      product_policy: "STRICT",
      message_activity_sharing: false
    });
  });

  test("supports BSUID recipient routing and omits to when only recipient is supplied", () => {
    expect(buildSendMarketingTemplatePayload({
      recipient: "bsuid-abc123",
      name: "promo_offer",
      languageCode: "en_US",
      productPolicy: "CLOUD_API_FALLBACK",
      messageActivitySharing: true
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      recipient: "bsuid-abc123",
      type: "template",
      template: {
        name: "promo_offer",
        language: { code: "en_US" }
      },
      product_policy: "CLOUD_API_FALLBACK",
      message_activity_sharing: true
    });
  });

  test("posts to /marketing_messages and preserves response message_status and contacts.user_id", async () => {
    const { client, handle } = clientWith();

    const response = await sendMarketingTemplate(client, { phoneNumberId: "555" }, {
      to: "15551234567",
      name: "promo_offer",
      languageCode: "en_US",
      components: [templateComponent],
      productPolicy: "STRICT",
      messageActivitySharing: false
    });

    expect(response.messages?.[0]?.message_status).toBe("held_for_quality_assessment");
    expect(response.contacts?.[0]?.user_id).toBe("bsuid-1");
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/555/marketing_messages");
    expect(handle.requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "15551234567",
      type: "template",
      template: {
        name: "promo_offer",
        language: { code: "en_US" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }]
      },
      product_policy: "STRICT",
      message_activity_sharing: false
    });
  });

  test("PhoneNumberClient bound helper posts through the bound phone number id", async () => {
    const { client, handle } = clientWith();
    const scoped = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND" });

    await scoped.sendMarketingTemplate({
      phoneNumberId: "CALLER_SHOULD_NOT_WIN",
      recipient: "bsuid-parent-1",
      name: "promo_offer",
      languageCode: "en_US"
    } as never);

    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/BOUND/marketing_messages");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      recipient: "bsuid-parent-1",
      type: "template",
      template: {
        name: "promo_offer",
        language: { code: "en_US" }
      }
    });
  });

  test("rejects invalid recipients, policies, booleans, components, bodies, and path IDs before transport", async () => {
    const { client, handle } = clientWith();
    const base = { to: "15551234567", name: "promo_offer", languageCode: "en_US" };

    expect(() => buildSendMarketingTemplatePayload({ name: "promo_offer", languageCode: "en_US" } as never)).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload({ ...base, to: "not-a-phone" })).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload({ ...base, recipient: "bad\nbsuid" })).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload({ ...base, productPolicy: "ALLOW" as never })).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload({ ...base, messageActivitySharing: "true" as never })).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload({ ...base, components: [templateComponent, , templateComponent] as never })).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload({ ...base, type: "text" } as never)).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload(Object.defineProperty({ ...base }, "name", {
      enumerable: true,
      get() { throw new TypeError("name getter should not run"); }
    }) as never)).toThrow(GraphRequestValidationError);
    expect(() => buildSendMarketingTemplatePayload({
      ...base,
      components: [Object.defineProperty({}, "type", {
        enumerable: true,
        get() { throw new TypeError("component.type getter should not run"); }
      })]
    } as never)).toThrow(GraphRequestValidationError);

    await expect(sendMarketingTemplate(client, { phoneNumberId: "555" }, undefined as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(sendMarketingTemplate(client, { phoneNumberId: "../555" }, base)).rejects.toThrow(GraphRequestValidationError);
    await expect(sendMarketingTemplate(client, { phoneNumberId: "555", unexpected: "x" } as never, base)).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("preserves Graph error subclass taxonomy after transport", async () => {
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "Marketing Messages Lite does not support this message type.",
          type: "OAuthException",
          code: 134100,
          fbtrace_id: "trace-wats98"
        }
      }
    });

    try {
      await sendMarketingTemplate(client, { phoneNumberId: "555" }, {
        to: "15551234567",
        name: "promo_offer",
        languageCode: "en_US"
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketingMessagesLiteUnsupportedMessageTypeError);
      expect(error).toBeInstanceOf(GraphApiError);
      expect(error).not.toBeInstanceOf(GraphRateLimitError);
      expect((error as MarketingMessagesLiteUnsupportedMessageTypeError).fbtraceId).toBe("trace-wats98");
    }
  });
});
