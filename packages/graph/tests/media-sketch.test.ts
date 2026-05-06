// WATS-37 media runtime parity first slice.
//
// RED/GREEN coverage: WATS-37 media runtime performs real
// MockTransport-backed Graph requests for upload, metadata, binary download,
// delete, encrypted decrypt, and upload-session helpers with strict runtime
// validation.

import { describe, expect, test, beforeAll } from "bun:test";
import * as graphRoot from "../src/index";
import { GraphClient } from "../src/client";
import { createMockTransport } from "../src/createMockTransport";
import * as media from "../src/endpoints/media";
import { GraphApiError, GraphNetworkError } from "../src/errors";
import { PaginationError } from "../src/pagination";
import type { TransportRequest } from "../src/transport";
import type { Transport, TransportResponse } from "../src/transport";

const {
  uploadMedia,
  downloadMedia,
  deleteMedia,
  downloadMediaBytes,
  decryptEncryptedMedia,
  createUploadSession,
  uploadFileToSession,
  getUploadSession,
  MediaCryptoError,
  MediaIntegrityError
} = media;

type MockHandle = ReturnType<typeof createMockTransport>;

function buildClient(handle: MockHandle): GraphClient {
  return new GraphClient({
    accessToken: "test-token",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: handle.transport as Transport
  });
}

function buildJsonHandle(body: object): MockHandle {
  return createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body
    }
  });
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
      entries.push(`${key}=${typeof value === "string" ? value : value.name}`);
    }
    return entries.join("&");
  }
  return String(body);
}

async function expectMultipartUploadRequest(
  req: TransportRequest,
  expectedFileText: string
): Promise<void> {
  expect(req.method).toBe("POST");
  expect(req.url).toBe("https://graph.facebook.com/v25.0/555000111/media");
  expect(req.headers.get("authorization")).toBe("Bearer test-token");
  const contentType = req.headers.get("content-type") ?? "";
  expect(contentType).toMatch(/^multipart\/form-data; boundary=[A-Za-z0-9_.-]+$/);
  expect(contentType).not.toContain("image/jpeg; boundary=");
  const boundary = contentType.slice("multipart/form-data; boundary=".length);
  const text = await bodyText(req);
  expect(text).toContain(`--${boundary}\r\n`);
  expect(text).toContain('Content-Disposition: form-data; name="messaging_product"');
  expect(text).toContain("\r\n\r\nwhatsapp\r\n");
  expect(text).toContain('Content-Disposition: form-data; name="type"');
  expect(text).toContain("\r\n\r\nimage/jpeg\r\n");
  expect(text).toContain('Content-Disposition: form-data; name="file"; filename="media"');
  expect(text).toContain("Content-Type: image/jpeg");
  expect(text).toContain(expectedFileText);
  expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
}

function expectMediaValidationError(thrown: unknown, code: string): void {
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as { name?: string }).name).toBe("MediaValidationError");
  expect((thrown as { code?: string }).code).toBe(code);
  expect(thrown).not.toBeInstanceOf(TypeError);
  expect(thrown).not.toBeInstanceOf(PaginationError);
}

function expectMediaCryptoError(thrown: unknown, code: string): void {
  expect(thrown).toBeInstanceOf(MediaCryptoError);
  expect((thrown as { name?: string }).name).toBe("MediaCryptoError");
  expect((thrown as { code?: string }).code).toBe(code);
  expect(thrown).not.toBeInstanceOf(TypeError);
}

function expectMediaIntegrityError(thrown: unknown, code: string): void {
  expect(thrown).toBeInstanceOf(MediaIntegrityError);
  expect((thrown as { name?: string }).name).toBe("MediaIntegrityError");
  expect((thrown as { code?: string }).code).toBe(code);
  expect(thrown).not.toBeInstanceOf(TypeError);
}

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
    return undefined;
  } catch (error) {
    return error;
  }
}

function expectNoTransport(handle: MockHandle): void {
  expect(handle.requests.length).toBe(0);
}

const validUploadBody = {
  file: new Uint8Array([65, 66, 67]),
  type: "image/jpeg",
  messagingProduct: "whatsapp" as const
};

let testSubtle!: SubtleCrypto;

beforeAll(() => {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("SubtleCrypto is required for WATS-37 media tests");
  }
  testSubtle = globalThis.crypto.subtle;
});

function bytesFromText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.slice() as BufferSource;
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  return bytesToBase64(new Uint8Array(await testSubtle.digest("SHA-256", asBufferSource(bytes))));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function buildEncryptedFixture(plaintext = bytesFromText("deterministic media plaintext")): Promise<{
  bundle: media.EncryptedMediaBundle;
  encrypted: Uint8Array;
  plaintext: Uint8Array;
}> {
  const encryptionKey = new Uint8Array(32);
  const hmacKey = new Uint8Array(32);
  const iv = new Uint8Array(16);
  for (let i = 0; i < encryptionKey.length; i += 1) encryptionKey[i] = (i + 1) & 0xff;
  for (let i = 0; i < hmacKey.length; i += 1) hmacKey[i] = (0xa0 + i) & 0xff;
  for (let i = 0; i < iv.length; i += 1) iv[i] = (0x10 + i) & 0xff;

  const paddingLength = 16 - (plaintext.byteLength % 16 || 16) || 16;
  const padded = concatBytes([plaintext, new Uint8Array(paddingLength).fill(paddingLength)]);
  const key = await testSubtle.importKey("raw", asBufferSource(encryptionKey), { name: "AES-CBC" }, false, ["encrypt"]);
  const encryptedWithWebCryptoPadding = new Uint8Array(
    await testSubtle.encrypt({ name: "AES-CBC", iv: asBufferSource(iv) }, key, asBufferSource(padded))
  );
  // WebCrypto AES-CBC applies PKCS#7 padding. Test fixture passes already-padded
  // input, so strip the extra block to model pywa's ciphertext exactly.
  const ciphertext = encryptedWithWebCryptoPadding.slice(0, padded.byteLength);
  const hmacCryptoKey = await testSubtle.importKey(
    "raw",
    asBufferSource(hmacKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(await testSubtle.sign("HMAC", hmacCryptoKey, asBufferSource(concatBytes([iv, ciphertext]))));
  const tag = mac.slice(0, 10);
  const encrypted = concatBytes([ciphertext, tag]);
  const bundle: media.EncryptedMediaBundle = {
    url: "https://lookaside.example.test/encrypted",
    encryptionKey: bytesToBase64(encryptionKey),
    hmacKey: bytesToBase64(hmacKey),
    iv: bytesToBase64(iv),
    sha256: await sha256Base64(plaintext),
    sha256Enc: await sha256Base64(encrypted)
  };
  return { bundle, encrypted, plaintext };
}

function makeChunkedTransportResponse(chunks: readonly Uint8Array[], headers?: Record<string, string>): TransportResponse {
  let consumed = false;
  const bytes = concatBytes(chunks);
  return {
    status: 200,
    headers: new Headers(headers),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    }),
    async arrayBuffer() {
      if (consumed) throw new Error("consumed");
      consumed = true;
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      return copy;
    },
    async text() {
      if (consumed) throw new Error("consumed");
      consumed = true;
      return new TextDecoder().decode(bytes);
    },
    async json<T>() {
      return JSON.parse(await this.text()) as T;
    }
  };
}

