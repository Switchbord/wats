// WATS-41 RED — synthetic Calling webhook normalization and filters.
//
// Behavioral tests for calls-field normalization, malformed payload skip
// guarantees, descriptor/accessor safety, and minimal typed calling filter
// helpers. Uses synthetic payloads only; no live Meta webhook traffic.

import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope
} from "../src/webhookNormalizer";
import * as filtersTypedRoot from "../src/filtersTyped/index";

type TypedCallUpdate = {
  readonly kind: "callConnect" | "callTerminate";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly call: {
    readonly event: "connect" | "terminate";
    readonly direction?: "USER_INITIATED" | "BUSINESS_INITIATED";
    readonly session?: unknown;
  };
};
type TypedCallStatusUpdate = {
  readonly kind: "callStatus";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly callStatus: { readonly status: "RINGING" | "ACCEPTED" | "REJECTED" };
};

type CallFilterExports = typeof filtersTypedRoot & {
  call: {
    predicate(update: unknown): boolean;
    connect(): { predicate(update: unknown): boolean };
    terminate(): { predicate(update: unknown): boolean };
    status(): { predicate(update: unknown): boolean };
    answered(): { predicate(update: unknown): boolean };
    rejected(): { predicate(update: unknown): boolean };
    incoming(): { predicate(update: unknown): boolean };
    outgoing(): { predicate(update: unknown): boolean };
  };
};

const { call } = filtersTypedRoot as CallFilterExports;

function envelope(callsValue: Record<string, unknown>): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-CALLS",
        time: 1713697200,
        changes: [
          {
            field: "calls",
            value: callsValue
          }
        ]
      }
    ]
  };
}

const baseMetadata = {
  display_phone_number: "15550001111",
  phone_number_id: "1234567890"
};

describe("WATS-41 Calling webhook normalization", () => {
  test("value.calls connect and terminate entries produce typed call updates", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      calls: [
        {
          id: "call-connect-1",
          from: "15551234567",
          to: "15557654321",
          event: "connect",
          direction: "USER_INITIATED",
          timestamp: "1713697100",
          session: { sdp_type: "offer", sdp: "v=0\r\n" }
        },
        {
          id: "call-terminate-1",
          from: "15551234567",
          event: "terminate",
          direction: "BUSINESS_INITIATED",
          timestamp: "1713697101"
        }
      ]
    }));
    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(2);
    const connect = result.updates[0] as unknown as TypedCallUpdate;
    const terminate = result.updates[1] as unknown as TypedCallUpdate;
    expect(connect.kind).toBe("callConnect");
    expect(connect.updateId).toBe("call-connect-1");
    expect(connect.phoneNumberId).toBe("1234567890");
    expect(connect.call.event).toBe("connect");
    expect(connect.call.direction).toBe("USER_INITIATED");
    expect(connect.call.session).toEqual({ sdp_type: "offer", sdp: "v=0\r\n" });
    expect(terminate.kind).toBe("callTerminate");
    expect(terminate.call.event).toBe("terminate");
    expect(terminate.call.direction).toBe("BUSINESS_INITIATED");
  });

  test("value.statuses RINGING / ACCEPTED / REJECTED entries produce typed call status updates", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      statuses: [
        { id: "call-s1", recipient_id: "15551234567", status: "RINGING", timestamp: "1713697200" },
        { id: "call-s2", recipient_id: "15551234567", status: "ACCEPTED", timestamp: "1713697201" },
        { id: "call-s3", recipient_id: "15551234567", status: "REJECTED", timestamp: "1713697202" }
      ]
    }));
    expect(result.skipped.length).toBe(0);
    expect(result.updates.map((u) => u.kind)).toEqual(["callStatus", "callStatus", "callStatus"]);
    expect(result.updates.map((u) => (u as unknown as TypedCallStatusUpdate).callStatus.status)).toEqual([
      "RINGING",
      "ACCEPTED",
      "REJECTED"
    ]);
  });

  test("malformed calling payloads are skipped, not raw-thrown", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      calls: [
        null,
        { from: "15551234567", event: "connect" },
        { id: "call-bad-event", event: "hold" },
        { id: "call-bad-control\n", event: "terminate" }
      ],
      statuses: [
        null,
        { recipient_id: "15551234567", status: "RINGING" },
        { id: "call-bad-status", status: "COMPLETED" }
      ]
    }));
    expect(result.updates.length).toBe(0);
    expect(result.skipped.length).toBe(7);
    for (const skipped of result.skipped) {
      expect(skipped.reason).toBe("malformed_field");
      expect(skipped.path).toContain("value.");
    }
  });


  test("accessor-backed calling array entries and statuses are skipped without executing getters", () => {
    const calls: unknown[] = [];
    Object.defineProperty(calls, "0", { enumerable: true, get() { throw new Error("call getter should not run"); } });
    const statuses: unknown[] = [];
    Object.defineProperty(statuses, "0", { enumerable: true, get() { throw new Error("status getter should not run"); } });
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      calls,
      statuses
    }));
    expect(result.updates.length).toBe(0);
    expect(result.skipped.map((s) => s.detail)).toEqual(["call-not-an-object", "call-status-not-an-object"]);
  });

  test("metadata and nested accessor payloads are skipped without executing getters", () => {
    const badMetadata = {} as Record<string, unknown>;
    Object.defineProperty(badMetadata, "phone_number_id", {
      enumerable: true,
      get() { throw new Error("metadata getter should not run"); }
    });
    const result1 = normalizeWebhookEnvelope(envelope({ metadata: badMetadata, calls: [{ id: "call-1", event: "connect" }] }));
    expect(result1.updates.length).toBe(0);
    expect(result1.skipped[0]?.reason).toBe("malformed_field");

    const badCall = { id: "call-2" } as Record<string, unknown>;
    Object.defineProperty(badCall, "event", {
      enumerable: true,
      get() { throw new Error("call getter should not run"); }
    });
    const result2 = normalizeWebhookEnvelope(envelope({ metadata: baseMetadata, calls: [badCall] }));
    expect(result2.updates.length).toBe(0);
    expect(result2.skipped[0]?.reason).toBe("malformed_field");
  });
});

