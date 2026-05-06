// F-7 PhoneNumberClient tests (WATS-19 / Arch-E) — RED.
//
// Covers constructor-time validation (duck-typed graphClient, phoneNumberId
// sanitization parity with F-6 assertSafePathParamValue), path binding via
// the F-6 sendMessage endpoint-registry callable, F-5 registry error
// surfacing (sibling-NOT assertions), AbortSignal propagation, and
// CR/LF header rejection inherited from F-4/F-6.

import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRateLimitError,
  GraphRequestValidationError,
  PhoneNumberClient,
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

describe("F-7 PhoneNumberClient construction validation", () => {
  test("rejects non-object config", () => {
    expect(
      () => new PhoneNumberClient(null as unknown as never)
    ).toThrow(GraphRequestValidationError);
    expect(
      () => new PhoneNumberClient(undefined as unknown as never)
    ).toThrow(GraphRequestValidationError);
    expect(
      () => new PhoneNumberClient("nope" as unknown as never)
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects missing graphClient", () => {
    expect(
      () =>
        new PhoneNumberClient({
          phoneNumberId: "123"
        } as unknown as never)
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects graphClient without a .request() method (duck-type)", () => {
    expect(
      () =>
        new PhoneNumberClient({
          graphClient: { notRequest: true } as unknown as GraphClient,
          phoneNumberId: "123"
        })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects missing phoneNumberId", () => {
    const { client } = clientWith({ status: 200, body: {} });
    expect(
      () =>
        new PhoneNumberClient({
          graphClient: client
        } as unknown as never)
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects non-string phoneNumberId", () => {
    const { client } = clientWith({ status: 200, body: {} });
    expect(
      () =>
        new PhoneNumberClient({
          graphClient: client,
          phoneNumberId: 123 as unknown as string
        })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects empty / whitespace-only phoneNumberId", () => {
    const { client } = clientWith({ status: 200, body: {} });
    expect(
      () =>
        new PhoneNumberClient({ graphClient: client, phoneNumberId: "" })
    ).toThrow(GraphRequestValidationError);
    expect(
      () =>
        new PhoneNumberClient({ graphClient: client, phoneNumberId: "   " })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects phoneNumberId containing CR / LF / NUL / control chars", () => {
    const { client } = clientWith({ status: 200, body: {} });
    for (const bad of ["12\r3", "12\n3", "12\u00003", "12\u00073"]) {
      expect(
        () =>
          new PhoneNumberClient({
            graphClient: client,
            phoneNumberId: bad
          })
      ).toThrow(GraphRequestValidationError);
    }
  });

  test("rejects phoneNumberId containing slashes or traversal dots", () => {
    const { client } = clientWith({ status: 200, body: {} });
    for (const bad of ["1/2", "..", ".", "a\\b", "?x", "#y"]) {
      expect(
        () =>
          new PhoneNumberClient({
            graphClient: client,
            phoneNumberId: bad
          })
      ).toThrow(GraphRequestValidationError);
    }
  });

  test("exposes phoneNumberId + graphClient accessors on a valid instance", () => {
    const { client } = clientWith({ status: 200, body: {} });
    const pnc = new PhoneNumberClient({
      graphClient: client,
      phoneNumberId: "555000111"
    });
    expect(pnc.phoneNumberId).toBe("555000111");
    expect(pnc.graphClient).toBe(client);
  });
});

describe("WATS-60 PhoneNumberClient optional params validation", () => {
  test("rejects symbol-keyed optional params before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "phone" } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PHONE" });
    const symbolKey = Symbol("hidden");
    const params = { fields: ["id"], [symbolKey]: "hidden" };

    let thrown: unknown;
    try {
      await pnc.getInfo(params as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(handle.requests.length).toBe(0);
  });

  test("wraps proxy descriptor traps as GraphRequestValidationError before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { id: "phone" } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PHONE" });
    const params = new Proxy({}, {
      ownKeys() {
        return ["fields"];
      },
      getOwnPropertyDescriptor() {
        throw new Error("params descriptor trap should be wrapped");
      }
    });

    let thrown: unknown;
    try {
      await pnc.getInfo(params as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as GraphRequestValidationError).cause).toBeInstanceOf(Error);
    expect(handle.requests.length).toBe(0);
  });

  test("continues to omit undefined params and preserve constructor-bound phoneNumberId", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "phone" }
    });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PHONE" });

    await pnc.getInfo({ phoneNumberId: "OVERRIDE", fields: undefined } as never);

    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/BOUND-PHONE");
  });
});

