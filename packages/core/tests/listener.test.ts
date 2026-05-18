// packages/core/tests/listener.test.ts (F-11 RED)
//
// Exhaustive coverage of the listener substrate:
//   - Registry creation (construction-time validation)
//   - register(filter, options) validation (filter shape, timeoutMs,
//     signal, description, activeCount cap)
//   - ListenerHandle: returns { id, promise, cancel, cancelled, settled }
//   - evaluate(update): resolves the FIRST matching listener (first-
//     match-wins), clears it from the registry, returns matched flag
//     + the winning listener id; non-matching listeners keep pending
//   - timeout: options.timeoutMs rejects with ListenerTimeoutError
//     after N ms and removes the listener from the registry
//   - AbortSignal: aborting the signal rejects with ListenerAbortError
//     (code: "listener_signal_aborted"); already-aborted signal at
//     register time rejects synchronously and registry.activeCount
//     does not increase
//   - cancel(): idempotent; rejects pending promise with
//     ListenerAbortError (code: "listener_cancelled")
//   - clear(): rejects all pending with
//     ListenerAbortError(code: "listener_registry_cleared")
//   - activeCount is accurate across register / resolve / timeout /
//     cancel / clear lifecycles
//   - maxActiveListeners cap (default 10_000): exceed → throws
//     ListenerOptionsError(code: "max_listeners_exceeded")
//   - Resource cleanup: no dangling setTimeout / signal listener after
//     resolve / reject (indirectly asserted: activeCount drops to 0
//     and a subsequent .register() succeeds)

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_ACTIVE_LISTENERS,
  ListenerAbortError,
  ListenerOptionsError,
  ListenerTimeoutError,
  createListenerRegistry,
  type ListenerHandle,
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

// --- synthetic TypedUpdate factories --------------------------------

function makeMessageUpdate(overrides: { id?: string; from?: string; body?: string } = {}): TypedMessageUpdate {
  const id = overrides.id ?? "wamid.L1";
  const from = overrides.from ?? "15551234567";
  const body = overrides.body ?? "hi";
  return {
    kind: "message",
    updateId: id,
    phoneNumberId: "1234567890",
    wabaId: "WABA-L",
    receivedAt: 1,
    message: {
      from,
      id,
      timestamp: "1",
      type: "text",
      text: { body }
    } as TypedMessageUpdate["message"],
    rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
  };
}

function makeStatusUpdate(id = "wamid.S1"): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: id,
    phoneNumberId: "1",
    wabaId: "W",
    receivedAt: 1,
    status: {} as never,
    rawChange: { field: "messages", value: {} } as never
  };
}

async function microtick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// =====================================================================
// createListenerRegistry construction
// =====================================================================

describe("createListenerRegistry — construction", () => {
  test("returns a ListenerRegistry with .register / .evaluate / .clear / .activeCount", () => {
    const reg: ListenerRegistry = createListenerRegistry();
    expect(typeof reg.register).toBe("function");
    expect(typeof reg.evaluate).toBe("function");
    expect(typeof reg.clear).toBe("function");
    expect(reg.activeCount).toBe(0);
  });

  test("DEFAULT_MAX_ACTIVE_LISTENERS is 10_000", () => {
    expect(DEFAULT_MAX_ACTIVE_LISTENERS).toBe(10_000);
  });

  test("rejects non-object options", () => {
    expect(() =>
      createListenerRegistry("bad" as unknown as undefined)
    ).toThrow(ListenerOptionsError);
  });

  test("rejects non-integer maxActiveListeners", () => {
    expect(() => createListenerRegistry({ maxActiveListeners: 0 })).toThrow(
      ListenerOptionsError
    );
    expect(() => createListenerRegistry({ maxActiveListeners: -1 })).toThrow(
      ListenerOptionsError
    );
    expect(() =>
      createListenerRegistry({ maxActiveListeners: 1.5 })
    ).toThrow(ListenerOptionsError);
    expect(() =>
      createListenerRegistry({ maxActiveListeners: Number.NaN })
    ).toThrow(ListenerOptionsError);
    expect(() =>
      createListenerRegistry({ maxActiveListeners: Number.POSITIVE_INFINITY })
    ).toThrow(ListenerOptionsError);
    expect(() =>
      createListenerRegistry({
        maxActiveListeners: "10" as unknown as number
      })
    ).toThrow(ListenerOptionsError);
  });
});

