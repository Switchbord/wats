# ADR-004: Typed Updates and Handler Model

- status: Accepted
- decisionStatus: locked
- date: 2026-04-21
- depends on: ADR-001 (API shape), ADR-002 (foundations pivot)
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo, foundations,
  typed-updates, handlers, listeners]

## Context

The C2 substrate (`parseWebhookUpdate` + `createUpdateRouter`) produces
`ParsedUpdateEvent[]` keyed by a `{ field, subtype? }` discriminator. It is
correct, deterministic, and 65/65 green. What it is not is usable as a
public handler DSL. Users who want pywa-style ergonomics
(`client.onMessage(filter, handler)`, `client.listen({...})`,
`client.onCallbackButton(...)`) have to re-implement narrowing and
snake_case-to-camelCase normalization in every handler.

Pywa handles this with 22 typed update classes (`pywa/handlers.py`), a
domain type tree (`pywa/types/`), and a listener substrate
(`pywa/listeners.py`). WATS needs the same ergonomic surface without
inheriting pywa's runtime choices: we are Bun-first, async-only,
camelCase-only, and TypeScript-discriminated-union-native.

This ADR specifies:

1. The typed update normalizer above the raw envelope parser (WATS-16).
2. The `TypedUpdate` discriminated union (WATS-23, extending WhatsApp domain
   types).
3. The handler registration model on the `WhatsApp` facade (WATS-15).
4. The per-type filter namespaces that replace the raw-event filter DSL as
   the recommended user surface (retains WATS-6, WATS-14 fixes).
5. The listener substrate (WATS-22) and its dependency on `Clock` injection
   (WATS-26).

No source changes are made in this ADR; it is a design-locked specification.
Implementation lands under WATS-15/16/22/23/26 in the foundations pivot
cycle.

## Decision

### 1. Typed update normalizer

A pure, deterministic, side-effect-free function that sits above
`parseWebhookUpdate`:

```ts
import type { ParsedUpdateEvent } from "@switchbord/core/router";

export interface TypedUpdateMetadata {
  phoneNumberId: string;
  displayPhoneNumber?: string;
  timestamp: Date;
  entryId?: string;
  entryTime?: number;
}

export type NormalizerErrorCode =
  | "invalid_parsed_events"
  | "internal_normalizer_error";

export interface NormalizerError {
  code: NormalizerErrorCode;
  message: string;
}

export type NormalizeUpdatesResult =
  | {
      ok: true;
      updates: TypedUpdate[];
      skipped: number;
      raw: readonly ParsedUpdateEvent[];
    }
  | {
      ok: false;
      error: NormalizerError;
    };

export interface NormalizeUpdatesOptions {
  clock?: Clock;          // see WATS-26
  logger?: Logger;        // see WATS-26
}

export function normalizeUpdates(
  events: readonly ParsedUpdateEvent[],
  options?: NormalizeUpdatesOptions
): NormalizeUpdatesResult;
```

Contract:

- Pure. No I/O. No module-scoped state. Safe to call concurrently.
- Deterministic. Same input yields identical output across calls (modulo
  `clock.now()` which is only used as a fallback when the payload omits a
  usable timestamp).
- Async-safe. The function itself is synchronous and non-blocking; it is
  used inside async dispatch pipelines without await contention.
- Does not throw. Malformed fragments are captured as `RawUpdate` variants
  and counted in the `skipped` total for observability. See WATS-10.
- Does not mutate input. Each `TypedUpdate` carries a reference to its
  source `ParsedUpdateEvent` via the `raw` field (WATS-10 catch-all preserved).
- camelCase-normalized on the typed surface. The `raw` reference preserves
  the original snake_case payload byte-for-byte (WATS-2).

Error returns are reserved for programmer errors in the caller (e.g.,
passing a non-array where `ParsedUpdateEvent[]` is expected) and for
internal invariants that would otherwise be silent. Data shape problems in
individual events never produce `ok: false`; they produce a `RawUpdate`.

### 2. `TypedUpdate` discriminated union (WATS-23)

Every `TypedUpdate` carries:

```ts
export interface TypedUpdateBase<TKind extends string> {
  type: TKind;                           // string literal discriminator
  raw: ParsedUpdateEvent;                // unmodified source reference
  metadata: TypedUpdateMetadata;         // camelCase-normalized
}
```

