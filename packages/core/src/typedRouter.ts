// @wats/core — typedRouter.ts (F-10 GREEN)
//
// Handle-based TypedRouter above the F-8 `TypedUpdate` discriminated
// union and the F-9 branded `TypedFilter` surface. Closes WATS-10 (L4
// ordering guarantee) and WATS-15 (A3 observability seams).
//
// Contract:
//   - Handlers are invoked in REGISTRATION ORDER (WATS-10 L4) on
//     every dispatch. The order is not implicitly grouped by kind,
//     filter shape, or any other property — user-registration order
//     is the only ordering guarantee.
//   - `.on(filter, handler)` validates both arguments at call time
//     (filter via `isTypedFilter`, handler must be a function) and
//     returns a frozen `RegistrationHandle` with a unique `Symbol()`
//     id and an `unregister()` that is idempotent.
//   - `.dispatch(update)` ALWAYS resolves. Handler throws are caught,
//     forwarded to `observer.onHandlerError(...)`, and collected in
//     `DispatchReport.errors`. Dispatch NEVER rejects with a handler
//     error.
//   - Unregister during dispatch uses SNAPSHOT SEMANTICS: the handler
//     list seen by a single `.dispatch()` call is captured at entry;
//     unregistrations made by one handler do not skip later matching
//     handlers in the same dispatch. New `.on()` calls during dispatch
//     also do NOT fire in the current dispatch — they become visible
//     to the NEXT dispatch.
//   - A handler may return the string literal `"stop"` (or an async
//     handler may resolve to `"stop"`) to halt the current dispatch
//     early. `DispatchReport.stopped` is set to `true`.
//   - Concurrency mode:
//       sequential (default) — handlers awaited in order, so side-
//         effects observe registration order exactly.
//       parallel — all matching handlers fired via `Promise.allSettled`;
//         errors still collected, but interleaving is undefined.
//   - `maxHandlersPerDispatch` (default 10_000) caps the number of
//     MATCHING handlers invoked per dispatch. Further handlers are
//     skipped and `DispatchReport.capped` is set.
//
// Non-goals:
//   - No HTTP integration (F-12 owns that).
//   - No listener substrate (F-11).
//   - No persistence, retry, or backoff.
//   - No wire normalization — that lives in F-8 webhookNormalizer.
//
// Injection defense:
//   - The router operates exclusively on in-memory TypedUpdate values.
//     It never builds URLs, headers, or eval-equivalent strings from
//     user content.

import {
  isTypedFilter,
  type TypedFilter
} from "./filtersTyped/typedFilter.js";
import type { TypedUpdate } from "./webhookNormalizer.js";
import type { ListenerRegistry } from "./listener.js";

export interface HandlerContext<T extends TypedUpdate = TypedUpdate> {
  readonly update: T;
  readonly registrationIndex: number;
  readonly dispatchId: string;
}

export type Handler<T extends TypedUpdate = TypedUpdate> = (
  ctx: HandlerContext<T>
) => void | "stop" | Promise<void | "stop">;

export interface RegistrationHandle {
  readonly id: symbol;
  readonly registrationIndex: number;
  readonly registered: boolean;
  unregister(): void;
}

export interface DispatchHandlerError {
  readonly handleId: symbol;
  readonly error: unknown;
}

export interface DispatchReport {
  readonly dispatchId: string;
  readonly matchedHandlers: number;
  readonly errors: readonly DispatchHandlerError[];
  readonly stopped: boolean;
  readonly capped: boolean;
}

export interface RouterObserver {
  onBeforeDispatch?: (dispatchId: string, update: TypedUpdate) => void;
  onAfterDispatch?: (dispatchId: string, report: DispatchReport) => void;
  onHandlerMatch?: (
    dispatchId: string,
    handle: RegistrationHandle,
    update: TypedUpdate
  ) => void;
  onHandlerError?: (
    dispatchId: string,
    handle: RegistrationHandle,
    error: unknown,
    update: TypedUpdate
  ) => void;
  // F-11 listener substrate: fired after a listener in the injected
  // `listenerRegistry` resolves against the current dispatch update.
  // Provided as an optional additive hook so pre-F-11 routers and
  // observer implementations keep working unchanged.
  onListenerMatch?: (
    dispatchId: string,
    listenerId: symbol,
    update: TypedUpdate
  ) => void;
}

export type RouterConcurrency = "sequential" | "parallel";

