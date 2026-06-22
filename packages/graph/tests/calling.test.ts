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

type CallPermissionsResponse = {
  readonly messagingProduct?: string;
  readonly permission?: { readonly status?: string; readonly expirationTime?: number; readonly [key: string]: unknown };
  readonly actions?: ReadonlyArray<{ readonly actionName?: string; readonly canPerformAction?: boolean; readonly limits?: ReadonlyArray<Record<string, unknown>>; readonly [key: string]: unknown }>;
  readonly [key: string]: unknown;
};

type CallingExports = typeof graphRoot & {
  initiateCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  preAcceptCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  acceptCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  rejectCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  terminateCall: (client: GraphClient, params: { phoneNumberId: string }, body: unknown, opts?: unknown) => Promise<CallLifecycleResponse>;
  getCallPermissions: (client: GraphClient, input: unknown, body?: undefined, opts?: unknown) => Promise<CallPermissionsResponse>;
};

const {
  initiateCall,
  preAcceptCall,
  acceptCall,
  rejectCall,
  terminateCall,
  getCallPermissions
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

describe("WATS-168 initiateCall recipient BSUID support", () => {
  test("request body with to only is unchanged (no recipient emitted)", async () => {
    const { client, handle } = clientWith(ok({ id: "call-to-only" }));
    const response = await initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", session });
    expect(response.id).toBe("call-to-only");
    const body = parseBody(handle.requests[0]?.body);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      action: "connect",
      session: { sdp_type: "offer", sdp: session.sdp }
    });
    expect(body.recipient).toBeUndefined();
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/555/calls");
  });

  test("request body with recipient only emits recipient and no to", async () => {
    const { client, handle } = clientWith(ok({ id: "call-recipient-only" }));
    await initiateCall(client, { phoneNumberId: "555" }, { recipient: "BSUID-parent-abc", session });
    const body = parseBody(handle.requests[0]?.body);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient: "BSUID-parent-abc",
      action: "connect",
      session: { sdp_type: "offer", sdp: session.sdp }
    });
    expect(body.to).toBeUndefined();
  });

  test("request body with both to and recipient emits both (Meta: to takes precedence)", async () => {
    const { client, handle } = clientWith(ok());
    await initiateCall(
      client,
      { phoneNumberId: "555" },
      { to: "15551234567", recipient: "BSUID-parent-abc", session, bizOpaqueCallbackData: "trk" }
    );
    const body = parseBody(handle.requests[0]?.body);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      recipient: "BSUID-parent-abc",
      action: "connect",
      session: { sdp_type: "offer", sdp: session.sdp },
      biz_opaque_callback_data: "trk"
    });
  });

  test("rejects when neither to nor recipient is supplied", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      initiateCall(client, { phoneNumberId: "555" }, { session } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("invalid recipient rejects with GraphRequestValidationError and sends no request", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of [null, undefined, "", "   ", 123, {}, [], true, "bad\r", "bad\n", "bad\u0000", ".", "..", "a/b", "a\\b", "a?b", "a#b", "%2e%2e", "%252e%252e"]) {
      handle.requests.length = 0;
      await expect(
        initiateCall(client, { phoneNumberId: "555" }, { recipient: bad as never, session } as never)
      ).rejects.toThrow(GraphRequestValidationError);
      expect(handle.requests.length).toBe(0);
    }
  });

  test("recipient still validated when to is also supplied (both-invalid and recipient-invalid paths)", async () => {
    const { client, handle } = clientWith(ok());
    // Valid to, invalid recipient -> rejects on recipient, no request sent.
    handle.requests.length = 0;
    await expect(
      initiateCall(client, { phoneNumberId: "555" }, { to: "15551234567", recipient: "bad\u0000", session } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("PhoneNumberClient bound-id behavior works with recipient-only input", async () => {
    const { client, handle } = clientWith(ok({ id: "scoped-recipient" }));
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND" });
    const response = await phone.initiateCall({ recipient: "BSUID-x", session } as never);
    expect(response.id).toBe("scoped-recipient");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/BOUND/calls");
    const body = parseBody(handle.requests[0]?.body);
    expect(body.recipient).toBe("BSUID-x");
    expect(body.to).toBeUndefined();
  });

  test("recipient-only with bizOpaqueCallbackData still emits tracker", async () => {
    const { client, handle } = clientWith(ok());
    await initiateCall(
      client,
      { phoneNumberId: "555" },
      { recipient: "BSUID-y", session, bizOpaqueCallbackData: "tracker-z" }
    );
    const body = parseBody(handle.requests[0]?.body);
    expect(body.recipient).toBe("BSUID-y");
    expect(body.biz_opaque_callback_data).toBe("tracker-z");
    expect(body.to).toBeUndefined();
  });
});

const permissionsWire = {
  messaging_product: "whatsapp",
  permission: { status: "temporary", expiration_time: 1745343479 },
  actions: [
    {
      action_name: "send_call_permission_request",
      can_perform_action: true,
      limits: [{ time_period: "PT24H", max_allowed: 1, current_usage: 0 }]
    },
    {
      action_name: "start_call",
      can_perform_action: false,
      limits: [{ time_period: "PT24H", max_allowed: 5, current_usage: 5, limit_expiration_time: 1745622600 }]
    }
  ]
};

function okPerm(body: object = permissionsWire): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

describe("WATS-77 getCallPermissions request mapping", () => {
  test("userWaId maps to GET /{phoneNumberId}/call_permissions?user_wa_id=...", async () => {
    const { client, handle } = clientWith(okPerm());
    await getCallPermissions(client, { phoneNumberId: "555", userWaId: "16505551234" });
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/555/call_permissions?user_wa_id=16505551234"
    );
  });

  test("recipient maps to GET /{phoneNumberId}/call_permissions?recipient=...", async () => {
    const { client, handle } = clientWith(okPerm());
    await getCallPermissions(client, { phoneNumberId: "555", recipient: "BSUID-abc" });
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/555/call_permissions?recipient=BSUID-abc"
    );
    expect(handle.requests[0]?.url).not.toContain("user_wa_id");
  });
});

