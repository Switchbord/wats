# WATS documentation

- status: public-docs-site
- applies-to: WATS-36A
- lastReviewed: 2026-05-01

WATS is a Bun-first TypeScript implementation of pywa-style WhatsApp Cloud API primitives. The docs site is generated locally and is credential-free: it does not call Meta Graph APIs, resolve environment secrets, or publish packages.

## Start here

- [Getting Started](./getting-started.md) — local MockTransport walkthrough.
- [Reference Index](./reference/index.md) — public package and runtime primitives.
- [pywa to WATS migration](./migration/pywa-to-wats.md) — migration map and known gaps.
- [pywa parity matrix](./parity/pywa-parity-matrix.md) — capability status and live-validation state.
- [OpenAPI UI](./reference/openapi-ui.md) — static Scalar page backed by the WATS service OpenAPI JSON.

## Local docs commands

```sh
bun run docs:check
bun run docs:build
bun run docs:dev
```

The public site intentionally excludes internal handoff/context-compression notes and private workspace-only package docs.
