# Release Policy

- status: active
- applies-to: WATS monorepo
- lastReviewed: 2026-05-01

## Purpose

This document defines how WATS moves from the current foundations line to publishable releases. It is intentionally short: release mechanics should be boring, auditable, and easy to automate.

## Version lines

WATS uses semantic versioning across published workspace packages.

### `0.x` development line

Use the `0.x` line while the public toolkit is still expanding toward full WhatsApp/pywa parity.

- Patch bump: documentation fixes, test-only changes, non-behavioral repo hygiene, or bug fixes that do not change public contracts.
- Minor bump: any new public feature, endpoint family, package, CLI command, config schema field, standalone service route, persistence contract, or deployment artifact that defines supported behavior.
- Breaking changes are allowed only when documented in the changelog and parity/reference docs, but they still require a minor bump in `0.x`.

### Alpha release hygiene

WATS alpha keeps the CLI/runtime/operator layer in this monorepo per architecture notes. The intended release discipline is frequent, auditable increments: after release automation exists, each merged incremental PR should normally produce at least a patch-level release candidate unless it is explicitly batched into a documented alpha train.

WATS-50 release hygiene policy adds a reusable maintainer workflow and makes this PR/release discipline explicit. It is design/docs/test-planner/workflow only and patch-class. Every merged alpha PR should have a release classification unless it is included in a documented alpha train; in docs-lock wording, every merged alpha PR carries at least patch-class release intent. Changesets or equivalent are a future automation choice, not implemented by this slice; in lowercase, changesets or equivalent are not implemented by this slice. Roadmap and deferred work live in Linear, not repo-local deferred ledgers; in docs-lock wording: Linear, not repo-local deferred ledgers.

Current status: this is policy/design only. WATS-46 and WATS-50 do not implement version-bump automation, package publication, GitHub releases, Docker image publication, branch-protection mutation, public repo creation, or credentialed CI.

Alpha classification rules:

- Docs-only, tests-only, and non-behavioral repository-hygiene changes are patch changes.
- WATS-47 CLI operator UX design is design/docs/test-planner only, so it is a patch-class change until behavior lands.
- New CLI behavior, config schema fields, service routes, persistence interfaces/adapters, Docker/deploy artifacts that define supported behavior, public docs-site surfaces, or package exports are minor changes on `0.x`.
- Implemented `wats init`, `wats doctor`, or `wats serve` behavior is a minor change on `0.x`, because those commands define supported operator behavior.
- The lowercase release-note summary is: implemented `wats init`, `wats doctor`, or `wats serve` behavior is minor, while WATS-47 design/docs/test-planner only remains patch.
- WATS-48 persistence contract design is design/docs/test-planner only, so it is patch-class until behavior lands.
- Implemented persistence interfaces, package exports, config schema fields, service integration, migration runner, SQLite adapter, or Postgres adapter are minor changes on `0.x`.
- WATS-49 Docker/deployment design scaffold is design/docs/test-planner only, so it is patch-class until behavior lands.
- Implemented Dockerfile, compose.yaml, container health checks, published image, or container-registry credentials are minor changes on `0.x` and must remain outside credential-free checks until explicitly authorized.
- Breaking alpha contract changes are still minor changes on `0.x`, but must be called out in `CHANGELOG.md`, release notes, migration docs when relevant, and public API/reference docs.
- Release candidates must preserve the no-live-credentials default: no Meta, npm, GitHub release, package-registry, or container-registry secrets are required for local checks.
- `Switchbord/wats` must not be referenced as an existing pushed public repository until repository creation/push actually occurs.

### `1.x` stable line

Cut `1.0.0` only when WATS has a coherent, publishable WhatsApp operations surface:

- packages are publishable from `dist`, not source-only exports
- CI runs tests, type checks, package smoke tests, and docs checks
- Graph, webhook, routing, config, CLI onboarding, and standalone service are documented
- OpenAPI 3.1 exists for the standalone service
- core WhatsApp/pywa coverage is tracked in Linear and the parity matrix
- remaining gaps are explicitly labeled as post-1.0, experimental, or unsupported

