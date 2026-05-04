# Getting Started

- status: scaffold
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-20

## Audience

Engineers onboarding to WATS development.

## Prerequisites

- Bun 1.3+
- Familiarity with TypeScript async patterns

## Quickstart Steps

1. Install dependencies with `bun install`.
2. Run `bun test` to validate local setup.
3. Explore `packages/*` and architecture docs.

## First Integration Path

Minimal Graph client setup (B2):

```ts
import { GraphClient } from "@wats/graph";

const graphClient = new GraphClient({
  baseUrl: "https://graph.facebook.com",
  apiVersion: "v20.0",
  accessToken: process.env.WHATSAPP_GRAPH_TOKEN as string
});

await graphClient.messages.sendMessage({
  phoneNumberId: "<phone_number_id>",
  to: "15551230000",
  text: "hello from WATS"
});
```

Notes:
- keep `accessToken` in environment variables or a secrets manager
- `baseUrl` and `apiVersion` stay configurable for testing and migration windows

## Troubleshooting

TODO(A2): Add common setup and runtime failure resolutions.

## Next Reading

- `docs/reference/client.md`
- `docs/architecture/decisions/ADR-001-api-shape.md`
