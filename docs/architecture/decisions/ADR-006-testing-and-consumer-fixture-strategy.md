# ADR-006: Testing and Consumer-Fixture Strategy

- status: Accepted
- date: 2026-04-21
- labels: [foundation, testing, fixtures, tdd, edge-runtime]
- relatesTo: ADR-001 (API Shape), ADR-003 (Transport/Crypto), ADR-005 (Endpoint Registry)

## Context

WATS's test suite today is 65/65 green across five packages. Tests live in
three layers:

- `packages/<pkg>/tests/*.test.ts` — per-package unit tests (`bun test`).
- `packages/testing/tests/*.test.ts` — workspace-level integrity tests
  (docs presence, consumer importability, repository invariants).
- `packages/testing/fixtures/types-consumer/` — a self-contained package
  with its own `package.json` that imports `@wats/types`,
  `@wats/types/config`, `@wats/types/webhook`, `@wats/types/entities` as
  publishable specifiers and asserts the declared export symbols are
  reachable.

The consumer-fixture pattern has already caught one real regression (A1:
subpath export was missing when the package exposed only `main`). It needs
to scale to every publishable package and to the forthcoming Transport /
CryptoProvider / EndpointDef seams (ADR-003, ADR-005) without collapsing
into a single `packages/testing` that is simultaneously a workspace-tests
package, a fixture host, and a prospective public `test-utils`.

Three concrete drivers:

1. The B2/C1/C2 `globalThis.fetch` mocking patterns in
   `packages/graph/tests/client.test.ts` and `packages/http/tests/*` become
   obsolete under ADR-003's Transport seam; they must migrate cleanly.
2. Edge-runtime portability is a hard invariant (ADR-003). A CI-reachable
   smoke test must exist that imports `@wats/http` and `@wats/crypto` under
   a WinterCG-compatible harness with no `node:crypto`.
3. Every implementer subagent must run the adversarial-battery skill
   before concluding a task. This is currently enforced by prose in task
   briefs; it deserves an ADR-level anchor with a checklist.

## Decision

WATS organises testing along four axes: per-package unit tests, per-package
contract (consumer-fixture) tests, a shared workspace-integrity suite,
and an edge-runtime sanity suite. The `@wats/testing` package is retained
as the internal home for workspace + fixture host concerns; a future
`@wats/test-utils` package is reserved (not built yet) for public-facing
test helpers.

### Layer map

```
 packages/<pkg>/tests/                     unit + per-package integration
   |                                       (bun test; no cross-package mocks)
   v
 packages/testing/fixtures/<pkg>-consumer/ consumer-fixture (own package.json)
   |                                       imports "@wats/<pkg>" as a consumer
   |                                       would; type-checks + runs
   v
 packages/testing/tests/                   workspace-integrity + fixture
   |                                       runners (docs-presence, fixture
   |                                       type-check, importability)
   v
 packages/testing/edge/                    edge-runtime smoke tests
                                           (WinterCG harness; no node:crypto)
```

### Per-package test layout

Every publishable package owns its own unit tests under `packages/<pkg>/tests/`.
No package directly imports another package's test helpers. Cross-package
assertions live in `packages/testing/tests/`.

Contract tests for each publishable package live under
`packages/testing/fixtures/<pkg>-consumer/` with its own `package.json`:

```
packages/testing/fixtures/
  types-consumer/            (exists today; keeps A1 coverage)
    package.json
    verify-imports.ts
  graph-consumer/            (new, lands with ADR-005 F-step)
    package.json
    verify-endpoint-definition.ts
    verify-execute-roundtrip.ts
  http-consumer/             (new, lands with ADR-003 F-step)
    package.json
    verify-signature-crypto-injection.ts
  crypto-consumer/           (new, lands with ADR-003 F-step)
    package.json
    verify-capability-probe.ts
  core-consumer/             (new, lands with F-step after router/filters)
    package.json
    verify-router-importability.ts
```

Each fixture's `package.json` pins `@wats/<pkg>` via a workspace link:

```json
{
  "name": "@wats/fixture-<pkg>-consumer",
  "private": true,
  "type": "module",
  "dependencies": {
    "@wats/<pkg>": "workspace:*"
  }
}
```

A test file in `packages/testing/tests/<pkg>-consumer.test.ts` asserts that:

- the fixture's entry file type-checks under `bun tsc --noEmit` with the
  fixture's own `tsconfig.json`.
- executing the fixture under `bun run` prints a known success sentinel.
- the set of exported symbols under each publishable specifier matches a
  committed allowlist (the A1 regression shape).

### `@wats/testing` role