class UnderReportingUint8Array extends Uint8Array {
  override get byteLength(): number {
    return 0;
  }

  override get length(): number {
    return 0;
  }
}

describe("WATS-37 media public exports", () => {
  test("exports finite upload cap, validation error, and runtime functions from endpoint module", () => {
    expect(typeof uploadMedia).toBe("function");
    expect(typeof downloadMedia).toBe("function");
    expect(typeof deleteMedia).toBe("function");
    expect(typeof downloadMediaBytes).toBe("function");
    expect(typeof decryptEncryptedMedia).toBe("function");
    expect(typeof createUploadSession).toBe("function");
    expect(typeof uploadFileToSession).toBe("function");
    expect(typeof getUploadSession).toBe("function");
    expect(typeof (media as Record<string, unknown>).MediaValidationError).toBe("function");
    expect(typeof (media as Record<string, unknown>).MediaCryptoError).toBe("function");
    expect(typeof (media as Record<string, unknown>).MediaIntegrityError).toBe("function");
    expect(typeof (media as Record<string, unknown>).DEFAULT_MAX_MEDIA_UPLOAD_BYTES).toBe("number");
    expect(typeof (media as Record<string, unknown>).DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES).toBe("number");
    expect(typeof (media as Record<string, unknown>).MAX_MEDIA_UPLOAD_BYTES).toBe("number");
    expect(Number.isInteger((media as { DEFAULT_MAX_MEDIA_UPLOAD_BYTES?: number }).DEFAULT_MAX_MEDIA_UPLOAD_BYTES)).toBe(true);
    expect(((media as { DEFAULT_MAX_MEDIA_UPLOAD_BYTES?: number }).DEFAULT_MAX_MEDIA_UPLOAD_BYTES ?? 0) > 0).toBe(true);
    expect(((media as { DEFAULT_MAX_MEDIA_UPLOAD_BYTES?: number }).DEFAULT_MAX_MEDIA_UPLOAD_BYTES ?? Infinity) < Infinity).toBe(true);
  });

  test("root @switchbord/graph barrel exposes WATS-37 media runtime taxonomy", () => {
    expect(typeof (graphRoot as Record<string, unknown>).uploadMedia).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).downloadMedia).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).deleteMedia).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).downloadMediaBytes).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).decryptEncryptedMedia).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).createUploadSession).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).uploadFileToSession).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).getUploadSession).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).MediaValidationError).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).MediaCryptoError).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).MediaIntegrityError).toBe("function");
    expect(typeof (graphRoot as Record<string, unknown>).DEFAULT_MAX_MEDIA_UPLOAD_BYTES).toBe("number");
    expect(typeof (graphRoot as Record<string, unknown>).DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES).toBe("number");
  });
});

