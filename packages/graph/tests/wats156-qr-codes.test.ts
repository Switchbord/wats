import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient,
  createQrCode,
  deleteQrCode,
  getQrCode,
  listQrCodes,
  updateQrCode,
  type CreateQrCodeResponse,
  type DeleteQrCodeResponse,
  type GetQrCodeResponse,
  type ListQrCodesResponse,
  type UpdateQrCodeResponse
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec) {
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

function ok(body: object = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

const unsafePathValues = [
  null,
  undefined,
  "",
  "   ",
  123,
  {},
  [],
  "bad\r",
  "bad\n",
  "bad\u0000",
  "bad\u007f",
  ".",
  "..",
  "a/b",
  "a\\b",
  "a?b",
  "a#b",
  "%2e%2e",
  "%252e%252e",
  "%2f",
  "%252f"
] as const;

describe("WATS-156 QR code wire shapes", () => {
  test("all five endpoints build exact method/url/body/query shapes", async () => {
    const { client, handle } = clientWith([
      ok({
        code: "4O4YGZEG3RIVE1",
        prefilled_message: "Cyber Monday",
        deep_link_url: "https://wa.me/message/4O4YGZEG3RIVE1",
        qr_image_url: "https://scontent-iad3-2.xx.fbcdn.net/..."
      }),
      ok({
        data: [
          {
            code: "4O4YGZEG3RIVE1",
            prefilled_message: "Cyber Monday",
            deep_link_url: "https://wa.me/message/4O4YGZEG3RIVE1"
          },
          {
            code: "WOMVT6TJ2BP7A1",
            prefilled_message: "Tell me more",
            deep_link_url: "https://wa.me/message/WOMVT6TJ2BP7A1"
          }
        ],
        paging: { cursors: { before: "QVFIUb", after: "QVFIUa" } }
      }),
      ok({
        data: [
          {
            code: "4O4YGZEG3RIVE1",
            prefilled_message: "Cyber Monday",
            deep_link_url: "https://wa.me/message/4O4YGZEG3RIVE1"
          }
        ]
      }),
      ok({
        code: "4O4YGZEG3RIVE1",
        prefilled_message: "Cyber Tuesday",
        deep_link_url: "https://wa.me/message/4O4YGZEG3RIVE1"
      }),
      ok({ success: true })
    ]);

    const created: CreateQrCodeResponse = await createQrCode(client, {
      phoneNumberId: "pn-1",
      prefilledMessage: "Cyber Monday",
      generateQrImage: "SVG"
    });
    const listed: ListQrCodesResponse = await listQrCodes(client, {
      phoneNumberId: "pn-1",
      fields: ["code", "prefilled_message"],
      before: "cursor-before",
      after: "cursor-after"
    });
    const got: GetQrCodeResponse = await getQrCode(client, {
      phoneNumberId: "pn-1",
      code: "4O4YGZEG3RIVE1",
      fields: "code,prefilled_message"
    });
    const updated: UpdateQrCodeResponse = await updateQrCode(client, {
      phoneNumberId: "pn-1",
      code: "4O4YGZEG3RIVE1",
      prefilledMessage: "Cyber Tuesday"
    });
    const deleted: DeleteQrCodeResponse = await deleteQrCode(client, {
      phoneNumberId: "pn-1",
      code: "4O4YGZEG3RIVE1"
    });

    expect(created.code).toBe("4O4YGZEG3RIVE1");
    expect(listed.data?.length).toBe(2);
    expect(got.data?.[0]?.code).toBe("4O4YGZEG3RIVE1");
    expect(updated.prefilled_message).toBe("Cyber Tuesday");
    expect(deleted.success).toBe(true);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/pn-1/message_qrdls",
      "GET https://graph.facebook.com/v25.0/pn-1/message_qrdls?fields=code%2Cprefilled_message&before=cursor-before&after=cursor-after",
      "GET https://graph.facebook.com/v25.0/pn-1/message_qrdls/4O4YGZEG3RIVE1?fields=code%2Cprefilled_message",
      "POST https://graph.facebook.com/v25.0/pn-1/message_qrdls",
      "DELETE https://graph.facebook.com/v25.0/pn-1/message_qrdls/4O4YGZEG3RIVE1"
    ]);

    expect(parseBody(handle.requests[0]?.body)).toEqual({
      prefilled_message: "Cyber Monday",
      generate_qr_image: "SVG"
    });
    // list: no body
    expect(handle.requests[1]?.body).toBeFalsy();
    // get: no body
    expect(handle.requests[2]?.body).toBeFalsy();
    expect(parseBody(handle.requests[3]?.body)).toEqual({
      code: "4O4YGZEG3RIVE1",
      prefilled_message: "Cyber Tuesday"
    });
    // delete: no body
    expect(handle.requests[4]?.body).toBeFalsy();
  });

  test("generateQrImage is case-insensitive and normalized to uppercase", async () => {
    const { client, handle } = clientWith([ok({ code: "C1" })]);

    await createQrCode(client, {
      phoneNumberId: "pn-1",
      prefilledMessage: "hello",
      generateQrImage: "png"
    });

    expect(parseBody(handle.requests[0]?.body)).toEqual({
      prefilled_message: "hello",
      generate_qr_image: "PNG"
    });
  });

  test("listQrCodes works with no optional params", async () => {
    const { client, handle } = clientWith([ok({ data: [] })]);

    await listQrCodes(client, { phoneNumberId: "pn-1" });

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/pn-1/message_qrdls"
    ]);
  });
});

