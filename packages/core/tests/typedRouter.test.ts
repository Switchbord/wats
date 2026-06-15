// packages/core/tests/typedRouter.test.ts (F-10 RED)
//
// Exhaustive coverage of TypedRouter:
//   - Construction validation
//   - Handle-based registration + ordering guarantee (WATS-10 L4)
//   - Filter-aware dispatch
//   - Observer hooks (onBefore/onAfter/onMatch/onError) — WATS-15 A3
//   - Error collection in DispatchReport (no re-throw)
//   - "stop" handler return halts dispatch
//   - Snapshot-semantics unregister during dispatch
//   - clear()
//   - Sequential vs parallel concurrency
//   - Dispatch-id uniqueness and factory injection
//   - maxHandlersPerDispatch cap

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_HANDLERS_PER_DISPATCH,
  TypedRouter,
  TypedRouterOptionsError,
  type DispatchReport,
  type Handler,
  type HandlerContext,
  type RegistrationHandle,
  type RouterObserver
} from "../src/typedRouter";
import {
  createListenerRegistry,
  type ListenerRegistry
} from "../src/listener";
import {
  and,
  createTypedFilter,
  custom,
  message,
  status
} from "../src/filtersTyped/index";
import type {
  TypedMessageUpdate,
  TypedStatusUpdate,
  TypedUpdate
} from "../src/webhookNormalizer";

// --- synthetic TypedUpdate factories (no MockTransport — router does
// --- not touch the network) ------------------------------------------

function makeMessageUpdate(overrides: {
  id?: string;
  body?: string;
  from?: string;
} = {}): TypedMessageUpdate {
  const id = overrides.id ?? "wamid.M1";
  const body = overrides.body ?? "hello world";
  const from = overrides.from ?? "15551234567";
  return {
    kind: "message",
    updateId: id,
    phoneNumberId: "1234567890",
    wabaId: "WABA-X",
    receivedAt: 1_713_697_100_000,
    message: {
      from,
      id,
      timestamp: "1713697100",
      type: "text",
      text: { body }
    } as TypedMessageUpdate["message"],
    rawChange: {
      field: "messages",
      value: { messaging_product: "whatsapp", metadata: {}, messages: [] }
    } as TypedMessageUpdate["rawChange"]
  };
}

function makeStatusUpdate(
  statusName: "sent" | "delivered" | "read" | "failed" = "delivered"
): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: "wamid.S1",
    phoneNumberId: "1234567890",
    wabaId: "WABA-X",
    receivedAt: 1_713_697_200_000,
    status: {
      id: "wamid.S1",
      recipientId: "15551234567",
      status: statusName,
      timestamp: "1713697200"
    },
    rawChange: {
      field: "messages",
      value: { messaging_product: "whatsapp", metadata: {}, statuses: [] }
    } as TypedStatusUpdate["rawChange"]
  };
}

// =====================================================================
// Construction
// =====================================================================

describe("TypedRouter construction", () => {
  test("zero-arg construction succeeds", () => {
    const r = new TypedRouter();
    expect(r).toBeInstanceOf(TypedRouter);
    expect(r.handlerCount).toBe(0);
  });

  test("options with observer containing non-function hooks throws", () => {
    expect(() =>
      new TypedRouter({
        observer: { onBeforeDispatch: 5 as unknown as () => void }
      })
    ).toThrow(TypedRouterOptionsError);
  });

  test("maxHandlersPerDispatch must be a positive integer", () => {
    expect(() => new TypedRouter({ maxHandlersPerDispatch: 0 })).toThrow(
      TypedRouterOptionsError
    );
    expect(() => new TypedRouter({ maxHandlersPerDispatch: -5 })).toThrow(
      TypedRouterOptionsError
    );
    expect(() => new TypedRouter({ maxHandlersPerDispatch: 1.5 })).toThrow(
      TypedRouterOptionsError
    );
    expect(
      () =>
        new TypedRouter({
          maxHandlersPerDispatch: "10" as unknown as number
        })
    ).toThrow(TypedRouterOptionsError);
  });

  test("concurrency enum rejects unknown values", () => {
    expect(
      () =>
        new TypedRouter({
          concurrency: "race" as unknown as "sequential"
        })
    ).toThrow(TypedRouterOptionsError);
  });

  test("dispatchIdFactory must be a function if present", () => {
    expect(
      () =>
        new TypedRouter({
          dispatchIdFactory: "nope" as unknown as () => string
        })
    ).toThrow(TypedRouterOptionsError);
  });

  test("non-object options throws", () => {
    expect(
      () => new TypedRouter("bad" as unknown as Record<string, never>)
    ).toThrow(TypedRouterOptionsError);
  });

  test("DEFAULT_MAX_HANDLERS_PER_DISPATCH constant is 10_000", () => {
    expect(DEFAULT_MAX_HANDLERS_PER_DISPATCH).toBe(10_000);
  });
});

