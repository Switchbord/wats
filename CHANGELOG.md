# Changelog

## [0.2.1] - 2026-05-04

Alpha launch release for WATS. This is the first release line intended for public repository visibility and package-manager installation from the Bun/npm ecosystem once registry credentials are authorized.

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
- GitHub publication still requires a sanitized public import or history rewrite before pushing private history.
- No package publication occurs during release dry-runs; no GitHub release/tag creation happens until the sanitized public repository is pushed and reviewed. No package publication is performed by these checks.

### Verification gates

- `bun run typecheck`
- `bun run build:packages`
- `bun run pack:smoke`
- `bun run publish:dry-run` (`npm publish --dry-run` equivalent checks only; no package publication)
- `bun run release:dry-run`
- `bun run docs:check`
- `bun run docs:build`
- targeted release policy tests including `packages/testing/tests/wats021-alpha-release.test.ts`


### Service message routes

- `@switchbord/service` `POST {apiPrefix}/messages` now accepts WATS media composer bodies for image, video, audio, document, and sticker messages, converts them through the existing SDK builders, preserves generic text body compatibility, and keeps location/contacts/reaction/interactive service route expansion as later WATS-73 slices.

### CLI diagnostics

- `wats doctor --config <path>` now runs offline diagnostics for runtime/package imports, config/profile checks, service route collisions, OpenAPI generation, and optional env presence counts without printing env names or values.

### Not included

- No real `wats serve` process wrapper yet.
- No live Meta validation campaign execution yet.
- No Docker image publication.
- No GitHub release/tag creation until the sanitized public repository is pushed and reviewed.
