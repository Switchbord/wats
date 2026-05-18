# WATS examples

- status: WATS-52 community examples scaffold
- safety default: offline by default

This directory contains credential-free community examples for WATS. The WATS-52 alpha launch scaffold is intentionally small: examples should teach public `@wats/*` package usage while avoiding live credentials and live Meta calls.

## Safety rules

- All examples are offline by default.
- Use MockTransport for Graph-facing calls.
- Use synthetic webhook payloads/envelopes for webhook and router examples.
- Keep real access tokens, bearer tokens, webhook values, app values, WABA ids, phone-number ids, service values, and database URLs out of this repository.
- Treat tunnel exercises as credential-gated webhook tunnel guidance; they are checklists for operators, not default tests.
- Do not claim WhatsApp `delivered` or `read` from send success. Those states require observed webhook/event-store evidence.
- Example code must import WATS packages through public `@wats/*` specifiers, never by relative paths into `packages/*/src`.

## Available examples

- `examples/config/wats.config.example.yaml` — WATS-51 placeholder YAML config template.
- `examples/config/wats.config.example.json` — WATS-51 placeholder JSON config template.
- `.env.example` — placeholder env-name index for local ignored copies.
- `examples/offline-bot/README.md` — offline MockTransport bot walkthrough with synthetic webhook payloads/envelopes.

## How to run local checks

Docs/examples checks are credential-free:

```sh
bun test packages/testing/tests/wats52-community-examples.test.ts
bun run docs:check
```

The community examples guide is published at `docs/guides/community-examples.md`. It covers the MockTransport quickstart, service app `fetch` / OpenAPI patterns, credential-gated webhook tunnel guidance, and extensibility seams.

## Runtime boundary

This examples scaffold predates the current CLI runtime. WATS now implements real `wats init`, offline `wats doctor` diagnostics, and dry-run `wats serve` for local service smoke checks. The examples scaffold still does not implement Docker images, Compose files, release automation, credential-gated live serve mode, or live Meta validation. Service examples may call the public Request-to-Response app directly with synthetic inputs or use `wats serve --dry-run` for local route smoke checks.