// =====================================================================
// Registration + handle semantics
// =====================================================================

describe("TypedRouter registration", () => {
  test("on(filter, handler) returns a RegistrationHandle", () => {
    const r = new TypedRouter();
    const handle = r.on(message, () => {});
    expect(typeof handle.id).toBe("symbol");
    expect(typeof handle.unregister).toBe("function");
    expect(handle.registered).toBe(true);
    expect(handle.registrationIndex).toBe(0);
    expect(r.handlerCount).toBe(1);
  });

  test("handles have unique symbol ids", () => {
    const r = new TypedRouter();
    const h1 = r.on(message, () => {});
    const h2 = r.on(message, () => {});
    expect(h1.id).not.toBe(h2.id);
    expect(h2.registrationIndex).toBe(1);
  });

  test("on() rejects non-filter arg with TypedRouterOptionsError", () => {
    const r = new TypedRouter();
    expect(() =>
      r.on({} as unknown as typeof message, () => {})
    ).toThrow(TypedRouterOptionsError);
  });

  test("on() rejects non-function handler", () => {
    const r = new TypedRouter();
    expect(() =>
      r.on(message, "not-a-function" as unknown as Handler<TypedMessageUpdate>)
    ).toThrow(TypedRouterOptionsError);
  });

  test("unregister() flips handle.registered to false and drops from count", () => {
    const r = new TypedRouter();
    const h = r.on(message, () => {});
    expect(r.handlerCount).toBe(1);
    h.unregister();
    expect(h.registered).toBe(false);
    expect(r.handlerCount).toBe(0);
  });

  test("unregister() is idempotent", () => {
    const r = new TypedRouter();
    const h = r.on(message, () => {});
    h.unregister();
    h.unregister();
    expect(h.registered).toBe(false);
    expect(r.handlerCount).toBe(0);
  });

  test("clear() removes all handlers", () => {
    const r = new TypedRouter();
    r.on(message, () => {});
    r.on(status, () => {});
    r.on(message, () => {});
    expect(r.handlerCount).toBe(3);
    r.clear();
    expect(r.handlerCount).toBe(0);
  });
});

// =====================================================================
// Dispatch — ordering + filter matching
// =====================================================================

