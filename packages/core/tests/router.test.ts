import { describe, expect, test } from "bun:test";
import {
  DEFAULT_UPDATE_ROUTER_LIMITS,
  createUpdateRouter,
  type ParsedUpdateEvent
} from "../src/router";

function buildEvent(input: {
  field: string;
  subtype?: string;
  eventType?: string;
}): ParsedUpdateEvent {
  return {
    object: "whatsapp_business_account",
    discriminator: {
      field: input.field,
      subtype: input.subtype,
      eventType: input.eventType ?? (input.subtype ? `${input.field}.${input.subtype}` : input.field)
    },
    entry: {
      index: 0,
      id: "entry-1",
      time: 1713697200
    },
    change: {
      index: 0,
      value: {}
    },
    raw: {
      entry: {},
      change: {}
    }
  };
}

describe("C2 update router", () => {
  test("uses finite secure defaults for router limits", () => {
    expect(Number.isFinite(DEFAULT_UPDATE_ROUTER_LIMITS.maxHandlersPerEvent)).toBe(true);
    expect(Number.isInteger(DEFAULT_UPDATE_ROUTER_LIMITS.maxHandlersPerEvent)).toBe(true);
    expect(DEFAULT_UPDATE_ROUTER_LIMITS.maxHandlersPerEvent).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches)).toBe(true);
    expect(Number.isInteger(DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches)).toBe(true);
    expect(DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches).toBeGreaterThan(0);
  });

  test("enforces default maxHandlersPerEvent when exceeded", async () => {
    const router = createUpdateRouter();
    let calls = 0;
    const handlerCount = DEFAULT_UPDATE_ROUTER_LIMITS.maxHandlersPerEvent + 2;

    for (let index = 0; index < handlerCount; index += 1) {
      router.on({ field: "messages" }, () => {
        calls += 1;
      });
    }

    const summary = await router.dispatch([buildEvent({ field: "messages" })]);

    expect(summary.capped).toBe(true);
    expect(summary.aborted).toBe(false);
    expect(summary.limitError?.code).toBe("handlers_per_event_limit_exceeded");
    expect(summary.matchedHandlers).toBe(handlerCount);
    expect(summary.executedHandlers).toBe(DEFAULT_UPDATE_ROUTER_LIMITS.maxHandlersPerEvent);
    expect(calls).toBe(DEFAULT_UPDATE_ROUTER_LIMITS.maxHandlersPerEvent);
  });

  test("aborts on default maxDispatches when exceeded", async () => {
    const router = createUpdateRouter();
    let calls = 0;

    router.on({ field: "messages" }, () => {
      calls += 1;
    });

    const events = Array.from(
      { length: DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches + 1 },
      () => buildEvent({ field: "messages" })
    );

    const summary = await router.dispatch(events);

    expect(summary.capped).toBe(true);
    expect(summary.aborted).toBe(true);
    expect(summary.limitError?.code).toBe("dispatches_limit_exceeded");
    expect(summary.executedHandlers).toBe(DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches);
    expect(summary.matchedHandlers).toBe(DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches + 1);
    expect(calls).toBe(DEFAULT_UPDATE_ROUTER_LIMITS.maxDispatches);
  });

  test("registers handlers and dispatches only matching routes", async () => {
    const router = createUpdateRouter();
    const calls: string[] = [];

    router.on({ field: "messages" }, () => {
      calls.push("messages:all");
    });

    router.on({ field: "messages", subtype: "message_status" }, () => {
      calls.push("messages:status");
    });

    const summary = await router.dispatch([
      buildEvent({ field: "messages" }),
      buildEvent({ field: "messages", subtype: "message_status" })
    ]);

    expect(calls).toEqual(["messages:all", "messages:all", "messages:status"]);
    expect(summary.totalEvents).toBe(2);
    expect(summary.matchedHandlers).toBe(3);
    expect(summary.executedHandlers).toBe(3);
    expect(summary.failedHandlers).toBe(0);
    expect(summary.unmatchedEvents).toBe(0);
    expect(summary.capped).toBe(false);
    expect(summary.aborted).toBe(false);
  });

  test("dispatches multiple handlers in deterministic registration order", async () => {
    const router = createUpdateRouter();
    const calls: string[] = [];

    router.on({ field: "messages" }, () => {
      calls.push("first");
    });

    router.on({ field: "messages" }, () => {
      calls.push("second");
    });

    router.on({ field: "messages" }, () => {
      calls.push("third");
    });

    const summary = await router.dispatch([buildEvent({ field: "messages" })]);

    expect(calls).toEqual(["first", "second", "third"]);
    expect(summary.matchedHandlers).toBe(3);
    expect(summary.executedHandlers).toBe(3);
  });

  test("preserves deterministic order across indexed field and subtype routes", async () => {
    const router = createUpdateRouter();
    const calls: string[] = [];

    router.on({ field: "messages", subtype: "message_status" }, () => {
      calls.push("status-first");
    });

    router.on({ field: "messages" }, () => {
      calls.push("field-second");
    });

    router.on({ field: "messages", subtype: "message_status" }, () => {
      calls.push("status-third");
    });

    await router.dispatch([buildEvent({ field: "messages", subtype: "message_status" })]);

    expect(calls).toEqual(["status-first", "field-second", "status-third"]);
  });

  test("returns no-handler summary when no routes match", async () => {
    const router = createUpdateRouter();

    router.on({ field: "messages", subtype: "message_status" }, () => {});

    const summary = await router.dispatch([buildEvent({ field: "message_template_status_update" })]);

    expect(summary.totalEvents).toBe(1);
    expect(summary.matchedHandlers).toBe(0);
    expect(summary.executedHandlers).toBe(0);
    expect(summary.failedHandlers).toBe(0);
    expect(summary.unmatchedEvents).toBe(1);
    expect(summary.errors).toEqual([]);
  });

  test("accounts for handler failures and continues dispatch", async () => {
    const router = createUpdateRouter();
    const calls: string[] = [];

    router.on({ field: "messages" }, () => {
      calls.push("before-error");
      throw new Error("boom");
    });

    router.on({ field: "messages" }, () => {
      calls.push("after-error");
    });

    const summary = await router.dispatch([buildEvent({ field: "messages" })]);

    expect(calls).toEqual(["before-error", "after-error"]);
    expect(summary.matchedHandlers).toBe(2);
    expect(summary.executedHandlers).toBe(1);
    expect(summary.failedHandlers).toBe(1);
    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0]?.field).toBe("messages");
    expect(summary.errors[0]?.handlerIndex).toBe(0);
  });

  test("aborts dispatch when maxDispatches limit is exceeded", async () => {
    const router = createUpdateRouter({ maxDispatches: 2 });
    const calls: string[] = [];

    router.on({ field: "messages" }, () => {
      calls.push("first");
    });

    router.on({ field: "messages" }, () => {
      calls.push("second");
    });

    router.on({ field: "messages" }, () => {
      calls.push("third");
    });

    const summary = await router.dispatch([buildEvent({ field: "messages" })]);

    expect(calls).toEqual(["first", "second"]);
    expect(summary.capped).toBe(true);
    expect(summary.aborted).toBe(true);
    expect(summary.limitError?.code).toBe("dispatches_limit_exceeded");
    expect(summary.executedHandlers).toBe(2);
  });

  test("caps handlers per event when maxHandlersPerEvent limit is set", async () => {
    const router = createUpdateRouter({ maxHandlersPerEvent: 1 });
    const calls: string[] = [];

    router.on({ field: "messages" }, () => {
      calls.push("all");
    });

    router.on({ field: "messages", subtype: "message_status" }, () => {
      calls.push("status");
    });

    const summary = await router.dispatch([buildEvent({ field: "messages", subtype: "message_status" })]);

    expect(calls).toEqual(["all"]);
    expect(summary.capped).toBe(true);
    expect(summary.aborted).toBe(false);
    expect(summary.limitError?.code).toBe("handlers_per_event_limit_exceeded");
    expect(summary.matchedHandlers).toBe(2);
    expect(summary.executedHandlers).toBe(1);
  });
});