describe("WATS-156 QR code scoped client id injection", () => {
  test("PhoneNumberClient injects bound phoneNumberId for all five QR endpoints", async () => {
    const { client, handle } = clientWith([
      ok({ code: "C1" }),
      ok({ data: [] }),
      ok({ data: [] }),
      ok({ code: "C1" }),
      ok({ success: true })
    ]);
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PN" });

    await phone.createQrCode({ phoneNumberId: "OVERRIDE", prefilledMessage: "hi", generateQrImage: "SVG" } as never);
    await phone.listQrCodes({ phoneNumberId: "OVERRIDE" } as never);
    await phone.getQrCode({ phoneNumberId: "OVERRIDE", code: "C1" } as never);
    await phone.updateQrCode({ phoneNumberId: "OVERRIDE", code: "C1", prefilledMessage: "hi2" } as never);
    await phone.deleteQrCode({ phoneNumberId: "OVERRIDE", code: "C1" } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/BOUND-PN/message_qrdls",
      "GET https://graph.facebook.com/v25.0/BOUND-PN/message_qrdls",
      "GET https://graph.facebook.com/v25.0/BOUND-PN/message_qrdls/C1",
      "POST https://graph.facebook.com/v25.0/BOUND-PN/message_qrdls",
      "DELETE https://graph.facebook.com/v25.0/BOUND-PN/message_qrdls/C1"
    ]);
  });
});

