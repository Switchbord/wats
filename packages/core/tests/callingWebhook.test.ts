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