After `1.0.0`:

- Patch bump: backward-compatible fixes and docs clarifications.
- Minor bump: backward-compatible public API additions.
- Major bump: breaking public contract changes.

## Monorepo package policy

The root package remains private. Published packages should be scoped packages under `@wats/*` until a future rename/scope decision is made. The alpha CLI/runtime/operator layer stays in this monorepo per architecture notes; a second repository is not the default release target for `@wats/cli`, `@wats/service`, config templates, persistence contracts, Docker/deploy docs, or alpha launch documentation.

Publishable packages:

- `@wats/types`
- `@wats/crypto`
- `@wats/graph`
- `@wats/core`
- `@wats/http`
- `@wats/internal-utils` (published internal support, not stable application API)
- `@wats/config`
- `@wats/service`
- `@wats/cli`

Private packages:

- `@wats/testing`

Before any public release, publishable packages must expose built artifacts via `exports` and `types`; source-only `./src/*.ts` exports are acceptable for the local Bun workspace but not for registry release.

## WATS-31 publishability scaffold

WATS-31 adds the first release/CI hygiene scaffold without converting every package to a `dist` build. The scaffold is intentionally non-publishing: it verifies the current source-only workspace remains testable, type-checkable, and guarded against accidental publication of workspace packages.

Exact local commands:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run docs:check
bun run docs:build
bun run check-publish
```

What these commands mean today:

- `bun test` runs the existing unit, policy, consumer-fixture, docs-lockstep, and edge-runtime tests.
- `bun run typecheck` runs `bunx tsc --noEmit -p tsconfig.release.json` over the currently publishable package source trees: `@wats/types`, `@wats/crypto`, `@wats/graph`, `@wats/core`, `@wats/http`, `@wats/config`, `@wats/service`, and `@wats/cli`.
- `bun run docs:check` validates the public docs manifest, local links, internal-path exclusions, and generated-output secret scan.
- `bun run docs:build` generates the static OpenAPI JSON, creates the TypeDoc-ready package API page, and builds the VitePress site credential-free.
- `bun run check-publish` runs typecheck, `bun run build:packages`, `bun run pack:smoke`, and the WATS-31/WATS-83 workspace-policy tests.

CI mirrors those commands in `.github/workflows/ci.yml` using Bun on GitHub-hosted Ubuntu. No Meta credentials, WhatsApp tokens, app secrets, npm tokens, or publish permissions are required by this credential-free workflow.

## WATS-83 publishable package artifacts

WATS-83 converts the publishable package manifests from source-only `./src/*.ts` exports to built `dist` artifacts. The publishable packages now declare `main`, `types`, and `exports` entries that point at `dist/index.js`, `dist/index.d.ts`, and matching subpath `dist` files.

The new `bun run build:packages` gate builds JavaScript and declarations for `@wats/types`, `@wats/crypto`, `@wats/graph`, `@wats/core`, `@wats/http`, `@wats/internal-utils`, `@wats/config`, `@wats/service`, and `@wats/cli` into each package-local `dist/` directory. The private `@wats/testing` package remains outside this build list.

The new `bun run pack:smoke` gate runs packed-output smoke tests with `bun pm pack --dry-run --ignore-scripts` plus temporary tarball inspection. It verifies package tarballs contain `package.json`, `dist/index.js`, and `dist/index.d.ts`, and exclude source entrypoints, `.env` files, and `node_modules`.

WATS-83 originally kept packages private while adding artifact smoke gates. For the 0.2.1 alpha launch, packages are publishable with `private: false` and `publishConfig.access: public`; publication still happens only after explicit operator authorization. There is no registry publication in dry-run checks, no GitHub release, no tag creation, no repository push, no branch-protection mutation, no credentialed CI, and no live Meta call.

## WATS-85 release automation dry-run

WATS-85 adds a credential-free release automation dry-run and provenance preflight. The root `release:dry-run` script checks `git status --short`, policy files, publishable package dist manifest shape, internal support/workspace package guards, `bun run build:packages`, `bun run pack:smoke`, and docs checks without acquiring publishing authority.

The `.github/workflows/release-dry-run.yml` workflow is manual GitHub Actions `workflow_dispatch` only. It uses read-only contents permissions, `id-token: none`, and no secrets. It is a provenance preflight for release readiness, not a deployment or publication workflow.

WATS-85 has no publishing authority: no registry credentials, no `npm publish`, no GitHub release, no tags/releases, no Docker push, no branch-protection mutation, no repository push, and no live Meta calls.

## WATS-84 public policy baseline

WATS-84 adds the public policy/legal baseline required before public repository visibility: a root `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, and MIT license metadata in workspace package manifests.

This resolves the earlier legal/community-file follow-up for GitHub visibility. It does not make the packages registry-ready: source-only `./src/*.ts` exports remain a package-release blocker until WATS-83 builds and smoke-tests publishable artifacts.

WATS-84 is still non-publishing release readiness work. It does not create a GitHub repository, push to `Switchbord/wats`, publish packages, add release automation, create tags/releases, mutate branch protection, configure credentialed CI, or run live Meta calls.

Before public repository creation or push, maintainers must also verify that non-public planning artifacts are absent from the public tree or history.

## Changelog policy

`CHANGELOG.md` is user-facing. Each release entry should answer:

1. What changed?
2. What can users do now that they could not do before?
3. What changed in the public contract?
4. Which docs and parity rows changed?
5. Which known gaps remain?

Do not create extra hardening-follow-up changelog entries for the same feature. If adversarial review reopens a feature before release, amend the original entry in place.

## Roadmap policy

Roadmap and deferred work live in Linear, not in repo-local deferred ledgers. Repo docs may summarize current scope, but issue-level tracking belongs in Linear. The WATS-46 alpha operations plan is such a summary for WATS-47..52; it is not a replacement issue tracker.

Every roadmap issue should include:

- scope ledger: included / not included
- docs to update
- tests and consumer fixtures required
- credential requirements, if any
- pywa / Meta reference links or source files to reconcile
- release classification: patch, minor, major, or post-1.0

## Credential gate

Work that touches live Meta Graph endpoints requires explicit user authorization and a documented secrets plan.

Allowed without credentials:

- unit tests
- `MockTransport` tests
- config parsing/validation
- OpenAPI generation
- local webhook signature tests with synthetic secrets
- docs and package smoke tests

Requires authorization:

- live message send
- live template/media/flow/calling/admin endpoint checks
- live webhook verification using real app secrets
- any operation that mutates WABA, phone-number, template, media, catalog, flow, or calling state

## Release readiness checklist

Before tagging or pushing a release:

- [ ] working tree clean
- [ ] `bun install` complete
- [ ] `bun test` green
- [ ] type checks green for all publishable packages
- [ ] package exports point at build output for publishable packages
- [ ] consumer fixtures import only through package specifiers
- [ ] alpha CLI/runtime/operator release notes match the monorepo package boundaries in architecture notes
- [ ] README reflects actual shipped scope
- [ ] reference docs and guides updated
- [ ] parity matrix updated
- [ ] changelog entry written
- [ ] Linear roadmap reflects remaining gaps
- [ ] no secrets or credential values committed

## 0.2.1 alpha launch package-manager release

WATS 0.2.1 is the alpha launch package-manager line. The intended registry path is npm-compatible package publication, which Bun consumes with `bun add @wats/...`.

Publishable packages for 0.2.1:

- `@wats/types`
- `@wats/crypto`
- `@wats/graph`
- `@wats/core`
- `@wats/http`
- `@wats/internal-utils`
- `@wats/config`
- `@wats/service`
- `@wats/cli`

`@wats/internal-utils` is included because `@wats/config` depends on it at runtime; keeping it private would make registry installs fail. It remains documented as an internal package and should not be treated as a stable public API.

Before actual publication, run:

```bash
bun run check-publish
bun run docs:build
```

The `publish:dry-run` gate performs npm-compatible dry-run packaging and Bun import smoke checks without publishing. Actual `npm publish --access public` still requires a valid npm token and explicit operator authorization.
