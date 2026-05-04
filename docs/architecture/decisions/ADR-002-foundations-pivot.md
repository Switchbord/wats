# ADR-002: Foundations Pivot (Breadth Pause, One-Cycle Substrate Investment)

- status: Accepted
- decisionStatus: locked
- date: 2026-04-21
- supersedes: none
- amends: ADR-001 (API Shape; ADR-001 remains locked)
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo, foundations]

## Context

WATS has shipped its A/B/C/D initial slices: package scaffolding (A/B), webhook
verification primitives and update normalization (C1/C2), and filter DSL groundwork
(D1). Test suite is 65/65 green on `main`. We have a working `parseWebhookUpdate`
plus `createUpdateRouter` plus a small filter set, a Graph client with a single
`messages.sendMessage` endpoint, and signature/challenge helpers.

In parallel, we ran a post-D1 consolidated adversarial review of the substrate and
cross-referenced it with the pywa reference library (22 typed update classes in
`pywa/handlers.py`, ~865 LOC of filter DSL in `pywa/filters.py`, ~292 LOC of
listener substrate in `pywa/listeners.py`, a domain type hierarchy under
`pywa/types/`). The review surfaced defect classes and architectural gaps that
are:

1. Already causing user-visible issues at the current size
   (see WATS-2, WATS-6, WATS-7, WATS-10, WATS-12, WATS-14), and
2. Will compound non-linearly as we add endpoints, handlers, media, flows,
   calls, and listeners on top of the current shape.

Specifically:

- Public-surface camelCase/snake_case schism (WATS-2): we normalize on the
  envelope but re-expose raw snake_case inside `change.value`. Every future
  filter or handler must re-translate. Not a bug we can patch once; it is a
  missing normalization layer.
- Routing primitives operate on raw envelope shapes, not typed update classes.
  Pywa-style ergonomics (`onMessage`, `onCallbackButton`, `onMessageStatus`,
  `listen(...)`) cannot be implemented on top of `ParsedUpdateEvent` alone
  without re-implementing normalization in every handler.
- There is no client facade (WATS-15). `@wats/graph.GraphClient` and
  `@wats/core` primitives do not compose into a single `WhatsApp` object.
  Users would currently need to wire seven packages themselves.
- There is no transport seam, no crypto seam, no endpoint registry, no scoped
  sub-clients (WATS-16/17/18/19 cluster). Each new endpoint bolts onto the
  class directly. This is the same shape that made pywa's client a single
  3000+ LOC file; we still have time to avoid it.
- There is no listener substrate (WATS-22). Request/response flows
  (send-and-wait-for-reply) cannot be modeled without one.
- Open index signatures on `WhatsAppMessage`, `WhatsAppContact`, and
  `WhatsAppMessageStatus` (WATS-23) defeat discriminated-union narrowing in
  userland, which in turn forces every filter to hand-roll runtime guards.
- No injection seams for logger/clock/id generation (WATS-26) means all
  behavior is non-deterministic in tests.

This is a greenfield codebase. There is no deferred-tech-debt contract with
users; no shipped release; no migration pressure. Fixing these now costs one
cycle. Fixing them after we have N endpoints, M handlers, and a listener DSL
costs N+M+listener_surface units of rework plus a breaking release.

## Decision

Pause breadth expansion. Invest one cycle in foundations before adding any
additional Graph endpoints, message composers, media helpers, flow primitives,
or call handling. The cycle delivers, in order:

1. Error code registry (shared taxonomy across parser/router/graph/http/crypto).
2. Injection seams: `Logger`, `Clock`, `IdGenerator` (WATS-26), default
   implementations using real clock, `crypto.randomUUID`, and a console-backed
   logger; all optional in `createWhatsApp(config)`.
3. Discriminated-union types for `WhatsAppMessage` and the message-status set
   (WATS-23). Close open index signatures; expose raw payload via a single
   `raw` field for forward compatibility.
4. Typed update normalizer above the raw envelope parser (WATS-16). Input is
   `ParsedUpdateEvent[]`; output is `TypedUpdate` (discriminated union).
   See ADR-004 for full normalizer and handler-model specification.
5. `WhatsApp` client facade (WATS-15). One public construction entrypoint,
   `createWhatsApp(config)`. One object to register handlers, listen,
   and send. Typed handler methods (`onMessage`, `onMessageStatus`,
   `onTemplateStatusUpdate`, etc.), one per discriminator literal.
6. Transport seam (WATS-17). `GraphClient` accepts a `Transport` interface
   (default: `fetch`-backed) so tests and alternative runtimes can inject.
7. Crypto seam (WATS-18). `CryptoProvider` interface with a Node/Bun/Workers
   adapter trio; signature verification and future media encryption depend on
   it, not on `node:crypto` directly.
8. Endpoint registry / scoped sub-clients (WATS-19/20). `GraphClient` stops
   being a property bag. Endpoints register through `defineEndpoint(...)`.
   Scoped sub-clients (`client.messages`, `client.media`, `client.templates`)
   compose from the registry rather than from ad-hoc constructor wiring.
9. Listener substrate (WATS-22). `client.listen({ type, from, filter?,
   timeoutMs?, signal? })`. Integrates with `Clock` for deterministic timeout
   tests.
10. Webhook adapters (`@wats/http`): Bun-native adapter plus a framework-agnostic
    `WebhookAdapter` contract so Hono, Elysia, Express, Cloudflare Workers,
    and Deno can plug in without forking.

The four documents landing in this pivot are:

- This ADR (ADR-002): the decision record.
- ADR-004: typed updates + handler model specification.
- `docs/architecture/public-api-surface.md`: post-pivot public API sketch.
- `docs/architecture/package-map.md`: post-pivot package graph.