describe("WATS-41 typed calling filters", () => {
  test("call kind and event/status/direction helpers return strict booleans across sibling kinds", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      calls: [
        { id: "call-connect-1", event: "connect", direction: "USER_INITIATED", timestamp: "1" },
        { id: "call-terminate-1", event: "terminate", direction: "BUSINESS_INITIATED", timestamp: "2" }
      ],
      statuses: [
        { id: "call-s1", status: "ACCEPTED", timestamp: "3" },
        { id: "call-s2", status: "REJECTED", timestamp: "4" }
      ]
    }));
    const [connect, terminate, accepted, rejected] = result.updates;
    expect(call.predicate(connect!)).toBe(true);
    expect(call.connect().predicate(connect!)).toBe(true);
    expect(call.connect().predicate(terminate!)).toBe(false);
    expect(call.terminate().predicate(terminate!)).toBe(true);
    expect(call.status().predicate(accepted!)).toBe(true);
    expect(call.answered().predicate(accepted!)).toBe(true);
    expect(call.rejected().predicate(rejected!)).toBe(true);
    expect(call.incoming().predicate(connect!)).toBe(true);
    expect(call.outgoing().predicate(terminate!)).toBe(true);

    const messageResult = normalizeWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-MSG",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "123" },
                messages: [{ id: "wamid.1", from: "1555", type: "text", text: { body: "hi" } }]
              }
            }
          ]
        }
      ]
    });
    expect(call.connect().predicate(messageResult.updates[0]!)).toBe(false);
  });
});

