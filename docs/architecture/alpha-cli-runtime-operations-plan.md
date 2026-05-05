# WATS Alpha CLI/runtime operations plan

- status: planning
- applies-to: WATS-46 and WATS-47..52
- lastReviewed: 2026-05-01
- owner: Linear roadmap; this document is only a repo-local summary

## Purpose

This plan summarizes the alpha operational path after ADR-007. Linear remains the source of truth for issue-level scope, status, and deferrals.

## Architecture decision summary

ADR-007 decides that WATS alpha CLI/runtime/deployment work stays in the existing WATS monorepo. The operator layer is not split into a second repository for alpha.

Why:

- `@switchbord/config`, `@switchbord/cli`, and `@switchbord/service` are still experimental and need coordinated contract iteration with `@switchbord/core`, `@switchbord/http`, and `@switchbord/graph`.
- One checkout, one docs site, one package map, and one CI loop are better for alpha contributors.
- Package boundaries can be enforced by monorepo consumer fixtures and docs-lock tests until packages are published.
- Docker/deploy examples, config templates, and persistence docs need to match the actual CLI/service contracts.
- A second repo is useful later only for independently versioned examples/templates after WATS packages are published.

## Alpha readiness tracks

### 1. CLI UX

Goal: make package-manager onboarding usable without writing framework glue.

WATS-47 design anchor: `docs/architecture/wats47-cli-operator-ux-design.md`.

Expected alpha features:

- `wats init` writes config templates safely with no overwrite by default.
- `wats config validate` remains credential-safe and does not resolve secret env refs.
- `wats config print` and `wats config paths` inspect config/profile discovery without leaking secrets.
- `wats doctor` performs offline environment/config/package diagnostics by default.
- `wats serve` starts the standalone service process once the runtime wrapper is designed.
- `wats openapi` continues to export service OpenAPI without live Meta calls.
- Help output documents credential-gated behavior explicitly.

Boundary:

- CLI composes `@switchbord/config` and `@switchbord/service`; it must not duplicate schema validation or service routing.
- Live Meta validation requires explicit opt-in flags and a documented secrets plan.
- No live Meta calls by default; no raw secrets in CLI arguments; no second repository for WATS-47.

Linear link: WATS-47.

### 2. Persistence: SQLite and Postgres

Goal: define a durable state layer for runtime operations without coupling WATS to one deployment topology.

WATS-48 design anchors: `docs/architecture/wats48-persistence-contract-design.md` and `docs/reference/persistence.md`.

Expected alpha features:

- A small persistence interface for runtime state that WATS actually needs.
- SQLite as the local/dev default if the state model requires a built-in adapter.
- Postgres as the deploy/production adapter if alpha operations need multi-process or hosted durability.
- Schema and migration policy with deterministic local tests.
- Webhook event idempotency and service request idempotency without raw webhook payload persistence by default; in shorthand, no raw webhook payload persistence by default.
- Redacted diagnostics: no secrets in diagnostics; never log access tokens, app secrets, verify tokens, bearer tokens, database URLs, or raw webhook payloads unless explicitly safe.

Boundary:

- WATS-48 is design/docs/test-planner only.
- Persistence is a monorepo package/subpath decision, not a reason to create a second repo.
- Do not implement adapters, schemas, config fields, migration runners, or service integration in WATS-48.
- Linear remains the source of truth for issue-level status and deferrals.

Linear link: WATS-48.

### 3. Docker and deployment

Goal: give users a boring path to run the standalone service once `wats serve` exists.

WATS-49 design anchors: `docs/architecture/wats49-docker-deployment-design.md` and `docs/guides/deploy-docker.md`.

Expected alpha features:

- Dockerfile or container recipe matched to the actual CLI/service process contract.
- Health/readiness route documentation (`/healthz`, `/readyz`).
- Environment injection examples that reference env var names only.
- Non-root runtime, minimal image, explicit port, and graceful shutdown guidance.
- Bun/Node deployment recipes consistent with supported runtime targets.

Boundary:

- WATS-49 is design/docs/test-planner only unless `wats serve` lands in the same behavior-bearing slice.
- Docker/deploy packaging must not precede the real `wats serve` process contract; in docs-lock wording, it must not precede the real `wats serve` process contract.
- No root Dockerfile, compose.yaml, image publication, registry credentials, or release automation until explicitly implemented in a later issue; in docs-lock wording, no image publication, registry credentials, or release automation.
- No live Meta calls in build/test/docs checks.

Linear link: WATS-49.

### 4. Release hygiene and semver