The union covers pywa's 22 typed update classes at minimum:

Message variants (narrowed by `messages[].type`):

```ts
export type MessageUpdate =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | DocumentMessage
  | StickerMessage
  | LocationMessage
  | ContactsMessage
  | ReactionMessage
  | OrderMessage
  | SystemMessage
  | UnsupportedMessage;

export interface TextMessage extends TypedUpdateBase<"message.text"> {
  messageId: string;
  from: string;
  timestamp: Date;
  text: { body: string };
  context?: WhatsAppMessageContext;
}

export interface ImageMessage extends TypedUpdateBase<"message.image"> {
  messageId: string;
  from: string;
  timestamp: Date;
  image: { mediaId: string; mimeType: string; sha256: string; caption?: string };
  context?: WhatsAppMessageContext;
}

// ... one interface per message media type, same shape.

export interface UnsupportedMessage
  extends TypedUpdateBase<"message.unsupported"> {
  messageId: string;
  from: string;
  timestamp: Date;
  errors?: readonly WhatsAppErrorPayload[];
}
```

Interactive variants (narrowed by `messages[].interactive.type`):

```ts
export type InteractiveUpdate =
  | InteractiveButtonReply
  | InteractiveListReply
  | InteractiveNfmReply          // flow completion reply from interactive
  | InteractiveProductReply
  | InteractiveProductListReply
  | InteractiveCtaUrlReply;

export interface InteractiveButtonReply
  extends TypedUpdateBase<"interactive.buttonReply"> {
  messageId: string;
  from: string;
  timestamp: Date;
  reply: { id: string; title: string };
  context?: WhatsAppMessageContext;
}

export interface InteractiveListReply
  extends TypedUpdateBase<"interactive.listReply"> {
  messageId: string;
  from: string;
  timestamp: Date;
  reply: { id: string; title: string; description?: string };
  context?: WhatsAppMessageContext;
}
```

Button message (legacy template button):

```ts
export interface ButtonMessage extends TypedUpdateBase<"message.button"> {
  messageId: string;
  from: string;
  timestamp: Date;
  button: { text: string; payload: string };
  context?: WhatsAppMessageContext;
}
```

Status variants (narrowed by `statuses[].status`):

```ts
export type MessageStatusUpdate =
  | MessageStatusSent
  | MessageStatusDelivered
  | MessageStatusRead
  | MessageStatusFailed
  | MessageStatusDeleted
  | MessageStatusWarning;

export interface MessageStatusSent
  extends TypedUpdateBase<"messageStatus.sent"> {
  messageId: string;
  recipientId: string;
  timestamp: Date;
  conversation?: { id: string; origin?: { type: string } };
  pricing?: { category: string; pricingModel: string };
}

// ... delivered/read/failed/deleted/warning mirror the same base shape with
// additional status-specific fields (errors for failed, deletion reason for
// deleted, warning detail for warning).
```

Template status:

```ts
export interface TemplateStatusUpdate
  extends TypedUpdateBase<"templateStatusUpdate"> {
  templateId: string;
  templateName?: string;
  event: string;             // approved / rejected / paused / disabled / flagged
  reason?: string;
  otherInfo?: Record<string, unknown>;
}
```

Flow completion (top-level flow update, distinct from interactive nfm reply):

```ts
export interface FlowCompletion extends TypedUpdateBase<"flowCompletion"> {
  flowToken: string;
  responseJson?: unknown;
  name?: string;
}
```

Call events:

```ts
export type CallUpdate = CallConnect | CallTerminate | CallStatus;

export interface CallConnect extends TypedUpdateBase<"call.connect"> {
  callId: string;
  from: string;
  timestamp: Date;
  sessionDescription?: { type: string; sdp: string };
}

export interface CallTerminate extends TypedUpdateBase<"call.terminate"> {
  callId: string;
  from: string;
  timestamp: Date;
  duration?: number;
  status?: string;
}

export interface CallStatus extends TypedUpdateBase<"call.status"> {
  callId: string;
  from: string;
  timestamp: Date;
  status: string;
}
```

Chat + account events:

```ts
export interface ChatOpened extends TypedUpdateBase<"chatOpened"> {
  from: string;
  timestamp: Date;
}

export interface PhoneNumberChange
  extends TypedUpdateBase<"account.phoneNumberChange"> {
  oldPhoneNumber?: string;
  newPhoneNumber?: string;
  effectiveAt?: Date;
}

export interface IdentityChange
  extends TypedUpdateBase<"account.identityChange"> {
  waId: string;
  acknowledged: boolean;
  createdTimestamp?: Date;
  hash?: string;
}

export interface UserMarketingPreferences
  extends TypedUpdateBase<"account.userMarketingPreferences"> {
  waId: string;
  optIn: boolean;
  changedAt?: Date;
  category?: string;
}
```

Catch-all (WATS-10):

```ts
export interface RawUpdate extends TypedUpdateBase<"raw"> {
  reason:
    | "unknown_field"
    | "unknown_subtype"
    | "malformed_message_shape"
    | "malformed_status_shape"
    | "malformed_timestamp"
    | "internal_normalizer_fallback";
  // raw (inherited) holds the full ParsedUpdateEvent; userland inspects it.
}

export type TypedUpdate =
  | MessageUpdate
  | InteractiveUpdate
  | ButtonMessage
  | MessageStatusUpdate
  | TemplateStatusUpdate
  | FlowCompletion
  | CallUpdate
  | ChatOpened
  | PhoneNumberChange
  | IdentityChange
  | UserMarketingPreferences
  | RawUpdate;
```

Contract notes:

- Every member has a `type` string literal. Exhaustive `switch` narrows in
  TypeScript without external tooling.
- Every member has `raw: ParsedUpdateEvent`. Userland never loses access to
  the original snake_case payload; consumers opt into strict camelCase at
  the typed layer and reach through `raw` for forward compatibility.
- Index signatures are closed on the typed members (WATS-23 fix). Future
  fields added by Meta surface through `raw` until the normalizer promotes
  them.
- Normalization is a one-time boundary: it happens in the normalizer, not
  in filters, not in handlers, not in userland. This closes WATS-2 at the
  single correct layer.

### 3. Handler model

The `WhatsApp` facade exposes one registration method per discriminator
kind plus a low-level escape hatch. Each registration returns a disposer.

```ts
export interface HandlerRegistration {
  dispose(): void;
}

export interface WhatsApp {
  // Typed handler methods, one per discriminator group.
  onMessage(
    filter: TypedFilter<MessageUpdate> | undefined,
    handler: TypedHandler<MessageUpdate>
  ): HandlerRegistration;

  onInteractive(
    filter: TypedFilter<InteractiveUpdate> | undefined,
    handler: TypedHandler<InteractiveUpdate>
  ): HandlerRegistration;

  onButton(
    filter: TypedFilter<ButtonMessage> | undefined,
    handler: TypedHandler<ButtonMessage>
  ): HandlerRegistration;

  onMessageStatus(
    filter: TypedFilter<MessageStatusUpdate> | undefined,
    handler: TypedHandler<MessageStatusUpdate>
  ): HandlerRegistration;

  onTemplateStatusUpdate(
    filter: TypedFilter<TemplateStatusUpdate> | undefined,
    handler: TypedHandler<TemplateStatusUpdate>
  ): HandlerRegistration;

  onFlowCompletion(
    filter: TypedFilter<FlowCompletion> | undefined,
    handler: TypedHandler<FlowCompletion>
  ): HandlerRegistration;

  onCall(
    filter: TypedFilter<CallUpdate> | undefined,
    handler: TypedHandler<CallUpdate>
  ): HandlerRegistration;

  onChatOpened(
    filter: TypedFilter<ChatOpened> | undefined,
    handler: TypedHandler<ChatOpened>
  ): HandlerRegistration;

  onAccountChange(
    filter:
      | TypedFilter<PhoneNumberChange | IdentityChange | UserMarketingPreferences>
      | undefined,
    handler:
      TypedHandler<PhoneNumberChange | IdentityChange | UserMarketingPreferences>
  ): HandlerRegistration;

  // Low-level escape hatch (unchanged semantics from existing router).
  onRaw(
    selector: UpdateRouteSelector,
    handler: UpdateRouteHandler
  ): HandlerRegistration;

  // Listener substrate (see section 5).
  listen<TKind extends TypedUpdate["type"]>(
    options: ListenOptions<TKind>
  ): Promise<Extract<TypedUpdate, { type: TKind }>>;

  // Dispatch pipeline entry point (invoked by webhook adapters).
  handleEnvelope(
    rawEnvelope: unknown
  ): Promise<HandleEnvelopeSummary>;
}

export type TypedHandler<T extends TypedUpdate> = (
  client: WhatsApp,
  update: T,
  context?: { signal: AbortSignal }
) => void | Promise<void>;

export type TypedFilter<T extends TypedUpdate> = (update: T) => boolean;
```

