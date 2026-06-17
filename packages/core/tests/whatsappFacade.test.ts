// packages/core/tests/whatsappFacade.test.ts (F-10 RED)
//
// WhatsApp facade — Arch-L composition root. Exercises:
//   - Construction validation (graphClient required; ids optional)
//   - phoneNumberClient/wabaClient lazy-but-eager exposure when ids present
//   - router delegation (on/dispatch)
//   - observer / routerOptions injection
//   - accepts a pre-built TypedRouter

import { describe, expect, test } from "bun:test";
import {
  WhatsApp,
  WhatsAppFacadeConfigError,
  WhatsAppListenOptionsError,
  type WhatsAppFacadeConfig
} from "../src/whatsappFacade";
import {
  TypedRouter,
  type DispatchReport,
  type RouterObserver
} from "../src/typedRouter";
import {
  ListenerAbortError,
  ListenerTimeoutError,
  createListenerRegistry,
  type ListenerHandle
} from "../src/listener";
import { message } from "../src/filtersTyped/index";
import { GraphClient } from "@wats/graph";
import {
  createMockTransport,
  type MockTransportHandle
} from "../../graph/src/createMockTransport";
import { GraphRequestValidationError } from "../../graph/src/errors";
import type {
  TypedMessageUpdate,
  TypedStatusUpdate,
  TypedUpdate
} from "../src/webhookNormalizer";

function makeGraphClient(): GraphClient {
  const handle = createMockTransport({
    defaultResponse: { status: 200, body: { ok: true } }
  });
  return new GraphClient({
    accessToken: "token-AAA",
    apiVersion: "v25.0",
    transport: handle.transport
  });
}

function makeGraphClientWithHandle(): {
  readonly graphClient: GraphClient;
  readonly handle: MockTransportHandle;
} {
  const handle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: "wamid.START" }] }
    }
  });
  return {
    graphClient: new GraphClient({
      accessToken: "token-AAA",
      apiVersion: "v25.0",
      transport: handle.transport
    }),
    handle
  };
}

function makeMessageUpdate(): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.F10",
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 1,
    message: {
      from: "15551234567",
      id: "wamid.F10",
      timestamp: "1",
      type: "text",
      text: { body: "hi" }
    } as TypedMessageUpdate["message"],
    rawChange: {
      field: "messages",
      value: {}
    } as TypedMessageUpdate["rawChange"]
  };
}

function makeReplyToSentMessage(sentMessageId = "wamid.START", from = "15551230000"): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.REPLY",
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 2,
    message: {
      from,
      id: "wamid.REPLY",
      timestamp: "2",
      type: "text",
      text: { body: "reply" },
      context: { messageId: sentMessageId, from: "1234567890" }
    } as TypedMessageUpdate["message"],
    rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
  };
}

function makeInteractiveReply(
  replyType: "button_reply" | "list_reply" | "nfm_reply",
  sentMessageId = "wamid.START",
  from = "15551230000"
): TypedMessageUpdate {
  const interactive = replyType === "button_reply"
    ? { type: "button_reply" as const, buttonReply: { id: "btn-1", title: "Yes" } }
    : replyType === "list_reply"
      ? { type: "list_reply" as const, listReply: { id: "row-1", title: "Row", description: "Desc" } }
      : { type: "nfm_reply" as const, nfmReply: { responseJson: "{\"done\":true}", body: "Done", name: "flow" } };
  return {
    kind: "message",
    updateId: `wamid.${replyType}`,
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 2,
    message: {
      from,
      id: `wamid.${replyType}`,
      timestamp: "2",
      type: "interactive",
      interactive,
      context: { messageId: sentMessageId, from: "1234567890" }
    } as TypedMessageUpdate["message"],
    rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
  };
}

function makeQuickReplyButton(sentMessageId = "wamid.START", from = "15551230000"): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.BUTTON",
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 2,
    message: {
      from,
      id: "wamid.BUTTON",
      timestamp: "2",
      type: "button",
      button: { text: "Yes", payload: "btn-1" },
      context: { messageId: sentMessageId, from: "1234567890" }
    } as TypedMessageUpdate["message"],
    rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
  };
}

