# Listeners Reference

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-22

## Purpose

The listener substrate lets a handler (or any async flow) **wait for
a future typed update that matches a filter**, enabling conversational
patterns without hand-rolling ad-hoc Promise wiring. F-11 closes
WATS-22 (Arch-H listener substrate) per the foundations-pivot plan.

## Scope

- `createListenerRegistry` factory + `ListenerRegistry` /
  `ListenerHandle` contract.
- Timeout + AbortSignal support, cancel, clear-all.
- First-match-wins semantics across concurrent listeners.
- TypedRouter integration via an optional `listenerRegistry` hook.
- WhatsApp facade delegation: `wa.listen({ type, from?, filter?,
  timeoutMs?, signal? })`.
- WATS-78 sent-result waiters (`waitForReply`, `waitUntilRead`, etc.) built on the same registry.
- Observer seam: `onListenerMatch(dispatchId, listenerId, update)`.

## Listener substrate overview

```ts
import {
  WhatsApp,
  createListenerRegistry,
  ListenerAbortError,
  ListenerTimeoutError,
  type ListenerHandle
} from "@wats/core";
import { message } from "@wats/core/filtersTyped";

const wa = new WhatsApp({ graphClient });

// Facade-local listener substrate (lazy). Returns a frozen handle
// carrying { id, promise, cancel, cancelled, settled }.
const reply: ListenerHandle = wa.listen({
  type: "message",
  from: "15551234567",
  timeoutMs: 30_000
});

// Somewhere else: the webhook adapter calls wa.dispatch(update) as
// updates arrive. The listener's promise resolves to the matching
// TypedMessageUpdate — listener evaluation runs BEFORE the handler
// loop per the F-11 plan DoD, but the update still flows through
// normal handlers (additive, not short-circuit).
try {
  const reply = await reply.promise;
  console.log("got reply:", reply.message.text?.body);
} catch (err) {
  if (err instanceof ListenerTimeoutError) {
    // No matching update within 30_000 ms.
  } else if (err instanceof ListenerAbortError) {
    // reply.cancel() was called, or an AbortSignal aborted.
  }
}
```

The substrate is intentionally tiny. All heavy lifting lives in the
components it composes — the F-9 `TypedFilter` surface (matching
logic), the F-10 `TypedRouter` (dispatch), and the F-10 `WhatsApp`
facade (composition root).

## createListenerRegistry

```ts
function createListenerRegistry(
  options?: ListenerRegistryOptions
): ListenerRegistry;

interface ListenerRegistryOptions {
  readonly maxActiveListeners?: number; // default: 10_000
}

interface ListenerRegistry {
  readonly activeCount: number;
  register<T extends TypedUpdate>(
    filter: TypedFilter<T>,
    options?: ListenerOptions
  ): ListenerHandle<T>;
  evaluate(update: TypedUpdate): {
    readonly matched: boolean;
    readonly listenerId?: symbol;
  };
  clear(): void;
}
```

`createListenerRegistry()` returns an in-memory registry. Consumers
either use the facade-owned registry exposed via `wa.listenerRegistry`
(lazily created on first `.listen()` call) or construct their own and
pass it via `new WhatsApp({ listenerRegistry })`.

### register(filter, options?)

- `filter` must be a branded `TypedFilter<T>` (see
  `docs/reference/filters.md`). Any non-filter throws
  `ListenerOptionsError("invalid_filter")`.
- `options.timeoutMs` (optional positive integer): rejects the handle
  with `ListenerTimeoutError` after N milliseconds and removes the
  listener from the registry. `0`, negative, non-integer, `NaN`, and
  `Infinity` all throw `ListenerOptionsError("invalid_timeout")` at
  construction.
- `options.signal` (optional `AbortSignal`): rejects with
  `ListenerAbortError("listener_signal_aborted")` on abort. An
  already-aborted signal at register time rejects **synchronously**
  and the listener never enters the registry (so `activeCount` is
  unaffected).
- `options.description` (optional string): debug label. Non-string
  throws `ListenerOptionsError("invalid_description")`.
- If `activeCount` is already at `maxActiveListeners`, `register`
  throws `ListenerOptionsError("max_listeners_exceeded")` **before
  any side-effects** (no timer or signal listener is attached).

Returns a frozen `ListenerHandle<T>`:

```ts
interface ListenerHandle<T extends TypedUpdate = TypedUpdate> {
  readonly id: symbol;
  readonly promise: Promise<T>;
  readonly cancelled: boolean;
  readonly settled: boolean;
  cancel(): void;
}
```

- `id` — unique `Symbol`; matches `evaluate(update).listenerId` when
  this listener wins a match.