describe("WATS-156 QR code validation — safe ids", () => {
  test("createQrCode rejects unsafe phoneNumberId without transport", async () => {
    const { client, handle } = clientWith([ok()]);
    for (const bad of unsafePathValues) {
      await expect(
        createQrCode(client, {
          phoneNumberId: bad as string,
          prefilledMessage: "hi",
          generateQrImage: "SVG"
        })
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("getQrCode / updateQrCode / deleteQrCode reject unsafe code without transport", async () => {
    const { client, handle } = clientWith([ok(), ok(), ok()]);
    for (const bad of unsafePathValues) {
      await expect(
        getQrCode(client, { phoneNumberId: "pn-1", code: bad as string })
      ).rejects.toThrow(GraphRequestValidationError);
      await expect(
        updateQrCode(client, { phoneNumberId: "pn-1", code: bad as string, prefilledMessage: "hi" })
      ).rejects.toThrow(GraphRequestValidationError);
      await expect(
        deleteQrCode(client, { phoneNumberId: "pn-1", code: bad as string })
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-156 QR code validation — descriptor-safe params (no host TypeError)", () => {
  test("createQrCode rejects accessor-backed params without host TypeError", async () => {
    const { client, handle } = clientWith([ok()]);
    // Build an input object where `prefilledMessage` is an accessor that
    // would throw if invoked. The validation layer must reject accessor-
    // backed properties with a GraphRequestValidationError, NOT propagate
    // the host error.
    const trap: Record<string, unknown> = { phoneNumberId: "pn-1", generateQrImage: "SVG" };
    Object.defineProperty(trap, "prefilledMessage", {
      get() { throw new Error("boom"); },
      enumerable: true,
      configurable: true
    });
    await expect(
      createQrCode(client, trap as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("updateQrCode rejects __proto__-containing params without host TypeError", async () => {
    const { client, handle } = clientWith([ok()]);
    const malicious = JSON.parse('{"__proto__":{"poll":true},"code":"C1","prefilledMessage":"hi"}');
    await expect(
      updateQrCode(client, malicious as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(({} as { poll?: unknown }).poll).toBeUndefined();
    expect(handle.requests.length).toBe(0);
  });

  test("createQrCode rejects non-object input", async () => {
    const { client, handle } = clientWith([ok()]);
    for (const bad of [null, undefined, 123, "string", true, Symbol("x")]) {
      await expect(
        createQrCode(client, bad as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-156 QR code validation — finite strings (prefilledMessage 140-char limit)", () => {
  test("createQrCode rejects prefilledMessage over 140 chars", async () => {
    const { client, handle } = clientWith([ok()]);
    const long = "x".repeat(141);
    await expect(
      createQrCode(client, { phoneNumberId: "pn-1", prefilledMessage: long, generateQrImage: "SVG" })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("createQrCode accepts prefilledMessage at exactly 140 chars", async () => {
    const { client, handle } = clientWith([ok({ code: "C1" })]);
    const exact = "x".repeat(140);
    await createQrCode(client, { phoneNumberId: "pn-1", prefilledMessage: exact, generateQrImage: "SVG" });
    expect(parseBody(handle.requests[0]?.body).prefilled_message).toBe(exact);
  });

  test("updateQrCode rejects prefilledMessage over 140 chars", async () => {
    const { client, handle } = clientWith([ok()]);
    const long = "x".repeat(141);
    await expect(
      updateQrCode(client, { phoneNumberId: "pn-1", code: "C1", prefilledMessage: long })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("createQrCode rejects empty prefilledMessage", async () => {
    const { client, handle } = clientWith([ok()]);
    await expect(
      createQrCode(client, { phoneNumberId: "pn-1", prefilledMessage: "", generateQrImage: "SVG" })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-156 QR code validation — generateQrImage enum", () => {
  test("createQrCode rejects invalid generateQrImage values", async () => {
    const { client, handle } = clientWith([ok()]);
    for (const bad of ["JPEG", "GIF", "", "svg ", 123, null, undefined]) {
      await expect(
        createQrCode(client, { phoneNumberId: "pn-1", prefilledMessage: "hi", generateQrImage: bad as string })
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-156 QR code validation — no transport on invalid inputs", () => {
  test("all five endpoints make zero transport calls when validation fails", async () => {
    const { client, handle } = clientWith([ok(), ok(), ok(), ok(), ok()]);

    // create: missing generateQrImage
    await expect(
      createQrCode(client, { phoneNumberId: "pn-1", prefilledMessage: "hi", generateQrImage: undefined as unknown as string })
    ).rejects.toThrow(GraphRequestValidationError);

    // list: unsafe phoneNumberId
    await expect(
      listQrCodes(client, { phoneNumberId: "a/b" })
    ).rejects.toThrow(GraphRequestValidationError);

    // get: missing code
    await expect(
      getQrCode(client, { phoneNumberId: "pn-1", code: undefined as unknown as string })
    ).rejects.toThrow(GraphRequestValidationError);

    // update: missing code
    await expect(
      updateQrCode(client, { phoneNumberId: "pn-1", code: undefined as unknown as string, prefilledMessage: "hi" })
    ).rejects.toThrow(GraphRequestValidationError);

    // delete: unsafe code
    await expect(
      deleteQrCode(client, { phoneNumberId: "pn-1", code: ".." })
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });

  test("GET/DELETE endpoints reject a body argument", async () => {
    const { client, handle } = clientWith([ok(), ok(), ok()]);

    await expect(
      listQrCodes(client, { phoneNumberId: "pn-1" }, "body" as never)
    ).rejects.toThrow(GraphRequestValidationError);

    await expect(
      getQrCode(client, { phoneNumberId: "pn-1", code: "C1" }, "body" as never)
    ).rejects.toThrow(GraphRequestValidationError);

    await expect(
      deleteQrCode(client, { phoneNumberId: "pn-1", code: "C1" }, "body" as never)
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-156 QR code validation — finite fields arrays", () => {
  test("listQrCodes rejects fields array exceeding max length", async () => {
    const { client, handle } = clientWith([ok()]);
    const tooMany = Array.from({ length: 51 }, (_, i) => `field${i}`);
    await expect(
      listQrCodes(client, { phoneNumberId: "pn-1", fields: tooMany as never })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("getQrCode rejects fields with control characters", async () => {
    const { client, handle } = clientWith([ok()]);
    await expect(
      getQrCode(client, { phoneNumberId: "pn-1", code: "C1", fields: "bad\u0000field" })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});
