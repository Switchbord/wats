# WATS Public Alpha Announce Draft

- status: draft
- applies-to: WATS-117
- publicDocs: excluded from public docs site by `docs/public-docs-manifest.json` `maintainers/**`
- lastReviewed: 2026-05-24

## Short version

WATS public alpha is a TypeScript/Bun toolkit for WhatsApp Cloud API development. It gives you composable `@wats/*` packages for Graph calls, webhook ingestion, typed routing, filters, listeners, a standalone service foundation, CLI operator checks, and credential-free test adapters.

Install the CLI:

```bash
bunx --bun @wats/cli --help
```

Run the offline minimal example:

```bash
bun run examples:minimal-bot
```

No live Meta credentials are required for install, docs, default tests, or the minimal example.

## What is included

- `@wats/cli` safe local setup, config validation, doctor, OpenAPI export, onboarding checklist, and dry-run service checks.
- `@wats/graph` Graph client, MockTransport, endpoint helpers, errors, pagination, media/template/Flow/calling/admin compatibility surfaces.
- `@wats/core` typed webhook normalization, filters, router, listeners, and `WhatsApp` facade.
- `@wats/http` webhook verification and runtime-neutral adapters.
- `@wats/service` standalone Request-to-Response service foundation.
- `examples/minimal-bot` for a 60-second offline onramp.
- No maintainer-owned telemetry by default.

## When NOT to use WATS

- Do not treat WATS as a 1.0-stable production framework yet.
- Do not use WATS to bypass Meta policy, template approval, opt-in, commerce, calling, or messaging limits.
- Do not expect default CI to run live Meta validation; live checks require explicit credentials and approval.
- Do not expect WATS to host your bot for you. It is a toolkit and runtime package set, not a hosted platform.
- Do not infer delivered/read states from send success; use observed webhook/event-store evidence.

## Safety stance

WATS sends no telemetry to maintainer-owned endpoints by default. The CLI does not phone home. Credential-free commands, package tests, docs checks, dry-run service examples, and `examples/minimal-bot` stay local unless you explicitly configure Graph/API calls.

Keep access tokens, app secrets, verify tokens, service bearer tokens, WABA IDs, phone IDs, webhook bodies, and customer/user content out of public issues and logs.

## Feedback

Please open GitHub issues for install problems, documentation drift, type errors, or credential-free runtime bugs. Use a private security channel for suspected vulnerabilities or leaked credentials.

## Draft thread outline

1. WATS public alpha is live for TypeScript/Bun WhatsApp Cloud API development.
2. Install with `bunx --bun @wats/cli --help` or add the scoped `@wats/*` packages.
3. Try `bun run examples:minimal-bot` for a no-credentials local demo.
4. The project is a toolkit: Graph, HTTP, core routing, service, CLI, config, and testing packages.
5. Safety: no maintainer-owned telemetry by default; no live Meta calls in default tests.
6. When NOT to use WATS: not 1.0-stable, not hosted, not a Meta policy bypass, not default live validation.
7. Feedback welcome through GitHub issues/discussions; security through private advisories.