describe("WATS-77 getCallPermissions response normalization", () => {
  test("normalizes snake_case wire shape to camelCase including nested actions/limits", async () => {
    const { client } = clientWith(okPerm());
    const res = await getCallPermissions(client, { phoneNumberId: "555", userWaId: "16505551234" });
    expect(res).toEqual({
      messagingProduct: "whatsapp",
      permission: { status: "temporary", expirationTime: 1745343479 },
      actions: [
        {
          actionName: "send_call_permission_request",
          canPerformAction: true,
          limits: [{ timePeriod: "PT24H", maxAllowed: 1, currentUsage: 0 }]
        },
        {
          actionName: "start_call",
          canPerformAction: false,
          limits: [{ timePeriod: "PT24H", maxAllowed: 5, currentUsage: 5, limitExpirationTime: 1745622600 }]
        }
      ]
    });
  });

  test("permanent status has no expirationTime and omits limit_expiration_time when not present", async () => {
    const { client } = clientWith(
      okPerm({
        messaging_product: "whatsapp",
        permission: { status: "permanent" },
        actions: [{ action_name: "start_call", can_perform_action: true, limits: [{ time_period: "P7D", max_allowed: 10, current_usage: 2 }] }]
      })
    );
    const res = await getCallPermissions(client, { phoneNumberId: "555", recipient: "r1" });
    expect(res.permission).toEqual({ status: "permanent" });
    expect(res.permission?.expirationTime).toBeUndefined();
    expect(res.actions?.[0]?.limits?.[0]).toEqual({ timePeriod: "P7D", maxAllowed: 10, currentUsage: 2 });
  });

  test("preserves unknown fields at every level via index signatures", async () => {
    const { client } = clientWith(
      okPerm({
        messaging_product: "whatsapp",
        future_top_level: "keep-me",
        permission: { status: "no_permission", future_perm_field: 99 },
        actions: [
          {
            action_name: "start_call",
            can_perform_action: true,
            future_action_field: "x",
            limits: [{ time_period: "PT24H", max_allowed: 1, current_usage: 0, future_limit_field: true }]
          }
        ]
      })
    );
    const res = await getCallPermissions(client, { phoneNumberId: "555", userWaId: "16505551234" });
    expect(res.future_top_level).toBe("keep-me");
    expect(res.permission?.future_perm_field).toBe(99);
    expect(res.permission?.status).toBe("no_permission");
    expect(res.actions?.[0]?.future_action_field).toBe("x");
    expect((res.actions?.[0]?.limits?.[0] as Record<string, unknown>).future_limit_field).toBe(true);
  });
});

describe("WATS-77 getCallPermissions rejection matrix", () => {
  test("rejects missing/invalid phoneNumberId", async () => {
    const { client } = clientWith(okPerm());
    for (const bad of [null, undefined, "", "   ", 123, {}, [], "bad\n", "bad\u0000", ".", "..", "a/b", "a\\b", "a?b", "a#b"]) {
      await expect(
        getCallPermissions(client, { phoneNumberId: bad as never, userWaId: "16505551234" })
      ).rejects.toThrow(GraphRequestValidationError);
    }
  });

  test("rejects neither userWaId nor recipient (exactly-one rule)", async () => {
    const { client } = clientWith(okPerm());
    await expect(getCallPermissions(client, { phoneNumberId: "555" } as never)).rejects.toThrow(GraphRequestValidationError);
  });

  test("rejects both userWaId and recipient (exactly-one rule)", async () => {
    const { client } = clientWith(okPerm());
    await expect(
      getCallPermissions(client, { phoneNumberId: "555", userWaId: "16505551234", recipient: "r1" })
    ).rejects.toThrow(GraphRequestValidationError);
  });

  test("rejects non-string/empty/whitespace/control-char userWaId", async () => {
    const { client } = clientWith(okPerm());
    for (const bad of ["", "   ", 123, {}, [], true, "bad\n", "bad\r", "bad\u0000", "bad\u007f"]) {
      await expect(
        getCallPermissions(client, { phoneNumberId: "555", userWaId: bad as never })
      ).rejects.toThrow(GraphRequestValidationError);
    }
  });

  test("rejects non-string/empty/whitespace/control-char recipient", async () => {
    const { client } = clientWith(okPerm());
    for (const bad of ["", "   ", 123, {}, [], true, "bad\n", "bad\u0000"]) {
      await expect(
        getCallPermissions(client, { phoneNumberId: "555", recipient: bad as never })
      ).rejects.toThrow(GraphRequestValidationError);
    }
  });

  test("a valid userWaId request does not throw", async () => {
    const { client } = clientWith(okPerm());
    let threw = false;
    try {
      await getCallPermissions(client, { phoneNumberId: "555", userWaId: "16505551234" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
