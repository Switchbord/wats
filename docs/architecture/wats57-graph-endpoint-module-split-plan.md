# WATS-57 Graph endpoint module split plan

- status: design
- applies-to: WATS-57
- lastReviewed: 2026-05-02
- liveValidation: not-applicable

## Purpose

Plan the high-risk split of large Graph endpoint modules after the WATS-53/WATS-54 export consistency pass. This document is intentionally design/test-planner only: it defines a safe sequence for later implementation and does not move runtime code by itself.

## Background

The consistency review found that WATS foundations are strong, but newer post-foundations feature families accumulated inside large endpoint modules:

| File | Approximate size at planning | Families mixed |
| --- | ---: | --- |
| `packages/graph/src/endpoints/messages.ts` | 1,238 lines / 51 KB | raw send callable, text helper, WATS-38 composer builders, validation helpers, payload types |
| `packages/graph/src/endpoints/wabaEndpoints.ts` | 1,409 lines / 63 KB | WABA phone listing, templates, flows, template validation, Flow JSON helpers, data-exchange response builders |
| `packages/graph/src/endpoints/media.ts` | 1,425 lines / 49 KB | upload/download/delete/decrypt/upload sessions and media validation helpers |

WATS-53 added first-class endpoint subpaths for the existing runtime surfaces:

- `@switchbord/graph/endpoints/messages`
- `@switchbord/graph/endpoints/media`
- `@switchbord/graph/endpoints/templates`
- `@switchbord/graph/endpoints/flows`
- `@switchbord/graph/endpoints/calling`
- `@switchbord/graph/endpoints/business-management`

WATS-54 added `bun run api:check`, a manifest-backed consistency gate for package exports, source files, consumer fixture imports, and docs packet references.

WATS-57 plans the next riskier step: splitting monolithic internals without changing public behavior.

Do not combine mechanical subpath/export consistency with large internal module splits. WATS-53/WATS-54 intentionally handled the low-risk export/docs/test consistency work first; future split work should be isolated into smaller issues with stronger request-snapshot coverage.

## Scope

Included in the future split implementation:

- mechanically split endpoint families into smaller files;
- preserve all root `@switchbord/graph` exports;
- preserve all WATS-53 endpoint subpath exports;
- preserve request snapshots, runtime validation, and error taxonomy;
- preserve consumer fixture behavior;
- add regression tests before moving code;
- keep `bun run api:check` green at every GREEN commit.

Not included in WATS-57 itself:

- no runtime code movement in this design slice;
- no live Meta calls;
- no package publishing or release automation;
- no behavior changes to validators, builders, payload shapes, or Graph routes;
- no broad validation utility consolidation. That belongs to WATS-58 after the split boundaries are planned.

## Split principles

1. Split by public feature family, not by arbitrary helper type.
2. Keep compatibility barrels so public imports remain stable.
3. Move code in small mechanical commits with request-snapshot tests already red/green.
4. Avoid simultaneous semantic cleanup. If a helper is ugly but correct, move it first; refactor later.
5. Use WATS-54 `api:check` after every public export/source move.
6. Use consumer fixtures as the source of truth for package-specifier imports.
7. Do not collapse credential-free implementation status with live validation status in docs.

## Target module layout

### Messages family

Current file:

- `packages/graph/src/endpoints/messages.ts`

Target layout:

```text
packages/graph/src/endpoints/messages/
  index.ts              public barrel for @switchbord/graph/endpoints/messages
  types.ts              GraphMessages* input/output/payload types and constants
  validation.ts         string/object/array/url/contact/template validation helpers
  builders-text.ts      buildSendTextPayload and legacy raw text helper support
  builders-media.ts     buildSendImagePayload / video / audio / document / sticker
  builders-interactive.ts buttons/list/cta/catalog/product/location-request builders
  builders-remaining.ts location/contacts/reaction/read/typing/template builders
  callables.ts          sendMessage defineEndpoint and GraphMessagesEndpoint compatibility class
```

Compatibility requirement:

- `packages/graph/src/endpoints/messages.ts` remains as a thin barrel, or `packages/graph/package.json` is updated to target `./src/endpoints/messages/index.ts` only after `bun run api:check` and consumer fixtures prove the new source path. Prefer the thin-barrel first pass.

### Templates family

Current source:

- template sections inside `packages/graph/src/endpoints/wabaEndpoints.ts`
- thin WATS-53 barrel: `packages/graph/src/endpoints/templates.ts`

Target layout:

```text
packages/graph/src/endpoints/templates/
  index.ts              public barrel for @switchbord/graph/endpoints/templates
  types.ts              Template* response/input/component types
  validation.ts         template string/array/plain-object/safe-json helpers
  builders.ts           buildCreate/UpdateMessageTemplateBody and component builders
  parameterCounts.ts    validateTemplateParameterCounts
  callables.ts          list/get/create/update/delete message template endpoint callables
```