// =====================================================================
// register validation
// =====================================================================

describe("ListenerRegistry.register — validation", () => {
  test("rejects non-filter first arg", () => {
    const reg = createListenerRegistry();
    expect(() => reg.register({} as never)).toThrow(ListenerOptionsError);
    expect(() =>
      reg.register(null as unknown as never)
    ).toThrow(ListenerOptionsError);
    expect(() =>
      reg.register((() => true) as unknown as never)
    ).toThrow(ListenerOptionsError);
  });

  test("rejects non-object options", () => {
    const reg = createListenerRegistry();
    expect(() => reg.register(message, "bad" as never)).toThrow(
      ListenerOptionsError
    );
    expect(() => reg.register(message, 42 as never)).toThrow(
      ListenerOptionsError
    );
  });

  test("rejects invalid timeoutMs", () => {
    const reg = createListenerRegistry();
    for (const v of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100"]) {
      expect(() =>
        reg.register(message, { timeoutMs: v as unknown as number })
      ).toThrow(ListenerOptionsError);
    }
  });

  test("rejects non-AbortSignal signal", () => {
    const reg = createListenerRegistry();
    expect(() =>
      reg.register(message, { signal: {} as unknown as AbortSignal })
    ).toThrow(ListenerOptionsError);
    expect(() =>
      reg.register(message, { signal: "abc" as unknown as AbortSignal })
    ).toThrow(ListenerOptionsError);
  });

  test("rejects non-string description", () => {
    const reg = createListenerRegistry();
    expect(() =>
      reg.register(message, { description: 42 as unknown as string })
    ).toThrow(ListenerOptionsError);
  });

  test("accepts a valid filter + options and returns a handle", () => {
    const reg = createListenerRegistry();
    const handle = reg.register(message, {
      timeoutMs: 50,
      description: "test"
    });
    expect(typeof handle.id).toBe("symbol");
    expect(handle.promise).toBeInstanceOf(Promise);
    expect(handle.cancelled).toBe(false);
    expect(handle.settled).toBe(false);
    expect(typeof handle.cancel).toBe("function");
    expect(reg.activeCount).toBe(1);
    handle.cancel();
  });
});

// =====================================================================
// evaluate — first-match-wins + resolve
// =====================================================================

describe("ListenerRegistry.evaluate — match + resolve", () => {
  test("evaluate with matching filter resolves the listener's promise", async () => {
    const reg = createListenerRegistry();
    const handle = reg.register(message);
    const result = reg.evaluate(makeMessageUpdate());
    expect(result.matched).toBe(true);
    expect(result.listenerId).toBe(handle.id);
    const u = await handle.promise;
    expect(u.kind).toBe("message");
    expect(reg.activeCount).toBe(0);
  });

  test("evaluate with non-matching filter does NOT resolve", async () => {
    const reg = createListenerRegistry();
    const h = reg.register(status); // status-only
    const result = reg.evaluate(makeMessageUpdate()); // send a message
    expect(result.matched).toBe(false);
    expect(result.listenerId).toBeUndefined();
    // still pending
    expect(h.settled).toBe(false);
    expect(reg.activeCount).toBe(1);
    h.cancel();
  });

  test("first-match-wins: among N listeners matching same update, only the FIRST resolves", async () => {
    const reg = createListenerRegistry();
    const h1 = reg.register(message);
    const h2 = reg.register(message);
    const h3 = reg.register(message);
    const result = reg.evaluate(makeMessageUpdate());
    expect(result.matched).toBe(true);
    expect(result.listenerId).toBe(h1.id);
    await microtick();
    expect(h1.settled).toBe(true);
    expect(h2.settled).toBe(false);
    expect(h3.settled).toBe(false);
    expect(reg.activeCount).toBe(2);
    // Next evaluate fires h2.
    const result2 = reg.evaluate(makeMessageUpdate({ id: "wamid.L2" }));
    expect(result2.listenerId).toBe(h2.id);
    h3.cancel();
  });

  test("matched listener is removed from registry on resolve", async () => {
    const reg = createListenerRegistry();
    reg.register(message);
    expect(reg.activeCount).toBe(1);
    reg.evaluate(makeMessageUpdate());
    expect(reg.activeCount).toBe(0);
  });

  test("evaluate returns matched:false when registry is empty", () => {
    const reg = createListenerRegistry();
    const result = reg.evaluate(makeMessageUpdate());
    expect(result.matched).toBe(false);
    expect(result.listenerId).toBeUndefined();
  });

  test("filters that throw in predicate propagate unchanged", () => {
    const reg = createListenerRegistry();
    const boom = custom<TypedMessageUpdate>(
      () => {
        throw new Error("boom");
      },
      "boom"
    );
    reg.register(boom);
    expect(() => reg.evaluate(makeMessageUpdate())).toThrow("boom");
  });

  test("compound filter with textMatches narrows as expected", async () => {
    const reg = createListenerRegistry();
    const h = reg.register(and(message, message.textMatches(/hello/i)));
    const miss = reg.evaluate(makeMessageUpdate({ body: "bye" }));
    expect(miss.matched).toBe(false);
    const hit = reg.evaluate(makeMessageUpdate({ body: "Hello there" }));
    expect(hit.matched).toBe(true);
    expect(hit.listenerId).toBe(h.id);
    const u = await h.promise;
    expect(u.message.text?.body).toBe("Hello there");
  });
});

