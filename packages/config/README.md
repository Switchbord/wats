# @wats/config

YAML/JSON WATS configuration parser, validator, redactor, and env-secret reference types for CLI and service onboarding.

## Install

```bash
bun add @wats/config
npm i @wats/config
```

## Usage

```ts
import { parseConfig, redactConfig } from "@wats/config";

const config = parseConfig(`
version: 1
defaultProfile: local
profiles:
  local:
    graph: { apiVersion: v25.0, baseUrl: https://graph.facebook.com }
    whatsapp: { wabaId: "123", phoneNumberId: "456" }
    auth: { accessToken: { env: WATS_ACCESS_TOKEN } }
    webhook: { path: /webhooks/whatsapp, verifyToken: { env: WATS_VERIFY_TOKEN }, appSecret: { env: WATS_APP_SECRET }, maxBodyBytes: 1048576 }
    service: { host: 127.0.0.1, port: 8787, apiPrefix: /api, bearerToken: { env: WATS_SERVICE_TOKEN } }
`, { format: "yaml" });

console.log(redactConfig(config));
```

The package validates shape and redacts references; it does not resolve `.env.local` or contact Meta Graph APIs.

Docs: https://github.com/Switchbord/wats
License: MIT
