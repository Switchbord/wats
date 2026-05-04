# ADR-007: Alpha CLI/runtime operator layer packaging

- status: Accepted
- date: 2026-05-01
- labels: [alpha, cli, runtime, packaging, monorepo, release-operations]
- relatesTo: ADR-003 (Transport/Crypto), ADR-005 (Endpoint Registry), ADR-006 (Testing), WATS-31, WATS-32, WATS-33, WATS-34, WATS-35, WATS-36A, WATS-47..52

## Context

WATS now has the raw spine needed for alpha operations:

- `@wats/types` for domain contracts.
- `@wats/crypto`, `@wats/http`, and `@wats/graph` for portable runtime seams and Graph execution.
- `@wats/core` for routing, filters, listeners, and the `WhatsApp` facade.
- `@wats/config` for YAML/JSON config with env-secret references.
- `@wats/service` for a runtime-neutral standalone webhook/API app and OpenAPI document.
- `@wats/cli` for package-manager UX around config validation, OpenAPI export, local token generation, and planned `init`/`doctor`/`serve` behavior.
- `@wats/testing` as a private monorepo package and `@wats/internal-utils` as an internal support package published only when public runtime packages require it.

The alpha question is whether the release-alpha operational layer (CLI process wrapper, runtime service wrapper, Docker/deploy artifacts, persistence adapters, example configs, and release hygiene) should stay in this WATS monorepo or move to a second repository that imports the raw WATS spine as dependencies.

Default orientation: keep CLI/runtime/deployment in the monorepo unless a second repository is strongly justified.

## Decision

Keep the WATS alpha CLI/runtime/operator layer in the existing WATS monorepo.

The alpha release should continue to publish coordinated packages from this workspace (`@wats/config`, `@wats/cli`, `@wats/service`, and the raw spine packages). Do not create a second repository for alpha operations by default. A second repository is only justified later for independently versioned example applications, hosted templates, or deployment blueprints that can lag/lead the core SDK without defining WATS's public runtime contract.

The operational layer remains package-bounded inside the monorepo:

```text
WATS monorepo
  packages/types            public raw contracts
  packages/crypto           public crypto seam
  packages/graph            public Graph spine
  packages/http             public webhook/http seam
  packages/core             public facade/router/filter spine
  packages/config           public alpha config contract
  packages/service          public runtime-neutral standalone service
  packages/cli              public CLI/process UX
  packages/internal-utils   internal support helpers
  packages/testing          private docs/policy/fixture tests
  docs/                     architecture, reference, guides, examples policy
  scripts/                  credential-free docs/release checks
  .github/workflows/        credential-free CI only until release automation lands
```

## Options considered

### Option A — Monorepo owns raw spine plus alpha operator layer

The existing WATS workspace owns the public SDK packages and the alpha operational packages (`@wats/config`, `@wats/cli`, `@wats/service`). Docker/deploy docs, config templates, `.env.example`, and persistence adapters are added as monorepo work when their Linear issues land.

Pros:

- Best developer experience for alpha: one checkout, one lockfile, one CI graph, one docs site, one package map.
- Package-boundary mistakes are caught by existing workspace tests and consumer fixtures before publication.
- Versioning is coordinated while config/CLI/service contracts are still experimental and likely to change together.
- Documentation stays close to the code that defines CLI flags, config fields, OpenAPI routes, and deploy examples.
- Release notes can explain a single WATS alpha capability set instead of cross-repository compatibility tables.
- Community contributors can inspect the whole system without chasing a private or newly bootstrapped operations repo.
- No GitHub repo creation, auth, or live credential dependency is needed for alpha design work.

Cons:

- The monorepo contains more than a minimal SDK spine, so maintainers must enforce package boundaries and private package/internal-support guards.
- Deploy examples may become noisy if they are not curated and kept credential-free.
- A single release cadence can over-couple docs-only/runtime-only changes unless semver policy is explicit.

### Option B — Second repo imports WATS packages and owns operator layer

Create a separate release-alpha operations repository that depends on published WATS packages. It owns CLI wrappers, service deployment, Dockerfiles, examples, config templates, persistence, and release automation.

Pros:

- Clean separation between raw SDK spine and opinionated app/deployment assets.
- The operations repo dogfoods published package boundaries as a real external consumer.
- It could use a different release cadence, license policy, or deployment-oriented issue workflow.
- It can host full-stack example apps without making the SDK repository look application-heavy.

Cons:

- Requires package publication or workspace linking before the operator layer can move quickly.
- Increases alpha friction: two repos, two CI systems, cross-repo PR ordering, compatibility matrix, and more bootstrap docs.
- Slows contract iteration across `@wats/config`, `@wats/cli`, and `@wats/service`, which are still experimental.
- Makes docs ownership ambiguous: CLI flags, config schema, service routes, and deployment examples would be split from their source.
- Requires GitHub repo creation/push and auth that are explicitly out of scope here.
- Weakens community value during alpha because the main repository would not show a coherent end-to-end path.

### Option C — Hybrid: monorepo contracts, second repo only for examples/templates

Keep SDK/config/CLI/service packages in the monorepo, but eventually create a separate examples or templates repository after alpha packages are published and stable enough to consume as external dependencies.

Pros:

- Preserves alpha iteration speed while allowing future examples to validate consumer ergonomics.
- Keeps package boundaries honest through real external examples when the public API has settled.
- Lets deployment templates evolve at a different cadence once they are not defining core contracts.

Cons:

- Still not needed for WATS alpha and would add coordination before there is a published package baseline.
- Requires clear ownership rules so examples do not become the source of truth for CLI/service behavior.

## Tradeoff comparison

