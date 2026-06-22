import { describe, expect, test } from "bun:test";
import * as graph from "../src";
import { GraphClient, GraphRequestValidationError, PhoneNumberClient, type GraphMessagesSendBody } from "../src";
import { createMockTransport } from "../src/createMockTransport";
import { buildTemplateButtonComponent } from "../src/endpoints/templates";

const voice = graph as typeof graph & {
  buildSendVoiceCallPayload(input: unknown): GraphMessagesSendBody;
  buildWhatsAppCallDeepLink(input: unknown): string;
  buildVoiceCallTemplateButtonComponent(input: unknown): Record<string, unknown>;
};

function clientWithMock() {
  const handle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: "wamid.WATS170" }] }
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

describe("WATS-170 WhatsApp Calling button/deep-link builders", () => {
  test("buildSendVoiceCallPayload emits exact interactive voice_call Graph body", () => {
    expect(voice.buildSendVoiceCallPayload({
      to: "14085551234",
      recipient: "US.13491208655302741918",
      bodyText: "Call us from WhatsApp.",
      displayText: "Call on WhatsApp",
      ttlMinutes: 100,
      payload: "payload data",
      replyToMessageId: "wamid.PARENT"
    })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "14085551234",
      recipient: "US.13491208655302741918",
      type: "interactive",
      interactive: {
        type: "voice_call",
        body: { text: "Call us from WhatsApp." },
        action: {
          name: "voice_call",
          parameters: {
            display_text: "Call on WhatsApp",
            ttl_minutes: 100,
            payload: "payload data"
          }
        }
      },
      context: { message_id: "wamid.PARENT" }
    });
  });

  test("PhoneNumberClient sends voice-call button body through messages endpoint", async () => {
    const { client, handle } = clientWithMock();
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    await phone.sendVoiceCall({
      recipient: "US.13491208655302741918",
      bodyText: "Call us.",
      ttlMinutes: 43200
    });
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/123/messages");
    expect(JSON.parse(String(handle.requests[0]?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      recipient: "US.13491208655302741918",
      type: "interactive",
      interactive: {
        type: "voice_call",
        body: { text: "Call us." },
        action: { name: "voice_call", parameters: { ttl_minutes: 43200 } }
      }
    });
  });

  test("voice-call builders validate limits and recipient requirements", () => {
    expect(() => voice.buildSendVoiceCallPayload({ bodyText: "Call" })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildSendVoiceCallPayload({ to: "14085551234", bodyText: "Call", displayText: "x".repeat(21) })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildSendVoiceCallPayload({ to: "14085551234", bodyText: "Call", ttlMinutes: 0 })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildSendVoiceCallPayload({ to: "14085551234", bodyText: "Call", ttlMinutes: 43201 })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildSendVoiceCallPayload({ to: "14085551234", bodyText: "Call", ttlMinutes: 1.5 })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildSendVoiceCallPayload({ to: "14085551234", bodyText: "Call", payload: "x".repeat(513) })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildSendVoiceCallPayload({ to: "14085551234", bodyText: "Call", recipientType: "group" })).toThrow(GraphRequestValidationError);
  });

  test("call button template creation and send components use documented voice_call shapes", () => {
    expect(buildTemplateButtonComponent({ buttons: [{ type: "VOICE_CALL", text: "Call Now", ttlMinutes: 1440 }] })).toEqual({
      type: "BUTTONS",
      buttons: [{ type: "voice_call", text: "Call Now", ttl_minutes: 1440 }]
    });
    expect(voice.buildVoiceCallTemplateButtonComponent({ ttlMinutes: 100, payload: "payload data" })).toEqual({
      type: "button",
      sub_type: "voice_call",
      parameters: [
        { type: "ttl_minutes", ttl_minutes: 100 },
        { type: "payload", payload: "payload data" }
      ]
    });
    expect(graph.buildSendTemplatePayload({
      recipient: "US.13491208655302741918",
      name: "call_button_template",
      languageCode: "en_US",
      components: [voice.buildVoiceCallTemplateButtonComponent({ ttlMinutes: 100, payload: "payload data" })]
    } as never)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      recipient: "US.13491208655302741918",
      type: "template",
      template: {
        name: "call_button_template",
        language: { code: "en_US" },
        components: [{
          type: "button",
          sub_type: "voice_call",
          parameters: [
            { type: "ttl_minutes", ttl_minutes: 100 },
            { type: "payload", payload: "payload data" }
          ]
        }]
      }
    });
  });

  test("template voice-call limits use template-create floor and send-override floor", () => {
    expect(() => buildTemplateButtonComponent({ buttons: [{ type: "VOICE_CALL", text: "Call Now", ttlMinutes: 1439 }] })).toThrow(GraphRequestValidationError);
    expect(() => buildTemplateButtonComponent({ buttons: [{ type: "VOICE_CALL", text: "x".repeat(21), ttlMinutes: 1440 }] })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildVoiceCallTemplateButtonComponent({ ttlMinutes: 0 })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildVoiceCallTemplateButtonComponent({ ttlMinutes: 43201 })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildVoiceCallTemplateButtonComponent({ payload: "x".repeat(513) })).toThrow(GraphRequestValidationError);
  });

  test("buildWhatsAppCallDeepLink returns wa.me call URL and validates payload", () => {
    expect(voice.buildWhatsAppCallDeepLink({ phoneNumber: "14085551234", bizPayload: "payload data" })).toBe("https://wa.me/call/14085551234?biz_payload=payload+data");
    expect(voice.buildWhatsAppCallDeepLink({ phoneNumber: "14085551234" })).toBe("https://wa.me/call/14085551234");
    expect(() => voice.buildWhatsAppCallDeepLink({ phoneNumber: "not a phone" })).toThrow(GraphRequestValidationError);
    expect(() => voice.buildWhatsAppCallDeepLink({ phoneNumber: "14085551234", bizPayload: "x".repeat(513) })).toThrow(GraphRequestValidationError);
  });
});