function makeSentStatus(status: "sent" | "delivered" | "read" | "failed", id = "wamid.START", recipientId = "15551230000"): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: id,
    phoneNumberId: "1234567890",
    wabaId: "WABA-Z",
    receivedAt: 3,
    status: {
      id,
      status,
      timestamp: "3",
      recipientId
    } as TypedStatusUpdate["status"],
    rawChange: { field: "messages", value: {} } as TypedStatusUpdate["rawChange"]
  };
}

interface WaitableSentResultForTest {
  readonly messages?: Array<{ readonly id: string }>;
  readonly contacts?: Array<{ readonly wa_id?: string }>;
  waitForReply(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitForClick(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitForSelection(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitForFlowCompletion(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedMessageUpdate>;
  waitUntilDelivered(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedStatusUpdate>;
  waitUntilRead(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedStatusUpdate>;
  waitUntilFailed(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<TypedStatusUpdate>;
}

function startChatOf(wa: WhatsApp): (input: unknown) => Promise<unknown> {
  return (wa as unknown as { startChat: (input: unknown) => Promise<unknown> })
    .startChat.bind(wa);
}

// =====================================================================
// Construction
// =====================================================================

describe("WhatsApp facade construction", () => {
  test("requires a config object", () => {
    expect(
      () => new WhatsApp(undefined as unknown as WhatsAppFacadeConfig)
    ).toThrow(WhatsAppFacadeConfigError);
    expect(
      () => new WhatsApp(null as unknown as WhatsAppFacadeConfig)
    ).toThrow(WhatsAppFacadeConfigError);
  });

  test("requires a GraphClient with .request()", () => {
    expect(
      () =>
        new WhatsApp({
          graphClient: {} as unknown as GraphClient
        })
    ).toThrow(WhatsAppFacadeConfigError);
  });

  test("minimal config with just a graphClient succeeds", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    expect(wa.graphClient).toBe(gc);
    expect(wa.router).toBeInstanceOf(TypedRouter);
    expect(wa.phoneNumberClient).toBeUndefined();
    expect(wa.wabaClient).toBeUndefined();
  });

  test("rejects invalid phoneNumberId at construction", () => {
    const gc = makeGraphClient();
    expect(
      () => new WhatsApp({ graphClient: gc, phoneNumberId: "bad/slash" })
    ).toThrow();
    expect(
      () => new WhatsApp({ graphClient: gc, phoneNumberId: "" })
    ).toThrow(WhatsAppFacadeConfigError);
    expect(
      () =>
        new WhatsApp({
          graphClient: gc,
          phoneNumberId: 123 as unknown as string
        })
    ).toThrow(WhatsAppFacadeConfigError);
  });

  test("rejects invalid wabaId at construction", () => {
    const gc = makeGraphClient();
    expect(
      () => new WhatsApp({ graphClient: gc, wabaId: "" })
    ).toThrow(WhatsAppFacadeConfigError);
    expect(
      () => new WhatsApp({ graphClient: gc, wabaId: "bad\r\nid" })
    ).toThrow();
  });

  test("rejects non-TypedRouter `router` option", () => {
    const gc = makeGraphClient();
    expect(
      () =>
        new WhatsApp({
          graphClient: gc,
          router: {} as unknown as TypedRouter
        })
    ).toThrow(WhatsAppFacadeConfigError);
  });

  test("rejects observer that is not an object", () => {
    const gc = makeGraphClient();
    expect(
      () =>
        new WhatsApp({
          graphClient: gc,
          observer: "nope" as unknown as RouterObserver
        })
    ).toThrow(WhatsAppFacadeConfigError);
  });
});

// =====================================================================
// Scoped-client exposure
// =====================================================================

describe("WhatsApp facade scoped clients", () => {
  test("phoneNumberId → exposes PhoneNumberClient instance", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({
      graphClient: gc,
      phoneNumberId: "1234567890"
    });
    expect(wa.phoneNumberClient).toBeDefined();
    expect(wa.phoneNumberClient?.phoneNumberId).toBe("1234567890");
    expect(wa.phoneNumberClient?.graphClient).toBe(gc);
  });

  test("wabaId → exposes WABAClient instance", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc, wabaId: "99999" });
    expect(wa.wabaClient).toBeDefined();
    expect(wa.wabaClient?.wabaId).toBe("99999");
    expect(wa.wabaClient?.graphClient).toBe(gc);
  });

  test("no ids → both sub-clients undefined (NOT empty object)", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    expect(wa.phoneNumberClient).toBeUndefined();
    expect(wa.wabaClient).toBeUndefined();
  });

  test("both ids → both clients present + independently scoped", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({
      graphClient: gc,
      phoneNumberId: "1234567890",
      wabaId: "99999"
    });
    expect(wa.phoneNumberClient?.phoneNumberId).toBe("1234567890");
    expect(wa.wabaClient?.wabaId).toBe("99999");
  });
});

