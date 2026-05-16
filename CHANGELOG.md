# Changelog

## [0.3.0] - 2026-05-15

Alpha tooling release for WATS. This release prepares the next public package line after 0.2.1 and collects the post-0.2.1 CLI, service, Graph-internal, docs, and release-metadata work into a truthful 0.3.0 train.

### Install

```bash
bun add @switchbord/cli
bunx --bun wats --help

bun add @switchbord/core @switchbord/graph @switchbord/http
bun add @switchbord/config @switchbord/service
```

The packages are standard npm registry packages, so Bun installs them with `bun add ...`. Release checks remain credential-free and verify package build, pack, publish dry-run, release dry-run, docs, and policy tests before any side-effecting publish/tag/release step is allowed.

### CLI diagnostics and dry-run service

- `wats setup [dir] [--profile <name>]` runs a safe credential setup wizard for one local profile, writing `wats.config.yaml` with env-secret references plus an ignored `.env.local` for local values, while refusing overwrites and making no Meta calls.
- `wats onboarding --public-url <https URL>` prints an operator-facing Meta webhook setup checklist with a safe callback URL, locally generated verify/service tokens, and a clear list of user-side Meta values to store outside git.
- `wats doctor --config <path>` runs offline diagnostics for runtime/package imports, config/profile checks, service route collisions, OpenAPI generation, and optional env presence counts without printing env names or values.
- `wats serve --config <path> --dry-run` starts the standalone `@switchbord/service` app through a local Bun process wrapper with synthetic in-memory secrets, a no-network Graph transport, health/readiness/OpenAPI routes, `--print-routes`, and graceful shutdown.
- The exported `runCli` helper remains embeddable: process signal handling and `process.exit` stay isolated to the executable bin wrapper, with regression coverage in both direct tests and the external `@switchbord/cli` consumer fixture.
- `wats serve` recognizes the WATS-72 live-intent/acknowledgement guard (`--live` + `--yes-live`, or paired `WATS_LIVE_ENABLE=1` / `WATS_YES_LIVE=1`) but still fails closed before secret resolution, env-file parsing, service bind, or Meta Graph calls.

### Service message routes

- `@switchbord/service` `POST {apiPrefix}/messages` accepts WATS media composer bodies for image, video, audio, document, sticker, location, contacts, reaction, remove-reaction, and interactive button/list/CTA URL/product/product-list/catalog/location-request messages.
- The service converts supported message bodies through the existing SDK builders, preserves generic text body compatibility, and keeps remaining non-message route expansion as later issues.
- The service OpenAPI default and generated docs now align with the 0.3.0 release version while continuing to describe WATS service routes only, not the full Meta Graph API.

### Graph endpoint internals

- WATS-65 moves the message-template endpoint family into `packages/graph/src/endpoints/templates/` modules while preserving root `@switchbord/graph`, `@switchbord/graph/endpoints/templates`, and `WABAClient` behavior.
- WATS-66 moves the Flow endpoint family into `packages/graph/src/endpoints/flows/` modules while preserving root `@switchbord/graph`, `@switchbord/graph/endpoints/flows`, and `WABAClient` behavior.
- WATS-67 moves WABA phone-number listing into `packages/graph/src/endpoints/waba/` modules while preserving root `@switchbord/graph`, `wabaEndpoints.ts`, and `WABAClient.listPhoneNumbers` behavior.
- These are internal endpoint-family splits only: no new live Meta behavior, no new WABA/admin mutations, and no package export breakage.

### Docs and release hygiene

- Public docs now separate the implemented dry-run/local operator tooling from live/production operator modes that remain future work.
- Release metadata is aligned for 0.3.0 across root/package manifests and release dry-run scripts derive the release version from the root manifest instead of stale hard-coded 0.2.1 constants.
- `bun run check-publish` includes the 0.3.0 release contract test in addition to existing WATS-31/WATS-83/WATS-85/0.2.1 historical release checks.
- Credential-free dry-runs still perform no package publication and No GitHub release/tag creation.

### Release and safety boundaries

- This is an alpha tooling release, not a 1.0 stability claim.
- test account credentials are not required for this release, default install, local tests, CI, docs generation, package build, or package-manager smoke checks.
- No live Meta calls are part of the release checks.
- No WhatsApp access tokens, app secrets, WABA IDs, phone-number IDs, or webhook payloads are committed.
- Live Meta validation remains gated behind WATS-80/WATS-81 and explicit credentials.
- No live Meta validation campaign execution yet.
- No live-capable `wats serve` startup or `--env-file` secret resolution yet; WATS-72 currently provides guard recognition only.
- No Docker image publication.
- No persistence, idempotency, or outbox runtime yet.

### Verification gates

- `bun run typecheck`
- `bun run build:packages`
- `bun run pack:smoke`
- `bun run publish:dry-run` (`npm publish --dry-run` equivalent checks only; no package publication)
- `bun run release:dry-run`
- `bun run docs:check`
- `bun run docs:build`
- targeted release policy tests including `packages/testing/tests/wats030-release-contract.test.ts`

## [0.2.1] - 2026-05-04

Alpha launch release for WATS. This was the first release line intended for public repository visibility and package-manager installation from the Bun/npm ecosystem.

### Install

```bash
bun add @switchbord/cli
bunx --bun wats --help

bun add @switchbord/core @switchbord/graph @switchbord/http
bun add @switchbord/config @switchbord/service
```