// =====================================================================
// timeout
// =====================================================================

describe("ListenerRegistry.register — timeout", () => {
  test("timeoutMs rejects with ListenerTimeoutError after N ms", async () => {
    const reg = createListenerRegistry();
    const h = reg.register(message, { timeoutMs: 20 });
    let err: unknown;
    try {
      await h.promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerTimeoutError);
    expect((err as ListenerTimeoutError).code).toBe("listener_timeout");
    expect((err as ListenerTimeoutError).timeoutMs).toBe(20);
    expect(reg.activeCount).toBe(0);
    expect(h.settled).toBe(true);
  });

  test("evaluate before timeout resolves normally; timeout callback is cleared", async () => {
    const reg = createListenerRegistry();
    const h = reg.register(message, { timeoutMs: 1000 });
    reg.evaluate(makeMessageUpdate());
    const u = await h.promise;
    expect(u.kind).toBe("message");
    // Wait longer than any reasonable leftover timeout would have
    // fired — assert no unhandled rejections by re-checking settled.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.settled).toBe(true);
    expect(reg.activeCount).toBe(0);
  });
});

// =====================================================================
// AbortSignal
// =====================================================================

describe("ListenerRegistry.register — AbortSignal", () => {
  test("aborting the signal rejects with ListenerAbortError(signal_aborted)", async () => {
    const reg = createListenerRegistry();
    const controller = new AbortController();
    const h = reg.register(message, { signal: controller.signal });
    controller.abort();
    let err: unknown;
    try {
      await h.promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerAbortError);
    expect((err as ListenerAbortError).code).toBe("listener_signal_aborted");
    expect(reg.activeCount).toBe(0);
  });

  test("already-aborted signal rejects synchronously and does not count as active", async () => {
    const reg = createListenerRegistry();
    const controller = new AbortController();
    controller.abort();
    const h = reg.register(message, { signal: controller.signal });
    expect(reg.activeCount).toBe(0);
    let err: unknown;
    try {
      await h.promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerAbortError);
    expect((err as ListenerAbortError).code).toBe("listener_signal_aborted");
  });
});

// =====================================================================
// cancel()
// =====================================================================

describe("ListenerHandle.cancel", () => {
  test("cancel() rejects pending promise with ListenerAbortError(cancelled)", async () => {
    const reg = createListenerRegistry();
    const h = reg.register(message);
    h.cancel();
    let err: unknown;
    try {
      await h.promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerAbortError);
    expect((err as ListenerAbortError).code).toBe("listener_cancelled");
    expect(h.cancelled).toBe(true);
    expect(h.settled).toBe(true);
    expect(reg.activeCount).toBe(0);
  });

  test("cancel() is idempotent", async () => {
    const reg = createListenerRegistry();
    const h = reg.register(message);
    h.cancel();
    h.cancel();
    h.cancel();
    expect(reg.activeCount).toBe(0);
  });

  test("cancel() after resolve is a no-op", async () => {
    const reg = createListenerRegistry();
    const h = reg.register(message);
    reg.evaluate(makeMessageUpdate());
    await h.promise;
    h.cancel();
    expect(h.settled).toBe(true);
    expect(h.cancelled).toBe(false);
  });
});

