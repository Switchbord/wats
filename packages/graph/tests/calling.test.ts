// WATS-41 RED — credential-free Calling API parity.
//
// Behavioral tests for call endpoint callables, PhoneNumberClient scoped
// methods, typed request/response/session exports, pywa calling error
// taxonomy, and adversarial malformed JavaScript inputs. Tests use only
// MockTransport; no live Meta credentials.

import { describe, expect, test } from "bun:test";
import * as graphRoot from "../src";
import {
  CallConnectionError,
  CallingNotEnabledError,
  DuplicateCallError,
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient
} from "../src";

type CallAction = "connect" | "pre_accept" | "accept" | "reject" | "terminate";
type CallLifecycleResponse = { readonly id?: string; readonly success?: boolean; readonly [key: string]: unknown };
type CallSessionDescription = { readonly sdpType?: string; readonly sdp_type?: string; readonly sdp: string; readonly [key: string]: unknown };

type CallingExports = typeof graphRoot & {
  initiateCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  preAcceptCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  acceptCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  rejectCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  terminateCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
};

const {
  initiateCall,
  preAcceptCall,
  acceptCall,
  rejectCall,
  terminateCall
} = graphRoot as CallingExports;
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

function ok(body: object = { id: "call-1", success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

const session: CallSessionDescription = {
  sdpType: "offer",
  sdp: "v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n"
};

describe("WATS-41 Calling endpoint callables", () => {
  test("initiateCall POSTs /{phoneNumberId}/calls with Graph snake_case boundary fields", async () => {
    const { client, handle } = clientWith(ok({ id: "call-123" }));
    const response: CallLifecycleResponse = await initiateCall(
      client,
      { phoneNumberId: "555" },
      { to: "15551234567", session, bizOpaqueCallbackData: "tracker-1" }
    );
    expect(response.id).toBe("call-123");
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/555/calls");
    expect(handle.requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      action: "connect",
      session: {
        sdp_type: "offer",
        sdp: "v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n"
      },
      biz_opaque_callback_data: "tracker-1"
    });
  });

  test("preAcceptCall / acceptCall / rejectCall / terminateCall map call_id and action bodies", async () => {
    const { client, handle } = clientWith([ok(), ok(), ok(), ok()]);
    await preAcceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", session });
    await acceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", session, bizOpaqueCallbackData: "x" });
    await rejectCall(client, { phoneNumberId: "555" }, { callId: "call-1" });
    await terminateCall(client, { phoneNumberId: "555" }, { callId: "call-1" });
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/555/calls",
      "POST https://graph.facebook.com/v25.0/555/calls",
      "POST https://graph.facebook.com/v25.0/555/calls",
      "POST https://graph.facebook.com/v25.0/555/calls"
    ]);
    expect(handle.requests.map((r) => parseBody(r.body))).toEqual([
      { messaging_product: "whatsapp", call_id: "call-1", action: "pre_accept", session: { sdp_type: "offer", sdp: session.sdp } },
      { messaging_product: "whatsapp", call_id: "call-1", action: "accept", session: { sdp_type: "offer", sdp: session.sdp }, biz_opaque_callback_data: "x" },
      { messaging_product: "whatsapp", call_id: "call-1", action: "reject" },
      { messaging_product: "whatsapp", call_id: "call-1", action: "terminate" }
    ]);
  });

  test("optional fields are omitted when undefined", async () => {
    const { client, handle } = clientWith([ok(), ok()]);
    await preAcceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", session: undefined });
    await acceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", bizOpaqueCallbackData: undefined });
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      call_id: "call-1",
      action: "pre_accept"
    });
    expect(parseBody(handle.requests[1]?.body)).toEqual({
      messaging_product: "whatsapp",
      call_id: "call-1",
      action: "accept"
    });
  });

  test("public action type is exported and remains camelCase/safe at compile-time", () => {
    const actions: readonly CallAction[] = ["connect", "pre_accept", "accept", "reject", "terminate"];
    expect(actions.join(",")).toBe("connect,pre_accept,accept,reject,terminate");
  });
});