export interface TypedRouterOptions {
  readonly observer?: RouterObserver;
  readonly maxHandlersPerDispatch?: number;
  readonly concurrency?: RouterConcurrency;
  readonly dispatchIdFactory?: () => string;
  // F-11 optional listener substrate hook. When provided, `dispatch`
  // evaluates the registry BEFORE the handler loop (plan spec F-11
  // DoD): listeners see the update first (at most one resolves per
  // dispatch — first-match-wins), then the handler dispatch runs
  // unchanged. Invalid values rejected with
  // TypedRouterOptionsError("invalid_listener_registry").
  readonly listenerRegistry?: ListenerRegistry;
}

export type TypedRouterOptionsErrorCode =
  | "invalid_options"
  | "invalid_observer"
  | "invalid_max_handlers"
  | "invalid_concurrency"
  | "invalid_dispatch_id_factory"
  | "invalid_filter"
  | "invalid_handler"
  | "invalid_listener_registry";

export class TypedRouterOptionsError extends Error {
  readonly code: TypedRouterOptionsErrorCode;
  constructor(code: TypedRouterOptionsErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TypedRouterOptionsError";
    this.code = code;
  }
}

export const DEFAULT_MAX_HANDLERS_PER_DISPATCH = 10_000;

// --- internal bookkeeping --------------------------------------------

interface RegistrationEntry {
  readonly id: symbol;
  readonly registrationIndex: number;
  readonly filter: TypedFilter<TypedUpdate>;
  readonly handler: Handler<TypedUpdate>;
  removed: boolean;
}

const OBSERVER_HOOKS: readonly (keyof RouterObserver)[] = [
  "onBeforeDispatch",
  "onAfterDispatch",
  "onHandlerMatch",
  "onHandlerError",
  "onListenerMatch"
];

function validateOptions(options: TypedRouterOptions | undefined): void {
  if (options === undefined) {
    return;
  }
  if (typeof options !== "object" || options === null) {
    throw new TypedRouterOptionsError(
      "invalid_options",
      "TypedRouter: options must be an object if provided."
    );
  }
  const {
    observer,
    maxHandlersPerDispatch,
    concurrency,
    dispatchIdFactory,
    listenerRegistry
  } = options;
  if (observer !== undefined) {
    if (typeof observer !== "object" || observer === null) {
      throw new TypedRouterOptionsError(
        "invalid_observer",
        "TypedRouter: observer must be an object if provided."
      );
    }
    for (const hook of OBSERVER_HOOKS) {
      const value = (observer as Record<string, unknown>)[hook];
      if (value !== undefined && typeof value !== "function") {
        throw new TypedRouterOptionsError(
          "invalid_observer",
          `TypedRouter: observer.${hook} must be a function if provided.`
        );
      }
    }
  }
  if (maxHandlersPerDispatch !== undefined) {
    if (
      typeof maxHandlersPerDispatch !== "number" ||
      !Number.isFinite(maxHandlersPerDispatch) ||
      !Number.isInteger(maxHandlersPerDispatch) ||
      maxHandlersPerDispatch <= 0
    ) {
      throw new TypedRouterOptionsError(
        "invalid_max_handlers",
        "TypedRouter: maxHandlersPerDispatch must be a positive integer."
      );
    }
  }
  if (concurrency !== undefined) {
    if (concurrency !== "sequential" && concurrency !== "parallel") {
      throw new TypedRouterOptionsError(
        "invalid_concurrency",
        'TypedRouter: concurrency must be "sequential" or "parallel".'
      );
    }
  }
  if (dispatchIdFactory !== undefined && typeof dispatchIdFactory !== "function") {
    throw new TypedRouterOptionsError(
      "invalid_dispatch_id_factory",
      "TypedRouter: dispatchIdFactory must be a function if provided."
    );
  }
  if (listenerRegistry !== undefined) {
    if (typeof listenerRegistry !== "object" || listenerRegistry === null) {
      throw new TypedRouterOptionsError(
        "invalid_listener_registry",
        "TypedRouter: listenerRegistry must be a ListenerRegistry-shaped object if provided."
      );
    }
    const probe = listenerRegistry as unknown as Record<string, unknown>;
    if (
      typeof probe.register !== "function" ||
      typeof probe.evaluate !== "function" ||
      typeof probe.clear !== "function"
    ) {
      throw new TypedRouterOptionsError(
        "invalid_listener_registry",
        "TypedRouter: listenerRegistry must expose register / evaluate / clear."
      );
    }
  }
}

// --- dispatch-id default ---------------------------------------------

let fallbackCounter = 0;

// --- observer-throw isolation (F-10 remediation, WATS-29) ------------
//
// Observer hooks live on the dispatch hot path. The dispatch contract
// is "always resolves" — a hook throw must NOT poison resolution or
// the DispatchReport. Worst-case scenario before isolation: a throw
// inside onHandlerError swallowed the original handler error (which
// had already been pushed to DispatchReport.errors) by causing
// dispatch() to reject with the observer's error instead. We silently
// swallow observer throws here. Callers must not rely on observer
// hooks for exceptional-flow signaling.
function safeInvokeObserver(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch {
    // Silent swallow — see comment above. Documented in
    // docs/reference/router.md.
  }
}