The packages are standard npm registry packages, so Bun can install them with `bun add ...` after publication. The release pipeline also verifies `npm pack --dry-run` package contents and Bun runtime import smoke tests before any publish command is allowed.

### Highlights

- Ships the WATS TypeScript/Bun foundations: Graph client, endpoint definitions, error taxonomy, pagination, media runtime, template/Flow/calling helpers, read-only business-management inventory, webhook verification/adapters, typed update normalization, filters, router, listeners, and the `WhatsApp` facade.
- Adds safe app-layer onboarding packages: `@switchbord/config`, `@switchbord/cli`, and `@switchbord/service`.
- Implements `wats init [dir] --dry-run --format yaml|json --profile <name>` for credential-safe config/env placeholder generation, plus `wats onboarding --public-url <https URL>` to print the webhook callback address, locally generated verify/service tokens, and the Meta-side credentials the user must provide.
- Adds public release hygiene from WATS-31, WATS-36A, WATS-83, WATS-84, WATS-85, and WATS-82: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, public docs site checks, builds and verifies `dist` package artifacts during release checks, packed-output smoke tests, internal support/private package guards, credential-free release dry-run workflow, credential-free provenance preflight, and first-release readiness documentation, including WATS-82 sanitized public repository gating.
- Prepares the publication-ready package set at version `0.2.1`: `@switchbord/types`, `@switchbord/crypto`, `@switchbord/graph`, `@switchbord/core`, `@switchbord/http`, `@switchbord/internal-utils`, `@switchbord/config`, `@switchbord/service`, and `@switchbord/cli`.

### Included historical milestone coverage

This alpha launch consolidates the previously tracked WATS/F milestone surface into the 0.2.1 train so the public changelog starts at this release while preserving docs-lock coverage for implemented capabilities. Included milestone labels and representative surfaces: WATS-46 — alpha CLI/runtime packaging decision (ADR-007, monorepo, second repository, WATS-47..52, design/docs only); WATS-47 — CLI operator UX design (design/docs only, no live Meta validation, no second repository); WATS-48 — persistence contract design; WATS-49 — Docker/deployment design scaffold; WATS-51 config/env templates at examples/config/wats.config.example.yaml, examples/config/wats.config.example.json, and .env.example; WATS-53 graph endpoint subpaths @switchbord/graph/endpoints/media, @switchbord/graph/endpoints/templates, @switchbord/graph/endpoints/flows, @switchbord/graph/endpoints/calling, @switchbord/graph/endpoints/messages, and @switchbord/graph/endpoints/business-management; WATS-55 reference status taxonomy refresh; WATS-57 graph endpoint module split plan; WATS-58 graph validation utility reuse plan; WATS-84 — Public policy and security baseline. Historical foundation markers covered by this launch include [0.2.0-f7] PhoneNumberClient and WABAClient, [0.2.0-f8] normalizeWebhookEnvelope, [0.2.0-f9] TypedFilter createTypedFilter FilterValidationError @switchbord/core/filtersTyped, [0.2.0-f10] TypedRouter WhatsApp DispatchReport RegistrationHandle observer onBeforeDispatch, [0.2.0-f11] ListenerRegistry ListenerHandle ListenerTimeoutError ListenerAbortError first-match-wins onListenerMatch, [0.2.0-f12] createWebhookAdapter createFetchWebhookHandler createBunWebhookServer createNodeWebhookHandler edge-runtime, and [0.2.0-f13] paginate PaginationError maxPages plus WATS-37 media runtime names MediaValidationError, MediaCryptoError, MediaIntegrityError, uploadMedia, downloadMediaBytes, decryptEncryptedMedia, and createUploadSession.

Design-only/docs-only boundaries preserved in this launch: WATS-46/WATS-47/WATS-48/WATS-49/WATS-57/WATS-58 are design/docs/test-planner only where applicable; no @switchbord/persistence package export, no adapters, no config schema changes, no service persistence integration, no second repository, no root Dockerfile/Compose, no runtime code movement, no runtime source movement, no new public package exports, separate credential-free implementation status from live validation status, and Boundary: docs-lock/status metadata only; no runtime Graph behavior, no live Meta calls, and no package export changes. ### WATS-55 — Reference status taxonomy refresh: separate credential-free implementation status from live validation status. Boundary: docs-lock/status metadata only; no runtime Graph behavior, no live Meta calls, and no package export changes. The WATS-84 legal/community baseline contributes LICENSE, CONTRIBUTING.md, SECURITY.md, and MIT license metadata; release dry-runs still perform no package publication, no GitHub repository creation or push, no release automation, and no live Meta calls.

### Release and safety boundaries

- This is an alpha launch release, not a 1.0 stability claim.
- test account credentials are not required for this release, default install, local tests, CI, docs generation, package build, or package-manager smoke checks.
- No live Meta calls are part of the release checks.
- No WhatsApp access tokens, app secrets, WABA IDs, phone-number IDs, or webhook payloads are committed.
- Live Meta validation remains gated behind future WATS-80/WATS-81 work and explicit credentials.
- GitHub publication required a sanitized public import or history rewrite before pushing private history.
- No package publication occurs during release dry-runs. No package publication is performed by these checks.

### Verification gates

- `bun run typecheck`
- `bun run build:packages`
- `bun run pack:smoke`
- `bun run publish:dry-run` (`npm publish --dry-run` equivalent checks only; no package publication)
- `bun run release:dry-run`
- `bun run docs:check`
- `bun run docs:build`
- targeted release policy tests including `packages/testing/tests/wats021-alpha-release.test.ts`