Handler contract:

- Signature is `(client, update)` by default. The optional third argument
  `{ signal: AbortSignal }` is reserved for future cancellation support
  and is always supplied by the facade; handlers that want cancellation
  can read it, handlers that do not can ignore it.
- Handlers may be async. The facade awaits each one in deterministic
  registration order (inherited from the raw router).
- Handler failures are captured in the dispatch summary (inherited from
  `createUpdateRouter`) and do not stop later handlers.
- `dispose()` removes the registration from the facade's underlying
  router. Idempotent: calling twice is a no-op.
- Passing `undefined` (or omitting) a filter means "match every update of
  this discriminator kind."

### 4. Typed filter namespaces

The existing raw-event `UpdateFilter` stays as a low-level primitive for
`onRaw(...)`. The recommended user surface is typed filter namespaces
keyed by discriminator group.

```ts
export const filters: {
  // Universal combinators (generic over TypedUpdate subtypes).
  and<T extends TypedUpdate>(...fs: TypedFilter<T>[]): TypedFilter<T>;
  or<T extends TypedUpdate>(...fs: TypedFilter<T>[]): TypedFilter<T>;
  not<T extends TypedUpdate>(f: TypedFilter<T>): TypedFilter<T>;

  message: {
    hasText: TypedFilter<MessageUpdate>;
    textContains(
      query: string,
      options?: { caseSensitive?: boolean }
    ): TypedFilter<MessageUpdate>;
    textMatches(pattern: RegExp): TypedFilter<MessageUpdate>;
    fromWaId(waId: string): TypedFilter<MessageUpdate>;
    ofKind<K extends MessageUpdate["type"]>(
      kind: K
    ): TypedFilter<Extract<MessageUpdate, { type: K }>>;
  };

  interactive: {
    buttonReply: TypedFilter<InteractiveButtonReply>;
    listReply: TypedFilter<InteractiveListReply>;
    replyIdIs(id: string): TypedFilter<InteractiveUpdate>;
  };

  status: {
    is(
      ...statuses: readonly WhatsAppMessageStatusKind[]
    ): TypedFilter<MessageStatusUpdate>;
    forMessageId(id: string): TypedFilter<MessageStatusUpdate>;
  };

  template: {
    eventIs(event: string): TypedFilter<TemplateStatusUpdate>;
    nameIs(name: string): TypedFilter<TemplateStatusUpdate>;
  };

  call: {
    connect: TypedFilter<CallConnect>;
    terminate: TypedFilter<CallTerminate>;
    statusIs(status: string): TypedFilter<CallStatus>;
  };

  chat: {
    opened: TypedFilter<ChatOpened>;
  };

  account: {
    phoneNumberChange: TypedFilter<PhoneNumberChange>;
    identityChange: TypedFilter<IdentityChange>;
    marketingPreferences: TypedFilter<UserMarketingPreferences>;
  };
};
```

Filter contract (resolves WATS-6 and WATS-14):

- Filters MUST NOT throw. Every public filter is either (a) a pure
  predicate over an already-normalized typed update, which cannot encounter
  malformed payload, or (b) a user-supplied predicate whose contract
  forbids throwing.
- The combinators `and` / `or` / `not` do NOT wrap user predicates in
  try/catch. This is intentional: an exception in a predicate is a
  programmer bug, not a filtering decision, and silently swallowing it
  would mask the bug. The handler model documents this contract; the
  router catches thrown errors at the handler boundary instead (existing
  `failedHandlers`/`errors` summary).
