# @wats/graph

Graph client, transport seam, endpoint callables, typed Graph errors, pagination helpers, MockTransport, and WhatsApp endpoint-family helpers.

## Install

```bash
bun add @wats/graph
npm i @wats/graph
```

## Usage

```ts
import { GraphClient, createFetchTransport, sendMessage } from "@wats/graph";

const graph = new GraphClient({
  accessToken: process.env.WATS_ACCESS_TOKEN ?? "",
  apiVersion: "v25.0",
  transport: createFetchTransport()
});

await sendMessage(graph, { phoneNumberId: "1234567890" }, {
  messaging_product: "whatsapp",
  to: "15551234567",
  type: "text",
  text: { body: "Hello from WATS" }
});
```

Use `createMockTransport` from `@wats/graph/testing` for credential-free tests and examples. Some endpoint families are still expanding and should be treated according to the API stability policy.

Docs: https://wats.sh/docs/reference/client
License: MIT