Today `@wats/testing` holds:

- workspace self-tests (e.g. `workspace.test.ts`),
- docs-presence tests,
- consumer-importability runners,
- fixture packages under `fixtures/`,
- update-fixture JSON under `fixtures/updates/`.

Three candidate paths considered:

1. **Rename to `@wats/workspace-tests` (private), carve a new `@wats/test-utils` (public) for consumer helpers later.**
2. **Keep `@wats/testing` as a private dual-role package (workspace + fixture host).**
3. **Reserve `@wats/testing` as the eventual public test-utils name and move internals to `@wats/workspace-tests` now.**

**Decision: (2).** Keep `@wats/testing` as the internal workspace +
fixture-host package, `private: true`. Create a new **future** package
`@wats/test-utils` (public) as a later F-step for consumer-facing helpers
(`createMockTransport` re-exports, `createFakeCryptoProvider` re-exports,
`createUpdateBuilder`, fake Graph client). Rationale:

- The A1 regression coverage currently in `@wats/testing` is valuable and
  moving it adds churn with zero safety gain.
- `@wats/test-utils` has not shipped yet; claiming the `@wats/testing`
  namespace now would force a package rename under consumer code later.
- Private dual-role is acceptable because nothing inside `@wats/testing`
  is exported to consumers today; no API surface is affected.

`packages/testing/package.json` stays at `"private": true` and gains no
`exports` field.

### Edge-runtime sanity tests

A minimal suite under `packages/testing/edge/*.test.ts` runs under a
WinterCG-compatible harness and asserts that `@wats/http` and `@wats/crypto`
import and exercise without `node:crypto`. Harness options, in preference
order: (1) Bun with a module resolver that throws on any `node:crypto`
request (native `--no-node-builtin` not yet available), (2) Miniflare
(`workerd`) for a real Workers environment, (3) Deno. Decision: ship option
(1) as the minimum bar and add Miniflare as follow-up once the surface
stabilises. Both run on a separate CI job so unit-test latency is unaffected.

Edge-suite assertions:

- `import("@wats/http/signature")` resolves without a dynamic
  `node:crypto` load under `prefer: "webcrypto"`.
- `import("@wats/crypto")` resolves and `createCryptoProvider({ prefer:
  "webcrypto" })` returns a provider whose `name === "webcrypto"`.
- `validateWebhookSignature({ crypto, ... })` succeeds for a known
  appSecret/body/header triple with the WebCrypto provider.
- `createFetchTransport()` round-trips against a local `fetch` stub.

A synthetic `bun build --target=browser` check that fails on any `node:*`
externalisation warning is a stretch goal — catches the same bugs at
build time.

### Adversarial battery integration

Every implementer subagent MUST load the `adversarial-battery-for-implementers`
skill before writing tests or source. The battery is invoked post-RED
(failing test written) and pre-GREEN (implementation committed) to expand
the failing test cases along the standard axes: boundary values, empty
inputs, nullish propagation, unicode/control characters, timing, concurrency,
resource exhaustion, injection, malformed encoding, and cross-runtime
divergence.

Reviewer checklist snippet (must be present verbatim in every PR that adds
or changes a source file):

```
Adversarial battery:
  [ ] Battery loaded before authoring tests.
  [ ] Battery outcome recorded in commit body.
  [ ] Boundary inputs covered:      yes / n/a
  [ ] Empty/null inputs covered:    yes / n/a
  [ ] CR/LF/NUL rejection covered:  yes / n/a
  [ ] Unicode/surrogate covered:    yes / n/a
  [ ] Timing/concurrency covered:   yes / n/a
  [ ] Malformed encoding covered:   yes / n/a
  [ ] Cross-runtime divergence:     yes / n/a (link to edge test)
TDD:
  [ ] RED commit present before GREEN commit.
  [ ] RED commit includes the failing-test excerpt in body.
  [ ] GREEN commit references the RED SHA.
```

### TDD RED → GREEN audit

Every source change is introduced in two git commits:

1. **RED commit**: adds the failing test(s). Commit body MUST include:
   - the failing-test excerpt (diff or inline),
   - the battery outcome (which axes fired, which were n/a),
   - the expected error type / value.
2. **GREEN commit**: minimum implementation to pass. Commit body MUST
   reference the RED commit SHA and restate the battery summary.

`bun run audit:tdd` (owned by the workspace-tests package, not yet written)
walks `git log --follow` for each changed source file and verifies the
RED-before-GREEN ordering. Its output gates the `main`-merge check.

### Test doubles policy