- `filters.message.textContains('')` with an empty query returns a filter
  that matches NO messages (not "any message with a body"). This is the
  resolution of WATS-6: empty queries are a distinct, documented case.
  Users wanting "any message that has text at all" use
  `filters.message.hasText`.

Migration:

- Existing D1 filter tests (`packages/core/tests/filters.test.ts`) stay
  green against the raw `UpdateFilter` primitives in
  `@switchbord/core/filters`. They are retained as low-level regression
  coverage.
- New typed-filter tests land under `@switchbord/core/filters/typed` (planned
  file, not created in this ADR) and assert against `TypedUpdate`
  fixtures.

### 5. Listener substrate (WATS-22)

```ts
export interface ListenOptions<TKind extends TypedUpdate["type"]> {
  type: TKind;
  from?: string;                       // waId or phoneNumberId filter
  filter?: TypedFilter<Extract<TypedUpdate, { type: TKind }>>;
  timeoutMs?: number;                  // default from clock/config
  signal?: AbortSignal;
}

export type ListenErrorCode =
  | "listener_timeout"
  | "listener_aborted"
  | "listener_already_resolved";

export interface ListenerError extends Error {
  code: ListenErrorCode;
}

// Facade signature (restated from section 3 for locality):
listen<TKind extends TypedUpdate["type"]>(
  options: ListenOptions<TKind>
): Promise<Extract<TypedUpdate, { type: TKind }>>;
```

Contract:

- Backed by an identity map of pending resolvers keyed by
  `({ type, from? })`. The facade registers a transient handler via its
  underlying router; on match the resolver resolves with the typed
  update and the handler disposes.
- `timeoutMs` defaults to a facade-level configuration value
  (recommended default: `60_000`; exact default fixed in
  `createWhatsApp(config)` docs).
- Timeout is computed against `Clock.now()`, not `Date.now()` (WATS-26).
  This is what makes the listener deterministic in tests.
- `signal?: AbortSignal` causes the promise to reject with
  `listener_aborted` when aborted. The resolver is disposed
  synchronously on abort.
- A resolved or rejected listener is disposed exactly once. Re-resolution
  attempts after resolution surface as `listener_already_resolved`
  (internal invariant; should not reach userland).

### 6. Injection seams (WATS-26)

All three seams are optional at `createWhatsApp(config)`; defaults are
production-safe.

```ts
export interface Logger {
  debug(event: string, payload?: Record<string, unknown>): void;
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface CreateWhatsAppOptions extends WhatsAppClientConfig {
  logger?: Logger;               // default: console-backed
  clock?: Clock;                 // default: { now: () => new Date() }
  idGenerator?: IdGenerator;     // default: { next: () => crypto.randomUUID() }
}

export function createWhatsApp(
  options: CreateWhatsAppOptions
): WhatsApp;
```

These seams are consumed by:

- The listener substrate (timeout computation uses `Clock`).
- The log-scoped dispatch pipeline (structured events, WATS-27).
- The facade's internal correlation IDs (each `handleEnvelope`
  invocation gets one `IdGenerator.next()` value for log correlation).

### 7. Discriminated unions for `WhatsAppMessage` / `WhatsAppMessageStatus`
   (WATS-23)

`@switchbord/types/entities` currently defines `WhatsAppMessage` and
`WhatsAppMessageStatus` as open-ended interfaces with an index signature.
Post-pivot:

```ts
export type WhatsAppMessageStatusKind =
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "deleted"
  | "warning";

export type WhatsAppMessage =
  | WhatsAppTextMessage
  | WhatsAppImageMessage
  | WhatsAppVideoMessage
  | WhatsAppAudioMessage
  | WhatsAppDocumentMessage
  | WhatsAppStickerMessage
  | WhatsAppLocationMessage
  | WhatsAppContactsMessage
  | WhatsAppReactionMessage
  | WhatsAppOrderMessage
  | WhatsAppSystemMessage
  | WhatsAppInteractiveMessage
  | WhatsAppButtonMessage
  | WhatsAppUnsupportedMessage;

export interface WhatsAppMessageBase<TType extends string> {
  id: string;
  from: string;
  timestamp: string;              // preserved as raw Graph string at this layer
  type: TType;
  context?: WhatsAppMessageContext;
}

export interface WhatsAppTextMessage extends WhatsAppMessageBase<"text"> {
  text: WhatsAppMessageText;
}

// ... one concrete interface per message subtype.

export interface WhatsAppMessageStatus {
  id?: string;
  status?: WhatsAppMessageStatusKind;    // closed enum (was `string`)
  timestamp?: string;
  recipientId?: string;
  // Index signature removed. Forward-compat fields live on `TypedUpdate.raw`.
}
```

