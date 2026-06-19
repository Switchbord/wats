// WATS-159: Node/Bun filesystem-path media upload-and-send helpers.
//
// RED/GREEN coverage for the `@wats/graph/node-media` subpath. Proves each
// helper performs exactly two sequential Graph requests in order:
//   1. POST /{phoneNumberId}/media   (multipart/form-data upload)
//   2. POST /{phoneNumberId}/messages (send by returned media id)
// and that malformed/unsafe/oversized inputs are rejected BEFORE any
// transport request. Also pins extension→MIME inference, mimeType override,
// and the "never echo full file path" diagnostic redaction contract.

import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GraphClient,
  MediaValidationError,
  PhoneNumberClient
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";
import type { Transport, TransportRequest } from "../src/transport";
import {
  uploadAndSendAudioFromPath,
  uploadAndSendDocumentFromPath,
  uploadAndSendImageFromPath,
  uploadAndSendStickerFromPath,
  uploadAndSendVideoFromPath
} from "../src/nodeMedia";

const MEDIA_URL = "https://graph.facebook.com/v25.0/123/media";
const MESSAGES_URL = "https://graph.facebook.com/v25.0/123/messages";

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

function pncFor(client: GraphClient): PhoneNumberClient {
  return new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
}

function uploadThenSendResponses(mediaId: string, wamid: string): MockTransportResponseSpec[] {
  return [
    {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: mediaId }
    },
    {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: wamid }] }
    }
  ];
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

let tempRoot: string;

afterAll(() => {
  if (typeof tempRoot === "string") {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "wats159-"));
});

function tempFile(name: string, bytes: Uint8Array): string {
  const filePath = join(tempRoot, name);
  writeFileSync(filePath, bytes);
  return filePath;
}