| Dimension | Monorepo default | Second repo |
| --- | --- | --- |
| Developer experience | One checkout, one docs site, one CI loop; easiest for alpha contributors. | More realistic external consumption but higher bootstrap/cross-repo friction. |
| Versioning | Coordinated semver across packages while contracts move together. | Requires compatibility matrix between operator repo and WATS packages. |
| Package boundaries | Enforced with workspace tests, consumer fixtures, private guards, and docs-lock tests. | Enforced naturally by published package imports, but only after publication exists. |
| Deployment | Docker/deploy docs can live beside service/CLI source and be tested credential-free. | Cleaner deployment repo, but likely duplicates service/config docs. |
| Documentation | Single source for config, CLI, service, OpenAPI, release policy, and roadmap. | Split docs; users must know which repo is authoritative. |
| Release cadence | One alpha train with patch/minor classification; less coordination. | Independent cadence possible but premature before alpha contracts stabilize. |
| Community value | Main repo demonstrates end-to-end adoption path. | A second repo may help later as a gallery/template once packages are published. |

## Architecture implications

1. `@wats/config`, `@wats/cli`, and `@wats/service` stay publishable packages in this monorepo. They are not temporary wrappers for a different repository.
2. The CLI remains the user-facing process and package-manager UX boundary. It composes `@wats/config` and `@wats/service` rather than duplicating config parsing or service routing.
3. The service package remains runtime-neutral (`Request -> Response`) and does not read environment variables. CLI/server wrappers resolve env refs and pass explicit secrets in memory.
4. Persistence is an alpha extension point, not a second-repo reason. SQLite and Postgres adapters should be designed behind explicit interfaces and can live in monorepo packages or subpaths once WATS-48 lands.
5. Docker/deploy artifacts are release assets for this repository when implemented. They must remain credential-free in source: templates reference env vars and never contain live tokens.
6. Examples and docs should use public package specifiers (`@wats/*`) and consumer fixtures should keep proving those specifiers. Internal relative imports must not leak into public docs.
7. The public docs site may document the alpha operational path only for behavior that actually exists or is explicitly marked planned. Do not imply that `switchbord/wats` has been created or pushed.

## Release hygiene and semver implications

WATS uses semver across published workspace packages on the `0.x` line.

For alpha:

- Each incremental merged PR should normally result in at least a patch-level release candidate once release automation exists, but this ADR is policy/design only and does not implement automation.
- Docs-only, tests-only, and non-behavioral repository-hygiene changes are patch changes.
- New CLI commands, config schema fields, service routes, persistence interfaces, deployment artifacts that define supported behavior, or package exports are minor changes on `0.x`.
- Breaking alpha contract changes are still minor changes on `0.x`, but must be called out in `CHANGELOG.md`, release notes, migration docs when relevant, and public API/reference docs.
- The root package remains private. `@wats/internal-utils` may publish only as internal support for public runtime packages; `@wats/testing` remains guarded against publication.
- Release automation, npm/GitHub publication, Docker image publication, and GitHub repo creation are deferred to follow-up issues; this ADR must not be read as claiming those systems exist.

## WATS-47..52 sequencing

Linear remains the source of truth for issue-level tracking. The monorepo alpha operations sequence should be:

1. **WATS-47 — CLI UX completion for alpha**
   - Finish real `wats init`, `wats doctor`, and `wats serve` behavior.
   - Keep no-live-credentials as the default.
   - Add safe examples, help text, and consumer fixtures.

2. **WATS-48 — Persistence contract and adapters**
   - Define storage interfaces for runtime state needed by alpha operations.
   - Add SQLite as the local default and Postgres as the deploy/production path if justified.
   - Include schema/migration policy, test isolation, and no-secret logging rules.

3. **WATS-49 — Docker and deployment packaging**
   - Add Dockerfile/container docs only after the serve/runtime contract exists.
   - Include health/readiness, env var injection, non-root/runtime-hardening defaults, and deployment recipes.
   - Do not publish images or use registry credentials until explicitly authorized.

4. **WATS-50 — Release hygiene, semver, PR/release policy, reusable maintainer workflow**
   - Document the release train mechanics before automation: version classification, changelog validation, package smoke tests, provenance/signing decisions if any, and publish dry-runs.
   - Add reusable maintainer workflow guidance while keeping credentials out of CI until publication is intentionally enabled.

5. **WATS-51 — Config and environment templates**
   - Add checked-in config examples and `.env.example` templates with placeholder env var names only.
   - Document local/dev/prod profiles and secret-manager handoff.
   - Keep raw secrets out of examples and tests.

6. **WATS-52 — Community examples and alpha launch docs**
   - Add curated examples, quickstarts, troubleshooting, and public docs updates.
   - Decide whether an examples/templates repository is useful after monorepo packages are publishable and alpha contracts are stable.

## Deferred second-repo trigger

A second repository can be reconsidered only when at least one of these is true:

- WATS packages are published and stable enough for an external template repo to consume without workspace linking.
- Deployment examples need their own issue/release cadence without changing WATS package contracts.
- A hosted-template/gallery community workflow emerges that would add noise to the SDK monorepo.
- Maintainers want a clean external-consumer smoke test after package publication.

Until then, creating a second repo is rejected for WATS alpha.

## Consequences

- WATS alpha operations work remains visible, reviewable, and testable in one repository.
- Package boundaries must be actively enforced through tests, docs checks, and release policy.
- The monorepo release policy must explicitly distinguish policy/design from implemented automation.
- Future implementation issues should not add repo-local deferred ledgers; they should update Linear and keep repo docs as summaries.

## Non-goals

This ADR does not implement:

- CLI command behavior.
- database schemas or persistence adapters.
- Dockerfiles or container images.
- release automation or package publishing.
- GitHub repository creation or pushes.
- live Meta Graph calls, credentials, or credential validation.
