# Changelog

## [0.3.2] - 2026-05-18


### WATS-89 — v24/v25 webhook schema refresh

- Adds `played` to `WhatsAppMessageStatusKind` and `filtersTyped.status.played()` for voice playback receipts.
- Normalizes inbound webhook media `url` to public `media.url` and documents that status `conversation` is optional / absent by default in v24+.
- Preserves unsupported details for removed/unsupported message shapes such as `request_welcome` while keeping raw fallback.
- Promotes Coexistence account events including `PARTNER_REMOVED`, `account_offboarded`, `account_reconnected`, and `disconnectionInfo` in credential-free synthetic webhook coverage.

### WATS-90 — v24 message builders

- Adds `buildSendCallPermissionRequestPayload(...)` and `PhoneNumberClient.sendCallPermissionRequest(...)` for Graph `interactive.type = "call_permission_request"` / `action.name = "call_permission_request"` bodies.
- Adds audio voice-message designation via `buildSendAudioPayload({ to, mediaId, voice: true })` and `PhoneNumberClient.sendAudio({ ..., voice: true })`.
- Updates service `/messages` composer docs for `type: "callPermissionRequest"` and audio `voice: true`; all coverage is credential-free MockTransport only.

Patch alpha package release for WATS. This release keeps the 0.3.1 setup-wizard/tooling behavior and publishes corrected `@wats/*` npm packages with package-manager-safe ESM imports and CLI bin metadata.

### Package release correction

- Publishes the canonical npm scope as `@wats/*` for all nine public packages.
- Corrects built package artifacts so emitted ESM uses explicit `.js`/`index.js` relative specifiers that work from npm installs in Node and Bun.
- Corrects the `@wats/cli` bin metadata to `dist/bin.js`, preserving the executable `wats` command for package-manager installs.
- `0.3.1` should be treated as superseded on npm; use `0.3.2` or `latest`.

### CI maintenance

- Updates GitHub Actions checkout steps to `actions/checkout@v5` so the credential-free CI and release dry-run workflows are ready for GitHub's Node 24 action runtime.

### CLI setup wizard

- `wats setup [dir] [--profile <name>]` remains the safe non-live credential setup wizard for one local profile.
- Release metadata is aligned for 0.3.2 across root/package manifests, public internal dependency ranges, service OpenAPI default version, and release-policy tests.

### Release and safety boundaries

- This is an alpha tooling/package correction release, not a 1.0 stability claim.
- No live Meta calls, token validation against Meta, multi-profile credential editor, live-capable `wats serve`, `--env-file` live secret resolution, Docker image publication, persistence/outbox, or live Meta validation campaign execution are included.

## [0.3.1] - 2026-05-16

Patch alpha tooling release for WATS. This release added WATS-104's safe single-profile credential setup wizard on top of the 0.3.0 operator tooling line. The npm `@wats/*@0.3.1` artifacts were superseded by `0.3.2` before GitHub Release because the corrected package-manager install line is `0.3.2`.

## [0.3.0] - 2026-05-15

Alpha tooling release for WATS. This release prepares the next public package line after 0.2.1 and collects the post-0.2.1 CLI, service, Graph-internal, docs, and release-metadata work into a truthful 0.3.0 train.

### Install

```bash
bun add @wats/cli
bunx --bun wats --help

bun add @wats/core @wats/graph @wats/http
bun add @wats/config @wats/service
```

The packages are standard npm registry packages, so Bun installs them with `bun add ...`. Release checks remain credential-free and verify package build, pack, publish dry-run, release dry-run, docs, and policy tests before any side-effecting publish/tag/release step is allowed.

### CLI diagnostics and dry-run service

- `wats setup [dir] [--profile <name>]` runs a safe credential setup wizard for one local profile, writing `wats.config.yaml` with env-secret references plus an ignored `.env.local` for local values, while refusing overwrites and making no Meta calls.
- `wats onboarding --public-url <https URL>` prints an operator-facing Meta webhook setup checklist with a safe callback URL, locally generated verify/service tokens, and a clear list of user-side Meta values to store outside git.
- `wats doctor --config <path>` runs offline diagnostics for runtime/package imports, config/profile checks, service route collisions, OpenAPI generation, and optional env presence counts without printing env names or values.
- `wats serve --config <path> --dry-run` starts the standalone `@wats/service` app through a local Bun process wrapper with synthetic in-memory secrets, a no-network Graph transport, health/readiness/OpenAPI routes, `--print-routes`, and graceful shutdown.
- The exported `runCli` helper remains embeddable: process signal handling and `process.exit` stay isolated to the executable bin wrapper, with regression coverage in both direct tests and the external `@wats/cli` consumer fixture.
- `wats serve` recognizes the WATS-72 live-intent/acknowledgement guard (`--live` + `--yes-live`, or paired `WATS_LIVE_ENABLE=1` / `WATS_YES_LIVE=1`) but still fails closed before secret resolution, env-file parsing, service bind, or Meta Graph calls.

### Service message routes

- `@wats/service` `POST {apiPrefix}/messages` accepts WATS media composer bodies for image, video, audio, document, sticker, location, contacts, reaction, remove-reaction, and interactive button/list/CTA URL/product/product-list/catalog/location-request messages.
- The service converts supported message bodies through the existing SDK builders, preserves generic text body compatibility, and keeps remaining non-message route expansion as later issues.
- The service OpenAPI default and generated docs now align with the 0.3.0 release version while continuing to describe WATS service routes only, not the full Meta Graph API.

