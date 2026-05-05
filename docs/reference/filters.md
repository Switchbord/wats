# Typed filters (`@switchbord/core/filtersTyped`)

- status: active
- shipped: F-9 (`[0.2.0-f9]`)
- ADR: ADR-004 Typed updates and handler model
- Linear: WATS-21 (A1 typed filter surface), WATS-6, WATS-14

F-9 introduces a typed, type-narrowing filter surface that composes
directly over the F-8 [`TypedUpdate`](./webhook-normalizer.md)
discriminated union emitted by `normalizeWebhookEnvelope`. It replaces
the loose `ParsedUpdateEvent`-based filters in `@switchbord/core/filters`
(which remain available and untouched for backwards compatibility)
with branded, narrowing predicates that TypeScript can check across
handler boundaries.

This page is the reference for the surface. See also the router
(F-10) and listener (F-11) work that will consume these filters.

## Import surface

```ts
import {
  // Kind filters (each is a TypedFilter by itself AND a namespace)
  message,
  status,
  account,
  call,
  unknown as unknownUpdate,

  // Combinators
  and,
  or,
  not,
  custom,

  // Construction / introspection
  createTypedFilter,
  isTypedFilter,
  FILTER_BRAND,

  // Error type
  FilterValidationError,

  // Types
  type TypedFilter,
  type FilterValidationErrorCode
} from "@switchbord/core/filtersTyped";
```

Consumers of `@switchbord/core` can also reach the surface under the
`filtersTyped` namespace on the root entrypoint:

```ts
import { filtersTyped } from "@switchbord/core";
filtersTyped.message.textMatches(/^hello/);
```

### Two filter surfaces coexist (transitional)

`@switchbord/core` currently ships TWO filter surfaces side-by-side:

| Surface | Import | Status | Shape |
|---------|--------|--------|-------|
| Legacy (D1/C2) | `@switchbord/core/filters` | Preserved byte-for-byte from `[0.1.14]` / `[0.1.15]` | untyped `and`/`or`/`not` + `hasMessageText`, `messageTextContains`, `messageFromWaId`, `hasMessageStatus`, `messageStatusIn` |
| Typed (F-9)    | `@switchbord/core/filtersTyped` (this doc) | New in `[0.2.0-f9]` | branded `TypedFilter<T>` + typed `and`/`or`/`not`/`custom` + `message.*` / `status.*` built-ins |

The two surfaces are independent: the typed surface does NOT import
from the legacy one, and vice versa. The names `and` / `or` / `not`
exist on BOTH surfaces with different signatures and different
brand semantics — do not mix them in the same composition chain.
Pick one per call site; migrate at your own pace. Removal of the
legacy path is tracked for a later F-step.

## TypedFilter brand (§ overview)

`TypedFilter<T extends TypedUpdate>` is a branded object that
identifies as a filter across module boundaries. The brand symbol is
interned with `Symbol.for("@switchbord/core/filter-brand")` so filters
built in a consumer workspace still pass `isTypedFilter` against
this module.

```ts
interface TypedFilter<T extends TypedUpdate = TypedUpdate> {
  readonly [FILTER_BRAND]: true;
  readonly predicate: (update: TypedUpdate) => update is T;
  readonly describe: () => string;
}
```

- `predicate` is a synchronous TypeScript type-guard that narrows
  `TypedUpdate` to `T`.
- `describe` is a debug / logging label. Combinators compose a
  deterministic label from their children (e.g. `"and(message,
  message.textMatches(/hello/i))"`).

### `createTypedFilter(predicate, describe)`

Wraps a bespoke type-guard predicate and a `describe` function into
a `TypedFilter<T>`. The predicate is NEVER invoked during
construction — only its shape is validated.

```ts
const fromAlice = createTypedFilter<TypedMessageUpdate>(
  (u): u is TypedMessageUpdate =>
    u.kind === "message" && u.message.from === "alice",
  () => "from=alice"
);
```

Rejects a non-function `predicate` with
`FilterValidationError("invalid_predicate")` and a non-function
`describe` with `FilterValidationError("invalid_describe")`.

### `isTypedFilter(value): value is TypedFilter`

Brand check. Safe to call on `unknown`. Returns `false` for plain
objects that happen to shape like a filter but lack the
`FILTER_BRAND` symbol — a conservative guard against accidental
structural matches from untyped code.

### `FILTER_BRAND`

Exported `unique symbol`. Interned via `Symbol.for`, so a filter
produced in a consumer package still identifies correctly.

#### Brand-forgery caveat

`Symbol.for("@switchbord/core/filter-brand")` is **globally interned** by
design — that is how cross-workspace filter identity works. The flip
side is that any untrusted code running in the same realm can
produce an object that carries the same symbol key and will pass
`isTypedFilter`. Consequence:

> **The filter brand is an ergonomic contract, not a security
> boundary.** Treat `isTypedFilter` as a shape check against honest
> bugs (structural matches from untyped code), not as a defense
> against adversarial code executing in the same process.

If you are dispatching filters supplied by plugins across a trust
boundary, enforce that trust boundary at the loader (module
allow-list, signed manifests, worker isolation) — not via the
filter brand.

## Kind filters

A kind filter narrows a `TypedUpdate` to one of the normalized update variants.
Each kind filter is a `TypedFilter` by itself AND can also be used
as the base for `and(...)` / `or(...)` composition.

- `message` — matches `TypedMessageUpdate` only.
- `status` — matches `TypedStatusUpdate` only.
- `account` — matches `TypedAccountUpdate` only.
- `template` — WATS-39 template account-event namespace and kind-like filter. Matches `TypedAccountUpdate` values whose normalizer output carries `update.template`.
- `call` — WATS-41 calling namespace and kind-like filter. Matches `callConnect`, `callTerminate`, and `callStatus` updates, with helpers for connect/terminate/status/ringing/answered/rejected/incoming/outgoing.
- `unknown` — matches `TypedUnknownUpdate` only (re-exported as
  `unknown` on the barrel; rename on import if it collides).

```ts
if (message.predicate(update)) {
  // update is narrowed to TypedMessageUpdate here
  console.log(update.message.id);
}
```

`message`, `status`, and `template` are also **namespaces** carrying their
built-in factories. See below.

### Sibling-kind safety

**Every kind filter and every message / status built-in returns
`false` without throwing when given an off-kind update.** You can
safely evaluate `message.textMatches(/foo/).predicate(statusUpdate)`
and get `false` back — the outer kind guard runs before any
body-specific inspection. This is asserted in the unit tests and
the core-consumer fixture.

## Calling filters (WATS-41)

`call` is a branded filter namespace for typed calling updates emitted by
`normalizeWebhookEnvelope(...)` from `field: "calls"` payloads.

```ts
import { call, and } from "@switchbord/core/filtersTyped";

const answeredIncoming = and(call.answered(), call.incoming());
if (call.connect().predicate(update)) {
  console.log(update.call.id, update.call.direction);
}
```

Helpers:

- `call` — any `callConnect`, `callTerminate`, or `callStatus` update.
- `call.connect()` — `kind === "callConnect"`.
- `call.terminate()` — `kind === "callTerminate"`.
- `call.status()` — any `kind === "callStatus"`.
- `call.ringing()` / `call.answered()` / `call.rejected()` — call status
  values `RINGING`, `ACCEPTED`, and `REJECTED`.
- `call.incoming()` / `call.outgoing()` — connect/terminate updates whose
  direction is `USER_INITIATED` or `BUSINESS_INITIATED`.

Sibling-kind safety applies: every calling helper returns `false`, not a thrown
property-access error, for message/status/account/template/unknown updates.

## Combinators

All combinators short-circuit and return new `TypedFilter` instances.
They validate their inputs at construction time via `isTypedFilter`
and the `FilterValidationError` codes below. They do **not** try /
catch — a consumer-supplied `custom()` predicate that throws will
propagate its error to the caller unchanged.

### `and(...filters)`

```ts
and(message, message.textMatches(/hello/i));
```

- Zero args → `FilterValidationError("empty_args")`.
- Any non-`TypedFilter` argument → `FilterValidationError("not_a_filter")`.
- Returns a branded `TypedFilter<T>` whose `describe()` is
  `"and(<child1>, <child2>, ...)"`.

### `or(...filters)`

```ts
or(status.sent(), status.delivered());
```

Same validation contract as `and`. Matches if any child matches.

### `not(filter)`

```ts
not(message);
```

Inverts a filter. Note that negating a narrowing is no longer a
narrowing — the result is typed as `TypedFilter<TypedUpdate>`.

Rejects a non-filter arg with `FilterValidationError("not_a_filter")`.

### `custom(predicate, describe?)`

```ts
custom<TypedMessageUpdate>(
  (u): u is TypedMessageUpdate =>
    u.kind === "message" && u.message.from === "15551234567",
  "from=15551234567"
);
```

Wraps a user-supplied type-guard. Synchronous by contract — if the
predicate throws, the throw propagates. Rejects a non-function
predicate with `FilterValidationError("invalid_predicate")`.

## Message built-ins (`message.*`)

Message built-ins target `TypedMessageUpdate`. They each check
`u.kind === "message"` first; an off-kind update returns `false`
immediately (never throws). WATS-43A extends the original text/type/from
set with media, location, reaction, interactive-reply, and quick-reply
button helpers over the deep-normalized message body families emitted by
`normalizeWebhookEnvelope`.

