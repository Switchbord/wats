import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient,
  buildSendAudioPayload,
  buildSendCallPermissionRequestPayload,
  type GraphMessagesSendBody
} from "../src";
import { createMockTransport } from "../src/createMockTransport";

function clientWithMock() {
  const handle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: "wamid.WATS90" }] }
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

describe("WATS-90 v24 message builders", () => {
  test("buildSendCallPermissionRequestPayload emits exact Graph call-permission body", () => {
    expect(
      buildSendCallPermissionRequestPayload({
        to: "15551230000",
        bodyText: "Can we call you about your order?",
        replyToMessageId: "wamid.PARENT"
      })
    ).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "call_permission_request",
        body: { text: "Can we call you about your order?" },
        action: { name: "call_permission_request" }
      },
      context: { message_id: "wamid.PARENT" }
    });
  });

  test("buildSendAudioPayload supports v24 voice designation without changing default audio", () => {
    expect(buildSendAudioPayload({ to: "15551230000", mediaId: "AUDIO_ID" })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "audio",
      audio: { id: "AUDIO_ID" }
    });

    expect(buildSendAudioPayload({ to: "15551230000", mediaId: "AUDIO_ID", voice: true })).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "audio",
      audio: { id: "AUDIO_ID", voice: true }
    });
  });

  test("new builders reject malformed inputs before transport", async () => {
    expect(() => buildSendCallPermissionRequestPayload(null as never)).toThrow(GraphRequestValidationError);
    expect(() => buildSendCallPermissionRequestPayload({ to: "15551230000", bodyText: "" })).toThrow(GraphRequestValidationError);
    expect(() => buildSendCallPermissionRequestPayload({ to: "15551230000", bodyText: "ok", unknown: true } as never)).toThrow(GraphRequestValidationError);
    expect(() => buildSendAudioPayload({ to: "15551230000", mediaId: "AUDIO_ID", voice: "true" as never })).toThrow(GraphRequestValidationError);

    const { client, handle } = clientWithMock();
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    await expect(phone.sendCallPermissionRequest({ to: "15551230000", bodyText: "" })).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("PhoneNumberClient sends call permission request and voice audio bodies", async () => {
    const { client, handle } = clientWithMock();
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    await phone.sendCallPermissionRequest({ to: "15551230000", bodyText: "May we call you?" });
    await phone.sendAudio({ to: "15551230000", mediaId: "AUDIO_ID", voice: true });

    expect(handle.requests.length).toBe(2);
    expect(JSON.parse(String(handle.requests[0]?.body)) as GraphMessagesSendBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: {
        type: "call_permission_request",
        body: { text: "May we call you?" },
        action: { name: "call_permission_request" }
      }
    });
    expect(JSON.parse(String(handle.requests[1]?.body)) as GraphMessagesSendBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "audio",
      audio: { id: "AUDIO_ID", voice: true }
    });
  });
});