- `promise` — resolves to the matched `TypedUpdate` OR rejects with
  `ListenerTimeoutError` / `ListenerAbortError`. Never resolves twice.
- `cancelled` — flips `true` only when `.cancel()` is called.
- `settled` — flips `true` on any settlement path (match, timeout,
  abort, cancel, registry clear).
- `cancel()` — idempotent; rejects a pending promise with
  `ListenerAbortError("listener_cancelled")`. No-op after `settled`.

Every settlement path runs through a single internal `finalize()`
helper that clears the timer, removes the abort listener, flips
`settled`, and removes the registry entry. No dangling `setTimeout`
or `AbortSignal` listeners survive a settled listener.

### evaluate(update)

The router (or any caller) passes an incoming `TypedUpdate`. The
registry iterates listeners in **registration order** and resolves
the **first** matching listener — this is the **first-match-wins**
contract:

- If 3 listeners all match the same update, only the first (by
  registration order) resolves; the other two stay pending.
- The winning listener is removed from the registry **before** its
  promise resolves, so chained `.then(...)` code sees
  `activeCount` already decremented.
- Predicate throws propagate unchanged — a `custom()` filter that
  throws surfaces the throw to the caller of `evaluate()`. The F-10
  router (and the WhatsApp facade dispatch wrapper) isolate these
  throws so the dispatch resolution contract survives.

### clear()

Rejects every pending listener with
`ListenerAbortError("listener_registry_cleared")` and empties the
registry. Typically invoked on graceful shutdown.

## Listener BEFORE handler ordering (plan DoD)

The F-11 plan pins the contract: **listener resolution runs BEFORE
the handler loop on every dispatch**. The update still flows through
normal handlers — listeners are additive, not short-circuit. In
practice this means:

- Register a listener for `{ type: "message", from: USER }`.
- Register a handler that logs every incoming message.
- Dispatch an update matching both.
- The listener wins its match first (its promise resolves); the
  handler still fires.

```ts
const lh = wa.listen({ type: "message" });
wa.on(message, () => console.log("handler saw message"));

await wa.dispatch(update);
const u = await lh.promise; // resolves
// Console still shows "handler saw message".
```

This shape mirrors pywa's `listeners.py` / handler interplay and
keeps normal routing unaffected by the listener substrate.

## Sent-result waiters (WATS-78)

WATS-78 layers facade sent-result waiters on this same listener registry.
`WhatsApp.startChat(...)` returns a waitable send result whose helpers register
one-shot listeners under the hood:

- `waitForReply({ timeoutMs?, signal? })`
- `waitUntilDelivered({ timeoutMs?, signal? })`
- `waitUntilRead({ timeoutMs?, signal? })`
- `waitUntilFailed({ timeoutMs?, signal? })`

These helpers have the same timeoutMs and AbortSignal cleanup guarantees as
`wa.listen(...)`. They are convenience filters over observed future webhooks;
they do not add persistence, replay, delivery guarantees, or read/delivered
inference.

## TypedRouter integration

`TypedRouterOptions` accepts an optional `listenerRegistry` hook:

```ts
import { TypedRouter, createListenerRegistry } from "@wats/core";

const registry = createListenerRegistry();
const router = new TypedRouter({ listenerRegistry: registry });
```

When the router's `dispatch(update)` is invoked:

1. `observer.onBeforeDispatch(dispatchId, update)` fires.
2. `listenerRegistry.evaluate(update)` runs — at most one listener
   wins (first-match-wins).
3. If a listener matched, `observer.onListenerMatch(dispatchId,
   listenerId, update)` fires.
4. The normal handler loop runs unchanged — snapshot semantics,
   error collection, `"stop"` return, etc.
5. `observer.onAfterDispatch(dispatchId, report)` fires.

Listener-predicate throws during evaluation are **isolated** at the
router boundary: the throw is swallowed so the dispatch still
resolves normally. A throwing listener filter is a programmer bug
in consumer code; observe it via your own logging.

## WhatsApp.listen facade method

The facade is the ergonomic surface. It lazily creates a default
`ListenerRegistry` on first call (unless the caller supplied one via
`new WhatsApp({ listenerRegistry })`).

```ts
interface WhatsAppListenOptions<TKind extends TypedUpdate["kind"]> {
  readonly type: TKind;                 // kind gate — narrows T
  readonly from?: string;               // optional sender wa_id narrower
  readonly filter?: TypedFilter<...>;   // optional extra constraint
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly description?: string;
}

wa.listen<TKind>(
  options: WhatsAppListenOptions<TKind>
): ListenerHandle<Extract<TypedUpdate, { kind: TKind }>>;
```