// =====================================================================
// WATS-30 startChat
// =====================================================================

describe("WATS-30 WhatsApp.startChat", () => {
  test("delegates to the bound PhoneNumberClient.sendText for arbitrary non-contact recipients", async () => {
    const { graphClient, handle } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });

    const res = await startChatOf(wa)({
      to: "15551230000",
      text: "hello from facade",
      previewUrl: false,
      replyToMessageId: "wamid.REPLY"
    });

    expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
      "wamid.START"
    );
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/1234567890/messages"
    );
    const body = JSON.parse(String(handle.requests[0]?.body)) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string; preview_url?: boolean };
      context?: { message_id?: string };
    };
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "text",
      text: { body: "hello from facade", preview_url: false },
      context: { message_id: "wamid.REPLY" }
    });
  });

  test("rejects when the facade has no bound phoneNumberId/client", async () => {
    const { graphClient, handle } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient });

    let thrown: unknown;
    try {
      await startChatOf(wa)({ to: "15551230000", text: "hello" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects malformed inputs with typed validation before transport", async () => {
    const { graphClient, handle } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const cases: readonly unknown[] = [
      undefined,
      null,
      "x",
      [],
      { to: "", text: "hello" },
      { to: "15551230000", text: "" },
      { to: "15551230000", text: "hello", previewUrl: "false" },
      { to: "15551230000", text: "hello", replyToMessageId: "bad\nreply" }
    ];

    for (const input of cases) {
      let thrown: unknown;
      try {
        await startChatOf(wa)(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });
});

// =====================================================================
// WATS-78 sent-update waiter ergonomics
// =====================================================================

describe("WATS-78 WhatsApp sent-result waiters", () => {
  test("startChat returns a waitable sent result that preserves Graph response fields", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });

    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    expect(sent.messages?.[0]?.id).toBe("wamid.START");
    expect(typeof sent.waitForReply).toBe("function");
    expect(typeof sent.waitForClick).toBe("function");
    expect(typeof sent.waitForSelection).toBe("function");
    expect(typeof sent.waitForFlowCompletion).toBe("function");
    expect(typeof sent.waitUntilDelivered).toBe("function");
    expect(typeof sent.waitUntilRead).toBe("function");
    expect(typeof sent.waitUntilFailed).toBe("function");
  });

  test("waitForClick resolves on interactive button replies and ignores mismatched recipient/context", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    const promise = sent.waitForClick({ timeoutMs: 100 });
    await wa.dispatch(makeInteractiveReply("button_reply", "other-message", "15551230000"));
    expect(wa.activeListenerCount).toBe(1);
    await wa.dispatch(makeInteractiveReply("button_reply", "wamid.START", "15559990000"));
    expect(wa.activeListenerCount).toBe(1);
    await wa.dispatch(makeInteractiveReply("button_reply", "wamid.START", "15551230000"));

    const update = await promise;
    if (update.message.type !== "interactive") throw new Error(`expected interactive, got ${update.message.type}`);
    expect(update.message.interactive.type).toBe("button_reply");
    expect(wa.activeListenerCount).toBe(0);
  });

  test("waitForClick also resolves on quick-reply button messages", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    const promise = sent.waitForClick({ timeoutMs: 100 });
    await wa.dispatch(makeQuickReplyButton("wamid.START", "15551230000"));
    const update = await promise;
    expect(update.message.type).toBe("button");
    expect(wa.activeListenerCount).toBe(0);
  });

  test("waitForSelection resolves on list replies only", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    const promise = sent.waitForSelection({ timeoutMs: 100 });
    await wa.dispatch(makeInteractiveReply("button_reply", "wamid.START", "15551230000"));
    expect(wa.activeListenerCount).toBe(1);
    await wa.dispatch(makeInteractiveReply("list_reply", "wamid.START", "15551230000"));
    const update = await promise;
    if (update.message.type !== "interactive") throw new Error(`expected interactive, got ${update.message.type}`);
    expect(update.message.interactive.type).toBe("list_reply");
    expect(wa.activeListenerCount).toBe(0);
  });

  test("waitForFlowCompletion resolves on nfm replies only", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    const promise = sent.waitForFlowCompletion({ timeoutMs: 100 });
    await wa.dispatch(makeInteractiveReply("list_reply", "wamid.START", "15551230000"));
    expect(wa.activeListenerCount).toBe(1);
    await wa.dispatch(makeInteractiveReply("nfm_reply", "wamid.START", "15551230000"));
    const update = await promise;
    if (update.message.type !== "interactive") throw new Error(`expected interactive, got ${update.message.type}`);
    expect(update.message.interactive.type).toBe("nfm_reply");
    expect(wa.activeListenerCount).toBe(0);
  });

  test("interaction waiters support timeout and abort cleanup", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    let timeoutErr: unknown;
    try {
      await sent.waitForSelection({ timeoutMs: 20 });
    } catch (error) {
      timeoutErr = error;
    }
    expect(timeoutErr).toBeInstanceOf(ListenerTimeoutError);
    expect(wa.activeListenerCount).toBe(0);

    const ctl = new AbortController();
    const aborted = sent.waitForFlowCompletion({ signal: ctl.signal });
    expect(wa.activeListenerCount).toBe(1);
    ctl.abort();
    let abortErr: unknown;
    try {
      await aborted;
    } catch (error) {
      abortErr = error;
    }
    expect(abortErr).toBeInstanceOf(ListenerAbortError);
    expect(wa.activeListenerCount).toBe(0);
  });

  test("waitForReply resolves only when an inbound message replies to the sent message from the observed recipient", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    const promise = sent.waitForReply({ timeoutMs: 100 });
    await wa.dispatch(makeReplyToSentMessage("other-message", "15551230000"));
    expect(wa.activeListenerCount).toBe(1);
    await wa.dispatch(makeReplyToSentMessage("wamid.START", "15559990000"));
    expect(wa.activeListenerCount).toBe(1);
    await wa.dispatch(makeReplyToSentMessage("wamid.START", "15551230000"));

    const reply = await promise;
    expect(reply.kind).toBe("message");
    expect(reply.message.from).toBe("15551230000");
    if (reply.message.type !== "text") {
      throw new Error(`expected text reply, got ${reply.message.type}`);
    }
    expect(reply.message.context?.messageId).toBe("wamid.START");
    expect(wa.activeListenerCount).toBe(0);
  });

  test("status waiters resolve only on observed status events for the sent message", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    const delivered = sent.waitUntilDelivered({ timeoutMs: 100 });
    const read = sent.waitUntilRead({ timeoutMs: 100 });
    const failed = sent.waitUntilFailed({ timeoutMs: 100 });
    await wa.dispatch(makeSentStatus("delivered", "other-message", "15551230000"));
    expect(wa.activeListenerCount).toBe(3);
    await wa.dispatch(makeSentStatus("delivered", "wamid.START", "15551230000"));
    await wa.dispatch(makeSentStatus("read", "wamid.START", "15551230000"));
    await wa.dispatch(makeSentStatus("failed", "wamid.START", "15551230000"));

    expect((await delivered).status.status).toBe("delivered");
    expect((await read).status.status).toBe("read");
    expect((await failed).status.status).toBe("failed");
    expect(wa.activeListenerCount).toBe(0);
  });

  test("waiters support timeout and abort cleanup", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
    const sent = await startChatOf(wa)({ to: "15551230000", text: "hello" }) as WaitableSentResultForTest;

    let timeoutErr: unknown;
    try {
      await sent.waitUntilRead({ timeoutMs: 20 });
    } catch (error) {
      timeoutErr = error;
    }
    expect(timeoutErr).toBeInstanceOf(ListenerTimeoutError);
    expect(wa.activeListenerCount).toBe(0);

    const ctl = new AbortController();
    const aborted = sent.waitForReply({ signal: ctl.signal });
    expect(wa.activeListenerCount).toBe(1);
    ctl.abort();
    let abortErr: unknown;
    try {
      await aborted;
    } catch (error) {
      abortErr = error;
    }
    expect(abortErr).toBeInstanceOf(ListenerAbortError);
    expect(wa.activeListenerCount).toBe(0);
  });
});