describe("WATS-41 PhoneNumberClient Calling methods", () => {
  test("scoped methods inject constructor-bound phoneNumberId and ignore caller override objects", async () => {
    const { client, handle } = clientWith([ok(), ok(), ok(), ok(), ok()]);
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND" });
    await phone.initiateCall({ phoneNumberId: "OVERRIDE", to: "15551234567", session } as never);
    await phone.preAcceptCall({ phoneNumberId: "OVERRIDE", callId: "call-1" } as never);
    await phone.acceptCall({ phoneNumberId: "OVERRIDE", callId: "call-1" } as never);
    await phone.rejectCall({ phoneNumberId: "OVERRIDE", callId: "call-1" } as never);
    await phone.terminateCall({ phoneNumberId: "OVERRIDE", callId: "call-1" } as never);
    expect(handle.requests.map((r) => r.url)).toEqual([
      "https://graph.facebook.com/v25.0/BOUND/calls",
      "https://graph.facebook.com/v25.0/BOUND/calls",
      "https://graph.facebook.com/v25.0/BOUND/calls",
      "https://graph.facebook.com/v25.0/BOUND/calls",
      "https://graph.facebook.com/v25.0/BOUND/calls"
    ]);
  });

  test("constructor rejects encoded unsafe bound phoneNumberId values", () => {
    const { client } = clientWith(ok());
    for (const bad of ["%2e%2e", "%252e%252e", "%2f", "%252f", "%25252525252f", "%25252525252525252561"]) {
      expect(() => new PhoneNumberClient({ graphClient: client, phoneNumberId: bad })).toThrow(GraphRequestValidationError);
    }
  });
});

