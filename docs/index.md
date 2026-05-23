# WATS documentation

- status: public-docs-site
- applies-to: WATS-36A
- lastReviewed: 2026-05-01

WATS is a runtime-neutral TypeScript toolkit for the WhatsApp Cloud API. The docs site is generated locally and is credential-free: it does not call Meta Graph APIs, resolve environment secrets, or publish packages.

WATS-105 positioning lock:

- What WATS is: a runtime-neutral TypeScript toolkit for the WhatsApp Cloud API, with strict typed updates, an injectable Graph transport, and MockTransport-first tests.
- Who it is for: Bun, Node, and edge teams that want strict types, credential-free defaults, and async-only ergonomics.
- vs pywa: a runtime-neutral webhook adapter with Transport+Crypto seams, typed discriminated-union updates, MockTransport-first testing, and async-only public APIs. WATS is not a drop-in pywa port, and live Meta validation is still credential-gated.

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

The public site focuses on user-facing guides, reference material, package contracts, and release boundaries.