Compatibility requirement:

- `wabaEndpoints.ts` initially re-exports template symbols from the new files so root imports and `WABAClient` imports continue working.
- `templates.ts` becomes a thin barrel over `./templates/index`.

### Flows family

Current source:

- Flow sections inside `packages/graph/src/endpoints/wabaEndpoints.ts`
- thin WATS-53 barrel: `packages/graph/src/endpoints/flows.ts`

Target layout:

```text
packages/graph/src/endpoints/flows/
  index.ts              public barrel for @switchbord/graph/endpoints/flows
  types.ts              Flow* response/input/types and caps
  validation.ts         Flow JSON and option validation helpers
  flowJson.ts           buildFlowJson / validateFlowJson
  dataExchange.ts       buildFlowScreenResponse / Close / Error
  callables.ts          list/get/create/update/publish/delete/deprecate/assets endpoint callables
```

Compatibility requirement:

- `wabaEndpoints.ts` initially re-exports Flow symbols from the new files so root imports and `WABAClient` imports continue working.
- `flows.ts` becomes a thin barrel over `./flows/index`.

### WABA phone listing

Current source:

- `listPhoneNumbers`, `PhoneNumberListEntry`, `PhoneNumberListResponse`, `GraphPaging` in `wabaEndpoints.ts`

Target layout options:

Option A, preferred first pass:

```text
packages/graph/src/endpoints/waba/
  index.ts
  phoneNumbers.ts
```

Keep `wabaEndpoints.ts` as a compatibility barrel re-exporting WABA phone listing plus templates/flows.

Option B, defer:

Leave phone listing in `wabaEndpoints.ts` until templates and flows have been split. This reduces blast radius and is acceptable if WABAClient tests remain comprehensive.

### Media family

Current file is also large, but it is cohesive around media. Do not split it in the same wave as `wabaEndpoints.ts` and `messages.ts`. Revisit after WATS-58 validation utility boundaries are designed.

Possible later layout:

```text
packages/graph/src/endpoints/media/
  index.ts
  types.ts
  validation.ts
  upload.ts
  download.ts
  decrypt.ts
  uploadSessions.ts
```

## Implementation sequence

### Phase 1 — split templates only

Goal: reduce `wabaEndpoints.ts` risk by extracting the more self-contained template family first.

Steps:

1. RED: add tests asserting current template public behavior through root, `@switchbord/graph/endpoints/templates`, and `WABAClient` stays identical.
2. Create `packages/graph/src/endpoints/templates/` files.
3. Move template types/builders/callables mechanically.
4. Change `wabaEndpoints.ts` to re-export template symbols from the new family while keeping Flow and phone-listing code in place.
5. Change `templates.ts` to re-export from `./templates/index`.
6. Run:
   - `bun test packages/graph/tests/wabaClient.test.ts packages/graph/tests/wabaTemplates.test.ts`;
   - `bun test packages/testing/tests/graph-consumer.test.ts packages/testing/tests/wats53-graph-endpoint-subpaths.test.ts packages/testing/tests/wats54-public-api-consistency.test.ts`;
   - `bun run api:check`;
   - `bun run typecheck`.
7. GREEN commit: mechanical template split only.

If no focused templates test exists, create one before moving code.

### Phase 2 — split flows

Goal: move Flow code after template extraction proves the compatibility-barrel pattern.

Steps:

1. RED: add tests asserting Flow public behavior through root, `@switchbord/graph/endpoints/flows`, and `WABAClient` stays identical.
2. Create `packages/graph/src/endpoints/flows/` files.
3. Move Flow types, validation, Flow JSON, data-exchange builders, and callables mechanically.
4. Change `wabaEndpoints.ts` to re-export Flow symbols from the new family.
5. Change `flows.ts` to re-export from `./flows/index`.
6. Run Flow tests, graph consumer fixture, `api:check`, and typecheck.
7. GREEN commit: mechanical Flow split only.

### Phase 3 — split WABA phone listing or retire `wabaEndpoints.ts`

Goal: leave `wabaEndpoints.ts` either as a tiny compatibility barrel or a WABA phone-listing module.

Steps:

1. Move `listPhoneNumbers`, `PhoneNumberListEntry`, `PhoneNumberListResponse`, and shared `GraphPaging` to `endpoints/waba/phoneNumbers.ts` or `endpoints/waba/index.ts`.
2. Update imports in `WABAClient`, business-management types, and tests if needed.
3. Keep `wabaEndpoints.ts` as a compatibility barrel that re-exports from `waba`, `templates`, and `flows` for at least one release line.
4. Run all WABA/business-management/template/Flow tests plus consumer fixtures.

### Phase 4 — split messages

Goal: split the high-traffic message composer module only after templates/flows split pattern is proven.

Steps:

1. Add or strengthen message composer request-snapshot tests for root, `@switchbord/graph/endpoints/messages`, `PhoneNumberClient`, and `WhatsApp` facade paths.
2. Create `endpoints/messages/` target files.
3. Move types/constants first, then validators, then builders, then callables.
4. Keep `messages.ts` as a compatibility barrel re-exporting from `./messages/index` initially.
5. Run:
   - `bun test packages/graph/tests/endpoints-messages.test.ts packages/graph/tests/phoneNumberClient.test.ts packages/core/tests/whatsappFacade.test.ts`;
   - graph consumer fixture and WATS-53/WATS-54 docs-lock tests;
   - `bun run api:check`;
   - `bun run typecheck`.

### Phase 5 — docs and manifest cleanup

After the mechanical split is complete and stable:

1. Update `scripts/public-api-consistency-manifest.json` source paths only if package exports move from compatibility barrels to family `index.ts` files.
2. Update `docs/architecture/package-map.md` with new internal family layout.
3. Update `docs/reference/endpoints.md` with the final module layout.
4. Update `CHANGELOG.md` with the split scope and no behavior change boundary.

## Tests to add before code movement

### Template split regression tests

Create or extend `packages/graph/tests/wabaTemplates.test.ts`:

- direct callable request snapshots for list/get/create/update/delete;
- component builder happy path and representative malformed input path;
- `validateTemplateParameterCounts` behavior;
- root export identity vs subpath export identity for representative functions.

### Flow split regression tests

Create or extend `packages/graph/tests/wabaFlows.test.ts`:

- direct callable request snapshots for list/get/create/update/publish/delete/deprecate/assets;
- Flow JSON validator at-limit and over-limit behavior;
- data-exchange response builder output;
- root export identity vs subpath export identity for representative functions.

### Message split regression tests

Extend existing message tests if needed:

- root export identity vs `@switchbord/graph/endpoints/messages` export identity;
- representative builder snapshots for text, media, interactive, template, read/typing;
- `PhoneNumberClient` and `WhatsApp` facade delegate through unchanged request shapes;
- malformed inputs continue to reject with `GraphRequestValidationError` and no raw host errors.

## Risk register

| Risk | Mitigation |
| --- | --- |
| Circular imports between new families and `wabaEndpoints.ts` | Move leaf helpers first; make `wabaEndpoints.ts` a re-export-only barrel after each family split. |
| Type-only exports accidentally become runtime imports | Use `export type` consistently and run `bun run typecheck`. |
| Root export drift | Run graph consumer fixture and `bun run api:check`. |
| Package subpath source drift | Keep thin compatibility barrels until after split stabilizes; only update manifest source paths deliberately. |
| Behavior changes hidden in refactor | Require request-snapshot tests before moving code; no semantic cleanup in split commits. |
| Validation helper divergence | Defer shared utility extraction to WATS-58; move helpers unchanged first. |
| Changelog/docs overclaim | State explicitly: mechanical split, no runtime behavior, no live Meta validation. |

## Verification matrix

Minimum commands per split phase:

```sh
bun test packages/graph/tests/wabaClient.test.ts \
  packages/graph/tests/businessManagement.test.ts \
  packages/testing/tests/graph-consumer.test.ts \
  packages/testing/tests/wats53-graph-endpoint-subpaths.test.ts \
  packages/testing/tests/wats54-public-api-consistency.test.ts

bun run api:check
bun run typecheck
bun run docs:check
git diff --check
```

Additional commands by phase:

- Templates: `bun test packages/graph/tests/wabaClient.test.ts packages/graph/tests/wabaTemplates.test.ts`
- Flows: `bun test packages/graph/tests/wabaClient.test.ts packages/graph/tests/wabaFlows.test.ts`
- Messages: `bun test packages/graph/tests/endpoints-messages.test.ts packages/graph/tests/phoneNumberClient.test.ts packages/core/tests/whatsappFacade.test.ts`
- Full closeout: `bun test`

## Definition of done for the future implementation

- Each split phase has RED/GREEN commits.
- Public package exports remain stable.
- Graph consumer fixture imports every documented public subpath.
- `bun run api:check` passes.
- Request snapshots are unchanged.
- Existing error taxonomy remains unchanged.
- Changelog and docs state mechanical/no-behavior-change boundary.
- No `tmp-wats-config` or other generated temp artifacts remain after tests.

## Recommended next Linear issues

WATS-57 is a plan slice. Implementation should be split into follow-up issues:

1. Split template endpoint family out of `wabaEndpoints.ts`.
2. Split Flow endpoint family out of `wabaEndpoints.ts`.
3. Split WABA phone-number listing or convert `wabaEndpoints.ts` to compatibility barrel.
4. Split message composer endpoint family out of `messages.ts`.
5. Revisit media module split after WATS-58 validation utility boundaries are known.

These should each be separate Linear issues because they touch different test matrices and have different rollback boundaries.