describe("WATS-41 Calling validation and sanitization", () => {

  test("params object rejects accessor-backed phoneNumberId without executing getter", async () => {
    const { client } = clientWith(ok());
    const params = {} as Record<string, unknown>;
    Object.defineProperty(params, "phoneNumberId", { enumerable: true, get() { throw new Error("params getter should not run"); } });
    await expect(initiateCall(client, params as never, { to: "15551234567", session })).rejects.toThrow(GraphRequestValidationError);
  });

  test("phoneNumberId path parameter rejects non-string, empty, whitespace, control, and unsafe segments", async () => {
    const { client } = clientWith(ok());
    for (const bad of [null, undefined, "", "   ", 123, {}, [], "bad\n", "bad\u0000", ".", "..", "a/b", "a\\b", "a?b", "a#b", "%2e%2e", "%252e%252e"]) {
      await expect(initiateCall(client, { phoneNumberId: bad as never }, { to: "15551234567", session })).rejects.toThrow(GraphRequestValidationError);
    }
  });

  test("to and callId reject null/undefined/empty/whitespace/non-string/control/unsafe strings", async () => {
    const { client } = clientWith(ok());
    for (const bad of [null, undefined, "", "   ", 123, {}, [], true, "bad\r", "bad\n", "bad\u0000", ".", "..", "a/b", "a\\b", "a?b", "a#b", "%2e%2e", "%252e%252e"]) {
      await expect(initiateCall(client, { phoneNumberId: "555" }, { to: bad as never, session })).rejects.toThrow(GraphRequestValidationError);
      await expect(acceptCall(client, { phoneNumberId: "555" }, { callId: bad as never })).rejects.toThrow(GraphRequestValidationError);
    }
  });

  test("bizOpaqueCallbackData accepts 512 chars and rejects over-limit/control/non-string values", async () => {
    const { client, handle } = clientWith([ok(), ok()]);
    const atLimit = "x".repeat(512);
    await initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session, bizOpaqueCallbackData: atLimit });
    await acceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", bizOpaqueCallbackData: atLimit });
    expect((parseBody(handle.requests[0]?.body).biz_opaque_callback_data as string).length).toBe(512);
    for (const bad of ["x".repeat(513), "bad\n", "bad\u0000", 123, {}, []]) {
      await expect(initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session, bizOpaqueCallbackData: bad as never })).rejects.toThrow(GraphRequestValidationError);
      await expect(acceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", bizOpaqueCallbackData: bad as never })).rejects.toThrow(GraphRequestValidationError);
    }
  });


  test("top-level request bodies reject accessors and unsafe prototype keys before read", async () => {
    const { client } = clientWith(ok());
    const accessorBody = {} as Record<string, unknown>;
    Object.defineProperty(accessorBody, "to", { enumerable: true, get() { throw new Error("body getter should not run"); } });
    accessorBody.session = session;
    await expect(initiateCall(client, { phoneNumberId: "555" }, accessorBody as never)).rejects.toThrow(GraphRequestValidationError);

    const protoBody = JSON.parse('{"callId":"call-1","__proto__":{"polluted":true}}');
    await expect(rejectCall(client, { phoneNumberId: "555" }, protoBody as never)).rejects.toThrow(GraphRequestValidationError);
  });


  test("session rejects public snake_case sdp_type so camelCase owns the API boundary", async () => {
    const { client } = clientWith(ok());
    await expect(initiateCall(client, { phoneNumberId: "555" }, {
      to: "15551234567",
      session: { sdpType: "offer", sdp_type: "answer", sdp: "v=0" }
    } as never)).rejects.toThrow(GraphRequestValidationError);
  });

  test("session descriptors are inspected before read and cloned before transport", async () => {
    const { client, handle } = clientWith(ok());
    const raw = { sdpType: "offer", sdp: "v=0\r\n" };
    await initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session: raw });
    raw.sdp = "MUTATED";
    expect((parseBody(handle.requests[0]?.body).session as Record<string, unknown>).sdp).toBe("v=0\r\n");

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "sdp", { enumerable: true, get() { throw new Error("getter should not run"); } });
    await expect(initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session: accessor as never })).rejects.toThrow(GraphRequestValidationError);
  });

  test("session rejects toJSON, custom prototypes, cycles, unsafe prototype keys, non-finite numbers, functions, symbols, and oversized/control strings", async () => {
    const { client } = clientWith(ok());
    class CustomSession { sdpType = "offer"; sdp = "v=0"; }
    const cyclic: Record<string, unknown> = { sdpType: "offer", sdp: "v=0" };
    cyclic.self = cyclic;
    const parsedProto = JSON.parse('{"sdpType":"offer","sdp":"v=0","__proto__":{"polluted":true}}');
    const badSessions: unknown[] = [
      null,
      undefined,
      "v=0",
      [],
      { sdpType: "offer", sdp: "" },
      { sdpType: "offer", sdp: "bad\u0000" },
      { sdpType: "offer", sdp: "x".repeat(16_385) },
      { sdpType: "offer", sdp: "v=0", toJSON() { return {}; } },
      new CustomSession(),
      cyclic,
      parsedProto,
      { sdpType: "offer", sdp: "v=0", n: Number.NaN },
      { sdpType: "offer", sdp: "v=0", fn: () => undefined },
      { sdpType: "offer", sdp: "v=0", sym: Symbol("x") }
    ];
    for (const bad of badSessions) {
      await expect(initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session: bad as never })).rejects.toThrow(GraphRequestValidationError);
      if (bad !== undefined) {
        await expect(preAcceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", session: bad as never })).rejects.toThrow(GraphRequestValidationError);
        await expect(acceptCall(client, { phoneNumberId: "555" }, { callId: "call-1", session: bad as never })).rejects.toThrow(GraphRequestValidationError);
      }
    }
  });
});

describe("WATS-41 Calling error taxonomy", () => {
  test("pywa calling error codes resolve to calling subclasses with sibling-NOT assertions", async () => {
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: { error: { message: "calling unavailable", code: 138000, type: "OAuthException" } }
    });
    let thrown: unknown;
    try {
      await initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CallingNotEnabledError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(DuplicateCallError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
  });

  test("distinct calling codes map to distinct subclasses", async () => {
    const { client } = clientWith([
      { status: 400, headers: { "content-type": "application/json" }, body: { error: { message: "duplicate", code: 138003 } } },
      { status: 400, headers: { "content-type": "application/json" }, body: { error: { message: "connection", code: 138004 } } }
    ]);
    await expect(initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session })).rejects.toThrow(DuplicateCallError);
    await expect(initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session })).rejects.toThrow(CallConnectionError);
  });
});