### `message.text(substring?)`

- Matches any text message (`u.message.type === "text"` and
  `u.message.text.body` is a string) when called without a substring.
- With a substring, matches when the body contains the substring
  (case-sensitive).
- `message.text("")` rejected at construction with
  `FilterValidationError("empty_substring")`. Non-string substring
  rejected with `invalid_predicate`.

```ts
const hasHello = message.text("hello");
```

### `message.textMatches(pattern)`

- Accepts a `RegExp` or a string pattern. Strings are compiled via
  `new RegExp(pattern)` inside a try/catch; unparseable patterns
  throw `FilterValidationError("invalid_pattern")`.
- Matches when the text body matches the pattern.
- **RegExp flag handling.** The factory clones the supplied regex at
  construction time and strips the `g` (global) and `y` (sticky)
  flags on the clone. These two flags make `RegExp.prototype.test`
  mutate `lastIndex`, which would leak state across successive
  predicate calls and break filter purity (returning alternating
  `true` / `false` on identical input). All other flags
  (`i`, `m`, `s`, `u`, `v`, `d`) are preserved. The caller-owned
  regex is never mutated — its `lastIndex` remains untouched.
  Implementation: `new RegExp(regex.source, regex.flags.replace(/[gy]/g, ""))`.

```ts
const startsWithHi = message.textMatches(/^hi\b/i);

// /g and /y are stripped on the internal clone; the predicate is
// stateless and the caller-owned regex is untouched:
const r = /hello/g;
const f = message.textMatches(r);
f.predicate(update); // true
f.predicate(update); // true (not alternating)
r.lastIndex;         // still 0
```

### `message.textEquals(value)`

- Exact (case-sensitive) body equality. Non-string `value` rejected.

### `message.type(messageType)`

- Narrows on the inner `.type` discriminator of `WhatsAppMessage`.
  Pass a closed literal (e.g. `"image"`, `"button"`, `"interactive"`).
- Empty-string / non-string rejected.

### `message.from(phoneNumber)`

- Matches when `u.message.from === phoneNumber` — **strict string
  equality**. No E.164 normalization is performed: the filter does
  not add or strip `+`, leading zeros, country-code prefixes, or
  whitespace. Callers who need canonicalization should normalize both
  sides before construction (e.g., via `libphonenumber-js`) or
  compose with `custom(...)` for richer matching logic.
- Empty / non-string rejected.

### WATS-43A media, location, reaction, interactive, and button helpers

- `message.media()` — matches any normalized media message body: image,
  video, audio, document, or sticker.
- `message.image()` / `video()` / `audio()` / `document()` / `sticker()` —
  match the corresponding normalized media subtype.
- `message.location()` — matches normalized location messages.
- `message.reaction(emoji?)` — matches reaction messages, optionally by exact
  emoji. Empty / whitespace-only / non-string exact values throw
  `FilterValidationError`.
- `message.reactionAdded()` — matches reaction messages whose normalized
  `reaction.emoji` is non-empty.
- `message.reactionRemoved()` — matches reaction messages whose normalized
  `reaction.emoji` is the empty string.
- `message.interactive()` — matches normalized interactive replies.
- `message.interactiveButtonReply(id?)` — matches `interactive.type ===
  "button_reply"`, optionally by exact reply id.
- `message.interactiveListReply(id?)` — matches `interactive.type ===
  "list_reply"`, optionally by exact row id.
- `message.interactiveNfmReply()` — matches `interactive.type === "nfm_reply"`
  Flow-completion replies.
- `message.button(payload?)` — matches quick-reply `type: "button"` messages,
  optionally by exact payload.

All WATS-43A helpers use normalized camelCase message fields and do not inspect
`rawChange`; malformed same-kind bodies return `false` rather than throwing.

### Still deferred

- command parsing, MIME/extension filters, location radius filters, generic
  callback-data factories, and pywa sent-update waiter ergonomics remain future
  WATS-43 follow-up work.

## Status built-ins (`status.*`)

All four status built-ins target `TypedStatusUpdate` and match
against the closed `WhatsAppMessageStatusKind` discriminator. Each
returns `false` (never throws) for off-kind updates.

- `status.sent()` — matches `status.status === "sent"`.
- `status.delivered()` — matches `"delivered"`.
- `status.read()` — matches `"read"`.
- `status.failed()` — matches `"failed"`.

### Forward-declared

- `status.deleted()` — pending a status-wire audit.
- Per-error-code matchers — pending the F-5 error registry surface
  exposed via `TypedStatusUpdate.status.errors[]`.

## Template account-event built-ins (`template.*`) — WATS-39

The `template` export is a branded `TypedFilter<TypedAccountUpdate>`
and a namespace for template webhook filters. It matches account
updates where `normalizeWebhookEnvelope` populated `update.template`
from a template status/quality/category/components payload.

