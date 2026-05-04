# Service Reference (`@wats/service`)

- status: experimental
- applies-to: WATS-34/WATS-35
- lastReviewed: 2026-04-28

## Purpose

`@wats/service` is the first standalone WATS application boundary. It exposes a runtime-neutral `Request -> Response` app that composes the existing Graph client, webhook adapter, config profile shape, and WhatsApp facade.

It is not a production server by itself. Bun/Node/Docker wrappers, persistence, metrics, and public docs UI remain separate roadmap items. WATS-35 adds a generated OpenAPI 3.1 document for the routes listed below.

## Public API

```ts
import {
  createWatsServiceApp,
  createWatsServiceOpenApiDocument,
  WatsServiceError,
  type WatsServiceApp,
  type WatsServiceConfig,
  type WatsServiceOpenApiOptions
} from "@wats/service";
```

### `createWatsServiceApp(config)`

Creates a `WatsServiceApp`:

```ts
interface WatsServiceApp {
  fetch(request: Request): Promise<Response>;
}
```

Config:

```ts
interface WatsServiceConfig {
  profile: WatsProfileConfig;       // already validated by @wats/config
  secrets: {
    accessToken: string;
    webhookVerifyToken: string;
    webhookAppSecret: string;
    serviceBearerToken: string;
  };
  transport?: Transport;
  cryptoProvider?: CryptoProvider;
  whatsapp?: { dispatch(update: unknown): unknown | Promise<unknown> };
}
```

The service package does not read environment variables. Callers resolve env refs from `@wats/config` outside the service and pass explicit secret values in memory.

## Routes

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/healthz` | GET | none | Returns `{ ok: true, service: "wats" }`. |
| `/readyz` | GET | none | Returns `{ ok: true, service: "wats" }` after construction. |
| `/openapi.json` | GET | none | Returns the generated OpenAPI 3.1 document. |
| `profile.webhook.path` | GET | Meta verify token | Delegates to `createWebhookAdapter`. |
| `profile.webhook.path` | POST | Meta signature | Delegates to `createWebhookAdapter`. |
| `${profile.service.apiPrefix}/messages/text` | POST | service bearer | Sends a text message through Graph. |
| `${profile.service.apiPrefix}/messages` | POST | service bearer | Passes through a supported text message body. |

Unknown routes return `404`. Unsupported methods return `405` with an `Allow` header.

## OpenAPI document

`createWatsServiceOpenApiDocument(profile, options?)` returns a plain-object OpenAPI 3.1 document for the current service routes. `createWatsServiceApp(config)` serves the same document at `GET /openapi.json` with JSON content type and no service bearer requirement. Method mismatch returns `405` with `Allow: GET`.

The document includes `serviceBearerAuth` only on the protected message routes and never embeds raw service bearer, Graph access, app secret, verify token, or config env-var secret reference values. See `docs/reference/openapi.md` for option validation, schemas, body matrix, and non-goals.

## Service bearer auth

Message API routes require:

```http
Authorization: Bearer <service-token>
```

Missing, malformed, or wrong credentials return `401` and do not echo the configured token.

The service bearer token is never forwarded to Graph. Graph requests use `secrets.accessToken` through `GraphClient`.

## Message routes

### `POST /messages/text`

Body:

```json
{
  "to": "15551230000",
  "text": "hello",
  "previewUrl": true
}
```

Validation:

- root body must be a JSON object
- `to` and `text` must be non-empty strings without control characters
- `previewUrl`, when present, must be boolean

The service builds the WhatsApp text payload and uses the configured phone number id.

### `POST /messages`

WATS-34 supports a generic text body only:

```json
{
  "messaging_product": "whatsapp",
  "to": "15551230000",
  "type": "text",
  "text": { "body": "hello" }
}
```

Other message types are available through the library-level WATS-38 composer helpers, but standalone service routes still expose only the current text-message bodies until a later service-route expansion.

## Webhook route

The configured webhook path delegates to `@wats/http`:

- GET challenge verification uses `secrets.webhookVerifyToken`
- POST signature verification uses `secrets.webhookAppSecret`
- normalized updates dispatch through the supplied `whatsapp` facade-like object or a default `WhatsApp` facade created from the service config

## Error taxonomy

Construction errors throw `WatsServiceError` with codes:

- `invalid_config`
- `invalid_profile`
- `invalid_secrets`
- `invalid_secret`
- `invalid_path`
- `invalid_transport`
- `invalid_crypto_provider`
- `invalid_whatsapp`

HTTP errors use JSON bodies:

```json
{ "error": { "code": "unauthorized", "message": "Missing or invalid bearer token." } }
```

Common HTTP error codes:

- `400` malformed request/body
- `401` missing or invalid service bearer token
- `404` route not found
- `405` method not allowed
- `502` Graph request failure

## WATS-48 persistence design target

WATS-48 documents a future injected PersistenceStore for service runtimes. There is no persistence integration in current @wats/service runtime.

Future service integration should accept an injected PersistenceStore instead of reading database environment variables directly. The service must not log secrets or raw webhook bodies through persistence diagnostics, and persistence failures must not expose database URLs, access tokens, app secrets, webhook verify tokens, service bearer tokens, message text, or raw webhook envelopes.

## WATS-49 Docker/deployment design target

WATS-49 documents the future container deployment contract. There is no supported Dockerfile/Compose/container image yet, and current @wats/service has no process wrapper/Docker integration.

Future containers should wrap `wats serve` rather than duplicating service routing. WATS-49 does not add image publication, registry credentials, live Meta startup checks, or release automation. In docs-lock wording: no image publication and no registry credentials.

## Non-goals

WATS-35/WATS-48/WATS-49 do not implement:

- a full Meta Graph API OpenAPI document
- `wats serve` process execution (`wats openapi` already exports the service OpenAPI document)
- live Meta credential checks
- persistence integration, queues, metrics, Docker, TLS, or rate limiting
- non-text message runtime coverage or schemas beyond the current text body

## Related

- Linear: WATS-34, WATS-35
- `docs/reference/openapi.md`
- `docs/reference/config.md`
- `docs/reference/webhook-adapter.md`
- `docs/architecture/cli-service-openapi-options.md`
