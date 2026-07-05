// packages/core/tests/whatsappFacadeWats172.test.ts (WATS-172 slice A RED)
//
// Exercises the four slice-A additions to the WhatsApp facade:
//   - createWhatsApp(options) factory
//   - sendText(input) primary text-send name
//   - onMessage(handler) / onStatus(handler) sugar
//   - waitable sent-results on every facade send method
//
// Adversarial input-rejection policy applied to every new public
// parameter: null / undefined / empty / whitespace / non-string /
// CRLF-NUL control chars where the value flows into headers or URLs.
// accessToken must never appear in any error message. Tests assert
// typed errors (WhatsAppFacadeConfigError / GraphRequestValidationError),
// never host TypeErrors.

import { describe, expect, test } from "bun:test";
import {
  WhatsApp,
  WhatsAppFacadeConfigError,
  createWhatsApp,
  type WhatsAppSentResultWaiters
} from "../src/whatsappFacade";
import { TypedRouter } from "../src/typedRouter";
import { createListenerRegistry } from "../src/listener";
import { GraphClient } from "@wats/graph";
import {
  createMockTransport,
  type MockTransportHandle
} from "../../graph/src/createMockTransport";
import { GraphRequestValidationError } from "../../graph/src/errors";
import type {
  TypedMessageUpdate,
  TypedStatusUpdate
} from "../src/webhookNormalizer";

// ---- shared fixtures -------------------------------------------------

function makeHandle(): MockTransportHandle {
  return createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: "wamid.START" }] }
    }
  });
}

function makeWa(transport?: MockTransportHandle): WhatsApp {
  const handle = transport ?? makeHandle();
  return createWhatsApp({
    accessToken: "token-AAA",
    apiVersion: "v25.0",
    phoneNumberId: "1234567890",
    transport: handle.transport
  });
}

function makeMessageUpdate(from = "15551230000"): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.F10",
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 1,
    message: {
      from,
      id: "wamid.F10",
      timestamp: "1",
      type: "text",
      text: { body: "hi" }
    } as TypedMessageUpdate["message"],
    rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
  };
}

function makeStatusUpdate(id = "wamid.S"): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: id,
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 3,
    status: {
      id,
      status: "delivered",
      timestamp: "3",
      recipientId: "15551230000"
    } as TypedStatusUpdate["status"],
    rawChange: { field: "messages", value: {} } as TypedStatusUpdate["rawChange"]
  };
}

function makeButtonReply(
  sentMessageId = "wamid.START",
  from = "15551230000"
): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.BTN",
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 2,
    message: {
      from,
      id: "wamid.BTN",
      timestamp: "2",
      type: "interactive",
      interactive: { type: "button_reply", buttonReply: { id: "btn-1", title: "Yes" } },
      context: { messageId: sentMessageId, from: "1234567890" }
    } as TypedMessageUpdate["message"],
    rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
  };
}

interface WaitableProbe {
  readonly messages?: Array<{ readonly id: string }>;
  waitForReply(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitForClick(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitForSelection(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitForFlowCompletion(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitUntilDelivered(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedStatusUpdate>;
  waitUntilRead(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedStatusUpdate>;
  waitUntilFailed(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedStatusUpdate>;
}

function asWaitable(res: unknown): WaitableProbe {
  return res as WaitableProbe;
}

// =====================================================================
// createWhatsApp factory — happy paths
// =====================================================================

describe("WATS-172 createWhatsApp factory — construction", () => {
  test("returns a WhatsApp instance bound to an internally-constructed GraphClient", () => {
    const handle = makeHandle();
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      phoneNumberId: "1234567890",
      transport: handle.transport
    });
    expect(wa).toBeInstanceOf(WhatsApp);
    expect(wa.graphClient).toBeInstanceOf(GraphClient);
    expect(wa.phoneNumberClient?.phoneNumberId).toBe("1234567890");
  });

  test("defaults apiVersion to v25.0 when omitted", async () => {
    const handle = makeHandle();
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      phoneNumberId: "1234567890",
      transport: handle.transport
    });
    await wa.sendText({ to: "15551230000", text: "hi" });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/1234567890/messages"
    );
  });

  test("honors an explicit apiVersion", async () => {
    const handle = makeHandle();
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      apiVersion: "v24.0",
      phoneNumberId: "1234567890",
      transport: handle.transport
    });
    await wa.sendText({ to: "15551230000", text: "hi" });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v24.0/1234567890/messages"
    );
  });