describe("WATS-37 uploadMedia runtime", () => {
  test("uploads Uint8Array as single POST multipart/form-data", async () => {
    const handle = buildJsonHandle({ id: "media-1" });
    const client = buildClient(handle);

    const result = await uploadMedia(client, { phoneNumberId: "555000111" }, validUploadBody);

    expect(result).toEqual({ id: "media-1" });
    expect(handle.requests.length).toBe(1);
    await expectMultipartUploadRequest(handle.requests[0]!, "ABC");
  });

  test("uploads ArrayBuffer body and preserves bytes in file part", async () => {
    const handle = buildJsonHandle({ id: "media-2" });
    const client = buildClient(handle);
    const buffer = new TextEncoder().encode("ARRAY-BUFFER").buffer;

    const result = await uploadMedia(
      client,
      { phoneNumberId: "555000111" },
      { file: buffer, type: "image/jpeg", messagingProduct: "whatsapp" }
    );

    expect(result.id).toBe("media-2");
    expect(handle.requests.length).toBe(1);
    await expectMultipartUploadRequest(handle.requests[0]!, "ARRAY-BUFFER");
  });

  test("uploads Blob body and checks Blob.size before reading", async () => {
    const handle = buildJsonHandle({ id: "media-3" });
    const client = buildClient(handle);
    const file = new Blob(["BLOB-CONTENT"], { type: "text/plain" });

    const result = await uploadMedia(
      client,
      { phoneNumberId: "555000111" },
      { file, type: "text/plain", messagingProduct: "whatsapp" },
      { maxBytes: file.size }
    );

    expect(result.id).toBe("media-3");
    expect(handle.requests.length).toBe(1);
    const requestText = await bodyText(handle.requests[0]!);
    expect(handle.requests[0]!.headers.get("content-type")).toContain("multipart/form-data; boundary=");
    expect(requestText).toContain("BLOB-CONTENT");
    expect(requestText).toContain("\r\n\r\ntext/plain\r\n");
  });

  test("supports at-limit maxBytes override", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const handle = buildJsonHandle({ id: "at-limit" });
    const client = buildClient(handle);

    const result = await uploadMedia(
      client,
      { phoneNumberId: "555000111" },
      { file: bytes, type: "image/png", messagingProduct: "whatsapp" },
      { maxBytes: bytes.byteLength }
    );

    expect(result.id).toBe("at-limit");
    expect(handle.requests.length).toBe(1);
  });

  test("rejects over-limit uploads before transport", async () => {
    const handle = buildJsonHandle({ id: "should-not-send" });
    const client = buildClient(handle);

    const thrown = await captureError(() =>
      uploadMedia(
        client,
        { phoneNumberId: "555000111" },
        { file: new Uint8Array([1, 2, 3, 4]), type: "image/png", messagingProduct: "whatsapp" },
        { maxBytes: 3 }
      )
    );

    expectMediaValidationError(thrown, "upload_too_large");
    expectNoTransport(handle);
  });

  test("rejects invalid maxBytes overrides", async () => {
    for (const maxBytes of [0, -1, 1.5, NaN, Infinity, Number.MAX_VALUE]) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        uploadMedia(client, { phoneNumberId: "555000111" }, validUploadBody, {
          maxBytes
        })
      );
      expectMediaValidationError(thrown, "invalid_options");
      expectNoTransport(handle);
    }
  });

  test("rejects invalid params objects before transport", async () => {
    for (const params of [null, undefined, "555", [], 42]) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        uploadMedia(client, params as never, validUploadBody)
      );
      expectMediaValidationError(thrown, "invalid_params");
      expectNoTransport(handle);
    }
  });

  test("rejects unsafe phoneNumberId values before transport", async () => {
    const badIds = [
      "",
      "   ",
      123,
      "../evil",
      "evil/path",
      "evil\\path",
      "evil?x=1",
      "evil#frag",
      "http://example.test/id",
      "evil%2Fpath",
      "%2e%2e",
      "%252e%252e",
      "abc\n123"
    ];
    for (const phoneNumberId of badIds) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        uploadMedia(client, { phoneNumberId } as never, validUploadBody)
      );
      expectMediaValidationError(thrown, "invalid_phone_number_id");
      expectNoTransport(handle);
    }
  });

  test("rejects invalid upload body objects before transport", async () => {
    for (const body of [null, undefined, "body", [], 123]) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        uploadMedia(client, { phoneNumberId: "555000111" }, body as never)
      );
      expectMediaValidationError(thrown, "invalid_upload_body");
      expectNoTransport(handle);
    }
  });

  test("rejects unsupported file body matrix entries before transport", async () => {
    const unsupportedFiles = [
      null,
      undefined,
      "hello",
      { bytes: [1, 2, 3] },
      new DataView(new ArrayBuffer(4)),
      new Int8Array([1, 2, 3])
    ];
    for (const file of unsupportedFiles) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        uploadMedia(client, { phoneNumberId: "555000111" }, {
          file,
          type: "image/jpeg",
          messagingProduct: "whatsapp"
        } as never)
      );
      expectMediaValidationError(thrown, "invalid_file");
      expectNoTransport(handle);
    }
  });

  test.skipIf(typeof SharedArrayBuffer === "undefined")(
    "rejects SharedArrayBuffer-backed Uint8Array before transport",
    async () => {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const sab = new SharedArrayBuffer(8);
      const file = new Uint8Array(sab);
      const thrown = await captureError(() =>
        uploadMedia(client, { phoneNumberId: "555000111" }, {
          file,
          type: "image/jpeg",
          messagingProduct: "whatsapp"
        } as never)
      );
      expectMediaValidationError(thrown, "invalid_file");
      expectNoTransport(handle);
    }
  );

  test("rejects invalid and unsupported MIME types before transport", async () => {
    const badTypes = [
      "",
      "   ",
      123,
      "image/jpeg\r\nX-Evil: 1",
      "application/x-msdownload",
      "image/jpeg; charset=binary",
      "text/html"
    ];
    for (const type of badTypes) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        uploadMedia(client, { phoneNumberId: "555000111" }, {
          file: new Uint8Array([1]),
          type,
          messagingProduct: "whatsapp"
        } as never)
      );
      expectMediaValidationError(
        thrown,
        typeof type === "string" && type.trim().length > 0 && !/[\r\n\0]/.test(type)
          ? "unsupported_media_type"
          : "invalid_media_type"
      );
      expectNoTransport(handle);
    }
  });

  test("rejects messagingProduct other than exactly whatsapp", async () => {
    for (const messagingProduct of [undefined, null, "WhatsApp", "instagram", " whatsapp "]) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        uploadMedia(client, { phoneNumberId: "555000111" }, {
          file: new Uint8Array([1]),
          type: "image/jpeg",
          messagingProduct
        } as never)
      );
      expectMediaValidationError(thrown, "invalid_messaging_product");
      expectNoTransport(handle);
    }
  });

  test("rejects fake AbortSignal-like objects before upload transport", async () => {
    const handle = buildJsonHandle({ id: "should-not-send" });
    const client = buildClient(handle);

    const thrown = await captureError(() =>
      uploadMedia(client, { phoneNumberId: "555000111" }, validUploadBody, {
        signal: { aborted: false } as unknown as AbortSignal
      })
    );

    expectMediaValidationError(thrown, "invalid_options");
    expectNoTransport(handle);
  });

  test("rejects malformed successful upload response", async () => {
    const handle = buildJsonHandle({ ok: true });
    const client = buildClient(handle);

    const thrown = await captureError(() =>
      uploadMedia(client, { phoneNumberId: "555000111" }, validUploadBody)
    );

    expectMediaValidationError(thrown, "invalid_response");
    expect(handle.requests.length).toBe(1);
  });
});