Consequence: `@switchbord/types` callers that previously relied on
`WhatsAppMessage[someUnknownKey]` will fail to compile. This is
pre-release; it is the correct behavior and aligns with the WATS-23
verdict. `TypedUpdate.raw` is the supported forward-compat escape hatch.

## Consequences

- The facade absorbs complexity. User code goes from
  `parseWebhookUpdate + router + filter` composition to
  `client.onMessage(filters.message.textContains("hi"), handler)` in one
  line.
- Typed updates close WATS-2 at a single point: the normalizer. No handler
  or filter ever re-normalizes.
- Discriminated unions close WATS-23 and enable exhaustive `switch`.
- Listener substrate makes request/response flows expressible without
  custom plumbing (WATS-22), and makes timeouts deterministic in tests via
  `Clock` injection (WATS-26).
- `RawUpdate` catch-all preserves observability for unknown / future
  fields without forcing the normalizer to throw (WATS-10).
- Existing D1 filter tests stay green; they migrate over time to typed-filter
  tests.

## Alternatives Considered

1. Normalize inside the parser, not in a separate layer.

   Rejected: the parser would need to grow knowledge of every message
   subtype, every status kind, every interactive variant, every call
   type. That makes the parser hard to test in isolation and couples
   envelope parsing to typed-update evolution. Keeping the normalizer
   above the parser means the parser stays a generic envelope walker
   and the typed-update layer evolves independently.

2. Emit a single `Update` class with tagged subtype fields instead of a
   discriminated union.

   Rejected: TypeScript's discriminated-union narrowing is the idiomatic
   way to model tagged sums in the ecosystem and is what userland expects
   from a modern TS library. Tagged classes force consumers to hand-roll
   narrowing.

3. Put filters as methods on update instances instead of standalone
   namespaces.

   Rejected: it couples filter evolution to instance construction (every
   new filter requires rebuilding the class), and it prevents the
   `and/or/not` combinators from staying generic. Standalone namespaces
   keep combinators pure and make tree-shaking work.

4. Make `onRaw(...)` the primary API and ship typed handlers as a thin
   wrapper.

   Rejected: this is the current state and is the exact reason we are
   doing the pivot. The typed handler surface is the library's main value
   proposition versus hand-rolled solutions.

## Linear Issue Resolution Map (this ADR)

- WATS-2 (H2) camelCase/snake_case schism — resolved at the normalizer.
- WATS-6 (M4) `messageTextContains('')` semantics — resolved by explicit
  empty-query contract in typed filter namespace.
- WATS-7 (M5) `events_limit_exceeded` partial-success behavior — input to
  the normalizer; normalizer preserves already-parsed events.
- WATS-10 (L3) malformed event counter — resolved via `RawUpdate`
  catch-all + normalizer `skipped` counter.
- WATS-14 (L8) `not(filter)` exception policy — filter contract forbids
  throwing; combinators do not catch.
- WATS-15 (Arch-A) WhatsApp facade — specified here; implemented under
  the foundations pivot.
- WATS-16 (Arch-B) typed update normalizer — specified here.
- WATS-22 (Arch-H) listener substrate — specified here.
- WATS-23 (Arch-I) discriminated unions for message/contact/status —
  specified here; implemented in `@switchbord/types`.
- WATS-26 (Arch-L) Logger/Clock/IdGenerator injection — specified here;
  wired through `createWhatsApp(options)`.

## Follow-up

- Implementation lands under WATS-15/16/22/23/26 during the foundations
  pivot cycle. No implementation is committed in this ADR.
- ADR-003 will land alongside the first commit of WATS-17/18/19 and will
  cross-reference this ADR for the facade shape.
- The typed-update parity matrix (WATS-29) mirrors pywa's handler classes
  1:1; it is a living document and will be generated from the normalizer
  implementation tests once they exist.
