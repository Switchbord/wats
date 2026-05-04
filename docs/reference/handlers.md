# Handlers Reference

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-21

## Purpose

Describe framework-agnostic handler registration and dispatch semantics for parsed webhook updates.

## Scope

- Update-event discriminator model (`field` + optional `subtype`)
- Routing-table registration and dispatch behavior
- Dispatch summary contract for testability and observability

## API Surface (C2)

`@wats/core` now exposes:

- `parseWebhookUpdate(rawEnvelope, options?)`
- `createUpdateRouter(options?)`

Router contracts:

- `router.on({ field, subtype? }, handler)`
  - `field` is required
  - `subtype` is optional and narrows matching when present
- `await router.dispatch(events)`
  - accepts parsed events from `parseWebhookUpdate`
  - executes matching handlers for each event via indexed lookup
  - returns structured dispatch summary
- Filter integration primitives (D1):
  - `UpdateFilter` and combinators (`and`, `or`, `not`) from `@wats/core/filters`
  - built-ins for common payload predicates (`hasMessageText`, `messageTextContains`, `messageFromWaId`, `hasMessageStatus`, `messageStatusIn`)

Router options:

- `maxHandlersPerEvent?: number`
- `maxDispatches?: number`

Default router limits (secure by default):

- `maxHandlersPerEvent`: `64`
- `maxDispatches`: `10_000`

If an option is missing, non-integer, non-finite, or `<= 0`, the router falls back to these defaults.

### Routing semantics

1) Lookup is indexed by `field` and `field+subtype` (avoids full route scan per event).
2) Routes with only `field` match all subtypes under that field.
3) Routes with `subtype` match exact subtype only.
4) Field and subtype matches are merged and dispatched in deterministic global registration order.
5) Multiple handlers are supported per route key.
6) Handler failures are captured in summary and do not stop remaining handlers (until a hard dispatch limit aborts).

### Filter integration semantics (D1)

- Filters are predicates over `ParsedUpdateEvent` and are framework-agnostic.
- Typical usage is to compose a filter and evaluate it at handler entry (or in a lightweight wrapper) before executing business logic.
- Combinators (`and`, `or`, `not`) are deterministic and side-effect free; they can be reused across handlers safely.
- Built-ins are defensive against partial/malformed payload shapes and return `false` instead of throwing.

Dispatch summary shape:

- `totalEvents`
- `matchedHandlers`
- `executedHandlers`
- `failedHandlers`
- `unmatchedEvents`
- `errors[]` (includes field/subtype/eventType, event index, handler index, and raw error)
- `capped` (true when any safety cap is applied)
- `aborted` (true when dispatch is terminated early)
- `limitError?` with typed codes:
  - `handlers_per_event_limit_exceeded` (event handler list capped)
  - `dispatches_limit_exceeded` (global dispatch budget exhausted)

Limit behavior:

- `maxHandlersPerEvent` caps per-event handler executions but continues to next events.
- `maxDispatches` aborts dispatch once budget is exhausted and returns partial summary with `aborted: true`.
- Default caps are always active unless explicitly overridden with valid positive integer values.
- Registration-order determinism is preserved even under limits.

## Usage Examples

See `docs/guides/handlers-overview.md` for parser + router end-to-end usage.

## Parity Notes

C2 establishes baseline pywa-parity routing primitives: typed event discriminators, deterministic route dispatch, and explicit failure accounting.

## Open Questions

- Whether future phases should add route priorities or middleware composition over pure registration order.