describe("WATS-37 downloadMedia metadata runtime", () => {
  test("resolves media metadata with numeric file_size parsing", async () => {
    const handle = buildJsonHandle({
      messaging_product: "whatsapp",
      url: "https://lookaside.example.test/media/1",
      mime_type: "image/jpeg",
      sha256: "sha256hex",
      file_size: "12345"
    });
    const client = buildClient(handle);

    const result = await downloadMedia(client, { mediaId: "media123" });

    expect(result).toEqual({
      messagingProduct: "whatsapp",
      url: "https://lookaside.example.test/media/1",
      mimeType: "image/jpeg",
      sha256: "sha256hex",
      fileSize: 12345
    });
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]!.method).toBe("GET");
    expect(handle.requests[0]!.url).toBe("https://graph.facebook.com/v25.0/media123");
    expect(handle.requests[0]!.body).toBeNull();
  });

  test("accepts numeric file_size values", async () => {
    const handle = buildJsonHandle({
      messaging_product: "whatsapp",
      url: "https://lookaside.example.test/media/2",
      mime_type: "image/png",
      sha256: "sha256hex",
      file_size: 7
    });
    const client = buildClient(handle);

    const result = await downloadMedia(client, { mediaId: "media456" });

    expect(result.fileSize).toBe(7);
  });

  test("rejects invalid download options and mediaId values before transport", async () => {
    const badOpts = [null, undefined, "media", [], 99, {}, { mediaId: "" }, { mediaId: "   " }, { mediaId: 1 }, { mediaId: "../evil" }, { mediaId: "evil%2Fpath" }, { mediaId: "%252e%252e" }, { mediaId: "https://example.test/x" }, { mediaId: "abc\u0000def" }, { mediaId: "media123", signal: { aborted: false } }];
    for (const opts of badOpts) {
      const handle = buildJsonHandle({ ok: true });
      const client = buildClient(handle);
      const thrown = await captureError(() => downloadMedia(client, opts as never));
      expectMediaValidationError(
        thrown,
        typeof opts === "object" &&
          opts !== null &&
          !Array.isArray(opts) &&
          "signal" in opts
          ? "invalid_options"
          : typeof opts === "object" && opts !== null && !Array.isArray(opts)
            ? "invalid_media_id"
            : "invalid_options"
      );
      expectNoTransport(handle);
    }
  });

  test("rejects malformed metadata payloads", async () => {
    const malformedPayloads = [
      {},
      { messaging_product: "instagram", url: "https://x", mime_type: "image/jpeg", sha256: "s", file_size: "1" },
      { messaging_product: "whatsapp", url: "", mime_type: "image/jpeg", sha256: "s", file_size: "1" },
      { messaging_product: "whatsapp", url: "https://x", mime_type: "", sha256: "s", file_size: "1" },
      { messaging_product: "whatsapp", url: "https://x", mime_type: "image/jpeg", sha256: "", file_size: "1" },
      { messaging_product: "whatsapp", url: "https://x", mime_type: "image/jpeg", sha256: "s", file_size: "NaN" },
      { messaging_product: "whatsapp", url: "https://x", mime_type: "image/jpeg", sha256: "s", file_size: -1 }
    ];
    for (const payload of malformedPayloads) {
      const handle = buildJsonHandle(payload as object);
      const client = buildClient(handle);
      const thrown = await captureError(() => downloadMedia(client, { mediaId: "media123" }));
      expectMediaValidationError(thrown, "invalid_response");
      expect(handle.requests.length).toBe(1);
    }
  });
});

describe("WATS-37 deleteMedia runtime", () => {
  test("deletes media and returns Graph success boolean", async () => {
    const handle = buildJsonHandle({ success: true });
    const client = buildClient(handle);

    const result = await deleteMedia(client, { mediaId: "media123" });

    expect(result).toEqual({ success: true });
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]!.method).toBe("DELETE");
    expect(handle.requests[0]!.url).toBe("https://graph.facebook.com/v25.0/media123");
    expect(handle.requests[0]!.body).toBeNull();
  });

  test("rejects invalid delete options and mediaId values before transport", async () => {
    const badOpts = [null, undefined, "media", [], 99, {}, { mediaId: "" }, { mediaId: "   " }, { mediaId: 1 }, { mediaId: "a/b" }, { mediaId: "a%2Fb" }, { mediaId: ".." }, { mediaId: "http://example.test/x" }, { mediaId: "abc\rdef" }, { mediaId: "media123", signal: { aborted: false } }];
    for (const opts of badOpts) {
      const handle = buildJsonHandle({ success: true });
      const client = buildClient(handle);
      const thrown = await captureError(() => deleteMedia(client, opts as never));
      expectMediaValidationError(
        thrown,
        typeof opts === "object" &&
          opts !== null &&
          !Array.isArray(opts) &&
          "signal" in opts
          ? "invalid_options"
          : typeof opts === "object" && opts !== null && !Array.isArray(opts)
            ? "invalid_media_id"
            : "invalid_params"
      );
      expectNoTransport(handle);
    }
  });

  test("rejects malformed delete response", async () => {
    const handle = buildJsonHandle({ success: "true" });
    const client = buildClient(handle);

    const thrown = await captureError(() => deleteMedia(client, { mediaId: "media123" }));

    expectMediaValidationError(thrown, "invalid_response");
    expect(handle.requests.length).toBe(1);
  });
});

