# WATS-58 Graph validation utility reuse plan

- status: design
- applies-to: WATS-58
- lastReviewed: 2026-05-02
- liveValidation: not-applicable

## Purpose

Plan package-local validation utility reuse for Graph endpoint families without changing runtime behavior prematurely.

WATS-58 follows WATS-57: split boundaries must be clear before broad validator extraction. This document identifies duplicate helper families, defines a safe target utility boundary, and sequences low-risk migrations with tests.

## Background

The consistency review found repeated validation patterns across Graph endpoint families:

- control-character checks;
- `GraphRequestValidationError` factories;
- plain-record and descriptor/accessor guards;
- unsafe prototype key rejection;
- own-data property reads;
- path/id traversal and nested percent-decoding;
- string/query bounds;
- array descriptor/sparse-hole guards;
- safe JSON clone helpers with cycle/depth/string/array caps;
- scoped-client optional params copying.

Representative current locations:

| Pattern | Current locations |
| --- | --- |
| `hasControlChar` | `endpoint.ts`, `endpoints/messages.ts`, `endpoints/media.ts`, `endpoints/calling.ts`, `endpoints/businessManagement.ts`, `endpoints/wabaEndpoints.ts` |
| `assertPlainRecord` / descriptor guards | `calling.ts`, `businessManagement.ts`, `wabaEndpoints.ts`, message safe clone helpers |
| safe array descriptor checks | `messages.ts`, `calling.ts`, `wabaEndpoints.ts`, `businessManagement.ts` |
| path/id safety and percent decoding | `endpoint.ts`, `businessManagement.ts`, scoped clients, media/calling helpers |
| safe JSON clone | `wabaEndpoints.ts` template/Flow helpers, message template payload helpers, calling session helpers |
| optional params copy | `subclients/phoneNumberClient.ts`, `subclients/wabaClient.ts` |

These repeated helpers are mostly hardened by prior adversarial reviews. The risk is future divergence: a new endpoint family may copy an older partial helper rather than the strongest current helper.

## Scope

Included in WATS-58 plan:

- define target package-local utility modules;
- define which helpers are safe to extract first;
- define tests to pin current behavior before extraction;
- define rollout order and verification commands;
- document what must stay family-local for now.

Not included in WATS-58 design slice:

- no runtime source movement in this planning commit;
- no changed error messages or classes;
- no new public package exports;
- no live Meta calls;
- no broad one-pass replacement across all endpoint families;
- no WATS-57 module splits.

## Target utility layout

Create private package-local modules under `packages/graph/src/internal/validation/`.

```text
packages/graph/src/internal/validation/
  errors.ts              graphValidationError(message, cause?) and wrapGraphValidation(...)
  strings.ts             hasAsciiControlChar, assertNonEmptyString, assertBoundedString
  records.ts             assertPlainDataRecord, ownDataValue, rejectUnsafePrototypeKey
  arrays.ts              assertDenseDataArray
  paths.ts               assertSafePathSegment, assertRepeatedlyDecodedSafePathId
  json.ts                safeJsonClone with family-supplied caps and path labels
  options.ts             copyOptionalParamsObject / splitRequiredStringDataProp
  index.ts               private barrel for internal imports only
```

Do not add package.json exports for these modules. They are private implementation details.

## Error compatibility rule

Public behavior currently exposes exact error classes and many tests assert messages. Utility extraction must preserve:

- `GraphRequestValidationError` for expected-bad public Graph inputs;
- family-specific message prefixes such as `Invalid createFlow input: ...`;
- `.cause` preservation where current code preserves it;
- sibling error taxonomy after transport.

Therefore utilities should accept labels and message factories rather than imposing one generic error string.

Example target signature:

```ts
export function graphValidationError(message: string, cause?: unknown): GraphRequestValidationError;

export function assertPlainDataRecord(
  value: unknown,
  opts: {
    readonly helperName: string;
    readonly path: string;
    readonly objectNoun?: "object" | "plain object";
    readonly rejectInheritedToJSON?: boolean;
    readonly rejectFunctionsSymbolsBigInts?: boolean;
  }
): Record<string, unknown>;
```

## Extraction order

### Phase 1 — utilities with standalone tests only

Goal: create private utility modules and tests without migrating endpoint code.

Steps:

1. RED: add `packages/graph/tests/internal-validation.test.ts` importing private utilities by relative path. This is acceptable because the utilities are private and not package exports.
2. Cover behavior currently repeated across endpoint families:
   - control char detection: NUL, CR, LF, TAB, DEL;
   - unsafe prototype keys: `__proto__`, `constructor`, `prototype`;
   - `assertPlainDataRecord` rejects null, arrays, custom prototypes, accessors, own/inherited `toJSON`, functions/symbols/bigints when configured. In short: assertPlainDataRecord rejects null, arrays, custom prototypes, accessors;
   - `ownDataValue` does not invoke accessors;
   - `assertDenseDataArray` rejects sparse arrays, accessors, own `map`/`Symbol.iterator`, custom prototypes. In short: assertDenseDataArray rejects sparse arrays;
   - `assertRepeatedlyDecodedSafePathId` rejects raw, encoded, double-encoded, malformed, and excessive traversal markers. In short: assertRepeatedlyDecodedSafePathId rejects raw, encoded, double-encoded;
   - `safeJsonClone` rejects cycles with a shared `WeakSet`, unsafe keys, accessors, non-finite numbers, over-depth, over-array, over-string. In short: safeJsonClone rejects cycles with a shared `WeakSet`.