// =====================================================================
// clear()
// =====================================================================

describe("ListenerRegistry.clear", () => {
  test("clear() rejects all pending with ListenerAbortError(registry_cleared)", async () => {
    const reg = createListenerRegistry();
    const h1 = reg.register(message);
    const h2 = reg.register(status);
    expect(reg.activeCount).toBe(2);
    reg.clear();
    expect(reg.activeCount).toBe(0);
    for (const h of [h1, h2]) {
      let err: unknown;
      try {
        await h.promise;
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ListenerAbortError);
      expect((err as ListenerAbortError).code).toBe(
        "listener_registry_cleared"
      );
    }
  });
});

// =====================================================================
// maxActiveListeners cap
// =====================================================================

describe("ListenerRegistry.register — maxActiveListeners cap", () => {
  test("registering beyond the configured cap throws max_listeners_exceeded", () => {
    const reg = createListenerRegistry({ maxActiveListeners: 3 });
    const h1 = reg.register(message);
    const h2 = reg.register(message);
    const h3 = reg.register(message);
    expect(reg.activeCount).toBe(3);
    let err: unknown;
    try {
      reg.register(message);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerOptionsError);
    expect((err as ListenerOptionsError).code).toBe("max_listeners_exceeded");
    // Cleanup (one resolve) frees a slot.
    reg.evaluate(makeMessageUpdate());
    expect(reg.activeCount).toBe(2);
    const h4 = reg.register(message);
    expect(reg.activeCount).toBe(3);
    // cleanup
    h2.cancel();
    h3.cancel();
    h4.cancel();
    void h1;
  });
});

// =====================================================================
// resource cleanup (indirect)
// =====================================================================

describe("ListenerRegistry — resource cleanup", () => {
  test("resolved listener frees its slot so future registrations succeed", async () => {
    const reg = createListenerRegistry({ maxActiveListeners: 1 });
    const h1 = reg.register(message);
    reg.evaluate(makeMessageUpdate());
    await h1.promise;
    // Slot freed → a second register() works.
    const h2 = reg.register(message);
    expect(reg.activeCount).toBe(1);
    h2.cancel();
  });

  test("timed-out listener frees its slot", async () => {
    const reg = createListenerRegistry({ maxActiveListeners: 1 });
    const h1 = reg.register(message, { timeoutMs: 10 });
    let err: unknown;
    try {
      await h1.promise;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ListenerTimeoutError);
    const h2 = reg.register(message);
    expect(reg.activeCount).toBe(1);
    h2.cancel();
  });

  test("cancelled listener frees its slot", async () => {
    const reg = createListenerRegistry({ maxActiveListeners: 1 });
    const h1 = reg.register(message);
    h1.cancel();
    const h2 = reg.register(message);
    expect(reg.activeCount).toBe(1);
    h2.cancel();
  });
});

// =====================================================================
// Type-narrowing round-trip (compile-time + runtime smoke)
// =====================================================================

describe("ListenerHandle<T> — typed narrowing round-trip", () => {
  test("register<TypedMessageUpdate>(message) resolves to a TypedMessageUpdate", async () => {
    const reg = createListenerRegistry();
    const h: ListenerHandle<TypedMessageUpdate> = reg.register(message);
    reg.evaluate(makeMessageUpdate({ id: "wamid.N1" }));
    const u = await h.promise;
    // Compile-time: u.message.from is accessible without narrowing.
    expect(u.message.from).toBe("15551234567");
  });

  test("custom() filter narrows to the supplied T", async () => {
    const reg = createListenerRegistry();
    const fromAlice = createTypedFilter<TypedMessageUpdate>(
      (u): u is TypedMessageUpdate =>
        u.kind === "message" && u.message.from === "ALICE",
      () => "from=ALICE"
    );
    const h = reg.register(fromAlice);
    reg.evaluate(makeMessageUpdate({ from: "BOB" }));
    expect(h.settled).toBe(false);
    reg.evaluate(makeMessageUpdate({ from: "ALICE" }));
    const u = await h.promise;
    expect(u.message.from).toBe("ALICE");
  });
});

// Silence unused imports for the type-level tests above.
void (null as unknown as TypedUpdate);
void (null as unknown as TypedStatusUpdate);