describe("WATS-37 downloadMediaBytes runtime", () => {
  test("downloads bytes through GraphClient transport with authorization and returns sha256/content-type", async () => {
    const payload = bytesFromText("binary-media");
    const expectedSha256 = await sha256Base64(payload);
    const handle = createMockTransport({
      defaultResponse: {
        status: 200,
        headers: { "content-type": "image/jpeg" },
        body: payload
      }
    });
    const client = buildClient(handle);

    const result = await downloadMediaBytes(client, {
      url: "https://lookaside.example.test/media/abc?token=opaque",
      expectedSha256,
      maxBytes: payload.byteLength
    });

    expect(Array.from(result.bytes)).toEqual(Array.from(payload));
    expect(result.sha256).toBe(expectedSha256);
    expect(result.contentType).toBe("image/jpeg");
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]!.method).toBe("GET");
    expect(handle.requests[0]!.url).toBe("https://lookaside.example.test/media/abc?token=opaque");
    expect(handle.requests[0]!.headers.get("authorization")).toBe("Bearer test-token");
  });

  test("enforces maxBytes while reading streamed response chunks", async () => {
    const requests: TransportRequest[] = [];
    const transport: Transport = {
      async request(req) {
        requests.push(req);
        return makeChunkedTransportResponse([
          new Uint8Array([1, 2]),
          new Uint8Array([3, 4])
        ], { "content-type": "application/octet-stream" });
      }
    };
    const client = new GraphClient({
      accessToken: "test-token",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com",
      transport
    });

    const thrown = await captureError(() =>
      downloadMediaBytes(client, {
        url: "https://lookaside.example.test/media/chunked",
        maxBytes: 3
      })
    );

    expectMediaValidationError(thrown, "download_too_large");
    expect(requests.length).toBe(1);
  });

  test("rejects streamed Uint8Array subclasses that under-report byteLength using intrinsic size", async () => {
    const requests: TransportRequest[] = [];
    const chunk = new UnderReportingUint8Array([1, 2, 3, 4]);
    expect(chunk.byteLength).toBe(0);
    expect(chunk.length).toBe(0);
    expect(Array.from(chunk)).toEqual([1, 2, 3, 4]);
    const transport: Transport = {
      async request(req) {
        requests.push(req);
        return {
          status: 200,
          headers: new Headers({ "content-type": "application/octet-stream" }),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.close();
            }
          }),
          async arrayBuffer() {
            throw new Error("arrayBuffer fallback should not be used for streamed response");
          },
          async text() {
            throw new Error("text fallback should not be used for streamed response");
          },
          async json<T>() {
            throw new Error("json fallback should not be used for streamed response") as T;
          }
        };
      }
    };
    const client = new GraphClient({
      accessToken: "test-token",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com",
      transport
    });

    const thrown = await captureError(() =>
      downloadMediaBytes(client, {
        url: "https://lookaside.example.test/media/under-reporting-chunk",
        maxBytes: 1
      })
    );

    expectMediaValidationError(thrown, "download_too_large");
    expect(thrown).not.toBeInstanceOf(GraphNetworkError);
    expect(requests.length).toBe(1);
  });

  test("rejects oversized downloads from Content-Length before reading body", async () => {
    const handle = createMockTransport({
      defaultResponse: () => {
        throw new Error("body should not be requested after content-length guard");
      }
    });
    const transport: Transport = {
      async request(req) {
        (handle.requests as TransportRequest[]);
        return makeChunkedTransportResponse([new Uint8Array([1, 2, 3, 4])], {
          "content-length": "4"
        });
      }
    };
    const client = new GraphClient({
      accessToken: "test-token",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com",
      transport
    });

    const thrown = await captureError(() =>
      downloadMediaBytes(client, {
        url: "https://lookaside.example.test/media/too-large",
        maxBytes: 3
      })
    );

    expectMediaValidationError(thrown, "download_too_large");
  });

  test("rejects invalid URL schemes, empty/control-char URLs, and invalid options before transport", async () => {
    const badOptions = [
      null,
      undefined,
      "https://example.test/x",
      [],
      {},
      { url: "" },
      { url: "   " },
      { url: 42 },
      { url: "https://lookaside.example.test/a\nheader" },
      { url: "file:///etc/passwd" },
      { url: "javascript:alert(1)" },
      { url: "data:text/plain,abc" },
      { url: "about:blank" },
      { url: "blob:https://example.test/id" },
      { url: "ftp://example.test/file" },
      { url: "https://lookaside.example.test/x", maxBytes: 0 },
      { url: "https://lookaside.example.test/x", maxBytes: Infinity },
      { url: "https://lookaside.example.test/x", expectedSha256: "" },
      { url: "https://lookaside.example.test/x", expectedSha256: "not base64" },
      { url: "https://lookaside.example.test/x", expectedSha256: "AAAA" },
      { url: "https://lookaside.example.test/x", signal: { aborted: false } }
    ];
    for (const opts of badOptions) {
      const handle = buildJsonHandle({ ok: true });
      const client = buildClient(handle);
      const thrown = await captureError(() => downloadMediaBytes(client, opts as never));
      expectMediaValidationError(
        thrown,
        isRecordForTest(opts) && "url" in opts && typeof opts.url === "string" && opts.url.startsWith("http") && ("maxBytes" in opts || "expectedSha256" in opts || "signal" in opts)
          ? "invalid_options"
          : isRecordForTest(opts)
            ? "invalid_url"
            : "invalid_options"
      );
      expectNoTransport(handle);
    }
  });

  test("preserves GraphApiError taxonomy for binary fetch failures", async () => {
    const handle = createMockTransport({
      defaultResponse: {
        status: 403,
        headers: { "content-type": "application/json" },
        body: { error: { message: "forbidden", code: 190 } }
      }
    });
    const client = buildClient(handle);

    const thrown = await captureError(() =>
      downloadMediaBytes(client, { url: "https://lookaside.example.test/media/denied" })
    );

    expect(thrown).toBeInstanceOf(GraphApiError);
    expect((thrown as { name?: string }).name).not.toBe("MediaValidationError");
  });

  test("rejects GraphClient-like objects without requestRaw before transport", async () => {
    let called = 0;
    const fakeClient = {
      async request() {
        called += 1;
        return {};
      }
    };

    const thrown = await captureError(() =>
      downloadMediaBytes(fakeClient as never, { url: "https://lookaside.example.test/media/bytes" })
    );

    expectMediaValidationError(thrown, "invalid_client");
    expect(called).toBe(0);
  });
});