No heavy mocking frameworks (sinon, jest mocks, vi.mock equivalents). WATS
uses explicit test doubles that live in `@wats/testing/doubles/` (internal)
and later re-export through `@wats/test-utils` (public):

```ts
// @wats/testing/doubles (internal, private)
export function createMockTransport(handler: MockTransportHandler): MockTransport;
export function createFakeCryptoProvider(seed?: FakeCryptoSeed): CryptoProvider;
export function createUpdateBuilder(): UpdateBuilder;
export function createFakeGraphClient(overrides?: FakeGraphClientOverrides):
  GraphClient;

export interface MockTransportHandler {
  (request: TransportRequest): Promise<TransportResponse> | TransportResponse;
}

export interface MockTransport extends Transport {
  readonly calls: readonly TransportRequest[];
  reset(): void;
  enqueue(responses: readonly TransportResponse[]): void;
}

export interface FakeCryptoSeed {
  readonly hmacOutput?: Uint8Array;
  readonly randomBytes?: Uint8Array;
  readonly timingSafeEqualReturns?: boolean;
}

export interface UpdateBuilder {
  withMessage(msg: Partial<WhatsAppMessage>): UpdateBuilder;
  withStatus(status: Partial<WhatsAppMessageStatus>): UpdateBuilder;
  withContact(contact: Partial<WhatsAppContact>): UpdateBuilder;
  build(): WhatsAppWebhookEnvelope;
}

export interface FakeGraphClientOverrides {
  readonly transport?: Transport;
  readonly crypto?: CryptoProvider;
  readonly accessToken?: string;
}
```

Rules:

- `globalThis.fetch` is NEVER patched. Transport seam or bust.
- `globalThis.crypto` is NEVER patched. CryptoProvider seam or bust.
- `Date.now` stubbing goes through an explicit `clock: Clock` seam; no
  monkey-patch of globals.
- No `jest.mock`-style hoisted module replacement.

### Migration map for existing tests

Tests that currently mock `globalThis.fetch` (pre-ADR-003) and their
destination under the new seam:

```
graph/tests/client.test.ts  B2  fetch stub   -> createMockTransport
graph/tests/client.test.ts  C1  fetch stub   -> createMockTransport + error path
graph/tests/client.test.ts  C2  fetch stub   -> createMockTransport + retry
http/tests/signature.test.ts    node:crypto  -> createFakeCryptoProvider
http/tests/webhook-challenge.test.ts node:crypto -> createFakeCryptoProvider
```

Migration is performed by the implementer of each F-step landing the new
seam; no test is deleted until its replacement is green. TDD RED→GREEN
applies to migrations: the replacement test is the RED commit; the
original is left passing until the GREEN commit removes it.

### Fixture test contract (consumer fixture)

A fixture is a "consumer of the published specifier" simulation. Rules:

- The fixture's `package.json` depends on `@wats/<pkg>` via
  `"workspace:*"`. No relative `../../../packages/<pkg>/src` imports.
- The fixture imports only from the published specifiers advertised in the
  package's own `exports` map. Breaking an `exports` entry must break a
  fixture.
- Each fixture exposes either a default export or a named `verify()` that
  returns a `{ ok: true } | { ok: false, error }` report. The runner in
  `packages/testing/tests/` invokes it and asserts `ok: true`.
- A fixture may assert type-level properties via a local `assertAssignable`
  or `expectType` helper. These are compile-time assertions; running under
  `bun run` should succeed even without them.
- A fixture must not import `node:*` unless the package under test
  explicitly advertises Node as a required runtime (currently: none).

Example fixture shape for ADR-005 verification (TS signatures only):

```ts
// packages/testing/fixtures/graph-consumer/verify-endpoint-definition.ts
import { defineEndpoint, type EndpointDef } from "@wats/graph";
import type { ExtractPathParams } from "@wats/graph";

declare function expectType<T>(value: T): void;
declare function expectAssignable<T, _U extends T>(): void;

declare const sample: EndpointDef<
  { phoneNumberId: string; to: string; text: string },
  { messages: readonly { id: string }[] },
  "/{phoneNumberId}/messages"
>;

declare function verify(): Promise<{ ok: true } | { ok: false; error: string }>;
```

The corresponding runner under `packages/testing/tests/graph-consumer.test.ts`
calls `verify()` and asserts `ok: true`, and separately runs `bun tsc
--noEmit` against the fixture package, asserting exit 0.

## Consequences

Positive:

- Every publishable package is tested the way a consumer will use it:
  through `exports` entries, not relative file paths.
- `globalThis.fetch` patching disappears, eliminating an entire class of
  cross-test interference under `bun test`'s parallel runner.