  test("honors a custom baseUrl", async () => {
    const handle = makeHandle();
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      apiVersion: "v25.0",
      baseUrl: "https://graph.example.test/",
      phoneNumberId: "1234567890",
      transport: handle.transport
    });
    await wa.sendText({ to: "15551230000", text: "hi" });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.example.test/v25.0/1234567890/messages"
    );
  });

  test("defaults transport to a fetch-based transport when omitted (no throw)", () => {
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      phoneNumberId: "1234567890"
    });
    expect(wa.graphClient).toBeInstanceOf(GraphClient);
  });

  test("passes wabaId through to the facade", () => {
    const handle = makeHandle();
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      phoneNumberId: "1234567890",
      wabaId: "99999",
      transport: handle.transport
    });
    expect(wa.wabaClient?.wabaId).toBe("99999");
  });

  test("passes router/observer/listenerRegistry/listenerRegistryOptions through", async () => {
    const handle = makeHandle();
    const preRouter = new TypedRouter();
    const reg = createListenerRegistry();
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      phoneNumberId: "1234567890",
      transport: handle.transport,
      router: preRouter,
      listenerRegistry: reg
    });
    expect(wa.router).toBe(preRouter);
    expect(wa.listenerRegistry).toBe(reg);
  });

  test("factory-built facade can send text end to end", async () => {
    const handle = makeHandle();
    const wa = makeWa(handle);
    const res = await wa.sendText({ to: "15551230000", text: "hello" });
    expect(asWaitable(res).messages?.[0]?.id).toBe("wamid.START");
    expect(handle.requests.length).toBe(1);
    const body = JSON.parse(String(handle.requests[0]?.body)) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string };
    };
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "text",
      text: { body: "hello" }
    });
  });
});

// =====================================================================
// createWhatsApp factory — adversarial input rejection
// =====================================================================