ADR-003 is reserved for the transport/crypto/endpoint-registry trio and will
land alongside the first implementation commit of WATS-17/18/19.

## Consequences

Short term (one cycle):

- Velocity on user-visible parity features drops. No new Graph endpoints, no
  new media helpers, no flow or calls handlers merge during the pivot cycle.
- A small number of currently passing tests (filter tests that assert against
  raw `ParsedUpdateEvent` shape) migrate to typed-update tests. The raw
  router stays as a low-level primitive used by the facade, so the migration
  is additive, not destructive.
- `WhatsAppMessage` and `WhatsAppMessageStatus` become discriminated unions
  (WATS-23), which is a source-level breaking change to `@wats/types`. This
  is acceptable pre-release.

Long term:

- Every subsequent feature (endpoints, handlers, listeners, media, flows,
  calls, templates) lands on a stable substrate. Rework is bounded.
- Parity with pywa's 22 typed update classes becomes a data-table exercise
  in the normalizer rather than a structural refactor per class.
- The facade absorbs complexity that would otherwise leak into every user
  program. Users write `client.onMessage(...)` instead of composing
  `parseWebhookUpdate` + `createUpdateRouter` + custom filters by hand.
- Test determinism improves (injected `Clock`, `IdGenerator`), which is
  necessary for the listener substrate.

Risk:

- The pivot includes nine internal workstreams. If any one slips, the cycle
  slips. Mitigation: land the error-code registry, injection seams, and
  discriminated unions first; they unblock the other six and are the
  lowest-risk items.

## Alternatives Considered

1. Continue breadth (rejected).

   Keep shipping endpoints and handlers on the current substrate. Accept
   the camelCase/snake_case schism, the lack of facade, and the absence of
   a listener substrate. Plan a v2.0 "great refactor" later.

   Rejected because the adversarial review verdict was "soft no-go on
   continuing breadth at current substrate quality." The defect classes are
   structural. Patching them in place after N endpoints means N separate
   migrations. Greenfield is the cheapest moment to fix them.

2. Partial pivot (rejected).

   Do WATS-2 (camelCase fix) and WATS-23 (discriminated unions) only; defer
   facade, transport seam, endpoint registry, and listener substrate to a
   later cycle.

   Rejected because the items compound. A typed update normalizer (WATS-16)
   without a facade (WATS-15) produces API ergonomics that are worse than the
   current state: users would import `normalizeUpdates` separately from
   `parseWebhookUpdate` and `createUpdateRouter` and wire three things. The
   facade is what makes the normalizer worth building. Similarly, the
   listener substrate depends on `Clock` injection (WATS-26), which depends
   on the facade's `createWhatsApp(config)` entry.

3. Rewrite from scratch (rejected).

   Start a new branch, port nothing. Rejected: the existing parser, router,
   filter combinators, signature verification, and endpoint path safety
   logic are all correct and well-tested. The pivot is additive composition
   on top of existing primitives, not replacement.

## Linear Issue Resolution Map

Grouped by the workstream that resolves each issue.

Normalizer + camelCase unification (ADR-004):

- WATS-2 (H2) public-surface camelCase/snake_case schism
- WATS-6 (M4) `messageTextContains('')` matches any body — resolves via
  typed filter namespace rewrite with explicit empty-query contract
- WATS-7 (M5) `updateParser` `events_limit_exceeded` discards already-parsed
  events — resolves via parser change that surfaces partial success plus
  normalizer contract
- WATS-10 (L3) `router.dispatch` malformed event counter — resolves via
  normalizer catch-all `RawUpdate` and typed handler model
- WATS-12 (L6) `invalid_envelope` message differentiation — resolves in the
  parser-error taxonomy that the error-code registry formalizes
- WATS-14 (L8) `not(filter)` exception policy — resolves via filter contract
  (filters must not throw; normalizer + payload safety guarantees it)
- WATS-16 (Arch-B) typed update normalizer above parser
- WATS-23 (Arch-I) discriminated unions for message/contact/status

Client facade + composition (ADR-003 preview):

- WATS-15 (Arch-A) WhatsApp client facade
- WATS-17 Transport seam (Graph)
- WATS-18 Crypto seam
- WATS-19 Endpoint registry
- WATS-20 Scoped sub-clients

Listener substrate and runtime injection:

- WATS-22 (Arch-H) listener registry
- WATS-26 (Arch-L) Logger/Clock/IdGenerator injection

Webhook adapter contracts:

- WATS-24 `WebhookAdapter` contract (Bun, Hono, Elysia, Workers, Deno)
- WATS-25 Raw-body preservation contract

Error taxonomy and observability:

- WATS-21 Error-code registry across packages
- WATS-27 Logger-scoped structured events
- WATS-28 Dispatch summary extension for typed updates
- WATS-29 Typed-update parity matrix doc (pywa mirror)

Issues not in scope for the pivot (tracked but deferred to post-foundations
cycles): WATS-1, WATS-3, WATS-4, WATS-5, WATS-8, WATS-9, WATS-11, WATS-13 —
these cover feature breadth (media helpers, flow composer, template upserts,
template analytics, call actions, calling dial tones, reaction composer,
product catalog) and will land on the foundations substrate.

## Follow-up

- ADR-003 (Transport + Crypto + Endpoint Registry) lands with the first
  WATS-17/18/19 commit.
- ADR-004 (Typed Updates + Handler Model) is merged in this pivot commit
  alongside this ADR.
- `docs/architecture/public-api-surface.md` and
  `docs/architecture/package-map.md` are merged in this pivot commit.
- The existing D1 filter tests remain green during the pivot; typed-filter
  tests are additive. Removal of the raw-event filter DSL is out of scope
  for the pivot.