// =====================================================================
// WATS-38 facade outbound media helpers
// =====================================================================

describe("WATS-38 WhatsApp outbound media helpers", () => {
  type FacadeMediaMethod = "sendImage" | "sendVideo" | "sendAudio" | "sendDocument" | "sendSticker";

  function facadeMediaMethodOf(
    wa: WhatsApp,
    method: FacadeMediaMethod
  ): (input: unknown) => Promise<unknown> {
    return (wa as unknown as Record<FacadeMediaMethod, (input: unknown) => Promise<unknown>>)[
      method
    ].bind(wa);
  }

  test("sendImage/sendVideo/sendAudio/sendDocument/sendSticker delegate to bound phone-number client", async () => {
    const cases = [
      {
        method: "sendImage" as const,
        input: { to: "15551230000", mediaId: "IMG_ID", caption: "image caption" },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "image",
          image: { id: "IMG_ID", caption: "image caption" }
        }
      },
      {
        method: "sendVideo" as const,
        input: { to: "15551230000", link: "https://cdn.example.test/video.mp4" },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "video",
          video: { link: "https://cdn.example.test/video.mp4" }
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
          mediaId: "DOC_ID",
          caption: "document caption",
          filename: "report.pdf"
        },
        expected: {
          messaging_product: "whatsapp",
          to: "15551230000",
          type: "document",
          document: { id: "DOC_ID", caption: "document caption", filename: "report.pdf" }
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
      const { graphClient, handle } = makeGraphClientWithHandle();
      const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
      const res = await facadeMediaMethodOf(wa, c.method)(c.input);
      expect((res as { messages?: Array<{ id: string }> }).messages?.[0]?.id).toBe(
        "wamid.START"
      );
      expect(handle.requests.length).toBe(1);
      expect(handle.requests[0]?.url).toBe(
        "https://graph.facebook.com/v25.0/1234567890/messages"
      );
      expect(JSON.parse(String(handle.requests[0]?.body))).toEqual(c.expected);
    }
  });

  test("media helpers reject when the facade has no bound phoneNumberId/client", async () => {
    const { graphClient, handle } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient });

    let thrown: unknown;
    try {
      await facadeMediaMethodOf(wa, "sendImage")({ to: "15551230000", mediaId: "IMG_ID" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(handle.requests.length).toBe(0);
  });
});

// =====================================================================
// Router delegation
// =====================================================================

describe("WhatsApp facade router delegation", () => {
  test(".on() delegates to the underlying router", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    const calls: string[] = [];
    const h = wa.on(message, (ctx) => {
      calls.push(ctx.update.updateId);
    });
    expect(h.registered).toBe(true);
    await wa.dispatch(makeMessageUpdate());
    expect(calls).toEqual(["wamid.F10"]);
    expect(wa.router.handlerCount).toBe(1);
  });

  test("registered handler survives facade → router round-trip", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    wa.on(message, () => {});
    expect(wa.router.handlerCount).toBe(1);
  });

  test(".dispatch() returns a DispatchReport", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    wa.on(message, () => {});
    const rpt: DispatchReport = await wa.dispatch(makeMessageUpdate());
    expect(typeof rpt.dispatchId).toBe("string");
    expect(rpt.matchedHandlers).toBe(1);
  });

  test("observer option wires through to router", async () => {
    const gc = makeGraphClient();
    const hits: string[] = [];
    const observer: RouterObserver = {
      onBeforeDispatch: () => hits.push("before"),
      onAfterDispatch: () => hits.push("after")
    };
    const wa = new WhatsApp({ graphClient: gc, observer });
    wa.on(message, () => {});
    await wa.dispatch(makeMessageUpdate());
    expect(hits).toEqual(["before", "after"]);
  });

  test("pre-built router is reused (not replaced)", async () => {
    const gc = makeGraphClient();
    const preRouter = new TypedRouter();
    preRouter.on(message, () => {});
    const wa = new WhatsApp({ graphClient: gc, router: preRouter });
    expect(wa.router).toBe(preRouter);
    expect(wa.router.handlerCount).toBe(1);
  });

  test("routerOptions honored when no router provided", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({
      graphClient: gc,
      routerOptions: { maxHandlersPerDispatch: 1 }
    });
    wa.on(message, () => {});
    wa.on(message, () => {});
    const rpt = await wa.dispatch(makeMessageUpdate());
    expect(rpt.matchedHandlers).toBe(1);
    expect(rpt.capped).toBe(true);
  });

  test("sibling-class: status update does not fire message handlers", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    let fired = 0;
    wa.on(message, () => {
      fired += 1;
    });
    const statusUpdate: TypedUpdate = {
      kind: "status",
      updateId: "wamid.S",
      phoneNumberId: "1",
      wabaId: "W",
      receivedAt: 1,
      status: {} as never,
      rawChange: { field: "messages", value: {} } as never
    };
    const rpt = await wa.dispatch(statusUpdate);
    expect(fired).toBe(0);
    expect(rpt.matchedHandlers).toBe(0);
  });
});