- Edge-runtime portability becomes a committed invariant, not a review
  hope.
- TDD RED→GREEN is enforceable, not aspirational.
- Future `@wats/test-utils` extraction is straightforward: move
  `@wats/testing/doubles/*` up to a new package without renaming existing
  workspace-test files.

Negative:

- Five new fixture packages (`graph-consumer`, `http-consumer`,
  `crypto-consumer`, `core-consumer`, plus the existing `types-consumer`),
  each with its own `package.json` and `node_modules` symlink. Workspace
  install time rises marginally.
- CI gains an edge-runtime job. Miniflare (if adopted) adds a Cloudflare
  dev dependency; it is confined to the edge job.
- The TDD audit tool is new code; it must itself be tested under the same
  RED→GREEN policy it enforces. Bootstrap caveat documented in the tool's
  README.

## Alternatives considered

- **Collapse all fixtures into one `packages/testing/fixtures/` package.**
  Rejected: a single `package.json` can't simultaneously depend on each
  workspace package under a distinct, realistic subset; the "consumer of
  `@wats/graph` uses only `@wats/graph`" property is lost.
- **Consumer-fixture tests inside `packages/<pkg>/tests/` importing
  `@wats/<pkg>` from the same workspace.** Rejected: tsconfig path mapping
  and workspace aliasing let tests import `src/` directly; fixture-host
  separation is what forces the published-specifier path.
- **`vitest` + `vi.mock` module replacement instead of explicit seams.**
  Rejected: ADR-001 is Bun-first, and explicit seams are a stronger
  architectural pressure than a mocking framework.
- **Make `@wats/testing` public and expose doubles now.** Rejected: the
  doubles touch unstable types (Transport, CryptoProvider, EndpointDef)
  that are 0.x; exposing them now locks semver early.

## Linear issues resolved

This ADR is cross-cutting and does not directly resolve a single Linear
issue; it establishes the discipline that resolves WATS-3, WATS-4, WATS-5,
WATS-8, WATS-11, WATS-13, WATS-17, WATS-18, WATS-19, WATS-20, WATS-21,
and WATS-27 as they land. Explicit deliverables:

- TDD RED→GREEN audit covering every source change introduced under
  ADR-003, ADR-005, and subsequent F-steps.
- Consumer-fixture coverage for every publishable specifier touched by
  ADR-003 and ADR-005.
- Edge-runtime sanity suite gating `@wats/http` and `@wats/crypto`
  compliance with the no-`node:crypto` invariant.

## Public API sketches (TS signatures only)

```ts
// internal, @wats/testing/doubles
export function createMockTransport(handler: MockTransportHandler): MockTransport;
export function createFakeCryptoProvider(seed?: FakeCryptoSeed): CryptoProvider;
export function createUpdateBuilder(): UpdateBuilder;
export function createFakeGraphClient(
  overrides?: FakeGraphClientOverrides
): GraphClient;

// internal, @wats/testing/fixtures runner
export interface FixtureReport {
  readonly ok: true;
}
export interface FixtureFailure {
  readonly ok: false;
  readonly error: string;
}
export type FixtureResult = FixtureReport | FixtureFailure;

export function runFixture(entry: string): Promise<FixtureResult>;
export function typecheckFixture(fixtureDir: string): Promise<FixtureResult>;

// future, @wats/test-utils (public) — not implemented yet
export {
  createMockTransport,
  createFakeCryptoProvider,
  createUpdateBuilder,
  createFakeGraphClient
};
```

## Interop notes

- **Bun**: primary runtime for `bun test`. All per-package and
  workspace-integrity suites run here.
- **Node**: fixtures must type-check under a Node-flavoured `tsc` to catch
  `moduleResolution: "node16"` regressions.
- **Workers / Edge**: sole target of the edge-runtime sanity suite;
  `@wats/http` and `@wats/crypto` fixtures run with `prefer: "webcrypto"`.
- **Deno**: not required in CI for 0.x; adding a Deno job is a drop-in
  since Deno consumes the same published specifiers.

## Open questions

- Miniflare vs a home-grown WinterCG harness for the edge suite.
  Decision deferred to the ADR-003 F-step.
- `bun run audit:tdd`: hard CI gate or advisor-only? Starting as advisor
  for one release cycle, then promoting to gate once noise is measured.
- Does `@wats/test-utils` re-export `MockTransport` class identity or a
  structural interface? Locks semver semantics; revisit before it ships.
- TDD audit: inspect squashed PR commits or pre-squash branch history?
  Depends on CI provider granularity.