describe("WATS-167 complete Calling webhook field normalization", () => {
  test("terminate call payload surfaces status/startTime/endTime/duration/bizOpaqueCallbackData/toUserId/toParentUserId/contacts in camelCase", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      calls: [
        {
          id: "call-term-full",
          from: "15551234567",
          to: "15557654321",
          event: "terminate",
          direction: "BUSINESS_INITIATED",
          timestamp: "1713697101",
          status: "COMPLETED",
          start_time: "1713697100",
          end_time: "1713697101",
          duration: 42,
          biz_opaque_callback_data: "opaque-xyz",
          to_user_id: "to-uid-1",
          to_parent_user_id: "to-puid-1",
          contacts: [
            { name: "Alice", username: "alice", wa_id: "wa-1", user_id: "u-1", parent_user_id: "p-1" },
            { name: "Bob", wa_id: "wa-2" }
          ]
        }
      ]
    }));
    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(1);
    const update = result.updates[0] as unknown as { kind: string; call: Record<string, unknown> };
    expect(update.kind).toBe("callTerminate");
    const call = update.call;
    expect(call.status).toBe("COMPLETED");
    expect(call.startTime).toBe("1713697100");
    expect(call.endTime).toBe("1713697101");
    expect(call.duration).toBe(42);
    expect(call.bizOpaqueCallbackData).toBe("opaque-xyz");
    expect(call.toUserId).toBe("to-uid-1");
    expect(call.toParentUserId).toBe("to-puid-1");
    expect(Array.isArray(call.contacts)).toBe(true);
    const contacts = call.contacts as ReadonlyArray<Record<string, unknown>>;
    expect(contacts.length).toBe(2);
    expect(contacts[0]).toEqual({
      name: "Alice",
      username: "alice",
      waId: "wa-1",
      userId: "u-1",
      parentUserId: "p-1",
      raw: { name: "Alice", username: "alice", wa_id: "wa-1", user_id: "u-1", parent_user_id: "p-1" }
    });
    expect(contacts[1].waId).toBe("wa-2");
    expect(contacts[1].name).toBe("Bob");
    expect(contacts[1].raw).toEqual({ name: "Bob", wa_id: "wa-2" });
    // snake_case must NOT exist on the public normalized payload (only in raw)
    expect(call.start_time).toBeUndefined();
    expect(call.end_time).toBeUndefined();
    expect(call.biz_opaque_callback_data).toBeUndefined();
    expect(call.to_user_id).toBeUndefined();
    expect(call.to_parent_user_id).toBeUndefined();
    expect("recipient_user_id" in call).toBe(false);
    // raw preserved unchanged
    const raw = call.raw as Record<string, unknown>;
    expect(raw.start_time).toBe("1713697100");
    expect(raw.biz_opaque_callback_data).toBe("opaque-xyz");
    expect(raw.contacts).toEqual([
      { name: "Alice", username: "alice", wa_id: "wa-1", user_id: "u-1", parent_user_id: "p-1" },
      { name: "Bob", wa_id: "wa-2" }
    ]);
  });

  test("connect call payload surfaces toUserId/toParentUserId/contacts/bizOpaqueCallbackData and WATS-170 button/deep-link payloads", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      calls: [
        {
          id: "call-connect-full",
          event: "connect",
          direction: "USER_INITIATED",
          timestamp: "1713697100",
          to_user_id: "to-uid-c",
          to_parent_user_id: "to-puid-c",
          biz_opaque_callback_data: "opaque-connect",
          cta_payload: "button-payload",
          deeplink_payload: "deep-payload",
          contacts: [{ wa_id: "wa-c" }]
        }
      ]
    }));
    expect(result.skipped.length).toBe(0);
    const call = (result.updates[0] as unknown as { call: Record<string, unknown> }).call;
    expect(call.toUserId).toBe("to-uid-c");
    expect(call.toParentUserId).toBe("to-puid-c");
    expect(call.bizOpaqueCallbackData).toBe("opaque-connect");
    expect(call.ctaPayload).toBe("button-payload");
    expect(call.deeplinkPayload).toBe("deep-payload");
    expect(call.cta_payload).toBeUndefined();
    expect(call.deeplink_payload).toBeUndefined();
    const contacts = call.contacts as ReadonlyArray<Record<string, unknown>>;
    expect(contacts.length).toBe(1);
    expect(contacts[0].waId).toBe("wa-c");
  });

  test("call status payload surfaces recipientUserId/recipientParentUserId/bizOpaqueCallbackData in camelCase", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      statuses: [
        {
          id: "call-status-full",
          recipient_id: "15551234567",
          status: "RINGING",
          timestamp: "1713697200",
          recipient_user_id: "r-uid-1",
          recipient_parent_user_id: "r-puid-1",
          biz_opaque_callback_data: "opaque-status"
        }
      ]
    }));
    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(1);
    const st = (result.updates[0] as unknown as { callStatus: Record<string, unknown> }).callStatus;
    expect(st.recipientUserId).toBe("r-uid-1");
    expect(st.recipientParentUserId).toBe("r-puid-1");
    expect(st.bizOpaqueCallbackData).toBe("opaque-status");
    // snake_case absent on the public payload
    expect(st.recipient_user_id).toBeUndefined();
    expect(st.recipient_parent_user_id).toBeUndefined();
    expect(st.biz_opaque_callback_data).toBeUndefined();
    // raw preserved
    const raw = st.raw as Record<string, unknown>;
    expect(raw.recipient_user_id).toBe("r-uid-1");
  });

  test("call_permission_reply message surfaces fromUserId/fromParentUserId in camelCase", () => {
    const result = normalizeWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-PERM",
          time: 1713697200,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: baseMetadata,
                messages: [
                  {
                    id: "wamid.perm",
                    from: "15551234567",
                    timestamp: "1713697200",
                    type: "interactive",
                    from_user_id: "from-uid-1",
                    from_parent_user_id: "from-puid-1",
                    interactive: {
                      type: "call_permission_reply",
                      call_permission_reply: {
                        response: "accept",
                        is_permanent: true,
                        response_source: "user_action"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(1);
    const msg = (result.updates[0] as unknown as { message: Record<string, unknown> }).message;
    expect(msg.fromUserId).toBe("from-uid-1");
    expect(msg.fromParentUserId).toBe("from-puid-1");
    const interactive = msg.interactive as Record<string, unknown>;
    expect(interactive.type).toBe("call_permission_reply");
    const reply = interactive.callPermissionReply as Record<string, unknown>;
    expect(reply.response).toBe("accept");
    expect(reply.isPermanent).toBe(true);
    // snake_case absent on the public payload
    expect(msg.from_user_id).toBeUndefined();
    expect(msg.from_parent_user_id).toBeUndefined();
    // raw preserved
    const raw = msg.raw as Record<string, unknown>;
    expect(raw.from_user_id).toBe("from-uid-1");
  });

  test("malformed optional calling fields are skipped safely without throwing", () => {
    const badContactsElement = { wa_id: "ok" } as Record<string, unknown>;
    Object.defineProperty(badContactsElement, "user_id", {
      enumerable: true,
      get() { throw new Error("contact getter should not run"); }
    });
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      calls: [
        {
          id: "call-malformed-opt",
          event: "terminate",
          timestamp: "1713697101",
          status: 123,                    // non-string -> omitted
          start_time: 456,                // non-string -> omitted
          end_time: null,                 // non-string -> omitted
          duration: "not-a-number",       // non-number -> omitted
          biz_opaque_callback_data: 789,  // non-string -> omitted
          to_user_id: "to-uid-ok",
          to_parent_user_id: "to-puid-ok",
          contacts: "not-an-array",       // not array -> omitted
          session: { ok: true }
        },
        {
          id: "call-malformed-contacts",
          event: "connect",
          timestamp: "1713697102",
          contacts: [
            null,
            "not-an-object",
            badContactsElement,           // accessor getter must not execute; wa_id still read safely
            { name: "Carol", wa_id: "wa-3" }
          ]
        }
      ]
    }));
    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(2);
    const call0 = (result.updates[0] as unknown as { call: Record<string, unknown> }).call;
    expect(call0.status).toBeUndefined();
    expect(call0.startTime).toBeUndefined();
    expect(call0.endTime).toBeUndefined();
    expect(call0.duration).toBeUndefined();
    expect(call0.bizOpaqueCallbackData).toBeUndefined();
    expect(call0.toUserId).toBe("to-uid-ok");
    expect(call0.toParentUserId).toBe("to-puid-ok");
    expect(call0.contacts).toBeUndefined();
    expect(call0.session).toEqual({ ok: true });

    const call1 = (result.updates[1] as unknown as { call: Record<string, unknown> }).call;
    const contacts1 = call1.contacts as ReadonlyArray<Record<string, unknown>>;
    expect(Array.isArray(contacts1)).toBe(true);
    // null and "not-an-object" skipped; badContactsElement wa_id read without throwing; Carol kept
    expect(contacts1.length).toBe(2);
    expect(contacts1[0].waId).toBe("ok");
    expect(contacts1[0].userId).toBeUndefined();
    expect(contacts1[1].name).toBe("Carol");
    expect(contacts1[1].waId).toBe("wa-3");
  });

  test("malformed status optional fields are skipped safely", () => {
    const result = normalizeWebhookEnvelope(envelope({
      messaging_product: "whatsapp",
      metadata: baseMetadata,
      statuses: [
        {
          id: "call-status-malformed",
          recipient_id: "15551234567",
          status: "ACCEPTED",
          timestamp: "1713697200",
          recipient_user_id: 123,          // non-safe -> omitted
          recipient_parent_user_id: "   ", // whitespace -> omitted
          biz_opaque_callback_data: null   // non-string -> omitted
        }
      ]
    }));
    expect(result.skipped.length).toBe(0);
    const st = (result.updates[0] as unknown as { callStatus: Record<string, unknown> }).callStatus;
    expect(st.recipientUserId).toBeUndefined();
    expect(st.recipientParentUserId).toBeUndefined();
    expect(st.bizOpaqueCallbackData).toBeUndefined();
    expect(st.recipientId).toBe("15551234567");
  });

  test("call_permission_reply message without from_user_id still normalizes and omits fields", () => {
    const result = normalizeWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-PERM2",
          time: 1713697200,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: baseMetadata,
                messages: [
                  {
                    id: "wamid.perm2",
                    from: "15551234567",
                    timestamp: "1713697200",
                    type: "interactive",
                    from_user_id: 99,          // non-safe -> omitted
                    from_parent_user_id: "   ", // whitespace -> omitted
                    interactive: {
                      type: "call_permission_reply",
                      call_permission_reply: { response: "reject" }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(1);
    const msg = (result.updates[0] as unknown as { message: Record<string, unknown> }).message;
    expect(msg.fromUserId).toBeUndefined();
    expect(msg.fromParentUserId).toBeUndefined();
    expect(msg.from_user_id).toBeUndefined();
  });
});