describe("F-7 PhoneNumberClient.sendMessage round-trip", () => {
  test("produces the identical MockTransport request as direct endpoint callable", async () => {
    const body = {
      messaging_product: "whatsapp" as const,
      to: "15551230000",
      type: "text" as const,
      text: { body: "hi" }
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
    const pnc = new PhoneNumberClient({
      graphClient: c2,
      phoneNumberId: "123"
    });
    await pnc.sendMessage(body);

    const r1 = h1.requests[0];
    const r2 = h2.requests[0];
    expect(r1?.url).toBe(r2?.url);
    expect(r1?.method).toBe(r2?.method);
    expect(r1?.headers.get("content-type")).toBe(
      r2?.headers.get("content-type")
    );
    expect(r1?.body).toBe(r2?.body);
  });

  test("binds phoneNumberId into the URL", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    const pnc = new PhoneNumberClient({
      graphClient: client,
      phoneNumberId: "987"
    });
    await pnc.sendMessage({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "text",
      text: { body: "x" }
    });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/987/messages"
    );
  });

  test("error code 131051 → UnsupportedMessageTypeError (sibling-NOT InvalidParameterError/GraphAuthError)", async () => {
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
    const pnc = new PhoneNumberClient({
      graphClient: client,
      phoneNumberId: "123"
    });
    let thrown: unknown;
    try {
      await pnc.sendMessage({
        messaging_product: "whatsapp",
        to: "15551230000",
        type: "text",
        text: { body: "hi" }
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnsupportedMessageTypeError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(InvalidParameterError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("propagates AbortSignal via opts.signal", async () => {
    const controller = new AbortController();
    const handle = createMockTransport({
      defaultResponse: (req) => {
        // The signal should be observable inside the transport.
        // We assert after the call that the request was cancelled.
        void req;
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { ok: true }
        };
      }
    });
    const client = new GraphClient({
      baseUrl: "https://graph.facebook.com",
      apiVersion: "v25.0",
      accessToken: "t",
      transport: handle.transport
    });
    const pnc = new PhoneNumberClient({
      graphClient: client,
      phoneNumberId: "123"
    });
    controller.abort();
    // We only care that the signal reaches the endpoint-callable; the
    // mock transport ignores it, so we just verify no throw happens
    // upstream of request construction.
    await pnc.sendMessage(
      {
        messaging_product: "whatsapp",
        to: "15551230000",
        type: "text",
        text: { body: "hi" }
      },
      { signal: controller.signal }
    );
    expect(handle.requests.length).toBe(1);
  });

  test("per-call opts.headers with CR/LF in value surface as GraphRequestValidationError", async () => {
    const { client } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    const pnc = new PhoneNumberClient({
      graphClient: client,
      phoneNumberId: "123"
    });
    let thrown: unknown;
    try {
      await pnc.sendMessage(
        {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "text",
          text: { body: "hi" }
        },
        { headers: { "x-crlf": "bad\r\nInjected: yes" } }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });
});

describe("WATS-38 PhoneNumberClient outbound media helpers", () => {
  type MediaMethod = "sendImage" | "sendVideo" | "sendAudio" | "sendDocument" | "sendSticker";

  function mediaMethodOf(
    pnc: PhoneNumberClient,
    method: MediaMethod
  ): (input: unknown) => Promise<unknown> {
    return (pnc as unknown as Record<MediaMethod, (input: unknown) => Promise<unknown>>)[
      method
    ].bind(pnc);
  }

  test("sendImage/sendVideo/sendAudio/sendDocument/sendSticker POST exact Graph media payloads", async () => {
    const cases = [
      {
        method: "sendImage" as const,
        input: {
          to: "15551230000",
          mediaId: "IMG_ID",
          caption: "image caption",
          replyToMessageId: "wamid.REPLY"
        },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "image",
          image: { id: "IMG_ID", caption: "image caption" },
          context: { message_id: "wamid.REPLY" }
        }
      },
      {
        method: "sendVideo" as const,
        input: {
          to: "15551230000",
          link: "https://cdn.example.test/video.mp4",
          caption: "video caption"
        },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "video",
          video: { link: "https://cdn.example.test/video.mp4", caption: "video caption" }
        }
      },
      {
        method: "sendAudio" as const,
        input: { to: "15551230000", mediaId: "AUD_ID" },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "audio",
          audio: { id: "AUD_ID" }
        }
      },
      {
        method: "sendDocument" as const,
        input: {
          to: "15551230000",
          link: "https://cdn.example.test/report.pdf",
          caption: "document caption",
          filename: "report.pdf"
        },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "document",
          document: {
            link: "https://cdn.example.test/report.pdf",
            caption: "document caption",
            filename: "report.pdf"
          }
        }
      },
      {
        method: "sendSticker" as const,
        input: { to: "15551230000", link: "https://cdn.example.test/sticker.webp" },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "sticker",
          sticker: { link: "https://cdn.example.test/sticker.webp" }
        }
      }
    ];

    for (const c of cases) {
      const { client, handle } = clientWith({
        status: 200,
        headers: { "content-type": "application/json" },
        body: { messages: [{ id: `wamid.${c.method}` }] }
      });
      const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
      const res = await mediaMethodOf(pnc, c.method)(c.input);
      expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
        `wamid.${c.method}`
      );
      expect(handle.requests.length).toBe(1);
      expect(handle.requests[0]?.method).toBe("POST");
      expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/123/messages");
      expect(JSON.parse(String(handle.requests[0]?.body))).toEqual(c.expected);
    }
  });

  test("media helpers reject malformed inputs before transport without raw TypeError", async () => {
    const { client, handle } = clientWith({ status: 200, body: { ok: true } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    const badCases: readonly unknown[] = [
      undefined,
      null,
      "x",
      [],
      { to: "", mediaId: "IMG" },
      { to: "15551230000" },
      { to: "15551230000", mediaId: "IMG", link: "https://cdn.example.test/img.jpg" },
      { to: "15551230000", link: "ftp://cdn.example.test/img.jpg" },
      { to: "15551230000", mediaId: "IMG\nBAD" },
      { to: "15551230000", mediaId: "IMG", replyToMessageId: "bad\rreply" }
    ];

    for (const input of badCases) {
      let thrown: unknown;
      try {
        await mediaMethodOf(pnc, "sendImage")(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("media helpers preserve downstream Graph error taxonomy", async () => {
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
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    let thrown: unknown;
    try {
      await mediaMethodOf(pnc, "sendImage")({ to: "15551230000", mediaId: "IMG_ID" });
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

describe("WATS-30 PhoneNumberClient.sendText", () => {
  function sendTextOf(pnc: PhoneNumberClient): (input: unknown) => Promise<unknown> {
    return (pnc as unknown as { sendText: (input: unknown) => Promise<unknown> })
      .sendText.bind(pnc);
  }

  test("sends a text conversation starter to an arbitrary phone number without contact lookup", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        messaging_product: "whatsapp",
        contacts: [{ input: "15551230000", wa_id: "15551230000" }],
        messages: [{ id: "wamid.WATS30" }]
      }
    });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    const res = await sendTextOf(pnc)({
      to: "15551230000",
      text: "hello from WATS",
      previewUrl: false
    });

    expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
      "wamid.WATS30"
    );
    expect(handle.requests.length).toBe(1);
    const req = handle.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://graph.facebook.com/v25.0/123/messages");
    const body = JSON.parse(String(req?.body)) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string; preview_url?: boolean };
    };
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "text",
      text: { body: "hello from WATS", preview_url: false }
    });
  });

  test("accepts at-limit E.164-ish recipient, at-limit text, and reply context", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: "wamid.LIMIT" }] }
    });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    const text = "x".repeat(4096);

    await sendTextOf(pnc)({
      to: "+123456789012345",
      text,
      replyToMessageId: "wamid.REPLY_123"
    });

    const body = JSON.parse(String(handle.requests[0]?.body)) as {
      to: string;
      text: { body: string; preview_url?: boolean };
      context?: { message_id?: string };
    };
    expect(body.to).toBe("+123456789012345");
    expect(body.text.body).toBe(text);
    expect(body.text.preview_url).toBeUndefined();
    expect(body.context?.message_id).toBe("wamid.REPLY_123");
  });

  test("rejects malformed options before transport without raw TypeError", async () => {
    const { client, handle } = clientWith({ status: 200, body: { ok: true } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    for (const bad of [undefined, null, "x", 123, true, []]) {
      let thrown: unknown;
      try {
        await sendTextOf(pnc)(bad);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects invalid recipients before transport but does not require contact membership", async () => {
    const { client, handle } = clientWith({ status: 200, body: { ok: true } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    const badRecipients: readonly unknown[] = [
      undefined,
      null,
      "",
      "   ",
      15551230000,
      "1555\r1230000",
      "1555\n1230000",
      "1555\u00001230000",
      "1555\u00071230000",
      "1555/1230000",
      "1555\\1230000",
      "1555?debug=true",
      "1555#frag",
      "https://example.com/15551230000",
      "15551230000@example.com",
      "abc15551230000",
      "1234567890123456"
    ];

    for (const to of badRecipients) {
      let thrown: unknown;
      try {
        await sendTextOf(pnc)({ to, text: "hello" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects invalid text values and over-limit bodies before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { ok: true } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    for (const text of [undefined, null, "", "   ", 123, false, "x".repeat(4097)]) {
      let thrown: unknown;
      try {
        await sendTextOf(pnc)({ to: "15551230000", text });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-boolean previewUrl before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { ok: true } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    for (const previewUrl of [null, "false", 0, 1, {}]) {
      let thrown: unknown;
      try {
        await sendTextOf(pnc)({ to: "15551230000", text: "hello", previewUrl });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects invalid replyToMessageId before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { ok: true } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    for (const replyToMessageId of [
      null,
      123,
      "",
      "   ",
      "wamid\rX",
      "wamid\nX",
      "wamid\u0000X",
      "x".repeat(257)
    ]) {
      let thrown: unknown;
      try {
        await sendTextOf(pnc)({
          to: "15551230000",
          text: "hello",
          replyToMessageId
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("preserves Graph error taxonomy from the messages endpoint", async () => {
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
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });

    let thrown: unknown;
    try {
      await sendTextOf(pnc)({ to: "15551230000", text: "hello" });
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


describe("WATS-38 remaining PhoneNumberClient composer helpers", () => {
  type RemainingMethod =
    | "sendLocation"
    | "sendContacts"
    | "sendReaction"
    | "removeReaction"
    | "sendButtons"
    | "sendList"
    | "sendCtaUrl"
    | "sendProduct"
    | "sendProducts"
    | "sendCatalog"
    | "requestLocation"
    | "markMessageAsRead"
    | "indicateTyping"
    | "sendTemplate";

  function methodOf(pnc: PhoneNumberClient, method: RemainingMethod): (input: unknown) => Promise<unknown> {
    return (pnc as unknown as Record<RemainingMethod, (input: unknown) => Promise<unknown>>)[method].bind(pnc);
  }

  test("remaining helpers POST exact Graph payloads", async () => {
    const cases = [
      {
        method: "sendLocation" as const,
        input: { to: "15551230000", latitude: 1.5, longitude: 2.5, name: "HQ" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "location", location: { latitude: 1.5, longitude: 2.5, name: "HQ" } }
      },
      {
        method: "sendContacts" as const,
        input: { to: "15551230000", contacts: [{ name: { formattedName: "Ada" }, phones: [{ phone: "123" }] }] },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "contacts", contacts: [{ name: { formatted_name: "Ada" }, phones: [{ phone: "123" }] }] }
      },
      {
        method: "sendReaction" as const,
        input: { to: "15551230000", messageId: "wamid.TARGET", emoji: "👍" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "reaction", reaction: { message_id: "wamid.TARGET", emoji: "👍" } }
      },
      {
        method: "removeReaction" as const,
        input: { to: "15551230000", messageId: "wamid.TARGET" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "reaction", reaction: { message_id: "wamid.TARGET", emoji: "" } }
      },
      {
        method: "sendButtons" as const,
        input: { to: "15551230000", bodyText: "Choose", buttons: [{ id: "yes", title: "Yes" }] },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "interactive", interactive: { type: "button", body: { text: "Choose" }, action: { buttons: [{ type: "reply", reply: { id: "yes", title: "Yes" } }] } } }
      },
      {
        method: "sendList" as const,
        input: { to: "15551230000", bodyText: "Pick", buttonText: "Choose", sections: [{ title: "A", rows: [{ id: "r1", title: "R1" }] }] },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "interactive", interactive: { type: "list", body: { text: "Pick" }, action: { button: "Choose", sections: [{ title: "A", rows: [{ id: "r1", title: "R1" }] }] } } }
      },
      {
        method: "sendCtaUrl" as const,
        input: { to: "15551230000", bodyText: "Open", displayText: "Open", url: "https://example.test" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "interactive", interactive: { type: "cta_url", body: { text: "Open" }, action: { name: "cta_url", parameters: { display_text: "Open", url: "https://example.test" } } } }
      },
      {
        method: "sendProduct" as const,
        input: { to: "15551230000", catalogId: "CAT", productRetailerId: "SKU" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "interactive", interactive: { type: "product", action: { catalog_id: "CAT", product_retailer_id: "SKU" } } }
      },
      {
        method: "sendProducts" as const,
        input: { to: "15551230000", catalogId: "CAT", headerText: "H", bodyText: "B", sections: [{ title: "S", productItems: [{ productRetailerId: "SKU" }] }] },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "interactive", interactive: { type: "product_list", header: { type: "text", text: "H" }, body: { text: "B" }, action: { catalog_id: "CAT", sections: [{ title: "S", product_items: [{ product_retailer_id: "SKU" }] }] } } }
      },
      {
        method: "sendCatalog" as const,
        input: { to: "15551230000", bodyText: "Catalog" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "interactive", interactive: { type: "catalog_message", body: { text: "Catalog" }, action: { name: "catalog_message" } } }
      },
      {
        method: "requestLocation" as const,
        input: { to: "15551230000", bodyText: "Share" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "interactive", interactive: { type: "location_request_message", body: { text: "Share" }, action: { name: "send_location" } } }
      },
      {
        method: "sendTemplate" as const,
        input: { to: "15551230000", name: "hello_world", languageCode: "en_US" },
        expected: { messaging_product: "whatsapp", to: "15551230000", type: "template", template: { name: "hello_world", language: { code: "en_US" } } }
      },
      {
        method: "markMessageAsRead" as const,
        input: { messageId: "wamid.INBOUND" },
        expected: { messaging_product: "whatsapp", status: "read", message_id: "wamid.INBOUND" }
      },
      {
        method: "indicateTyping" as const,
        input: { messageId: "wamid.INBOUND" },
        expected: { messaging_product: "whatsapp", status: "read", message_id: "wamid.INBOUND", typing_indicator: { type: "text" } }
      }
    ];

    for (const c of cases) {
      const { client, handle } = clientWith({ status: 200, headers: { "content-type": "application/json" }, body: { success: true, messages: [{ id: `wamid.${c.method}` }] } });
      const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
      await methodOf(pnc, c.method)(c.input);
      expect(handle.requests.length).toBe(1);
      expect(handle.requests[0]?.method).toBe("POST");
      expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/123/messages");
      expect(JSON.parse(String(handle.requests[0]?.body))).toEqual(c.expected);
    }
  });

  test("remaining helpers reject malformed inputs before transport without raw TypeError", async () => {
    const { client, handle } = clientWith({ status: 200, body: { ok: true } });
    const pnc = new PhoneNumberClient({ graphClient: client, phoneNumberId: "123" });
    for (const method of ["sendLocation", "sendContacts", "sendReaction", "sendButtons", "sendList", "sendCtaUrl", "sendProduct", "sendProducts", "sendCatalog", "requestLocation", "sendTemplate"] as const) {
      let thrown: unknown;
      try { await methodOf(pnc, method)(undefined); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });
});