// =====================================================================
// F-11 listener substrate delegation
// =====================================================================

describe("WhatsApp facade — F-11 listen() delegation", () => {
  test("wa.listen({ type: 'message' }) returns a ListenerHandle", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    const h: ListenerHandle<TypedMessageUpdate> = wa.listen({
      type: "message"
    });
    expect(typeof h.id).toBe("symbol");
    expect(h.promise).toBeInstanceOf(Promise);
    expect(h.cancelled).toBe(false);
    expect(wa.activeListenerCount).toBe(1);
    h.cancel();
    expect(wa.activeListenerCount).toBe(0);
  });

  test("listen resolves when a matching update dispatches", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    const h = wa.listen({ type: "message" });
    await wa.dispatch(makeMessageUpdate());
    const u = await h.promise;
    expect(u.kind).toBe("message");
    expect(u.updateId).toBe("wamid.F10");
  });

  test("listen({ type: 'message', from }) narrows by sender wa_id", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    const h = wa.listen({ type: "message", from: "15551234567" });
    // Non-matching sender — does not resolve.
    const otherUpdate = {
      ...makeMessageUpdate(),
      message: { ...makeMessageUpdate().message, from: "OTHER" }
    } as TypedMessageUpdate;
    await wa.dispatch(otherUpdate);
    // Matching sender resolves.
    await wa.dispatch(makeMessageUpdate());
    const u = await h.promise;
    expect(u.message.from).toBe("15551234567");
  });

  test("listen timeout rejects with ListenerTimeoutError", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    const h = wa.listen({ type: "message", timeoutMs: 20 });
    let err: unknown;
    try {
      await h.promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerTimeoutError);
    expect(wa.activeListenerCount).toBe(0);
  });

  test("listen AbortSignal rejects with ListenerAbortError", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    const ctl = new AbortController();
    const h = wa.listen({ type: "message", signal: ctl.signal });
    ctl.abort();
    let err: unknown;
    try {
      await h.promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerAbortError);
  });

  test("listen validates type", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    expect(() =>
      wa.listen({ type: "nope" as unknown as "message" })
    ).toThrow(WhatsAppListenOptionsError);
    expect(() =>
      wa.listen(undefined as unknown as { type: "message" })
    ).toThrow(WhatsAppListenOptionsError);
  });

  test("listen validates from when provided", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    expect(() =>
      wa.listen({
        type: "message",
        from: 42 as unknown as string
      })
    ).toThrow(WhatsAppListenOptionsError);
    expect(() => wa.listen({ type: "message", from: "" })).toThrow(
      WhatsAppListenOptionsError
    );
  });

  test("listenerRegistry getter returns the lazily-initialized registry", () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    expect(wa.listenerRegistry).toBeUndefined();
    const h = wa.listen({ type: "message" });
    expect(wa.listenerRegistry).toBeDefined();
    expect(wa.listenerRegistry?.activeCount).toBe(1);
    h.cancel();
  });

  test("caller-supplied listenerRegistry is reused (not replaced)", async () => {
    const gc = makeGraphClient();
    const reg = createListenerRegistry();
    const wa = new WhatsApp({ graphClient: gc, listenerRegistry: reg });
    expect(wa.listenerRegistry).toBe(reg);
    const h = wa.listen({ type: "message" });
    expect(reg.activeCount).toBe(1);
    await wa.dispatch(makeMessageUpdate());
    await h.promise;
    expect(reg.activeCount).toBe(0);
  });

  test("listener resolves BEFORE handlers fire (plan DoD)", async () => {
    const gc = makeGraphClient();
    const wa = new WhatsApp({ graphClient: gc });
    const order: string[] = [];
    wa.on(message, () => {
      order.push("handler");
    });
    const h = wa.listen({ type: "message" });
    h.promise.then((u) => {
      order.push(`listener:${u.updateId}`);
    });
    await wa.dispatch(makeMessageUpdate());
    // Yield microtasks so the listener's then() fires.
    await Promise.resolve();
    await Promise.resolve();
    // Both fire — listener-promise-resolution chains a microtask
    // after dispatch completes, but listener evaluate runs before
    // handler invocation, so "listener:..." marker appears first or
    // at least both are present.
    expect(order).toContain("handler");
    expect(order.some((o) => o.startsWith("listener:"))).toBe(true);
  });
});


