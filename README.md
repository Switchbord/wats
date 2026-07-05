# WATS

[![CI](https://github.com/Switchbord/wats/actions/workflows/ci.yml/badge.svg)](https://github.com/Switchbord/wats/actions/workflows/ci.yml)

WATS is a TypeScript toolkit for the WhatsApp Cloud API: typed Graph calls,
webhook ingestion, routing, and a standalone service. Bun-first, runs on Node,
Workers, and Deno where practical.

I built it because I wanted pywa's ergonomics in TypeScript and a reason to
learn Bun properly. If that overlaps with what you need, the docs and an
in-browser playground are at **[wats.sh](https://wats.sh)**.

```ts
import { GraphClient, GraphRateLimitError, PhoneNumberClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";

const mock = createMockTransport();
const graphClient = new GraphClient({
  accessToken: "demo-token",
  apiVersion: "v25.0",
  baseUrl: "https://graph.facebook.com",
  transport: mock.transport,
});
const phone = new PhoneNumberClient({ graphClient, phoneNumberId: "1234567890" });

try {
  await phone.sendText({ to: "15550001111", text: "hello from WATS" });
} catch (err) {
  if (err instanceof GraphRateLimitError) console.log(err.retryAfter);
}

console.log(JSON.stringify(mock.requests, null, 2));
```

Every client runs against a Transport seam. Swap in `createMockTransport` and
the toolkit captures the exact Graph request — method, path, payload — with no
network. That is how the test suite, the playground, and a credential-free
local workflow all work.

## Install

```bash
bun add @wats/core @wats/graph @wats/http
bun add @wats/config @wats/service
```

The `@wats/*` packages are standard npm packages; `npm i` works too. No
credentials are needed to install, test, or develop against the mock transport.

## CLI

```bash
bunx --bun @wats/cli setup     # writes wats.config.yaml + gitignored .env.local
bunx --bun @wats/cli doctor    # check local readiness
bunx --bun @wats/cli --help
```

Use the scoped specifier (`@wats/cli`) so Bun resolves the WATS package rather
than the unrelated unscoped `wats` package. `setup` writes env-secret
references, never secrets, into the committed config. Live serving requires
explicit `--live --yes-live --env-file .env.local` — WATS never reads secrets
implicitly. Full command reference: [wats.sh/docs/reference/cli](https://wats.sh/docs/reference/cli).

## Status

Alpha. The core paths — text and template sends, media, webhook verification
and normalization, routing, typed errors — are tested and have carried real
traffic. The wider endpoint surface is typed and tested against the wire
contract; per-endpoint status is tracked at
[wats.sh/docs/parity](https://wats.sh/docs/parity). The 0.x line still makes
breaking changes.

## Packages

| package | what it is |
| --- | --- |
| `@wats/types` | shared WhatsApp domain types |
| `@wats/crypto` | portable crypto provider seam |
| `@wats/graph` | Graph client, transport, endpoints, errors, pagination |
| `@wats/core` | typed updates, filters, router, listeners, `WhatsApp` facade |
| `@wats/http` | webhook verification and Bun/Node/Fetch adapters |
| `@wats/config` | YAML/JSON config validation and env-secret references |
| `@wats/cli` | local operator tooling |
| `@wats/service` | runtime-neutral webhook/API service foundation |
| `@wats/persistence` | experimental persistence contracts + SQLite adapter |
| `@wats/internal-utils` | published internal support package |

Dependency direction is deliberate: low-level packages stay portable,
`@wats/core` composes them, and the application-edge packages compose `core`.
See the generated dependency graph at
[wats.sh/docs/concepts/package-map](https://wats.sh/docs/concepts/package-map).

## Local development

```bash
bun install
bun test
```

Documentation is authored in `site/content/docs` and published to wats.sh.
Docs change in the same PR as the code they describe.

## Design principles

- camelCase-only public API
- async-only public API
- portable by default: Bun, Node, Workers, Deno where practical
- no secrets in generated config files; use environment references
- docs move with code
- tests prove package-specifier consumption, not only in-repo imports

## Links

- Site, docs, playground: [wats.sh](https://wats.sh)
- Endpoint status: [wats.sh/docs/parity](https://wats.sh/docs/parity)
- Privacy & telemetry stance: [wats.sh/docs/meta/privacy](https://wats.sh/docs/meta/privacy)
- npm: [@wats](https://www.npmjs.com/org/wats)
- `CONTRIBUTING.md` — contribution workflow and credential-free defaults
- `SECURITY.md` — vulnerability reporting and live-credential policy
- `SUPPORT.md` — where to ask questions and what makes a good report
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 for community spaces

MIT.
