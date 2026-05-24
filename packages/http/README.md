# @wats/http

Runtime-neutral webhook verification and adapter helpers for WATS: signature validation, challenge verification, Fetch/Bun/Node adapters, and WebhookAdapter composition.

## Install

```bash
bun add @wats/http
npm i @wats/http
```

## Usage

```ts
import { createFetchWebhookHandler, createWebhookAdapter } from "@wats/http";

const adapter = createWebhookAdapter({
  verifyToken: process.env.WATS_VERIFY_TOKEN ?? "",
  appSecret: process.env.WATS_APP_SECRET ?? "",
  whatsapp: { dispatch: async () => undefined }
});

const handle = createFetchWebhookHandler(adapter);
const response = await handle(new Request("https://example.test/webhook"));
console.log(response.status);
```

Use this package when you want the webhook/security boundary without the standalone `@wats/service` app.

Docs: https://github.com/Switchbord/wats
License: MIT