### Graph endpoint internals

- WATS-65 moves the message-template endpoint family into `packages/graph/src/endpoints/templates/` modules while preserving root `@wats/graph`, `@wats/graph/endpoints/templates`, and `WABAClient` behavior.
- WATS-66 moves the Flow endpoint family into `packages/graph/src/endpoints/flows/` modules while preserving root `@wats/graph`, `@wats/graph/endpoints/flows`, and `WABAClient` behavior.
- WATS-67 moves WABA phone-number listing into `packages/graph/src/endpoints/waba/` modules while preserving root `@wats/graph`, `wabaEndpoints.ts`, and `WABAClient.listPhoneNumbers` behavior.
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
bun add @wats/cli
bunx --bun wats --help

bun add @wats/core @wats/graph @wats/http
bun add @wats/config @wats/service
```

The packages are standard npm registry packages, so Bun can install them with `bun add ...` after publication. The release pipeline also verifies `npm pack --dry-run` package contents and Bun runtime import smoke tests before any publish command is allowed.

### Highlights

- Ships the WATS TypeScript/Bun foundations: Graph client, endpoint definitions, error taxonomy, pagination, media runtime, template/Flow/calling helpers, read-only business-management inventory, webhook verification/adapters, typed update normalization, filters, router, listeners, and the `WhatsApp` facade.
- Adds safe app-layer onboarding packages: `@wats/config`, `@wats/cli`, and `@wats/service`.
- Implements `wats init [dir] --dry-run --format yaml|json --profile <name>` for credential-safe config/env placeholder generation, plus `wats onboarding --public-url <https URL>` to print the webhook callback address, locally generated verify/service tokens, and the Meta-side credentials the user must provide.
- Adds public release hygiene from WATS-31, WATS-36A, WATS-83, WATS-84, and WATS-85: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, public docs site checks, builds and verifies `dist` package artifacts during release checks, packed-output smoke tests, internal support package guards, private package guards, credential-free release dry-run workflow, and credential-free provenance preflight.
- Prepares the publication-ready package set at version `0.2.1`: `@wats/types`, `@wats/crypto`, `@wats/graph`, `@wats/core`, `@wats/http`, `@wats/internal-utils`, `@wats/config`, `@wats/service`, and `@wats/cli`.

### Included historical milestone coverage

This alpha launch consolidates the implemented WATS/F milestone surface into the 0.2.1 train. Representative surfaces include WATS-51 config/env templates at `examples/config/wats.config.example.yaml`, `examples/config/wats.config.example.json`, and `.env.example`; WATS-53 graph endpoint subpaths `@wats/graph/endpoints/messages`, `@wats/graph/endpoints/media`, `@wats/graph/endpoints/templates`, `@wats/graph/endpoints/flows`, `@wats/graph/endpoints/calling`, and `@wats/graph/endpoints/business-management`; WATS-55 reference status metadata; public policy files; scoped clients; typed updates; filters; router/facade; listeners; webhook adapters; pagination; and media runtime helpers.

Historical foundations covered by this launch include [0.2.0-f7] `PhoneNumberClient` / `WABAClient`, [0.2.0-f8] `normalizeWebhookEnvelope`, [0.2.0-f9] `TypedFilter`, `createTypedFilter`, `FilterValidationError`, and `@wats/core/filtersTyped`, [0.2.0-f10] `TypedRouter`, `WhatsApp`, `DispatchReport`, `RegistrationHandle`, and observer seams, [0.2.0-f11] `ListenerRegistry`, `ListenerHandle`, `ListenerTimeoutError`, `ListenerAbortError`, first-match-wins listener behavior, `onListenerMatch`, timeout handling, and `AbortSignal` support, [0.2.0-f12] `createWebhookAdapter`, `createFetchWebhookHandler`, `createBunWebhookServer`, and `createNodeWebhookHandler`, edge-runtime adapters, and [0.2.0-f13] `paginate`, `PaginationError`, `maxPages`, and WATS-37 media runtime helpers including `MediaValidationError`, `MediaCryptoError`, `MediaIntegrityError`, `uploadMedia`, `downloadMediaBytes`, `decryptEncryptedMedia`, and `createUploadSession`.

### WATS-55 — Reference status taxonomy refresh

WATS-55 separate credential-free implementation status from live validation status. Boundary: docs-lock/status metadata only; no runtime Graph behavior, no live Meta calls, and no package export changes.

Boundaries preserved in this launch: no persistence package export, no persistence adapters, no config schema changes for persistence, no root Dockerfile/Compose, no live Meta calls, no package publication during dry-runs, and no new public package exports beyond the documented package set.

### Release and safety boundaries

- This is an alpha launch release, not a 1.0 stability claim.
- test account credentials are not required for this release, default install, local tests, CI, docs generation, package build, or package-manager smoke checks.
- No live Meta calls are part of the release checks.
- No WhatsApp access tokens, app secrets, WABA IDs, phone-number IDs, or webhook payloads are committed.
- Live Meta validation remains gated behind future WATS-80/WATS-81 work and explicit credentials.
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