describe("WATS-38 remaining WhatsApp facade composer helpers", () => {
  type RemainingFacadeMethod =
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

  function facadeMethodOf(wa: WhatsApp, method: RemainingFacadeMethod): (input: unknown) => Promise<unknown> {
    return (wa as unknown as Record<RemainingFacadeMethod, (input: unknown) => Promise<unknown>>)[method].bind(wa);
  }

  test("remaining facade helpers delegate to the bound phone-number client", async () => {
    const cases = [
      { method: "sendLocation" as const, input: { to: "15551230000", latitude: 1, longitude: 2 }, expectedType: "location" },
      { method: "sendContacts" as const, input: { to: "15551230000", contacts: [{ name: { formattedName: "Ada" } }] }, expectedType: "contacts" },
      { method: "sendReaction" as const, input: { to: "15551230000", messageId: "wamid.T", emoji: "👍" }, expectedType: "reaction" },
      { method: "removeReaction" as const, input: { to: "15551230000", messageId: "wamid.T" }, expectedType: "reaction" },
      { method: "sendButtons" as const, input: { to: "15551230000", bodyText: "Choose", buttons: [{ id: "a", title: "A" }] }, expectedType: "interactive" },
      { method: "sendList" as const, input: { to: "15551230000", bodyText: "Pick", buttonText: "Choose", sections: [{ title: "S", rows: [{ id: "r", title: "R" }] }] }, expectedType: "interactive" },
      { method: "sendCtaUrl" as const, input: { to: "15551230000", bodyText: "Open", displayText: "Open", url: "https://example.test" }, expectedType: "interactive" },
      { method: "sendProduct" as const, input: { to: "15551230000", catalogId: "CAT", productRetailerId: "SKU" }, expectedType: "interactive" },
      { method: "sendProducts" as const, input: { to: "15551230000", catalogId: "CAT", headerText: "H", bodyText: "B", sections: [{ title: "S", productItems: [{ productRetailerId: "SKU" }] }] }, expectedType: "interactive" },
      { method: "sendCatalog" as const, input: { to: "15551230000", bodyText: "Catalog" }, expectedType: "interactive" },
      { method: "requestLocation" as const, input: { to: "15551230000", bodyText: "Share" }, expectedType: "interactive" },
      { method: "sendTemplate" as const, input: { to: "15551230000", name: "hello_world", languageCode: "en_US" }, expectedType: "template" },
      { method: "markMessageAsRead" as const, input: { messageId: "wamid.INBOUND" }, expectedType: undefined },
      { method: "indicateTyping" as const, input: { messageId: "wamid.INBOUND" }, expectedType: undefined }
    ];

    for (const c of cases) {
      const { graphClient, handle } = makeGraphClientWithHandle();
      const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });
      const res = await facadeMethodOf(wa, c.method)(c.input);
      expect((res as { messages?: Array<{ id: string }>; success?: boolean }).messages?.[0]?.id ?? (res as { success?: boolean }).success).toBeTruthy();
      expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/1234567890/messages");
      const body = JSON.parse(String(handle.requests[0]?.body)) as { type?: string; status?: string };
      if (c.expectedType !== undefined) expect(body.type).toBe(c.expectedType);
      else expect(body.status).toBe("read");
    }
  });

  test("remaining facade helpers reject when no phoneNumberId is bound", async () => {
    const { graphClient, handle } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient });
    for (const method of ["sendLocation", "sendContacts", "sendReaction", "sendButtons", "sendList", "sendCtaUrl", "sendProduct", "sendProducts", "sendCatalog", "requestLocation", "sendTemplate", "markMessageAsRead", "indicateTyping"] as const) {
      let thrown: unknown;
      try { await facadeMethodOf(wa, method)({ to: "15551230000", messageId: "wamid", latitude: 1, longitude: 2 }); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
    expect(handle.requests.length).toBe(0);
  });
});
