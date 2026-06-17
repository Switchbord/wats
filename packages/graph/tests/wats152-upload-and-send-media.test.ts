// WATS-152 slice 1: PhoneNumberClient.uploadAndSend* helpers.
//
// RED/GREEN coverage for the one-call in-memory upload-and-send helpers.
// Proves each helper performs exactly two sequential Graph requests in order:
//   1. POST /{phoneNumberId}/media (multipart/form-data upload)
//   2. POST /{phoneNumberId}/messages (send by returned media id)
// and that malformed/unsupported inputs are rejected before transport.

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  PhoneNumberClient,
  MediaValidationError
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";
import type { Transport, TransportRequest } from "../src/transport";

function clientWith(
  responses: MockTransportResponseSpec[] | MockTransportResponseSpec
) {
  const handle = createMockTransport(
    Array.isArray(responses) ? { responses } : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport as Transport
  });
  return { client, handle };
}

async function bodyText(req: TransportRequest): Promise<string> {
  const body = req.body;
  if (body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Blob) return await body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const entries: string[] = [];
    for (const [key, value] of body.entries()) {
      entries.push(
        `${key}=${typeof value === "string" ? value : (value as File).name}`
      );
    }
    return entries.join("&");
  }
  return String(body);
}

const MEDIA_URL = "https://graph.facebook.com/v25.0/123/media";
const MESSAGES_URL = "https://graph.facebook.com/v25.0/123/messages";

describe("WATS-152 slice 1 PhoneNumberClient.uploadAndSend* helpers", () => {
  test("uploadAndSendImage issues upload then send in exact order with returned id", async () => {
    const { client, handle } = clientWith([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { id: "MEDIA_IMG_ID" }
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { messages: [{ id: "wamid.IMG" }] }
      }
    ]);
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    const res = await pnc.uploadAndSendImage({
      to: "15551230000",
      file: new Uint8Array([1, 2, 3, 4]),
      mimeType: "image/jpeg",
      caption: "hello image",
      replyToMessageId: "wamid.REPLY"
    });

    expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
      "wamid.IMG"
    );
    expect(handle.requests.length).toBe(2);

    // 1. upload request: POST /123/media multipart
    const uploadReq = handle.requests[0] as TransportRequest;
    expect(uploadReq.method).toBe("POST");
    expect(uploadReq.url).toBe(MEDIA_URL);
    expect(uploadReq.headers.get("authorization")).toBe("Bearer test-token");
    const ct = uploadReq.headers.get("content-type") ?? "";
    expect(ct).toMatch(/^multipart\/form-data; boundary=[A-Za-z0-9_.-]+$/);
    const uploadText = await bodyText(uploadReq);
    expect(uploadText).toContain('name="messaging_product"');
    expect(uploadText).toContain("whatsapp");
    expect(uploadText).toContain('name="type"');
    expect(uploadText).toContain("image/jpeg");

    // 2. send request: POST /123/messages with media id from upload response
    const sendReq = handle.requests[1] as TransportRequest;
    expect(sendReq.method).toBe("POST");
    expect(sendReq.url).toBe(MESSAGES_URL);
    const sendBody = JSON.parse(String(sendReq.body)) as Record<string, unknown>;
    expect(sendBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "image",
      image: { id: "MEDIA_IMG_ID", caption: "hello image" },
      context: { message_id: "wamid.REPLY" }
    });
  });

  test("uploadAndSendDocument issues upload then send with filename + caption", async () => {
    const { client, handle } = clientWith([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { id: "MEDIA_DOC_ID" }
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { messages: [{ id: "wamid.DOC" }] }
      }
    ]);
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    const res = await pnc.uploadAndSendDocument({
      to: "15551230000",
      file: new ArrayBuffer(8),
      mimeType: "application/pdf",
      caption: "the report",
      filename: "report.pdf"
    });

    expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
      "wamid.DOC"
    );
    expect(handle.requests.length).toBe(2);

    const uploadReq = handle.requests[0] as TransportRequest;
    expect(uploadReq.url).toBe(MEDIA_URL);
    const uploadText = await bodyText(uploadReq);
    expect(uploadText).toContain("application/pdf");

    const sendReq = handle.requests[1] as TransportRequest;
    expect(sendReq.url).toBe(MESSAGES_URL);
    const sendBody = JSON.parse(String(sendReq.body)) as Record<string, unknown>;
    expect(sendBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "document",
      document: {
        id: "MEDIA_DOC_ID",
        caption: "the report",
        filename: "report.pdf"
      }
    });
  });

  test("uploadAndSendVideo and uploadAndSendSticker wire media id through", async () => {
    const { client: videoClient, handle: videoHandle } = clientWith([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { id: "MEDIA_VID_ID" }
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { messages: [{ id: "wamid.VID" }] }
      }
    ]);
    const videoPnc = new PhoneNumberClient({
      graphClient: videoClient,
      phoneNumberId: "123"
    });
    const videoRes = await videoPnc.uploadAndSendVideo({
      to: "15551230000",
      file: new Blob([new Uint8Array([0, 0, 1])]),
      mimeType: "video/mp4"
    });
    expect(
      (videoRes as { messages?: Array<{ id: string }> }).messages?.[0]?.id
    ).toBe("wamid.VID");
    expect(videoHandle.requests.length).toBe(2);
    const videoBody = JSON.parse(
      String((videoHandle.requests[1] as TransportRequest).body)
    ) as Record<string, unknown>;
    expect(videoBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "video",
      video: { id: "MEDIA_VID_ID" }
    });

    const { client: stickerClient, handle: stickerHandle } = clientWith([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { id: "MEDIA_STK_ID" }
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { messages: [{ id: "wamid.STK" }] }
      }
    ]);
    const stickerPnc = new PhoneNumberClient({
      graphClient: stickerClient,
      phoneNumberId: "123"
    });
    await stickerPnc.uploadAndSendSticker({
      to: "15551230000",
      file: new Uint8Array([0]),
      mimeType: "image/webp"
    });
    expect(stickerHandle.requests.length).toBe(2);
    const stickerBody = JSON.parse(
      String((stickerHandle.requests[1] as TransportRequest).body)
    ) as Record<string, unknown>;
    expect(stickerBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "sticker",
      sticker: { id: "MEDIA_STK_ID" }
    });
  });

  test("rejects unsupported mimeType before any transport request (malformed case)", async () => {
    const { client, handle } = clientWith({
      status: 200,
      body: { id: "SHOULD_NOT_HAPPEN" }
    });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    let thrown: unknown;
    try {
      await pnc.uploadAndSendImage({
        to: "15551230000",
        file: new Uint8Array([1, 2, 3]),
        mimeType: "application/x-not-a-real-media-type"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MediaValidationError);
    expect((thrown as { code?: string }).code).toBe("unsupported_media_type");
    expect(handle.requests.length).toBe(0);
  });

  test("uploadAndSendAudio forwards voice flag and media id", async () => {
    const { client, handle } = clientWith([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { id: "MEDIA_AUD_ID" }
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { messages: [{ id: "wamid.AUD" }] }
      }
    ]);
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    const res = await pnc.uploadAndSendAudio({
      to: "15551230000",
      file: new Uint8Array([9, 9, 9]),
      mimeType: "audio/mpeg",
      voice: true
    });
    expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
      "wamid.AUD"
    );
    expect(handle.requests.length).toBe(2);
    const sendBody = JSON.parse(
      String((handle.requests[1] as TransportRequest).body)
    ) as Record<string, unknown>;
    expect(sendBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "audio",
      audio: { id: "MEDIA_AUD_ID", voice: true }
    });
  });
});