function defaultDispatchId(): string {
  try {
    const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } })
      .crypto;
    if (maybeCrypto?.randomUUID) {
      return maybeCrypto.randomUUID();
    }
  } catch {
    // fall through
  }
  fallbackCounter += 1;
  return `dsp-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

// --- TypedRouter implementation --------------------------------------

export class TypedRouter {
  readonly #entries: RegistrationEntry[] = [];
  readonly #observer: RouterObserver | undefined;
  readonly #maxHandlersPerDispatch: number;
  readonly #concurrency: RouterConcurrency;
  readonly #dispatchIdFactory: () => string;
  readonly #listenerRegistry: ListenerRegistry | undefined;
  #nextRegistrationIndex = 0;

  constructor(options?: TypedRouterOptions) {
    validateOptions(options);
    this.#observer = options?.observer;
    this.#maxHandlersPerDispatch =
      options?.maxHandlersPerDispatch ?? DEFAULT_MAX_HANDLERS_PER_DISPATCH;
    this.#concurrency = options?.concurrency ?? "sequential";
    this.#dispatchIdFactory = options?.dispatchIdFactory ?? defaultDispatchId;
    this.#listenerRegistry = options?.listenerRegistry;
  }

  get handlerCount(): number {
    let count = 0;
    for (const e of this.#entries) {
      if (!e.removed) count += 1;
    }
    return count;
  }

  get listenerRegistry(): ListenerRegistry | undefined {
    return this.#listenerRegistry;
  }

  on<T extends TypedUpdate>(
    filter: TypedFilter<T>,
    handler: Handler<T>
  ): RegistrationHandle {
    if (!isTypedFilter(filter)) {
      throw new TypedRouterOptionsError(
        "invalid_filter",
        "TypedRouter.on: filter must be a branded TypedFilter."
      );
    }
    if (typeof handler !== "function") {
      throw new TypedRouterOptionsError(
        "invalid_handler",
        "TypedRouter.on: handler must be a function."
      );
    }

    const id = Symbol("TypedRouter.handler");
    const registrationIndex = this.#nextRegistrationIndex;
    this.#nextRegistrationIndex += 1;

    const entry: RegistrationEntry = {
      id,
      registrationIndex,
      filter: filter as TypedFilter<TypedUpdate>,
      handler: handler as Handler<TypedUpdate>,
      removed: false
    };
    this.#entries.push(entry);

    const handle: RegistrationHandle = Object.freeze({
      id,
      registrationIndex,
      get registered(): boolean {
        return !entry.removed;
      },
      unregister: (): void => {
        if (entry.removed) {
          return;
        }
        entry.removed = true;
        // Compact the entries array on unregister so handlerCount
        // reflects removals in O(1) on subsequent reads and the
        // next dispatch snapshot is smaller.
        const idx = this.#entries.indexOf(entry);
        if (idx >= 0) {
          this.#entries.splice(idx, 1);
        }
      }
    });

    return handle;
  }

  async dispatch(update: TypedUpdate): Promise<DispatchReport> {
    const dispatchId = this.#dispatchIdFactory();
    const observer = this.#observer;

    safeInvokeObserver(
      observer?.onBeforeDispatch
        ? () => observer.onBeforeDispatch!(dispatchId, update)
        : undefined
    );

    // F-11: listener evaluation runs BEFORE the handler loop per the
    // plan DoD. At most one listener resolves per dispatch (first-
    // match-wins, implemented inside the registry). Listener
    // evaluation never short-circuits handler dispatch — the event
    // still flows through the normal handler list unchanged. Any
    // throw from a predicate inside evaluate() is swallowed locally
    // so the router's "dispatch always resolves" contract survives:
    // a programmer-bug predicate in a listener filter must not
    // poison unrelated handler dispatch. The registry leaves the
    // throwing listener in place (consistent with F-9 predicate
    // policy); the consumer can observe the bug via its own error
    // instrumentation.
    if (this.#listenerRegistry) {
      try {
        const result = this.#listenerRegistry.evaluate(update);
        if (result.matched && result.listenerId !== undefined) {
          const listenerId = result.listenerId;
          safeInvokeObserver(
            observer?.onListenerMatch
              ? () =>
                  observer.onListenerMatch!(dispatchId, listenerId, update)
              : undefined
          );
        }
      } catch {
        // Silently swallow — see comment above. Consumers relying on
        // predicate-throw visibility should surface it through their
        // own logging / observer implementation.
      }
    }

    // Snapshot BEFORE iteration so unregister-during-dispatch keeps
    // the current dispatch deterministic.
    const snapshot = this.#entries.slice();

    // `errors` is declared up-front so the predicate-throw branch
    // (below) can append to it. F-10 remediation (WATS-29 B2):
    // predicate throws are handler-side code (custom() user code) and
    // MUST appear in DispatchReport.errors so observer-less callers
    // see them.
    const errors: DispatchHandlerError[] = [];

    // Identify matching entries up-front (predicate evaluation is
    // cheap and deterministic). We still honour the cap on the
    // matching set.
    const matching: Array<{
      readonly entry: RegistrationEntry;
      readonly handle: RegistrationHandle;
    }> = [];
    let capped = false;
    for (const entry of snapshot) {
      if (entry.removed) {
        // An entry removed before the dispatch scan but still in the
        // snapshot — skip it. We reserve snapshot semantics for the
        // case where removal happens MID-dispatch (after we start
        // running handlers).
        continue;
      }
      let matched: boolean;
      try {
        matched = entry.filter.predicate(update);
      } catch (error) {
        // Predicate throws propagate per architecture notes F-9. Treat them as
        // handler errors (they originate from consumer-supplied
        // custom() predicates, so they are effectively handler-side
        // code): collect into report.errors AND forward to the
        // observer seam. Observer throw is isolated.
        const handle = this.#materializeHandle(entry);
        errors.push({ handleId: entry.id, error });
        safeInvokeObserver(
          observer?.onHandlerError
            ? () => observer.onHandlerError!(dispatchId, handle, error, update)
            : undefined
        );
        continue;
      }
      if (!matched) continue;
      if (matching.length >= this.#maxHandlersPerDispatch) {
        capped = true;
        break;
      }
      matching.push({ entry, handle: this.#materializeHandle(entry) });
    }

    let stopped = false;

    if (this.#concurrency === "sequential") {
      for (const { entry, handle } of matching) {
        safeInvokeObserver(
          observer?.onHandlerMatch
            ? () => observer.onHandlerMatch!(dispatchId, handle, update)
            : undefined
        );
        const ctx: HandlerContext = {
          update,
          registrationIndex: entry.registrationIndex,
          dispatchId
        };
        try {
          const result = await entry.handler(ctx);
          if (result === "stop") {
            stopped = true;
            break;
          }
        } catch (error) {
          errors.push({ handleId: entry.id, error });
          safeInvokeObserver(
            observer?.onHandlerError
              ? () => observer.onHandlerError!(dispatchId, handle, error, update)
              : undefined
          );
        }
      }
    } else {
      // Parallel: emit onHandlerMatch for all before firing, so the
      // observer still sees matches in registration order.
      for (const { handle } of matching) {
        safeInvokeObserver(
          observer?.onHandlerMatch
            ? () => observer.onHandlerMatch!(dispatchId, handle, update)
            : undefined
        );
      }
      const settled = await Promise.allSettled(
        matching.map(async ({ entry }) => {
          const ctx: HandlerContext = {
            update,
            registrationIndex: entry.registrationIndex,
            dispatchId
          };
          const result = await entry.handler(ctx);
          return result;
        })
      );
      for (let i = 0; i < settled.length; i += 1) {
        const outcome = settled[i]!;
        const pair = matching[i]!;
        if (outcome.status === "rejected") {
          errors.push({ handleId: pair.entry.id, error: outcome.reason });
          safeInvokeObserver(
            observer?.onHandlerError
              ? () =>
                  observer.onHandlerError!(
                    dispatchId,
                    pair.handle,
                    outcome.reason,
                    update
                  )
              : undefined
          );
        } else if (outcome.value === "stop") {
          stopped = true;
        }
      }
    }

    const report: DispatchReport = Object.freeze({
      dispatchId,
      matchedHandlers: matching.length,
      errors: Object.freeze(errors.slice()),
      stopped,
      capped
    });
    safeInvokeObserver(
      observer?.onAfterDispatch
        ? () => observer.onAfterDispatch!(dispatchId, report)
        : undefined
    );
    return report;
  }

  clear(): void {
    for (const e of this.#entries) {
      e.removed = true;
    }
    this.#entries.length = 0;
  }

  // --- internals -----------------------------------------------------

  #materializeHandle(entry: RegistrationEntry): RegistrationHandle {
    return Object.freeze({
      id: entry.id,
      registrationIndex: entry.registrationIndex,
      get registered(): boolean {
        return !entry.removed;
      },
      unregister: (): void => {
        if (entry.removed) return;
        entry.removed = true;
        const idx = this.#entries.indexOf(entry);
        if (idx >= 0) this.#entries.splice(idx, 1);
      }
    });
  }
}