- `template.status()` — matches `message_template_status_update`
  account updates with normalized template fields.
- `template.status("APPROVED")` — additionally checks the status
  event string.
- `template.name(value)` / `template.id(value)` /
  `template.language(value)` — match normalized template helper fields.

All template filters are sibling-kind safe: message/status/unknown
updates and non-template account updates return `false` without
throwing. Factory arguments must be non-empty strings; malformed values
throw `FilterValidationError` at construction.

## Error taxonomy

`FilterValidationError extends Error` is thrown only at
**construction time** (factory invocation). Its stable `.code` field
is one of:

- `empty_args` — `and()` / `or()` called with zero filters.
- `not_a_filter` — `and`/`or`/`not` received an argument that does
  not pass `isTypedFilter`.
- `invalid_pattern` — `message.textMatches(pattern)` received a
  non-string / non-RegExp pattern, or a string pattern that
  `new RegExp(...)` could not parse.
- `invalid_predicate` — `createTypedFilter` / `custom` / the
  built-ins received a non-function predicate or the wrong-typed
  scalar.
- `empty_substring` — `message.text('')` / `message.type('')` /
  `message.from('')` called with an empty string.
- `invalid_describe` — `createTypedFilter` received a non-function
  `describe`.

### Evaluation-time exception policy

Filter predicates do NOT swallow exceptions. If a consumer-supplied
`custom(fn)` predicate throws, the throw propagates unchanged to the
caller of `filter.predicate(update)` and through any enclosing
`and`/`or`/`not`. **The router / dispatch layer (F-10) owns the
final try/catch boundary** — filters themselves are pure functions
and must not rethrow, wrap, or log errors. This keeps the filter
surface composable and avoids hiding programmer error behind silent
`false` returns.

## Type narrowing guarantee

`TypedFilter<T>.predicate` is a TypeScript type guard (`update is T`).
Applied to a `TypedUpdate`, it narrows the variable inside the
truthy branch:

```ts
function handle(update: TypedUpdate) {
  if (message.predicate(update)) {
    // update: TypedMessageUpdate
    // update.message is the inner WhatsAppMessage
  } else if (status.predicate(update)) {
    // update: TypedStatusUpdate
  }
}
```

`and(a, b)` returns `TypedFilter<A & B>`; `or(a, b)` returns
`TypedFilter<A | B>`; `not(a)` returns `TypedFilter<TypedUpdate>`
(negation erases the narrowing).

## Full usage example

```typescript
import { normalizeWebhookEnvelope } from "@switchbord/core";
import {
  and,
  custom,
  message,
  status
} from "@switchbord/core/filtersTyped";
import type { TypedMessageUpdate } from "@switchbord/core";

const helloFromAlice = and(
  message,
  message.textMatches(/hello/i),
  custom<TypedMessageUpdate>(
    (u): u is TypedMessageUpdate =>
      u.kind === "message" && u.message.from === "alice",
    "from=alice"
  )
);

const deliveredStatuses = status.delivered();

const result = normalizeWebhookEnvelope(envelope);
for (const update of result.updates) {
  if (helloFromAlice.predicate(update)) {
    // update: TypedMessageUpdate — narrowed, `update.message.from === "alice"`
  } else if (deliveredStatuses.predicate(update)) {
    // update: TypedStatusUpdate — narrowed
  }
}
```

## Scope ledger (F-9)

In scope:
- `TypedFilter` brand + `createTypedFilter` + `isTypedFilter`.
- `FilterValidationError` + construction-time validation.
- `and` / `or` / `not` / `custom` combinators.
- Kind filters: `message` / `status` / `account` / `unknown`.
- Message built-ins: `text` / `textMatches` / `textEquals` /
  `type` / `from`.
- Status built-ins: `sent` / `delivered` / `read` / `failed`.
- Sibling-kind safety (no throws on off-kind).
- Subpath export `@switchbord/core/filtersTyped` + root namespace
  `filtersTyped`.

Out of scope (deferred):
- Extended message built-ins (media, interactive, reaction,
  location).
- Extended status built-ins (`deleted`, per-error-code).
- Account / unknown built-in factories.
- Router / dispatch integration — that is F-10.
- Listener registration — that is F-11.
- Async filter predicates.
- Removal of the legacy `@switchbord/core/filters` path — consumers
  migrate at their own pace.

## References

- ADR-004 — Typed updates + handler model.
- F-8 — [`normalizeWebhookEnvelope`](./webhook-normalizer.md) (the
  producer of the `TypedUpdate` union consumed by filters)
- Public API surface — [`docs/architecture/public-api-surface.md`](../architecture/public-api-surface.md)
