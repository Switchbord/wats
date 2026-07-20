# WATS examples

- safety default: offline by default

Credential-free community examples for WATS. The scaffold is intentionally small: examples teach public `@wats/*` package usage while avoiding live credentials and live Meta calls.

## Safety rules

- All examples are offline by default.
- Use MockTransport for Graph-facing calls.
- Use synthetic webhook payloads/envelopes for webhook and router examples.
- Keep real access tokens, bearer tokens, webhook values, app values, WABA ids, phone-number ids, service values, and database URLs out of this repository.
- Treat tunnel exercises as credential-gated webhook tunnel guidance; they are checklists for operators, not default tests.
- Do not claim WhatsApp `delivered` or `read` from send success. Those states require observed webhook/event-store evidence.
- Example code must import WATS packages through public `@wats/*` specifiers, never by relative paths into `packages/*/src`.

## Available examples

- `examples/config/wats.config.example.yaml` — placeholder YAML config template.
- `examples/config/wats.config.example.json` — placeholder JSON config template.
- `.env.example` — placeholder env-name index for local ignored copies.
- `examples/offline-bot/README.md` — docs-only walkthrough of an offline MockTransport bot with synthetic webhook payloads/envelopes.
- `examples/minimal-bot/` — runnable 60-second offline minimal bot using `@wats/service`, MockTransport, and `bun run demo`.
- `examples/groups/` — runnable offline Groups flow using `@wats/graph`, `@wats/core`, MockTransport, and synthetic group webhooks (`bun run examples:groups`).
- `examples/webhook-echo-bot/` — runnable offline echo bot using the `createWhatsApp` / `onMessage` / `sendText` loop with a mock transport and a synthetic webhook envelope (`bun run examples:webhook-echo-bot`).

## Running an example outside this repo

Example `package.json` files pin `@wats/*` deps to `workspace:*` so they install inside this monorepo. Copying a directory out of the repo breaks `bun install` because `workspace:*` is not a published range. To run a copy elsewhere, swap the workspace pins for the published range:

```sh
sed -i 's/"@wats\/\([^"]*\)": "workspace:\*"/"@wats\/\1": "^0.3.30"/g' examples/webhook-echo-bot/package.json
```

Then `bun install` in the copied directory resolves from the npm registry. No other changes are needed.

## How to run local checks

Docs/examples checks are credential-free:

```sh
bun test packages/testing/tests/wats52-community-examples.test.ts
bun run examples:minimal-bot
bun run examples:groups
```

The community examples guide is published at [wats.sh/docs/guides/community-examples](https://wats.sh/docs/guides/community-examples). It covers the MockTransport quickstart, service app `fetch` / OpenAPI patterns, credential-gated webhook tunnel guidance, and extensibility seams.

## Runtime boundary

This examples scaffold predates the current CLI runtime. WATS now implements real `wats init`, offline `wats doctor` diagnostics, dry-run `wats serve`, and credential-gated local live `wats serve` for HTTPS-tunnel webhook/Graph smoke checks. The examples scaffold still does not implement Docker images, Compose files, release automation, production hosting, or a live Meta validation campaign. Service examples may call the public Request-to-Response app directly with synthetic inputs or use `wats serve --dry-run` for local route smoke checks.
