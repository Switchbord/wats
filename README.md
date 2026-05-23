# WATS

WATS is a TypeScript toolkit for WhatsApp operations: a small set of composable packages for Graph calls, webhook ingestion, typed routing, listeners, filters, service routes, CLI operator checks, and testable runtime adapters.

It is intentionally not a single framework. The repository is a toolkit first; the CLI and standalone service sit on top of these packages rather than replace them.

## Positioning

- What WATS is: a runtime-neutral TypeScript toolkit for the WhatsApp Cloud API, with strict typed updates, an injectable Graph transport, and MockTransport-first tests.
- Who it is for: Bun, Node, and edge teams that want strict types, credential-free defaults, and async-only ergonomics without picking up a heavyweight HTTP stack.
- vs pywa: WATS is a runtime-neutral webhook adapter with Transport+Crypto seams, typed discriminated-union updates, MockTransport-first testing, and async-only public APIs. It is not a drop-in pywa port, and live Meta validation against a real WABA is still credential-gated and out of scope of the default repo checks.

## When NOT to use WATS

- You are a happy pywa user on Python — keep using pywa; WATS is not a Python port and does not aim to be one.
- You require Meta-validated production behavior today — WATS has no live Meta validation campaign result yet; live-credentialed checks remain explicitly credential-gated.
- You need long-term API stability — WATS is alpha; the public API surface may still move before the first non-alpha minor.

## Status

Current release: `0.3.2-alpha-tooling`.

WATS is alpha software. The foundations are in place and tested: Graph transport, endpoint definitions, error taxonomy, webhook verification, runtime-neutral webhook adapters, typed update normalization, filters, routers, listeners, and the `WhatsApp` facade.

Endpoint breadth is still expanding. Today WATS ships text message send, `WhatsApp.startChat(...)` / `PhoneNumberClient.sendText(...)` for arbitrary-recipient text starts, WABA phone-number listing, pagination, WATS-37 media runtime (single-POST upload, metadata resolution, binary download, delete, encrypted decrypt, and upload sessions), WATS-39 templates, WATS-40 flows, WATS-41 calling, WATS-42A read-only business-management inventory (`getWabaInfo`, subscribed-app listing, phone-number info/settings, business profile, and commerce settings), and service `POST {apiPrefix}/messages` routes for text, media, location, contacts, reaction, remove-reaction, and interactive message bodies.

The 0.3.2 line is an alpha tooling patch release. It adds the safe local `wats setup` wizard on top of the 0.3.0 operator tooling around `wats init`, `wats onboarding`, `wats doctor`, and dry-run `wats serve`. `wats setup` writes a safe `wats.config.yaml` with env-secret references plus an ignored `.env.local` for local secrets without making Meta calls. live serve mode, env-file secret resolution, Docker image publication, persistence/outbox, and live Meta validation are not included. Token validation against Meta and multi-profile credential editing are also not included.

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
bunx --bun wats --help

bun add @wats/core @wats/graph @wats/http
bun add @wats/config @wats/service
```

test account credentials are not needed for default install or CI. Live Meta validation remains a separate credential-gated campaign.

## Local development

```bash
bun install
bun test
```

Useful references:

- `docs/getting-started.md` — end-to-end foundations walkthrough
- `docs/reference/index.md` — reference map
- `docs/reference/cli.md` — safe local operator tooling reference
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
