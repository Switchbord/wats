# WATS

[![CI](https://github.com/Switchbord/wats/actions/workflows/ci.yml/badge.svg)](https://github.com/Switchbord/wats/actions/workflows/ci.yml)

WATS is a TypeScript toolkit for WhatsApp operations: a small set of composable packages for Graph calls, webhook ingestion, typed routing, listeners, filters, service routes, CLI operator checks, and testable runtime adapters.

It is intentionally not a single framework. The repository is a toolkit first; the CLI and standalone service sit on top of these packages rather than replace them.

## Status

Current release: `0.3.23-alpha-compatibility`.

WATS is alpha software. The foundations are in place and tested: Graph transport, endpoint definitions, error taxonomy, webhook verification, runtime-neutral webhook adapters, typed update normalization, filters, routers, listeners, and the `WhatsApp` facade.

Endpoint breadth is still expanding. Today WATS ships text message send, `WhatsApp.startChat(...)` / `PhoneNumberClient.sendText(...)` for arbitrary-recipient text starts, WABA phone-number listing, pagination, WATS-37 media runtime (single-POST upload, metadata resolution, binary download, delete, encrypted decrypt, and upload sessions), WATS-39 templates, WATS-40 flows, WATS-41 calling, WATS-42A read-only business-management inventory (`getWabaInfo`, subscribed-app listing, phone-number info/settings, business profile, and commerce settings), and service `POST {apiPrefix}/messages` routes for text, media, location, contacts, reaction, remove-reaction, and interactive message bodies.

The 0.3.23 line is an alpha compatibility and local-operator patch release. It keeps the safe local setup/live-serve flow, the experimental `@wats/persistence` SQLite package foundation, optional service idempotency injection, CLI package version/upgrade checks, the container deployment recipe (`deploy/railway/`, see `deploy/railway/README.md`), and the opt-in `wats serve --paas` native PaaS mode, then begins the WhatsApp Groups API (a WATS addition with no pywa equivalent): the WATS-131 group type foundation at `@wats/types/groups` and the WATS-132 Graph endpoint family at `@wats/graph/endpoints/groups`, the WATS-133 scoped `GroupClient` plus `PhoneNumberClient.createGroup`/`listGroups`/`group(id)` ergonomics, and the WATS-134 send-to-group message path (`recipientType: "group"`) with pin/unpin (`buildSendPinPayload`), and the WATS-135 webhook normalization that emits typed group updates (`group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update`) plus inbound `message.groupId`, and the WATS-136 `filtersTyped.group` filters and `WhatsApp` facade ergonomics (`createGroup`, `sendGroupMessage`, `group(groupId)`, `listen({ groupId })`), and the WATS-137 opt-in `@wats/service` group routes (`enableGroupRoutes`, default off) with matching OpenAPI, and the WATS-138 reference/quickstart docs plus a runnable credential-free `examples/groups` walkthrough, for creating, listing, updating, deleting, invite-link, participant, join-request, and messaging of business-owned WhatsApp groups. `wats setup` writes a safe `wats.config.yaml` with env-secret references plus an ignored `.env.local` for local secrets without making Meta calls. Live serve requires explicit `--live --yes-live --env-file .env.local`; WATS does not read `.env.local` implicitly. Published Docker registry images, background outbox workers, production hosting, token validation against Meta, and multi-profile credential editing are not included.

## Shape

```
packages/
  types           shared WhatsApp domain types
  crypto          portable crypto provider seam
  graph           Graph client, transport, endpoints, errors, pagination
  core            typed updates, filters, router, listeners, WhatsApp facade
  http            webhook verification and Bun/Node/Fetch adapters
  config          YAML/JSON config validation and env-secret refs
  cli             safe local operator tooling
  service         runtime-neutral webhook/API service foundation
  internal-utils  published internal support package for shared runtime helpers
  testing         private fixtures and workspace policy tests

docs/
  architecture/   package map, architecture docs, release policy
  reference/      public API references
  guides/         task-oriented guides
  parity/         pywa / WhatsApp coverage tracking
  migration/      pywa-to-WATS notes
```

The dependency direction is deliberate: low-level packages stay portable; `@wats/core` composes them; `@wats/config`, `@wats/cli`, and `@wats/service` form the first application-edge packages.

## Install

The public packages are standard npm registry packages and Bun can install them directly:

```bash
bun add @wats/cli
bunx --bun @wats/cli --help
bunx --bun @wats/cli --version

bun add @wats/core @wats/graph @wats/http
bun add @wats/config @wats/service
```

test account credentials are not needed for default install or CI. Live Meta validation remains a separate credential-gated campaign.

## Privacy and telemetry

WATS sends no telemetry to maintainer-owned endpoints by default. The CLI does not phone home; credential-free commands and dry-run examples stay local unless you explicitly configure Graph/API calls. `wats upgrade` is credential-free but intentionally asks Bun to contact npm for public `@wats/*` package updates. See `docs/privacy.md` for the privacy and redaction stance.

## Quickstart with CLI

For one-off commands in a fresh project, use the package specifier so Bun resolves the scoped CLI package instead of the unrelated unscoped `wats` package:

```bash
bunx --bun @wats/cli setup
```

Or add the CLI dependency first, then keep using the scoped package specifier for one-off commands:

```bash
bun add @wats/cli
bunx --bun @wats/cli setup
```

`wats setup` prompts for your Meta access token, app secret, WABA ID, and phone number ID, then writes `wats.config.yaml` (env-secret references, safe to commit) and `.env.local` (your actual secrets, gitignored). Verify token and service token are generated for you if left blank — or generate one explicitly first:

```bash
bunx --bun @wats/cli webhook token
```

Verify local readiness after setup:

```bash
bunx --bun @wats/cli doctor --config wats.config.yaml --check-env
```

Check and update your installed WATS packages from a Bun project:

```bash
bunx --bun @wats/cli --version
bunx --bun @wats/cli upgrade --dry-run
bunx --bun @wats/cli upgrade
```

For a local live webhook smoke, expose the local service with a secure HTTPS tunnel. Meta will not verify plain HTTP or a bare local IP callback:

```bash
ngrok http 8787
bunx --bun @wats/cli onboarding --public-url https://<your-tunnel-host> --webhook-path /webhooks/whatsapp
WATS_LIVE_ENABLE=1 WATS_YES_LIVE=1 \
  bunx --bun @wats/cli serve --config wats.config.yaml --live --yes-live --env-file .env.local
```

See `docs/reference/cli.md` for all commands and `docs/parity/live-testing-campaign.md` for the full credentialed live-testing runbook.

## Local development

```bash
bun install
bun test
```

Useful references:

- `docs/getting-started.md` — end-to-end foundations walkthrough
- `docs/reference/index.md` — reference map
- `docs/reference/cli.md` — safe local operator tooling reference
- `docs/privacy.md` — telemetry, privacy, and redaction stance
- `docs/api-stability.md` — stable, experimental, and internal API policy
- `docs/parity/pywa-parity-matrix.md` — implemented vs deferred coverage
- `docs/architecture/package-map.md` — package boundaries
- `docs/architecture/release-policy.md` — version and release rules
- `docs/architecture/roadmap-to-whatsapp-pywa-parity.md` — high-level milestone roadmap; issue-level work lives in Linear
- `CONTRIBUTING.md` — contribution workflow, docs/tests expectations, and credential-free defaults
- `SECURITY.md` — vulnerability reporting and live-credential safety policy

## Roadmap

The next milestone is a publishable WhatsApp/pywa parity line. See `docs/architecture/roadmap-to-whatsapp-pywa-parity.md` for the maintained roadmap summary and `docs/parity/pywa-parity-matrix.md` for capability status. Issue-level status and deferrals live in Linear, not in deferred-work files inside the repo.

## Design principles

- camelCase-only public API
- async-only public API
- portable by default: Bun, Node, Workers, and Deno where practical
- no secrets in config files generated by default; use environment references
- docs move with code
- tests prove package-specifier consumption, not only in-repo imports
- endpoint breadth grows on stable Graph, webhook, and routing foundations