function isRecordForTest(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("WATS-37 decryptEncryptedMedia runtime", () => {
  test("decrypts a deterministic pywa-compatible encrypted media fixture", async () => {
    const fixture = await buildEncryptedFixture();

    const decrypted = await decryptEncryptedMedia(fixture.bundle, fixture.encrypted);

    expect(Array.from(decrypted)).toEqual(Array.from(fixture.plaintext));
  });

  test("decrypts valid plaintext whose length is exactly one AES block", async () => {
    const fixture = await buildEncryptedFixture(bytesFromText("1234567890abcdef"));

    const decrypted = await decryptEncryptedMedia(fixture.bundle, fixture.encrypted);

    expect(new TextDecoder().decode(decrypted)).toBe("1234567890abcdef");
  });

  test("rejects invalid bundle/encrypted shapes with typed crypto errors", async () => {
    const fixture = await buildEncryptedFixture();
    const badCases: Array<[unknown, unknown, string]> = [
      [null, fixture.encrypted, "invalid_bundle"],
      [undefined, fixture.encrypted, "invalid_bundle"],
      [{}, fixture.encrypted, "invalid_base64"],
      [{ ...fixture.bundle, encryptionKey: "not base64" }, fixture.encrypted, "invalid_base64"],
      [{ ...fixture.bundle, encryptionKey: bytesToBase64(new Uint8Array(31)) }, fixture.encrypted, "invalid_key_length"],
      [{ ...fixture.bundle, hmacKey: bytesToBase64(new Uint8Array(31)) }, fixture.encrypted, "invalid_key_length"],
      [{ ...fixture.bundle, iv: bytesToBase64(new Uint8Array(15)) }, fixture.encrypted, "invalid_key_length"],
      [fixture.bundle, null, "invalid_ciphertext"],
      [fixture.bundle, new Uint8Array(9), "invalid_ciphertext"],
      [fixture.bundle, fixture.encrypted.slice(0, fixture.encrypted.length - 1), "invalid_ciphertext"]
    ];
    for (const [bundle, encrypted, code] of badCases) {
      const thrown = await captureError(() => decryptEncryptedMedia(bundle as never, encrypted as never));
      expectMediaCryptoError(thrown, code);
    }
  });

  test("rejects encrypted bundle hash, HMAC tag, plaintext hash, and PKCS#7 padding failures", async () => {
    const fixture = await buildEncryptedFixture();

    const wrongEncryptedHash = await captureError(() =>
      decryptEncryptedMedia({ ...fixture.bundle, sha256Enc: bytesToBase64(new Uint8Array(32)) }, fixture.encrypted)
    );
    expectMediaIntegrityError(wrongEncryptedHash, "encrypted_hash_mismatch");

    const tamperedTag = fixture.encrypted.slice();
    tamperedTag[tamperedTag.length - 1] ^= 0xff;
    const tagHash = await sha256Base64(tamperedTag);
    const wrongHmac = await captureError(() =>
      decryptEncryptedMedia({ ...fixture.bundle, sha256Enc: tagHash }, tamperedTag)
    );
    expectMediaIntegrityError(wrongHmac, "hmac_mismatch");

    const wrongPlaintextHash = await captureError(() =>
      decryptEncryptedMedia({ ...fixture.bundle, sha256: bytesToBase64(new Uint8Array(32)) }, fixture.encrypted)
    );
    expectMediaIntegrityError(wrongPlaintextHash, "plaintext_hash_mismatch");

    const tamperedCiphertext = fixture.encrypted.slice();
    tamperedCiphertext[tamperedCiphertext.length - 11] ^= 0x01;
    const ciphertext = tamperedCiphertext.slice(0, tamperedCiphertext.length - 10);
    const keyBytes = new Uint8Array(32);
    const ivBytes = new Uint8Array(16);
    for (let i = 0; i < keyBytes.length; i += 1) keyBytes[i] = (i + 1) & 0xff;
    for (let i = 0; i < ivBytes.length; i += 1) ivBytes[i] = (0x10 + i) & 0xff;
    const hmacKey = new Uint8Array(32);
    for (let i = 0; i < hmacKey.length; i += 1) hmacKey[i] = (0xa0 + i) & 0xff;
    const hmacCryptoKey = await testSubtle.importKey("raw", asBufferSource(hmacKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await testSubtle.sign("HMAC", hmacCryptoKey, asBufferSource(concatBytes([ivBytes, ciphertext]))));
    tamperedCiphertext.set(mac.slice(0, 10), tamperedCiphertext.length - 10);
    const tamperedCiphertextHash = await sha256Base64(tamperedCiphertext);
    const paddingError = await captureError(() =>
      decryptEncryptedMedia({ ...fixture.bundle, sha256Enc: tamperedCiphertextHash }, tamperedCiphertext)
    );
    expectMediaCryptoError(paddingError, "invalid_padding");
  });
});

describe("WATS-37 resumable upload sessions", () => {
  test("createUploadSession POSTs query-encoded session metadata", async () => {
    const handle = buildJsonHandle({ id: "upload:session:1" });
    const client = buildClient(handle);

    const result = await createUploadSession(client, {
      appId: "1234567890",
      fileName: "résumé final.pdf",
      fileLength: 1234,
      fileType: "application/pdf"
    });

    expect(result).toEqual({ id: "upload:session:1" });
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]!.method).toBe("POST");
    const reqUrl = new URL(handle.requests[0]!.url);
    expect(`${reqUrl.origin}${reqUrl.pathname}`).toBe("https://graph.facebook.com/v25.0/1234567890/uploads");
    expect(reqUrl.searchParams.get("file_name")).toBe("résumé final.pdf");
    expect(reqUrl.searchParams.get("file_length")).toBe("1234");
    expect(reqUrl.searchParams.get("file_type")).toBe("application/pdf");
  });

  test("createUploadSession validates per-call maxBytes before transport", async () => {
    const invalidCaps = [0, NaN, Infinity, 2];
    for (const maxBytes of invalidCaps) {
      const handle = buildJsonHandle({ id: "should-not-send" });
      const client = buildClient(handle);
      const thrown = await captureError(() =>
        createUploadSession(client, {
          appId: "1234567890",
          fileName: "fixture.pdf",
          fileLength: 3,
          fileType: "application/pdf"
        }, { maxBytes })
      );
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { name?: string }).name).toBe("MediaValidationError");
      expectNoTransport(handle);
    }

    const handle = buildJsonHandle({ id: "upload:session:at-limit" });
    const client = buildClient(handle);
    const ok = await createUploadSession(client, {
      appId: "1234567890",
      fileName: "fixture.pdf",
      fileLength: 3,
      fileType: "application/pdf"
    }, { maxBytes: 3 });
    expect(ok).toEqual({ id: "upload:session:at-limit" });
    expect(handle.requests.length).toBe(1);
  });

  test("getUploadSession resolves id and current file offset", async () => {
    const handle = buildJsonHandle({ id: "upload:session:1", file_offset: "42" });
    const client = buildClient(handle);

    const result = await getUploadSession(client, { uploadSessionId: "upload:session:1" });

    expect(result).toEqual({ id: "upload:session:1", fileOffset: 42 });
    expect(handle.requests[0]!.method).toBe("GET");
    expect(handle.requests[0]!.url).toBe("https://graph.facebook.com/v25.0/upload%3Asession%3A1");
  });

  test("uploadFileToSession supports Uint8Array, ArrayBuffer, Blob, and ReadableStream bodies", async () => {
    const bodies: Array<[string, Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>, number | undefined, number | undefined]> = [
      ["uint8", new Uint8Array([1, 2, 3]), undefined, undefined],
      ["arrayBuffer", new Uint8Array([4, 5]).buffer, undefined, undefined],
      ["blob", new Blob([new Uint8Array([6, 7, 8, 9])]), undefined, undefined],
      ["stream", new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([10])); controller.close(); } }), 1, 1]
    ];

    for (const [label, file, contentLength, expectedStreamBytes] of bodies) {
      const handle = buildJsonHandle({ h: `handle-${label}` });
      const client = buildClient(handle);
      const params: media.UploadFileToSessionParams = {
        uploadSessionId: "upload:session:1",
        file,
        fileOffset: 2,
        ...(contentLength !== undefined ? { contentLength } : {})
      };

      const result = await uploadFileToSession(client, params);

      expect(result).toEqual({ h: `handle-${label}` });
      expect(handle.requests.length).toBe(1);
      expect(handle.requests[0]!.method).toBe("POST");
      expect(handle.requests[0]!.url).toBe("https://graph.facebook.com/v25.0/upload%3Asession%3A1");
      expect(handle.requests[0]!.headers.get("file_offset")).toBe("2");
      if (contentLength !== undefined) {
        expect(handle.requests[0]!.headers.get("content-length")).toBe(String(contentLength));
      }
      if (expectedStreamBytes !== undefined) {
        const reqBody = handle.requests[0]!.body;
        expect(reqBody).toBeInstanceOf(ReadableStream);
        const reader = (reqBody as ReadableStream<Uint8Array>).getReader();
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
          }
        } finally {
          reader.releaseLock();
        }
        expect(total).toBe(expectedStreamBytes);
      }
    }
  });

  test("uploadFileToSession rejects ReadableStream actual bytes above maxBytes while transport consumes body", async () => {
    let chunksReadByTransport = 0;
    let transportCalls = 0;
    const transport: Transport = {
      async request(req) {
        transportCalls += 1;
        expect(req.body).toBeInstanceOf(ReadableStream);
        const reader = (req.body as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
            chunksReadByTransport += 1;
          }
        } finally {
          reader.releaseLock();
        }
        throw new Error("transport should not finish reading an oversized stream");
      }
    };
    const client = new GraphClient({
      accessToken: "test-token",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com",
      transport
    });
    const file = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      }
    });

    const thrown = await captureError(() =>
      uploadFileToSession(client, {
        uploadSessionId: "upload:session:1",
        file,
        contentLength: 3
      }, { maxBytes: 3 })
    );

    expectMediaValidationError(thrown, "upload_too_large");
    expect(transportCalls).toBe(1);
    expect(chunksReadByTransport).toBe(1);
  });

  test("uploadFileToSession rejects Uint8Array subclass stream chunks that under-report byteLength", async () => {
    let chunksReadByTransport = 0;
    let transportCalls = 0;
    const transport: Transport = {
      async request(req) {
        transportCalls += 1;
        expect(req.body).toBeInstanceOf(ReadableStream);
        const reader = (req.body as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
            chunksReadByTransport += 1;
          }
        } finally {
          reader.releaseLock();
        }
        return makeChunkedTransportResponse([bytesFromText('{"h":"should-not-succeed"}')], {
          "content-type": "application/json"
        });
      }
    };
    const client = new GraphClient({
      accessToken: "test-token",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com",
      transport
    });
    const chunk = new UnderReportingUint8Array([1, 2, 3, 4]);
    expect(chunk.byteLength).toBe(0);
    expect(chunk.length).toBe(0);
    expect(Array.from(chunk)).toEqual([1, 2, 3, 4]);
    const file = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      }
    });

    const thrown = await captureError(() =>
      uploadFileToSession(client, {
        uploadSessionId: "upload:session:1",
        file,
        contentLength: 1
      }, { maxBytes: 1 })
    );

    expectMediaValidationError(thrown, "upload_too_large");
    expect(transportCalls).toBe(1);
    expect(chunksReadByTransport).toBe(0);
  });

  test("uploadFileToSession normalizes direct Uint8Array subclasses before transport", async () => {
    const file = new UnderReportingUint8Array([9, 8, 7, 6]);
    expect(file.byteLength).toBe(0);
    expect(file.length).toBe(0);
    expect(Array.from(file)).toEqual([9, 8, 7, 6]);

    const overLimitHandle = buildJsonHandle({ h: "should-not-send" });
    const overLimitClient = buildClient(overLimitHandle);
    const thrown = await captureError(() =>
      uploadFileToSession(overLimitClient, {
        uploadSessionId: "upload:session:1",
        file
      }, { maxBytes: 3 })
    );
    expectMediaValidationError(thrown, "upload_too_large");
    expectNoTransport(overLimitHandle);

    const handle = buildJsonHandle({ h: "handle-normalized" });
    const client = buildClient(handle);
    const result = await uploadFileToSession(client, {
      uploadSessionId: "upload:session:1",
      file
    }, { maxBytes: 4 });

    expect(result).toEqual({ h: "handle-normalized" });
    expect(handle.requests.length).toBe(1);
    const body = handle.requests[0]!.body;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body).not.toBeInstanceOf(UnderReportingUint8Array);
    expect((body as Uint8Array).byteLength).toBe(4);
    expect(Array.from(body as Uint8Array)).toEqual([9, 8, 7, 6]);
  });

  test("rejects invalid create/get/upload session params and options before transport", async () => {
    const createBad: unknown[] = [
      null,
      undefined,
      [],
      {},
      { appId: "" },
      { appId: "../evil", fileName: "a.pdf", fileLength: 1, fileType: "application/pdf" },
      { appId: "123", fileName: "", fileLength: 1, fileType: "application/pdf" },
      { appId: "123", fileName: "../evil.pdf", fileLength: 1, fileType: "application/pdf" },
      { appId: "123", fileName: "a%2F.pdf", fileLength: 1, fileType: "application/pdf" },
      { appId: "123", fileName: "a.pdf", fileLength: 0, fileType: "application/pdf" },
      { appId: "123", fileName: "a.pdf", fileLength: Infinity, fileType: "application/pdf" },
      { appId: "123", fileName: "a.pdf", fileLength: 1, fileType: "text/html" },
      { appId: "123", fileName: "a.pdf", fileLength: 1, fileType: "application/pdf\r\nX: y" }
    ];
    for (const params of createBad) {
      const handle = buildJsonHandle({ id: "nope" });
      const client = buildClient(handle);
      const thrown = await captureError(() => createUploadSession(client, params as never));
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { name?: string }).name).toBe("MediaValidationError");
      expectNoTransport(handle);
    }

    const uploadBad: unknown[] = [
      null,
      undefined,
      [],
      {},
      { uploadSessionId: "", file: new Uint8Array([1]) },
      { uploadSessionId: "../evil", file: new Uint8Array([1]) },
      { uploadSessionId: "upload:session:1", file: "bad" },
      { uploadSessionId: "upload:session:1", file: new Uint8Array([1]), fileOffset: -1 },
      { uploadSessionId: "upload:session:1", file: new Uint8Array([1]), fileOffset: 1.2 },
      { uploadSessionId: "upload:session:1", file: new Uint8Array([1]), contentLength: 0 },
      { uploadSessionId: "upload:session:1", file: new Uint8Array([1]), contentLength: NaN },
      { uploadSessionId: "upload:session:1", file: new Uint8Array([1]), signal: { aborted: false } }
    ];
    for (const params of uploadBad) {
      const handle = buildJsonHandle({ h: "nope" });
      const client = buildClient(handle);
      const thrown = await captureError(() => uploadFileToSession(client, params as never));
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { name?: string }).name).toBe("MediaValidationError");
      expectNoTransport(handle);
    }

    const getBad = [null, undefined, [], {}, { uploadSessionId: "" }, { uploadSessionId: "a/b" }, { uploadSessionId: "a%2Fb" }, { uploadSessionId: "upload:session:1", signal: { aborted: false } }];
    for (const params of getBad) {
      const handle = buildJsonHandle({ id: "nope", file_offset: 0 });
      const client = buildClient(handle);
      const thrown = await captureError(() => getUploadSession(client, params as never));
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { name?: string }).name).toBe("MediaValidationError");
      expectNoTransport(handle);
    }
  });

  test("preserves GraphApiError taxonomy for upload session Graph failures", async () => {
    const handle = createMockTransport({
      defaultResponse: {
        status: 400,
        headers: { "content-type": "application/json" },
        body: { error: { message: "bad session", code: 100 } }
      }
    });
    const client = buildClient(handle);

    const thrown = await captureError(() =>
      createUploadSession(client, {
        appId: "1234567890",
        fileName: "a.pdf",
        fileLength: 1,
        fileType: "application/pdf"
      })
    );

    expect(thrown).toBeInstanceOf(GraphApiError);
    expect((thrown as { name?: string }).name).not.toBe("MediaValidationError");
  });
});

describe("WATS-37 media error taxonomy", () => {
  test("preserves GraphApiError taxonomy for Graph failures", async () => {
    const handle = createMockTransport({
      defaultResponse: {
        status: 400,
        headers: { "content-type": "application/json" },
        body: { error: { message: "Invalid parameter", code: 100 } }
      }
    });
    const client = buildClient(handle);

    const thrown = await captureError(() =>
      uploadMedia(client, { phoneNumberId: "555000111" }, validUploadBody)
    );

    expect(thrown).toBeInstanceOf(GraphApiError);
    expect((thrown as { name?: string }).name).not.toBe("MediaValidationError");
    expect(handle.requests.length).toBe(1);
  });

  test("MediaValidationError is exported as a plain Error sibling, not TypeError or PaginationError", async () => {
    const handle = buildJsonHandle({ id: "should-not-send" });
    const client = buildClient(handle);
    const thrown = await captureError(() =>
      uploadMedia(client, { phoneNumberId: "" }, validUploadBody)
    );

    expectMediaValidationError(thrown, "invalid_phone_number_id");
  });

});