describe("WATS-172 createWhatsApp factory — input rejection battery", () => {
  test("rejects non-object options with WhatsAppFacadeConfigError (not TypeError)", () => {
    for (const bad of [undefined, null, "x", 42, true, []] as unknown[]) {
      let thrown: unknown;
      try {
        createWhatsApp(bad as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WhatsAppFacadeConfigError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
  });

  test("rejects missing/empty/whitespace/non-string accessToken with invalid_access_token", () => {
    const handle = makeHandle();
    const cases: readonly unknown[] = [
      undefined,
      null,
      "",
      "   ",
      "\t\n",
      123,
      {},
      [],
      true
    ];
    for (const bad of cases) {
      let thrown: unknown;
      try {
        createWhatsApp({
          accessToken: bad as never,
          phoneNumberId: "1234567890",
          transport: handle.transport
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WhatsAppFacadeConfigError);
      expect(thrown).not.toBeInstanceOf(TypeError);
      expect((thrown as WhatsAppFacadeConfigError).code).toBe("invalid_access_token");
    }
  });

  test("accessToken with CR/LF/NUL/DEL control chars is rejected", () => {
    const handle = makeHandle();
    const cases = ["tok\r\nid", "tok\x00id", "tok\x7fid", "tok\x1fid"];
    for (const bad of cases) {
      let thrown: unknown;
      try {
        createWhatsApp({
          accessToken: bad,
          phoneNumberId: "1234567890",
          transport: handle.transport
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WhatsAppFacadeConfigError);
      expect((thrown as WhatsAppFacadeConfigError).code).toBe("invalid_access_token");
    }
  });

  test("accessToken value is NEVER echoed in any error message", () => {
    const handle = makeHandle();
    const sentinel = "SUPERSECRET-TOKEN-XYZ-9999";
    const cases = [sentinel, `${sentinel}\r\n`, `  ${sentinel}  `, `\x00${sentinel}`];
    for (const bad of cases) {
      let thrown: unknown;
      try {
        createWhatsApp({
          accessToken: bad,
          phoneNumberId: "1234567890",
          transport: handle.transport
        });
      } catch (error) {
        thrown = error;
      }
      const msg = String((thrown as Error)?.message ?? "");
      expect(msg).not.toContain("SUPERSECRET");
      expect(msg).not.toContain(sentinel);
    }
  });

  test("rejects an over-length accessToken (>4096 chars)", () => {
    const handle = makeHandle();
    const long = "a".repeat(4097);
    let thrown: unknown;
    try {
      createWhatsApp({
        accessToken: long,
        phoneNumberId: "1234567890",
        transport: handle.transport
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WhatsAppFacadeConfigError);
    expect((thrown as WhatsAppFacadeConfigError).code).toBe("invalid_access_token");
  });

  test("rejects invalid apiVersion with invalid_api_version", () => {
    const handle = makeHandle();
    const cases: readonly unknown[] = ["", "25.0", "v25.x", "vv25", "v", 25, null, true, {}];
    for (const bad of cases) {
      let thrown: unknown;
      try {
        createWhatsApp({
          accessToken: "token-AAA",
          apiVersion: bad as never,
          phoneNumberId: "1234567890",
          transport: handle.transport
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WhatsAppFacadeConfigError);
      expect(thrown).not.toBeInstanceOf(TypeError);
      expect((thrown as WhatsAppFacadeConfigError).code).toBe("invalid_api_version");
    }
  });

  test("rejects invalid baseUrl with invalid_base_url", () => {
    const handle = makeHandle();
    const cases: readonly unknown[] = ["", "not-a-url", "ftp://graph.test", "file:///x", 123, true, {}];
    for (const bad of cases) {
      let thrown: unknown;
      try {
        createWhatsApp({
          accessToken: "token-AAA",
          apiVersion: "v25.0",
          baseUrl: bad as never,
          phoneNumberId: "1234567890",
          transport: handle.transport
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WhatsAppFacadeConfigError);
      expect((thrown as WhatsAppFacadeConfigError).code).toBe("invalid_base_url");
    }
  });

  test("rejects malformed transport with invalid_transport", () => {
    const handle = makeHandle();
    const cases: readonly unknown[] = [null, "x", 42, true, {}, { request: "notfn" }, []];
    for (const bad of cases) {
      let thrown: unknown;
      try {
        createWhatsApp({
          accessToken: "token-AAA",
          apiVersion: "v25.0",
          phoneNumberId: "1234567890",
          transport: bad as never
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WhatsAppFacadeConfigError);
      expect((thrown as WhatsAppFacadeConfigError).code).toBe("invalid_transport");
    }
  });

  test("factory never reaches transport when accessToken is invalid (no request recorded)", () => {
    const handle = makeHandle();
    try {
      createWhatsApp({
        accessToken: "  \r\n",
        phoneNumberId: "1234567890",
        transport: handle.transport
      });
    } catch {
      /* expected */
    }
    expect(handle.requests.length).toBe(0);
  });
});

// =====================================================================
// sendText
// =====================================================================

describe("WATS-172 WhatsApp.sendText", () => {
  test("delegates to the same code path as startChat (identical URL + body)", async () => {
    const handleA = makeHandle();
    const waA = makeWa(handleA);
    await waA.sendText({ to: "15551230000", text: "hello", previewUrl: false });

    const handleB = makeHandle();
    const waB = new WhatsApp({
      graphClient: new GraphClient({
        accessToken: "token-AAA",
        apiVersion: "v25.0",
        transport: handleB.transport
      }),
      phoneNumberId: "1234567890"
    });
    await waB.startChat({ to: "15551230000", text: "hello", previewUrl: false });

    expect(handleA.requests[0]?.url).toBe(handleB.requests[0]?.url);
    expect(handleA.requests[0]?.body).toEqual(handleB.requests[0]?.body);
  });

  test("returns a waitable sent result", async () => {
    const wa = makeWa();
    const res = await wa.sendText({ to: "15551230000", text: "hello" });
    const sent = asWaitable(res);
    expect(sent.messages?.[0]?.id).toBe("wamid.START");
    expect(typeof sent.waitForReply).toBe("function");
    expect(typeof sent.waitForClick).toBe("function");
  });

  test("rejects when the facade has no bound phoneNumberId", async () => {
    const handle = makeHandle();
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      apiVersion: "v25.0",
      transport: handle.transport
    });
    let thrown: unknown;
    try {
      await wa.sendText({ to: "15551230000", text: "hello" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  test("startChat remains public and behaves identically", async () => {
    const wa = makeWa();
    const res = await wa.startChat({ to: "15551230000", text: "hello" });
    expect(asWaitable(res).messages?.[0]?.id).toBe("wamid.START");
  });
});

// =====================================================================
// onMessage / onStatus sugar
// =====================================================================

describe("WATS-172 WhatsApp.onMessage / onStatus", () => {
  test("onMessage registers a handler that fires only on message updates", async () => {
    const wa = makeWa();
    const calls: string[] = [];
    const h = wa.onMessage((ctx) => {
      calls.push(ctx.update.updateId);
    });
    expect(h.registered).toBe(true);
    await wa.dispatch(makeStatusUpdate());
    expect(calls).toEqual([]);
    await wa.dispatch(makeMessageUpdate());
    expect(calls).toEqual(["wamid.F10"]);
  });

  test("onStatus registers a handler that fires only on status updates", async () => {
    const wa = makeWa();
    const calls: string[] = [];
    const h = wa.onStatus((ctx) => {
      calls.push(ctx.update.updateId);
    });
    expect(h.registered).toBe(true);
    await wa.dispatch(makeMessageUpdate());
    expect(calls).toEqual([]);
    await wa.dispatch(makeStatusUpdate());
    expect(calls).toEqual(["wamid.S"]);
  });

  test("onMessage returns a handle that can be unregistered", async () => {
    const wa = makeWa();
    let fired = 0;
    const h = wa.onMessage(() => {
      fired += 1;
    });
    await wa.dispatch(makeMessageUpdate());
    expect(fired).toBe(1);
    h.unregister();
    await wa.dispatch(makeMessageUpdate());
    expect(fired).toBe(1);
  });
});

// =====================================================================
// Waitable sent-results on every facade send method
// =====================================================================

describe("WATS-172 waitable sent-results across facade send methods", () => {
  test("sendButtons returns a waitable whose waitForClick resolves on a button_reply", async () => {
    const wa = makeWa();
    const sent = asWaitable(
      await wa.sendButtons({
        to: "15551230000",
        bodyText: "Choose",
        buttons: [{ id: "a", title: "A" }]
      })
    );
    expect(sent.messages?.[0]?.id).toBe("wamid.START");
    expect(typeof sent.waitForClick).toBe("function");
    const promise = sent.waitForClick({ timeoutMs: 100 });
    await wa.dispatch(makeButtonReply("wamid.START", "15551230000"));
    const update = await promise;
    expect(update.kind).toBe("message");
    expect(wa.activeListenerCount).toBe(0);
  });

  const mediaMethods = [
    "sendImage",
    "sendVideo",
    "sendAudio",
    "sendDocument",
    "sendSticker",
    "sendLocation",
    "sendContacts",
    "sendReaction",
    "removeReaction",
    "sendList",
    "sendCtaUrl",
    "sendProduct",
    "sendProducts",
    "sendCatalog",
    "requestLocation",
    "sendTemplate"
  ] as const;

  const sampleInputs: Record<string, unknown> = {
    sendImage: { to: "15551230000", mediaId: "IMG", caption: "c" },
    sendVideo: { to: "15551230000", link: "https://cdn.test/v.mp4" },
    sendAudio: { to: "15551230000", mediaId: "AUD" },
    sendDocument: { to: "15551230000", mediaId: "DOC", filename: "r.pdf" },
    sendSticker: { to: "15551230000", link: "https://cdn.test/s.webp" },
    sendLocation: { to: "15551230000", latitude: 1, longitude: 2 },
    sendContacts: { to: "15551230000", contacts: [{ name: { formattedName: "Ada" } }] },
    sendReaction: { to: "15551230000", messageId: "wamid.T", emoji: "👍" },
    removeReaction: { to: "15551230000", messageId: "wamid.T" },
    sendList: { to: "15551230000", bodyText: "Pick", buttonText: "Go", sections: [{ title: "S", rows: [{ id: "r", title: "R" }] }] },
    sendCtaUrl: { to: "15551230000", bodyText: "Open", displayText: "Open", url: "https://example.test" },
    sendProduct: { to: "15551230000", catalogId: "CAT", productRetailerId: "SKU" },
    sendProducts: { to: "15551230000", catalogId: "CAT", headerText: "H", bodyText: "B", sections: [{ title: "S", productItems: [{ productRetailerId: "SKU" }] }] },
    sendCatalog: { to: "15551230000", bodyText: "Catalog" },
    requestLocation: { to: "15551230000", bodyText: "Share" },
    sendTemplate: { to: "15551230000", name: "hello_world", languageCode: "en_US" }
  };

  for (const method of mediaMethods) {
    test(`${method} returns a waitable sent result with all waiter methods`, async () => {
      const wa = makeWa();
      const res = await (wa as unknown as Record<string, (input: unknown) => Promise<unknown>>)[method](
        sampleInputs[method]
      );
      const sent = asWaitable(res);
      expect(sent.messages?.[0]?.id).toBe("wamid.START");
      expect(typeof sent.waitForReply).toBe("function");
      expect(typeof sent.waitForClick).toBe("function");
      expect(typeof sent.waitForSelection).toBe("function");
      expect(typeof sent.waitForFlowCompletion).toBe("function");
      expect(typeof sent.waitUntilDelivered).toBe("function");
      expect(typeof sent.waitUntilRead).toBe("function");
      expect(typeof sent.waitUntilFailed).toBe("function");
    });
  }

  test("sendMarketingTemplate returns a waitable that ALSO preserves marketing response fields", async () => {
    const handle = createMockTransport({
      defaultResponse: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          messaging_product: "whatsapp",
          contacts: [{ wa_id: "15551230000" }],
          messages: [{ id: "wamid.MKT", message_status: "accepted" }]
        }
      }
    });
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      apiVersion: "v25.0",
      phoneNumberId: "1234567890",
      transport: handle.transport
    });
    const res = (await wa.sendMarketingTemplate({
      to: "15551230000",
      name: "promo",
      languageCode: "en_US"
    })) as WhatsAppSentResultWaiters & {
      messages?: Array<{ id: string; message_status?: string }>;
    };
    expect(res.messages?.[0]?.id).toBe("wamid.MKT");
    expect(res.messages?.[0]?.message_status).toBe("accepted");
    expect(typeof res.waitForReply).toBe("function");
    expect(typeof res.waitForClick).toBe("function");
  });

  test("waitable from sendImage resolves waitForReply on a matching inbound reply", async () => {
    const wa = makeWa();
    const sent = asWaitable(
      await wa.sendImage({ to: "15551230000", mediaId: "IMG", caption: "c" })
    );
    const promise = sent.waitForReply({ timeoutMs: 100 });
    const reply: TypedMessageUpdate = {
      kind: "message",
      updateId: "wamid.REP",
      phoneNumberId: "1234567890",
      wabaId: "WABA-Z",
      receivedAt: 2,
      message: {
        from: "15551230000",
        id: "wamid.REP",
        timestamp: "2",
        type: "text",
        text: { body: "reply" },
        context: { messageId: "wamid.START", from: "1234567890" }
      } as TypedMessageUpdate["message"],
      rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
    };
    await wa.dispatch(reply);
    const update = await promise;
    expect(update.message.from).toBe("15551230000");
    expect(wa.activeListenerCount).toBe(0);
  });

  test("markMessageAsRead and indicateTyping are NOT waitable (no sent message id to track)", async () => {
    const handle = createMockTransport({
      defaultResponse: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { success: true }
      }
    });
    const wa = createWhatsApp({
      accessToken: "token-AAA",
      apiVersion: "v25.0",
      phoneNumberId: "1234567890",
      transport: handle.transport
    });
    const readRes = (await wa.markMessageAsRead({ messageId: "wamid.IN" })) as unknown;
    const typingRes = (await wa.indicateTyping({ messageId: "wamid.IN" })) as unknown;
    expect(typeof (readRes as { waitForReply?: unknown }).waitForReply).toBe("undefined");
    expect(typeof (typingRes as { waitForReply?: unknown }).waitForReply).toBe("undefined");
  });
});
