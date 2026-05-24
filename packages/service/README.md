# @wats/service

Runtime-neutral WATS service app and OpenAPI generator for webhook ingress, health/readiness, and authenticated local API routes.

## Install

```bash
bun add @wats/service
npm i @wats/service
```

## Usage

```ts
import { createWatsServiceOpenApiDocument } from "@wats/service";

const doc = createWatsServiceOpenApiDocument({
  graph: { apiVersion: "v25.0", baseUrl: "https://graph.facebook.com" },
  whatsapp: { wabaId: "123", phoneNumberId: "456" },
  auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
  webhook: { path: "/webhooks/whatsapp", verifyToken: { env: "WATS_VERIFY_TOKEN" }, appSecret: { env: "WATS_APP_SECRET" }, maxBodyBytes: 1048576 },
  service: { host: "127.0.0.1", port: 8787, apiPrefix: "/api", bearerToken: { env: "WATS_SERVICE_TOKEN" } }
});

console.log(doc.openapi);
```

For a runnable local process, use `@wats/cli` with `wats serve --dry-run`.

Docs: https://github.com/Switchbord/wats
License: MIT