3. GREEN: implement utilities to satisfy tests.
4. Run `bun test packages/graph/tests/internal-validation.test.ts` and `bun run typecheck`.

No endpoint code changes in Phase 1.

### Phase 2 — migrate scoped-client optional params helpers

Goal: low-risk migration with small blast radius.

Current duplication:

- `packages/graph/src/subclients/phoneNumberClient.ts` has `copyOptionalParamsObject`.
- `packages/graph/src/subclients/wabaClient.ts` has similar `copyOptionalParamsObject` plus required data-property split helpers.

Steps:

1. RED: add/strengthen tests in `phoneNumberClient.test.ts`, `wabaClient.test.ts`, and WATS-42A/Flow/template tests for accessor-backed params and bound-id override behavior.
2. Move only optional params copy logic to `internal/validation/options.ts`.
3. Preserve error message prefixes by passing `helperName` into the utility.
4. Run:
   - `bun test packages/graph/tests/phoneNumberClient.test.ts packages/graph/tests/wabaClient.test.ts`
   - `bun test packages/graph/tests/businessManagement.test.ts packages/graph/tests/wabaTemplates.test.ts packages/graph/tests/wabaFlows.test.ts`
   - `bun run typecheck`

### Phase 3 — migrate business-management path/query/record helpers

Goal: migrate one strongly hardened endpoint family after utilities are proven.

Why business-management first:

- WATS-42A already hardened descriptor-safe params/options, fields arrays, includeSipCredentials, encoded traversal, GET body rejection, and Graph header taxonomy.
- Tests are focused and adversarial.

Steps:

1. RED: add tests asserting current business-management error messages/classes for representative malformed params.
2. Replace local helpers incrementally:
   - `hasControlChar` -> `hasAsciiControlChar`;
   - `assertPlainRecord` -> `assertPlainDataRecord` with message-compatible options;
   - `ownDataValue` -> shared `ownDataValue`;
   - path id decode logic -> `assertRepeatedlyDecodedSafePathId` if exact messages can be preserved.
3. Run business-management and WABA client tests plus typecheck.
4. Stop if message compatibility creates churn; document why utility remains local.

### Phase 4 — wait until WATS-57 module splits before broad template/Flow/message migration

Do not migrate the large helpers inside `wabaEndpoints.ts` or `messages.ts` before the WATS-57 split phases. Otherwise the team must review two independent risks at once:

- moving/splitting modules;
- changing validator implementation.

After WATS-57 template/Flow/message splits land, migrate each family-local validation module to shared utilities in its own issue.

## What stays family-local for now

Keep these local until further review:

- media encrypted bundle validation and crypto/integrity errors;
- multipart boundary/body construction details;
- template parameter-count semantics and `TemplateParamCountMismatchError` construction;
- Flow JSON semantic limits and data-exchange response body rules;
- message composer domain-specific recipient/contact/interactive payload validation;
- GraphClient request body/content-type matrix;
- endpoint `defineEndpoint` define-time placeholder validation.

## Utility design rules

1. Private only: no package exports and no docs claiming consumer API.
2. Error-compatible: caller supplies helper labels and message nouns.
3. Descriptor-first: utilities must not spread/destructure/read caller objects before descriptor inspection.
4. Caps are caller-supplied: shared `safeJsonClone` takes max depth/array/string/key options rather than hardcoding template/Flow/message limits.
5. No broad semantic refactors: replacing a helper must not alter public accepted/rejected input sets unless a separate behavior issue says so.
6. Tests before migration: every migrated helper needs at least one existing endpoint-family test that would fail if accessors, sparse arrays, unsafe keys, or encoded traversal slipped through.

## Verification matrix

Minimum after Phase 1:

```sh
bun test packages/graph/tests/internal-validation.test.ts
bun run typecheck
git diff --check
```

Minimum after Phase 2:

```sh
bun test packages/graph/tests/phoneNumberClient.test.ts packages/graph/tests/wabaClient.test.ts
bun test packages/graph/tests/businessManagement.test.ts packages/graph/tests/wabaTemplates.test.ts packages/graph/tests/wabaFlows.test.ts
bun run typecheck
git diff --check
```

Minimum after Phase 3:

```sh
bun test packages/graph/tests/businessManagement.test.ts packages/graph/tests/wabaClient.test.ts
bun test packages/testing/tests/graph-consumer.test.ts packages/testing/tests/wats53-graph-endpoint-subpaths.test.ts packages/testing/tests/wats54-public-api-consistency.test.ts
bun run api:check
bun run typecheck
git diff --check
```

Full closeout before marking a migration issue Done:

```sh
bun test
bun run api:check
bun run docs:check
bun run typecheck
git status --short
```

## Recommended follow-up Linear issues

WATS-58 is a plan/boundary slice. Implementation should be separate:

1. Add private Graph internal validation utilities with standalone tests.
2. Migrate scoped-client optional params helpers to internal validation utilities.
3. Migrate business-management record/path/query helpers to internal validation utilities.
4. After WATS-57 splits land, migrate template validation helpers.
5. After WATS-57 splits land, migrate Flow validation helpers.
6. After WATS-57 message split lands, migrate message composer validation helpers.

## Definition of done for future migration work

- RED/GREEN commits exist per migration slice.
- No public package exports are added for private utilities.
- Existing public error classes and representative messages are preserved.
- Endpoint request snapshots remain unchanged.
- Adversarial malformed-input tests remain green.
- `bun run api:check`, typecheck, and relevant package tests pass.
- No test temp artifacts remain in the working tree.
