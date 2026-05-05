// @switchbord/core — listener.ts (F-11 GREEN)
//
// Listener substrate for conversational patterns: "send a prompt,
// wait for the user's next matching update". Closes WATS-22 (Arch-H)
// per the F-11 plan and implements the listener contract captured in
// ADR-004 §5 (listener_timeout / listener_aborted error codes).
//
// Contract:
//   - `createListenerRegistry(options?)` returns an in-memory
//     ListenerRegistry with `register(filter, options?)`, `evaluate(update)`,
//     `clear()`, and a live `activeCount` getter.
//   - `register()` validates the filter via `isTypedFilter`, plus the
//     options object (timeoutMs positive integer, signal duck-typed
//     AbortSignal, description string). Cap-exceeded or already-
//     aborted-signal paths are handled deterministically.
//   - `register()` returns a `ListenerHandle<T>` exposing
//     `{ id, promise, cancel, cancelled, settled }`. The promise is
//     pending until one of: a matching evaluate() resolves it, the
//     timeoutMs fires, the AbortSignal aborts, the handle is
//     cancelled, or the registry is cleared.
//   - `evaluate(update)` iterates in REGISTRATION ORDER and resolves
//     the FIRST matching listener (first-match-wins). The matched
//     listener is removed from the registry BEFORE its promise
//     resolves. Non-matching listeners remain pending. Predicate
//     throws propagate unchanged to the caller (router policy in
//     typedRouter.ts isolates listener-side throws).
//   - `clear()` rejects all pending listeners with
//     ListenerAbortError("listener_registry_cleared") and empties the
//     registry.
//
// Resource discipline:
//   - Every settlement path (match / timeout / abort / cancel / clear)
//     runs through a single `finalize()` helper that clears the
//     timer, removes the signal listener, sets `settled`, and removes
//     the entry from the internal map. No dangling timers or signal
//     listeners survive a settled listener.
//
// Non-goals (scope ledger):
//   - No persistence (in-memory only).
//   - No cross-instance distribution.
//   - No listener deduplication across identical filters.
//   - No Clock abstraction — F-11 uses real setTimeout; a later
//     step can thread Clock through if deterministic tests need it
//     (plan flagged FakeClock as "recommended"; not required).

import {
  isTypedFilter,
  type TypedFilter
} from "./filtersTyped/typedFilter";
import type { TypedUpdate } from "./webhookNormalizer";

// ----- Options + handle shapes --------------------------------------

export interface ListenerOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly description?: string;
}

export interface ListenerHandle<T extends TypedUpdate = TypedUpdate> {
  readonly id: symbol;
  readonly promise: Promise<T>;
  readonly cancelled: boolean;
  readonly settled: boolean;
  cancel(): void;
}

// ----- Error taxonomy ----------------------------------------------

export type ListenerTimeoutCode = "listener_timeout";
export type ListenerAbortCode =
  | "listener_cancelled"
  | "listener_signal_aborted"
  | "listener_registry_cleared";
export type ListenerOptionsErrorCode =
  | "invalid_filter"
  | "invalid_options"
  | "invalid_timeout"
  | "invalid_signal"
  | "invalid_description"
  | "max_listeners_exceeded"
  | "invalid_max_active_listeners";