describe("TypedRouter dispatch — ordering + matching", () => {
  test("single matching handler fires and report reflects it", async () => {
    const r = new TypedRouter();
    const calls: string[] = [];
    r.on(message, (ctx) => {
      calls.push(`msg:${ctx.update.updateId}`);
    });
    const report = await r.dispatch(makeMessageUpdate({ id: "wamid.X" }));
    expect(calls).toEqual(["msg:wamid.X"]);
    expect(report.matchedHandlers).toBe(1);
    expect(report.errors).toEqual([]);
    expect(report.stopped).toBe(false);
    expect(typeof report.dispatchId).toBe("string");
    expect(report.dispatchId.length).toBeGreaterThan(0);
  });

  test("handlers fire in REGISTRATION ORDER (WATS-10 L4)", async () => {
    const r = new TypedRouter();
    const order: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const idx = i;
      r.on(message, () => {
        order.push(idx);
      });
    }
    await r.dispatch(makeMessageUpdate());
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  test("only matching handlers fire; non-matching are skipped", async () => {
    const r = new TypedRouter();
    const hits: string[] = [];
    r.on(message, () => {
      hits.push("msg-1");
    });
    r.on(status, () => {
      hits.push("status-1");
    });
    r.on(message, () => {
      hits.push("msg-2");
    });
    r.on(status, () => {
      hits.push("status-2");
    });
    await r.dispatch(makeMessageUpdate());
    // Sibling-kind: status handlers must NOT fire on a message update.
    expect(hits).toEqual(["msg-1", "msg-2"]);
  });

  test("filter uses predicate (text match)", async () => {
    const r = new TypedRouter();
    const hits: string[] = [];
    r.on(and(message, message.textMatches(/hello/i)), () => {
      hits.push("hello");
    });
    r.on(and(message, message.textMatches(/goodbye/i)), () => {
      hits.push("bye");
    });
    await r.dispatch(makeMessageUpdate({ body: "Hello there" }));
    expect(hits).toEqual(["hello"]);
  });

  test("report.matchedHandlers counts only matching", async () => {
    const r = new TypedRouter();
    r.on(message, () => {});
    r.on(status, () => {});
    r.on(message, () => {});
    const report = await r.dispatch(makeMessageUpdate());
    expect(report.matchedHandlers).toBe(2);
  });

  test("sibling-class: status update with message-filter registrations fires nothing", async () => {
    const r = new TypedRouter();
    let fired = 0;
    r.on(message, () => {
      fired += 1;
    });
    r.on(message.textMatches(/x/), () => {
      fired += 1;
    });
    const report = await r.dispatch(makeStatusUpdate());
    expect(fired).toBe(0);
    expect(report.matchedHandlers).toBe(0);
  });
});

// =====================================================================
// Error collection
// =====================================================================

describe("TypedRouter dispatch — error collection", () => {
  test("throwing handler is captured in report.errors; other handlers still fire", async () => {
    const r = new TypedRouter();
    const calls: string[] = [];
    r.on(message, () => {
      calls.push("before");
    });
    const bad = r.on(message, () => {
      throw new Error("boom");
    });
    r.on(message, () => {
      calls.push("after");
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(calls).toEqual(["before", "after"]);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]?.handleId).toBe(bad.id);
    expect((report.errors[0]?.error as Error).message).toBe("boom");
    expect(report.matchedHandlers).toBe(3);
  });

  test("dispatch() resolves even when every handler throws", async () => {
    const r = new TypedRouter();
    r.on(message, () => {
      throw new Error("a");
    });
    r.on(message, () => {
      throw new Error("b");
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(report.errors.length).toBe(2);
  });

  test("async handler rejection is captured", async () => {
    const r = new TypedRouter();
    r.on(message, async () => {
      throw new Error("async-boom");
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(report.errors.length).toBe(1);
    expect((report.errors[0]?.error as Error).message).toBe("async-boom");
  });
});

// =====================================================================
// Stop semantics
// =====================================================================

describe("TypedRouter dispatch — stop", () => {
  test("handler returning 'stop' halts further matching handlers", async () => {
    const r = new TypedRouter();
    const calls: string[] = [];
    r.on(message, () => {
      calls.push("1");
    });
    r.on(message, () => {
      calls.push("2");
      return "stop" as const;
    });
    r.on(message, () => {
      calls.push("3");
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(calls).toEqual(["1", "2"]);
    expect(report.stopped).toBe(true);
  });

  test("async handler resolving to 'stop' halts dispatch", async () => {
    const r = new TypedRouter();
    const calls: string[] = [];
    r.on(message, async () => {
      calls.push("1");
      return "stop" as const;
    });
    r.on(message, () => {
      calls.push("2");
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(calls).toEqual(["1"]);
    expect(report.stopped).toBe(true);
  });
});

// =====================================================================
// Observer hooks
// =====================================================================

describe("TypedRouter observer seams (WATS-15 A3)", () => {
  test("onBeforeDispatch / onAfterDispatch fire with same dispatchId", async () => {
    const observed: string[] = [];
    let beforeId = "";
    let afterId = "";
    let afterReport: DispatchReport | undefined;
    const observer: RouterObserver = {
      onBeforeDispatch: (id) => {
        beforeId = id;
        observed.push("before");
      },
      onAfterDispatch: (id, report) => {
        afterId = id;
        afterReport = report;
        observed.push("after");
      }
    };
    const r = new TypedRouter({ observer });
    r.on(message, () => {});
    await r.dispatch(makeMessageUpdate());
    expect(observed).toEqual(["before", "after"]);
    expect(beforeId).toBe(afterId);
    expect(afterReport).toBeDefined();
  });

  test("onHandlerMatch fires for each matching handler, NOT for non-matching", async () => {
    const matched: number[] = [];
    const observer: RouterObserver = {
      onHandlerMatch: (_id, handle) => {
        matched.push(handle.registrationIndex);
      }
    };
    const r = new TypedRouter({ observer });
    r.on(message, () => {}); // index 0
    r.on(status, () => {}); // index 1 — should NOT match
    r.on(message, () => {}); // index 2
    await r.dispatch(makeMessageUpdate());
    expect(matched).toEqual([0, 2]);
  });

  test("onHandlerError fires when a handler throws", async () => {
    const errors: Array<{ idx: number; msg: string }> = [];
    const observer: RouterObserver = {
      onHandlerError: (_id, handle, error) => {
        errors.push({
          idx: handle.registrationIndex,
          msg: (error as Error).message
        });
      }
    };
    const r = new TypedRouter({ observer });
    r.on(message, () => {
      throw new Error("X");
    });
    r.on(message, () => {});
    await r.dispatch(makeMessageUpdate());
    expect(errors).toEqual([{ idx: 0, msg: "X" }]);
  });
});

// =====================================================================
// Snapshot semantics during unregister
// =====================================================================

describe("TypedRouter unregister-during-dispatch snapshot semantics", () => {
  test("handler unregistered mid-dispatch still fires for THAT dispatch", async () => {
    const r = new TypedRouter();
    const calls: string[] = [];
    let h2: RegistrationHandle | undefined;
    r.on(message, () => {
      calls.push("1");
      h2?.unregister();
    });
    h2 = r.on(message, () => {
      calls.push("2");
    });
    r.on(message, () => {
      calls.push("3");
    });
    await r.dispatch(makeMessageUpdate());
    // Snapshot semantics — H2 is part of the snapshot so it still runs.
    expect(calls).toEqual(["1", "2", "3"]);
    // But for the NEXT dispatch, H2 is gone.
    calls.length = 0;
    await r.dispatch(makeMessageUpdate());
    expect(calls).toEqual(["1", "3"]);
  });

  test("new on() during dispatch does NOT fire in current dispatch", async () => {
    const r = new TypedRouter();
    const calls: string[] = [];
    r.on(message, () => {
      calls.push("1");
      r.on(message, () => {
        calls.push("late");
      });
    });
    r.on(message, () => {
      calls.push("2");
    });
    await r.dispatch(makeMessageUpdate());
    expect(calls).toEqual(["1", "2"]); // "late" runs on NEXT dispatch only
  });
});

// =====================================================================
// Concurrency
// =====================================================================

describe("TypedRouter concurrency modes", () => {
  test("sequential (default): handlers awaited in order", async () => {
    const r = new TypedRouter();
    const order: string[] = [];
    r.on(message, async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("a-end");
    });
    r.on(message, async () => {
      order.push("b-start");
    });
    await r.dispatch(makeMessageUpdate());
    expect(order).toEqual(["a-end", "b-start"]);
  });

  test("parallel: handlers fire concurrently; all errors collected", async () => {
    const r = new TypedRouter({ concurrency: "parallel" });
    const order: string[] = [];
    r.on(message, async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("a-end");
    });
    r.on(message, async () => {
      order.push("b-start");
      throw new Error("b-boom");
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(order).toContain("a-end");
    expect(order).toContain("b-start");
    expect(report.errors.length).toBe(1);
  });
});

// =====================================================================
// Dispatch ID
// =====================================================================

describe("TypedRouter dispatch-id", () => {
  test("each dispatch has a unique id by default", async () => {
    const r = new TypedRouter();
    r.on(message, () => {});
    const a = await r.dispatch(makeMessageUpdate());
    const b = await r.dispatch(makeMessageUpdate());
    expect(a.dispatchId).not.toBe(b.dispatchId);
  });

  test("custom dispatchIdFactory is honored", async () => {
    let n = 0;
    const r = new TypedRouter({
      dispatchIdFactory: () => `dsp-${(n += 1)}`
    });
    r.on(message, () => {});
    const a = await r.dispatch(makeMessageUpdate());
    const b = await r.dispatch(makeMessageUpdate());
    expect(a.dispatchId).toBe("dsp-1");
    expect(b.dispatchId).toBe("dsp-2");
  });
});

// =====================================================================
// max-handlers cap
// =====================================================================

describe("TypedRouter maxHandlersPerDispatch cap", () => {
  test("dispatch halts at the cap; report.capped = true", async () => {
    const r = new TypedRouter({ maxHandlersPerDispatch: 2 });
    const order: number[] = [];
    r.on(message, () => {
      order.push(0);
    });
    r.on(message, () => {
      order.push(1);
    });
    r.on(message, () => {
      order.push(2);
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(order).toEqual([0, 1]);
    expect(report.capped).toBe(true);
    expect(report.matchedHandlers).toBe(2);
  });
});

// =====================================================================
// End-to-end composition smoke
// =====================================================================

describe("TypedRouter composition smoke", () => {
  test("custom() predicate filter integrates", async () => {
    const r = new TypedRouter();
    const calls: string[] = [];
    const fromBob = custom<TypedMessageUpdate>(
      (u): u is TypedMessageUpdate =>
        u.kind === "message" && u.message.from === "bob",
      "from=bob"
    );
    r.on(fromBob, (ctx) => {
      calls.push(ctx.update.message.from);
    });
    await r.dispatch(makeMessageUpdate({ from: "alice" }));
    expect(calls).toEqual([]);
    await r.dispatch(makeMessageUpdate({ from: "bob" }));
    expect(calls).toEqual(["bob"]);
  });

  test("HandlerContext exposes update + registrationIndex + dispatchId", async () => {
    const r = new TypedRouter();
    const captured: HandlerContext<TypedMessageUpdate>[] = [];
    r.on(message, (ctx) => {
      captured.push(ctx);
    });
    r.on(message, (ctx) => {
      captured.push(ctx);
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(captured.length).toBe(2);
    expect(captured[0]?.dispatchId).toBe(report.dispatchId);
    expect(captured[1]?.dispatchId).toBe(report.dispatchId);
    expect(captured[0]?.registrationIndex).toBe(0);
    expect(captured[1]?.registrationIndex).toBe(1);
    expect(captured[0]?.update.kind).toBe("message");
  });

  test("broadened-T filter via createTypedFilter dispatches correctly", async () => {
    const r = new TypedRouter();
    const anyAny = createTypedFilter<TypedUpdate>(
      (u): u is TypedUpdate => true,
      () => "any"
    );
    let n = 0;
    r.on(anyAny, () => {
      n += 1;
    });
    await r.dispatch(makeMessageUpdate());
    await r.dispatch(makeStatusUpdate());
    expect(n).toBe(2);
  });
});

// --- F-10 remediation (WATS-29) --------------------------------------
//
// Two adversarial blockers:
//   B1: observer-throw cascade — any observer hook that throws currently
//       propagates out of `router.dispatch()`, violating the "dispatch
//       always resolves" contract. Worst case: onHandlerError throwing
//       swallows the original handler error.
//   B2: filter-predicate throws are routed to observer.onHandlerError
//       but NOT appended to DispatchReport.errors, so observer-less
//       callers see {matchedHandlers:0, errors:[]} as if nothing
//       happened.
//
// Plus: assert RegistrationHandle is Object.frozen.

describe("F-10 remediation", () => {
  test("observer.onBeforeDispatch throw is isolated; dispatch resolves with report", async () => {
    const observer: RouterObserver = {
      onBeforeDispatch: () => {
        throw new Error("boom-before");
      }
    };
    const r = new TypedRouter({ observer });
    let fired = 0;
    r.on(message, () => {
      fired += 1;
    });
    let report: DispatchReport | undefined;
    await expect(
      (async () => {
        report = await r.dispatch(makeMessageUpdate());
      })()
    ).resolves.toBeUndefined();
    expect(report).toBeDefined();
    expect(report!.matchedHandlers).toBe(1);
    expect(fired).toBe(1);
  });

  test("observer.onHandlerMatch throw is isolated; handler still fires", async () => {
    const observer: RouterObserver = {
      onHandlerMatch: () => {
        throw new Error("boom-match");
      }
    };
    const r = new TypedRouter({ observer });
    let fired = 0;
    r.on(message, () => {
      fired += 1;
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(report.matchedHandlers).toBe(1);
    expect(fired).toBe(1);
    expect(report.errors.length).toBe(0);
  });

  test("observer.onHandlerError throw is isolated; original handler error preserved", async () => {
    const observerErrorsSeen: unknown[] = [];
    const observer: RouterObserver = {
      onHandlerError: (_id, _h, err) => {
        observerErrorsSeen.push(err);
        throw new Error("boom-on-error");
      }
    };
    const r = new TypedRouter({ observer });
    const original = new Error("handler-failed");
    r.on(message, () => {
      throw original;
    });
    let report: DispatchReport | undefined;
    await expect(
      (async () => {
        report = await r.dispatch(makeMessageUpdate());
      })()
    ).resolves.toBeUndefined();
    expect(report).toBeDefined();
    expect(report!.matchedHandlers).toBe(1);
    // The ORIGINAL handler error must still be in report.errors;
    // the observer's throw must not replace or swallow it.
    expect(report!.errors.length).toBe(1);
    expect(report!.errors[0]?.error).toBe(original);
    expect(observerErrorsSeen[0]).toBe(original);
  });

  test("observer.onAfterDispatch throw is isolated; dispatch resolves with report", async () => {
    const observer: RouterObserver = {
      onAfterDispatch: () => {
        throw new Error("boom-after");
      }
    };
    const r = new TypedRouter({ observer });
    r.on(message, () => {});
    let report: DispatchReport | undefined;
    await expect(
      (async () => {
        report = await r.dispatch(makeMessageUpdate());
      })()
    ).resolves.toBeUndefined();
    expect(report).toBeDefined();
    expect(report!.matchedHandlers).toBe(1);
  });

  test("filter predicate throw is collected in DispatchReport.errors with handleId", async () => {
    const r = new TypedRouter();
    const explodingFilter = custom<TypedUpdate>(
      ((_u: TypedUpdate): _u is TypedUpdate => {
        throw new Error("predicate-boom");
      }) as (u: TypedUpdate) => u is TypedUpdate,
      "predicate-boom"
    );
    let fired = 0;
    const handle = r.on(explodingFilter, () => {
      fired += 1;
    });
    const report = await r.dispatch(makeMessageUpdate());
    expect(fired).toBe(0);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]?.handleId).toBe(handle.id);
    expect((report.errors[0]?.error as Error).message).toBe("predicate-boom");
  });

  test("filter predicate throw still forwards to observer.onHandlerError AND is in report.errors", async () => {
    const seen: { handleId: symbol; error: unknown }[] = [];
    const observer: RouterObserver = {
      onHandlerError: (_id, h, err) => {
        seen.push({ handleId: h.id, error: err });
      }
    };
    const r = new TypedRouter({ observer });
    const explodingFilter = custom<TypedUpdate>(
      ((_u: TypedUpdate): _u is TypedUpdate => {
        throw new Error("pred-x");
      }) as (u: TypedUpdate) => u is TypedUpdate,
      "pred-x"
    );
    const handle = r.on(explodingFilter, () => {});
    const report = await r.dispatch(makeMessageUpdate());
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]?.handleId).toBe(handle.id);
    expect(seen.length).toBe(1);
    expect(seen[0]?.handleId).toBe(handle.id);
  });

  test("RegistrationHandle is Object.frozen", () => {
    const r = new TypedRouter();
    const handle = r.on(message, () => {});
    expect(Object.isFrozen(handle)).toBe(true);
  });
});

// =====================================================================
// F-11 listener substrate integration
// =====================================================================

describe("TypedRouter — F-11 listenerRegistry integration", () => {
  test("construction rejects non-object listenerRegistry", () => {
    expect(
      () =>
        new TypedRouter({
          listenerRegistry: 42 as unknown as ListenerRegistry
        })
    ).toThrow(TypedRouterOptionsError);
    expect(
      () =>
        new TypedRouter({
          listenerRegistry: null as unknown as ListenerRegistry
        })
    ).toThrow();
  });

  test("construction rejects listenerRegistry missing .evaluate", () => {
    const bad = {
      register: () => undefined,
      clear: () => undefined,
      activeCount: 0
    } as unknown as ListenerRegistry;
    expect(() => new TypedRouter({ listenerRegistry: bad })).toThrow(
      TypedRouterOptionsError
    );
  });

  test("dispatch invokes listenerRegistry.evaluate BEFORE handler loop (plan DoD)", async () => {
    const reg = createListenerRegistry();
    const order: string[] = [];
    const wrapped: ListenerRegistry = {
      get activeCount() {
        return reg.activeCount;
      },
      register: reg.register.bind(reg),
      clear: reg.clear.bind(reg),
      evaluate: (u) => {
        order.push("listener-evaluate");
        return reg.evaluate(u);
      }
    };
    const r = new TypedRouter({ listenerRegistry: wrapped });
    r.on(message, () => {
      order.push("handler");
    });
    await r.dispatch(makeMessageUpdate());
    expect(order).toEqual(["listener-evaluate", "handler"]);
  });

  test("listener resolves AND handler fires on same dispatch (additive, not short-circuit)", async () => {
    const reg = createListenerRegistry();
    const r = new TypedRouter({ listenerRegistry: reg });
    const lh = reg.register(message);
    let handlerFired = 0;
    r.on(message, () => {
      handlerFired += 1;
    });
    await r.dispatch(makeMessageUpdate());
    const u = await lh.promise;
    expect(u.kind).toBe("message");
    expect(handlerFired).toBe(1);
  });

  test("observer.onListenerMatch fires with correct dispatchId + listenerId", async () => {
    const reg = createListenerRegistry();
    const hits: { dispatchId: string; listenerId: symbol; kind: string }[] =
      [];
    const observer: RouterObserver = {
      onListenerMatch: (dispatchId, listenerId, update) => {
        hits.push({ dispatchId, listenerId, kind: update.kind });
      }
    };
    const r = new TypedRouter({ listenerRegistry: reg, observer });
    const lh = reg.register(message);
    const report = await r.dispatch(makeMessageUpdate());
    expect(hits.length).toBe(1);
    expect(hits[0]?.dispatchId).toBe(report.dispatchId);
    expect(hits[0]?.listenerId).toBe(lh.id);
    expect(hits[0]?.kind).toBe("message");
  });

  test("observer.onListenerMatch does NOT fire when no listener matches", async () => {
    const reg = createListenerRegistry();
    let hit = 0;
    const observer: RouterObserver = {
      onListenerMatch: () => {
        hit += 1;
      }
    };
    const r = new TypedRouter({ listenerRegistry: reg, observer });
    reg.register(status); // status-only
    await r.dispatch(makeMessageUpdate());
    expect(hit).toBe(0);
  });

  test("observer.onListenerMatch throw is isolated (does not poison dispatch)", async () => {
    const reg = createListenerRegistry();
    const observer: RouterObserver = {
      onListenerMatch: () => {
        throw new Error("obs-boom");
      }
    };
    const r = new TypedRouter({ listenerRegistry: reg, observer });
    reg.register(message);
    // Should still resolve the DispatchReport.
    const report = await r.dispatch(makeMessageUpdate());
    expect(report.dispatchId).toBeDefined();
  });

  test("listener evaluate() throw propagates through dispatch (predicate-throw policy)", async () => {
    const reg = createListenerRegistry();
    const boom = custom<TypedMessageUpdate>(
      ((_u: TypedUpdate): _u is TypedMessageUpdate => {
        throw new Error("pred-boom");
      }) as (u: TypedUpdate) => u is TypedMessageUpdate,
      "pred-boom"
    );
    reg.register(boom);
    const r = new TypedRouter({ listenerRegistry: reg });
    let caught: unknown;
    try {
      await r.dispatch(makeMessageUpdate());
    } catch (e) {
      caught = e;
    }
    // We accept either: dispatch resolves (preferred — listener-eval
    // error isolated, listener still removed) OR dispatch rejects
    // with the predicate error. GREEN pins ONE of these; assert the
    // preferred semantics.
    expect(caught).toBeUndefined();
  });

  test("observer.onListenerMatch enumerated in OBSERVER_HOOKS validation", () => {
    // A non-function onListenerMatch is rejected at construction.
    expect(
      () =>
        new TypedRouter({
          observer: {
            onListenerMatch: 5 as unknown as () => void
          }
        })
    ).toThrow(TypedRouterOptionsError);
  });
});