The facade composes the kind gate, the optional `from` narrower, and
the optional user-supplied `filter` via `and(...)` from
`@wats/core/filtersTyped`.

Additional facade surface:

- `wa.listenerRegistry` — getter returning the current registry (or
  `undefined` before the first `.listen()` call when the caller did
  not supply one at construction).
- `wa.activeListenerCount` — convenience getter equivalent to
  `wa.listenerRegistry?.activeCount ?? 0`.
- `WhatsAppListenOptionsError` — thrown by `.listen()` for invalid
  options; `.code` taxonomy: `"invalid_listen_options"` /
  `"invalid_listen_type"` / `"invalid_listen_from"` /
  `"invalid_listen_filter"`.

## Error taxonomy

All three error classes extend `Error` and carry a stable `.code`
field.

| Class | Code | When |
| --- | --- | --- |
| `ListenerTimeoutError` | `"listener_timeout"` | `options.timeoutMs` elapsed |
| `ListenerAbortError` | `"listener_cancelled"` | `handle.cancel()` |
| `ListenerAbortError` | `"listener_signal_aborted"` | `AbortSignal` aborted |
| `ListenerAbortError` | `"listener_registry_cleared"` | `registry.clear()` |
| `ListenerOptionsError` | `"invalid_filter"` | Non-branded filter |
| `ListenerOptionsError` | `"invalid_options"` | Non-object options |
| `ListenerOptionsError` | `"invalid_timeout"` | `timeoutMs` not a positive integer |
| `ListenerOptionsError` | `"invalid_signal"` | `signal` not AbortSignal-shaped |
| `ListenerOptionsError` | `"invalid_description"` | `description` not a string |
| `ListenerOptionsError` | `"max_listeners_exceeded"` | `activeCount >= maxActiveListeners` (default 10_000) |
| `ListenerOptionsError` | `"invalid_max_active_listeners"` | `maxActiveListeners` not a positive integer |

The facade surfaces `WhatsAppListenOptionsError` for facade-scoped
validation (unknown `type`, empty `from`, non-object `filter`); the
underlying `ListenerRegistry.register` runs afterwards and may still
throw `ListenerOptionsError` for options it validates directly.

## Observer seam: onListenerMatch

```ts
interface RouterObserver {
  // ... existing hooks ...
  onListenerMatch?: (
    dispatchId: string,
    listenerId: symbol,
    update: TypedUpdate
  ) => void;
}
```

The hook fires once per dispatch only when a listener wins its match.
Throws inside `onListenerMatch` are isolated (silent-swallow) per the
F-10 observer-throw policy — they never poison the dispatch report.

## Parity notes

`pywa/listeners.py` exposes `client.listen(...)` with a similar
kind + from-narrower surface. WATS F-11 matches the shape under the
aggressive-parity mandate: kind discriminant, optional `from`
narrower, optional extra filter, `timeoutMs` + `signal`. Differences:

- WATS returns a `ListenerHandle` with `{ promise, cancel }` instead
  of a raw Promise, so callers can cancel without wiring an
  `AbortController`.
- WATS listener evaluation runs **before** handler dispatch per plan
  DoD. pywa handlers and listeners interleave on a thread-queue; WATS
  fires listener resolution synchronously in `dispatch()` and then
  runs the handler loop.
- WATS is single-process / in-memory; pywa's listener table is
  similarly in-process. No persistence layer exists in either.

## Scope ledger (non-goals)

F-11 intentionally excludes:

- **No persistence.** Listener state lives in memory only; a process
  restart drops all pending listeners. Cross-process distribution is
  out of scope.
- **No cross-instance distribution.** A listener registered on one
  `WhatsApp` instance is invisible to another instance in the same
  process or a different process.
- **No listener deduplication** across identical filters. Two
  `wa.listen({ type: "message" })` calls create two independent
  handles.
- **No send-and-wait combinator.** Ergonomic helpers like
  `sendAndWait(message, filter)` are tracked for a later F-step.
- **No Clock abstraction.** Timeouts use real `setTimeout`.
  `FakeClock` threading is tracked for a later F-step if
  deterministic tests require it; today the contract is a numeric
  `timeoutMs`.
- **No @wats/http webhook wiring.** F-12 owns that integration — the
  adapter calls `wa.dispatch(update)` as envelopes arrive.

## Open questions

- Should a Clock abstraction thread through the listener substrate
  for deterministic FakeClock-driven tests? Plan notes this was
  flagged in architecture notes §5 but not required for F-11 behaviour.
- Should the facade expose a `sendAndWait` combinator that combines
  `.listen()` with a scoped-client send in one call? Consider for
  WATS-25 follow-up.