describe("WATS-159 node-media upload-and-send path helpers", () => {
  test("uploadAndSendImageFromPath issues upload then send in exact order with returned id", async () => {
    const { client, handle } = clientWith(
      uploadThenSendResponses("MEDIA_IMG_ID", "wamid.IMG")
    );
    const pnc = pncFor(client);
    const filePath = tempFile("pic.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    const res = await uploadAndSendImageFromPath(pnc, {
      to: "15551230000",
      path: filePath,
      caption: "hello image",
      replyToMessageId: "wamid.REPLY"
    });

    expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
      "wamid.IMG"
    );
    expect(handle.requests.length).toBe(2);

    const uploadReq = handle.requests[0] as TransportRequest;
    expect(uploadReq.method).toBe("POST");
    expect(uploadReq.url).toBe(MEDIA_URL);
    const ct = uploadReq.headers.get("content-type") ?? "";
    expect(ct).toMatch(/^multipart\/form-data; boundary=[A-Za-z0-9_.-]+$/);
    const uploadText = await bodyText(uploadReq);
    expect(uploadText).toContain('name="messaging_product"');
    expect(uploadText).toContain("whatsapp");
    expect(uploadText).toContain('name="type"');
    expect(uploadText).toContain("image/jpeg");

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

  test("extension→MIME inference flows through upload body for every media kind", async () => {
    const cases: Array<{
      label: string;
      name: string;
      expectedMime: string;
      expectedType: string;
      run: (pnc: PhoneNumberClient, path: string) => Promise<unknown>;
    }> = [
      {
        label: "png image",
        name: "img.png",
        expectedMime: "image/png",
        expectedType: "image",
        run: (pnc, path) =>
          uploadAndSendImageFromPath(pnc, { to: "15551230000", path })
      },
      {
        label: "mp4 video",
        name: "clip.mp4",
        expectedMime: "video/mp4",
        expectedType: "video",
        run: (pnc, path) =>
          uploadAndSendVideoFromPath(pnc, { to: "15551230000", path })
      },
      {
        label: "mp3 audio",
        name: "song.mp3",
        expectedMime: "audio/mpeg",
        expectedType: "audio",
        run: (pnc, path) =>
          uploadAndSendAudioFromPath(pnc, { to: "15551230000", path })
      },
      {
        label: "pdf document",
        name: "report.pdf",
        expectedMime: "application/pdf",
        expectedType: "document",
        run: (pnc, path) =>
          uploadAndSendDocumentFromPath(pnc, {
            to: "15551230000",
            path,
            filename: "report.pdf"
          })
      },
      {
        label: "webp sticker",
        name: "sticker.webp",
        expectedMime: "image/webp",
        expectedType: "sticker",
        run: (pnc, path) =>
          uploadAndSendStickerFromPath(pnc, { to: "15551230000", path })
      }
    ];

    for (const c of cases) {
      const { client, handle } = clientWith(
        uploadThenSendResponses(`MEDIA_${c.expectedType.toUpperCase()}`, `wamid.${c.expectedType.toUpperCase()}`)
      );
      const pnc = pncFor(client);
      const filePath = tempFile(c.name, new Uint8Array([1, 2, 3, 4]));

      await c.run(pnc, filePath);

      expect(handle.requests.length).toBe(2);
      const uploadText = await bodyText(handle.requests[0] as TransportRequest);
      expect(uploadText).toContain(c.expectedMime);
      const sendBody = JSON.parse(
        String((handle.requests[1] as TransportRequest).body)
      ) as Record<string, unknown>;
      expect(sendBody.type).toBe(c.expectedType);
      expect(
        (sendBody[c.expectedType] as { id?: string }).id
      ).toBe(`MEDIA_${c.expectedType.toUpperCase()}`);
    }
  });

  test("mimeType override wins over extension inference", async () => {
    const { client, handle } = clientWith(
      uploadThenSendResponses("MEDIA_OVR", "wamid.OVR")
    );
    const pnc = pncFor(client);
    const filePath = tempFile("pic.jpg", new Uint8Array([1, 2, 3]));

    await uploadAndSendImageFromPath(pnc, {
      to: "15551230000",
      path: filePath,
      mimeType: "image/png"
    });

    expect(handle.requests.length).toBe(2);
    const uploadText = await bodyText(handle.requests[0] as TransportRequest);
    expect(uploadText).toContain("image/png");
    expect(uploadText).not.toContain("image/jpeg");
  });

  test("audio voice flag forwards through to the send body", async () => {
    const { client, handle } = clientWith(
      uploadThenSendResponses("MEDIA_AUD", "wamid.AUD")
    );
    const pnc = pncFor(client);
    const filePath = tempFile("voice.m4a", new Uint8Array([9, 9, 9]));

    await uploadAndSendAudioFromPath(pnc, {
      to: "15551230000",
      path: filePath,
      voice: true
    });

    expect(handle.requests.length).toBe(2);
    const sendBody = JSON.parse(
      String((handle.requests[1] as TransportRequest).body)
    ) as Record<string, unknown>;
    expect(sendBody).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "audio",
      audio: { id: "MEDIA_AUD", voice: true }
    });
  });

  test("rejects empty/whitespace path before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);

    for (const badPath of ["", "   "] as const) {
      let thrown: unknown;
      try {
        await uploadAndSendImageFromPath(pnc, {
          to: "15551230000",
          path: badPath
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MediaValidationError);
      expect((thrown as MediaValidationError).code).toBe("invalid_params");
      expect(handle.requests.length).toBe(0);
    }
  });

  test("rejects NUL / control characters in path before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);

    for (const badPath of ["a\0b.jpg", "a\nb.jpg", "a\x7fb.jpg"] as const) {
      let thrown: unknown;
      try {
        await uploadAndSendImageFromPath(pnc, {
          to: "15551230000",
          path: badPath
        });
      } catch (error) {
        thrown = error;
      }
      const err = thrown as MediaValidationError;
      expect(err).toBeInstanceOf(MediaValidationError);
      expect(err.code).toBe("invalid_file");
      // The offending path must never appear in the message.
      expect(err.message).not.toContain(badPath);
      expect(handle.requests.length).toBe(0);
    }
  });

  test("rejects parent-directory (..) traversal segments before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);

    for (const badPath of [
      "../secret.jpg",
      "foo/../bar.jpg",
      "a/../../b.jpg"
    ] as const) {
      let thrown: unknown;
      try {
        await uploadAndSendImageFromPath(pnc, {
          to: "15551230000",
          path: badPath
        });
      } catch (error) {
        thrown = error;
      }
      const err = thrown as MediaValidationError;
      expect(err).toBeInstanceOf(MediaValidationError);
      expect(err.code).toBe("invalid_file");
      expect(err.message).not.toContain(badPath);
      expect(handle.requests.length).toBe(0);
    }
  });

  test("rejects directories even with an allowed extension before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);
    const dirPath = join(tempRoot, "evil.jpg");
    mkdirSync(dirPath);

    let thrown: unknown;
    try {
      await uploadAndSendImageFromPath(pnc, {
        to: "15551230000",
        path: dirPath
      });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as MediaValidationError;
    expect(err).toBeInstanceOf(MediaValidationError);
    expect(err.code).toBe("invalid_file");
    // The absolute directory path must never leak into the message.
    expect(err.message).not.toContain(tempRoot);
    expect(err.message).not.toContain(dirPath);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unsupported / missing extensions before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);

    const txtPath = tempFile("notes.txt", new Uint8Array([1]));
    const noExtPath = tempFile("noext", new Uint8Array([1]));

    for (const badPath of [txtPath, noExtPath] as const) {
      let thrown: unknown;
      try {
        await uploadAndSendImageFromPath(pnc, {
          to: "15551230000",
          path: badPath
        });
      } catch (error) {
        thrown = error;
      }
      const err = thrown as MediaValidationError;
      expect(err).toBeInstanceOf(MediaValidationError);
      expect(err.code).toBe("unsupported_media_type");
      expect(err.message).not.toContain(tempRoot);
      expect(err.message).not.toContain(badPath);
      expect(handle.requests.length).toBe(0);
    }
  });

  test("rejects over-large files before transport (maxBytes cap)", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);
    const filePath = tempFile("big.jpg", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

    let thrown: unknown;
    try {
      await uploadAndSendImageFromPath(pnc, {
        to: "15551230000",
        path: filePath,
        maxBytes: 4
      });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as MediaValidationError;
    expect(err).toBeInstanceOf(MediaValidationError);
    expect(err.code).toBe("upload_too_large");
    expect(err.message).not.toContain(tempRoot);
    expect(err.message).not.toContain(filePath);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects invalid maxBytes before filesystem read or transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);
    const filePath = tempFile("pic.jpg", new Uint8Array([1, 2, 3]));

    for (const maxBytes of [0, -1, 1.5, Number.POSITIVE_INFINITY] as const) {
      let thrown: unknown;
      try {
        await uploadAndSendImageFromPath(pnc, {
          to: "15551230000",
          path: filePath,
          maxBytes
        });
      } catch (error) {
        thrown = error;
      }
      const err = thrown as MediaValidationError;
      expect(err).toBeInstanceOf(MediaValidationError);
      expect(err.code).toBe("invalid_params");
      expect(handle.requests.length).toBe(0);
    }
  });

  test("rejects non-existent file before transport without leaking path", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);
    const missingPath = join(tempRoot, "absent.jpg");

    let thrown: unknown;
    try {
      await uploadAndSendImageFromPath(pnc, {
        to: "15551230000",
        path: missingPath
      });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as MediaValidationError;
    expect(err).toBeInstanceOf(MediaValidationError);
    expect(err.code).toBe("invalid_file");
    expect(err.message).not.toContain(tempRoot);
    expect(err.message).not.toContain(missingPath);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects empty recipient before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    const pnc = pncFor(client);
    const filePath = tempFile("pic.jpg", new Uint8Array([1, 2, 3]));

    let thrown: unknown;
    try {
      await uploadAndSendImageFromPath(pnc, { to: "", path: filePath });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as MediaValidationError;
    expect(err).toBeInstanceOf(MediaValidationError);
    expect(err.code).toBe("invalid_params");
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-PhoneNumberClient before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "NO" } });
    // Reuse a GraphClient (which is NOT a PhoneNumberClient) to prove the
    // structural guard fires before any filesystem or transport activity.
    let thrown: unknown;
    try {
      await uploadAndSendImageFromPath(client as unknown as PhoneNumberClient, {
        to: "15551230000",
        path: join(tempRoot, "pic.jpg")
      });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as MediaValidationError;
    expect(err).toBeInstanceOf(MediaValidationError);
    expect(err.code).toBe("invalid_client");
    expect(handle.requests.length).toBe(0);
  });
});