Goal: make alpha releases frequent, auditable, and boring.

WATS-50 release hygiene design anchor: `docs/architecture/wats50-release-hygiene-policy.md`.

Expected alpha features:

- Semver policy for `0.x` package changes.
- Changelog validation and package publish dry-runs.
- Package smoke tests that import from built artifacts once dist builds exist.
- Internal support package policy for `@switchbord/internal-utils` and private-package guards for `@switchbord/testing`.
- A release process that can eventually bump at least patch for every merged incremental PR.
- A reusable maintainer workflow for release closure hygiene.

Boundary:

- WATS-50 release hygiene is design/docs/test-planner/skill only.
- WATS-50 does not implement release automation, publish packages, create tags, push GitHub releases, mutate branch protection, or use credentials.
- Publication credentials must stay out of CI until explicitly authorized.

Linear link: WATS-50.

### 5. Config and environment templates

Goal: make first-run setup safe and copyable.

Expected alpha features:

- `wats.config.yaml` and JSON examples using the existing `@switchbord/config` schema.
- `.env.example` with placeholder names only, not sample secrets.
- Local/dev/prod profile guidance.
- Secret-manager handoff guidance for deployment environments.
- Clear distinction between config values that are public identifiers and fields that must remain env-secret refs.

Boundary:

- Raw tokens, app secrets, verify tokens, service bearer tokens, and live account ids must not be committed.
- Generated docs and examples must pass public docs secret-safety checks.

Linear link: WATS-51.

### 6. Community examples and alpha launch docs

Goal: make the public alpha understandable and useful.

Expected alpha features:

- Quickstarts for local webhook development, CLI config validation, OpenAPI export, and standalone service startup.
- Deployment examples aligned with the Docker/runtime decisions.
- Troubleshooting for config/env/ports/webhook signatures.
- pywa migration docs and parity matrix updates when operational behavior changes.
- Curated examples that import only public `@switchbord/*` package specifiers.

Boundary:

- Do not claim that `switchbord/wats` exists or has been pushed until repository creation actually happens.
- A separate examples/templates repository is a later decision after alpha packages are publishable and stable.

Linear link: WATS-52.

## Sequencing

```text
WATS-46  ADR + roadmap + release-policy docs lock
   |
WATS-47  CLI init/doctor/serve completion
   |
WATS-48  persistence contract + SQLite/Postgres path
   |
WATS-49  Docker/deploy packaging matched to serve contract
   |
WATS-50 release hygiene policy and reusable skill
   |
WATS-51 config/env templates and onboarding examples
   |
WATS-52  community examples and alpha launch docs
```

Some work may overlap, but implementation should not invert dependencies that affect user contracts. In particular, Docker packaging should not precede the real `wats serve` process contract, and release automation should not claim package/image publication before credentials and publish policy are approved.

## Required documentation updates per track

| Track | Docs to update when implemented |
| --- | --- |
| CLI UX | `docs/reference/cli.md`, getting-started guide, changelog, public docs manifest if new public pages are added |
| Persistence | service/config references, package map, release policy if new publishable packages are introduced |
| Docker/deploy | deployment guides, service reference, release readiness checklist |
| Config/env templates | config reference, CLI guide, `.env.example`, public docs secret checks |
| Release automation | release policy, CI docs, changelog policy, package publish docs |
| Community examples | public docs site nav/sidebar, migration/parity docs where behavior changes |

## Test expectations

WATS-46 adds docs-lock coverage only. WATS-47 docs-lock coverage now anchors the command UX design in `docs/architecture/wats47-cli-operator-ux-design.md`.

Future implementation tracks should add tests appropriate to their behavior:

- WATS-47: init no-overwrite/no-secret generation tests, doctor offline/no-secret diagnostics tests, serve process-wrapper tests, and cli-consumer fixture coverage.
- WATS-48: WATS-48 docs-lock coverage, storage contract tests, migration/adversarial tests, SQLite adapter contract tests, and Postgres adapter contract tests.
- WATS-49: WATS-49 docs-lock coverage plus future container/deploy smoke checks that do not require credentials, health/readiness/OpenAPI-only startup assertions, and no live Meta calls.
- WATS-50: release-policy/docs-lock coverage plus reusable skill validation.
- WATS-51: docs secret-safety checks for examples and env templates.
- WATS-52: docs-link/docs-build checks.

## Second repository revisit point

Do not create a second repo for WATS alpha operations. Revisit only after packages are published and a separate examples/templates cadence would provide more community value than it costs in cross-repo coordination.