export class ListenerTimeoutError extends Error {
  readonly code: ListenerTimeoutCode = "listener_timeout";
  readonly timeoutMs: number;
  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Listener timed out after ${timeoutMs}ms`);
    this.name = "ListenerTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class ListenerAbortError extends Error {
  readonly code: ListenerAbortCode;
  constructor(code: ListenerAbortCode, message?: string) {
    super(message ?? code);
    this.name = "ListenerAbortError";
    this.code = code;
  }
}

export class ListenerOptionsError extends Error {
  readonly code: ListenerOptionsErrorCode;
  constructor(code: ListenerOptionsErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ListenerOptionsError";
    this.code = code;
  }
}

// ----- Registry interface ------------------------------------------

export interface ListenerEvaluationResult {
  readonly matched: boolean;
  readonly listenerId?: symbol;
}

export interface ListenerRegistry {
  readonly activeCount: number;
  register<T extends TypedUpdate>(
    filter: TypedFilter<T>,
    options?: ListenerOptions
  ): ListenerHandle<T>;
  evaluate(update: TypedUpdate): ListenerEvaluationResult;
  clear(): void;
}

export interface ListenerRegistryOptions {
  readonly maxActiveListeners?: number;
}

export const DEFAULT_MAX_ACTIVE_LISTENERS = 10_000;

// ----- Internal entry bookkeeping -----------------------------------

interface RegistryEntry {
  readonly id: symbol;
  readonly filter: TypedFilter<TypedUpdate>;
  readonly resolve: (update: TypedUpdate) => void;
  readonly reject: (error: unknown) => void;
  // Resource handles — finalize() clears them.
  timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  signalAbortListener: (() => void) | undefined;
  signal: AbortSignal | undefined;
  settled: boolean;
  cancelled: boolean;
}

// ----- Validation helpers ------------------------------------------

function validateRegistryOptions(
  options: ListenerRegistryOptions | undefined
): void {
  if (options === undefined) return;
  if (typeof options !== "object" || options === null) {
    throw new ListenerOptionsError(
      "invalid_options",
      "createListenerRegistry: options must be an object if provided."
    );
  }
  const { maxActiveListeners } = options;
  if (maxActiveListeners !== undefined) {
    if (
      typeof maxActiveListeners !== "number" ||
      !Number.isFinite(maxActiveListeners) ||
      !Number.isInteger(maxActiveListeners) ||
      maxActiveListeners <= 0
    ) {
      throw new ListenerOptionsError(
        "invalid_max_active_listeners",
        "createListenerRegistry: maxActiveListeners must be a positive integer."
      );
    }
  }
}

function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== "object") return false;
  const sig = value as {
    aborted?: unknown;
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  return (
    typeof sig.aborted === "boolean" &&
    typeof sig.addEventListener === "function" &&
    typeof sig.removeEventListener === "function"
  );
}

function validateListenerOptions(
  options: ListenerOptions | undefined
): void {
  if (options === undefined) return;
  if (typeof options !== "object" || options === null) {
    throw new ListenerOptionsError(
      "invalid_options",
      "ListenerRegistry.register: options must be an object if provided."
    );
  }
  const { timeoutMs, signal, description } = options;
  if (timeoutMs !== undefined) {
    if (
      typeof timeoutMs !== "number" ||
      !Number.isFinite(timeoutMs) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new ListenerOptionsError(
        "invalid_timeout",
        "ListenerRegistry.register: timeoutMs must be a positive integer."
      );
    }
  }
  if (signal !== undefined && !isAbortSignalLike(signal)) {
    throw new ListenerOptionsError(
      "invalid_signal",
      "ListenerRegistry.register: signal must be an AbortSignal-like object."
    );
  }
  if (description !== undefined && typeof description !== "string") {
    throw new ListenerOptionsError(
      "invalid_description",
      "ListenerRegistry.register: description must be a string if provided."
    );
  }
}

// ----- Factory ------------------------------------------------------

export function createListenerRegistry(
  options?: ListenerRegistryOptions
): ListenerRegistry {
  validateRegistryOptions(options);
  const maxActive =
    options?.maxActiveListeners ?? DEFAULT_MAX_ACTIVE_LISTENERS;

  // Ordered map — insertion order = registration order; Map preserves
  // that under iteration, satisfying the first-match-wins contract.
  const entries = new Map<symbol, RegistryEntry>();

  function finalize(entry: RegistryEntry): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.timeoutHandle !== undefined) {
      clearTimeout(entry.timeoutHandle);
      entry.timeoutHandle = undefined;
    }
    if (entry.signal !== undefined && entry.signalAbortListener !== undefined) {
      entry.signal.removeEventListener("abort", entry.signalAbortListener);
      entry.signalAbortListener = undefined;
    }
    entries.delete(entry.id);
  }

  const registry: ListenerRegistry = {
    get activeCount(): number {
      return entries.size;
    },

    register<T extends TypedUpdate>(
      filter: TypedFilter<T>,
      opts?: ListenerOptions
    ): ListenerHandle<T> {
      if (!isTypedFilter(filter)) {
        throw new ListenerOptionsError(
          "invalid_filter",
          "ListenerRegistry.register: filter must be a branded TypedFilter."
        );
      }
      validateListenerOptions(opts);

      if (entries.size >= maxActive) {
        throw new ListenerOptionsError(
          "max_listeners_exceeded",
          `ListenerRegistry.register: active listener count would exceed max ${maxActive}.`
        );
      }

      const id = Symbol("ListenerRegistry.listener");
      let resolveOuter!: (u: TypedUpdate) => void;
      let rejectOuter!: (e: unknown) => void;
      const promise = new Promise<TypedUpdate>((resolve, reject) => {
        resolveOuter = resolve;
        rejectOuter = reject;
      });
      // Attach a no-op catch so a listener that is cancelled /
      // timed-out / aborted BEFORE the consumer attaches a .catch
      // handler does not surface as an unhandled-rejection warning.
      // Consumers who `await handle.promise` still see the rejection
      // via the original promise reference (promise.catch returns a
      // NEW promise; the original stays rejected and is still
      // observable).
      promise.catch(() => undefined);

      const entry: RegistryEntry = {
        id,
        filter: filter as TypedFilter<TypedUpdate>,
        resolve: resolveOuter,
        reject: rejectOuter,
        timeoutHandle: undefined,
        signalAbortListener: undefined,
        signal: undefined,
        settled: false,
        cancelled: false
      };

      // Short-circuit: already-aborted signal — reject synchronously
      // without entering the entries map (preserves "does not count
      // as active" guarantee).
      if (opts?.signal?.aborted) {
        entry.settled = true;
        const err = new ListenerAbortError(
          "listener_signal_aborted",
          "Listener aborted via AbortSignal (already aborted at register time)."
        );
        // Ensure the unhandled-rejection warning is suppressed by
        // rejecting BEFORE the handle is returned — callers awaiting
        // handle.promise will still see the rejection.
        rejectOuter(err);
        const handle: ListenerHandle<T> = Object.freeze({
          id,
          promise: promise as Promise<T>,
          get cancelled(): boolean {
            return false;
          },
          get settled(): boolean {
            return true;
          },
          cancel: (): void => {
            /* no-op — already settled */
          }
        });
        return handle;
      }

      entries.set(id, entry);

      // Wire timeout + signal AFTER entering the map so cleanup goes
      // through finalize().
      if (opts?.timeoutMs !== undefined) {
        const tms = opts.timeoutMs;
        entry.timeoutHandle = setTimeout(() => {
          if (entry.settled) return;
          const err = new ListenerTimeoutError(tms);
          finalize(entry);
          rejectOuter(err);
        }, tms);
      }

      if (opts?.signal !== undefined) {
        entry.signal = opts.signal;
        const listener = (): void => {
          if (entry.settled) return;
          const err = new ListenerAbortError(
            "listener_signal_aborted",
            "Listener aborted via AbortSignal."
          );
          finalize(entry);
          rejectOuter(err);
        };
        entry.signalAbortListener = listener;
        opts.signal.addEventListener("abort", listener, { once: true });
      }

      const handle: ListenerHandle<T> = Object.freeze({
        id,
        promise: promise as Promise<T>,
        get cancelled(): boolean {
          return entry.cancelled;
        },
        get settled(): boolean {
          return entry.settled;
        },
        cancel: (): void => {
          if (entry.settled) return;
          entry.cancelled = true;
          const err = new ListenerAbortError(
            "listener_cancelled",
            "Listener cancelled via handle.cancel()."
          );
          finalize(entry);
          rejectOuter(err);
        }
      });

      return handle;
    },

    evaluate(update: TypedUpdate): ListenerEvaluationResult {
      // Iterate Map in insertion (registration) order; first match
      // wins.
      for (const entry of entries.values()) {
        if (entry.settled) continue;
        // Predicate throws propagate unchanged — the router (F-10)
        // owns the dispatch-level try/catch boundary. We do NOT
        // finalize the throwing listener here because the throw is
        // a programmer bug in the consumer filter, not a matching
        // decision; leaving the listener in place matches the
        // filter contract (F-9 ADR-004).
        if (entry.filter.predicate(update)) {
          const matchedId = entry.id;
          const resolver = entry.resolve;
          finalize(entry);
          resolver(update);
          return { matched: true, listenerId: matchedId };
        }
      }
      return { matched: false };
    },

    clear(): void {
      // Snapshot to avoid mutation-during-iteration surprises;
      // finalize() deletes from the live map.
      const snapshot = Array.from(entries.values());
      for (const entry of snapshot) {
        if (entry.settled) continue;
        const rejecter = entry.reject;
        finalize(entry);
        rejecter(
          new ListenerAbortError(
            "listener_registry_cleared",
            "Listener rejected because ListenerRegistry.clear() was called."
          )
        );
      }
      entries.clear();
    }
  };

  return registry;
}
