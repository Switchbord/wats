# Service Reference (`@switchbord/service`)

- status: experimental
- applies-to: WATS-34/WATS-35/WATS-73
- lastReviewed: 2026-05-06

## Purpose

`@switchbord/service` is the first standalone WATS application boundary. It exposes a runtime-neutral `Request -> Response` app that composes the existing Graph client, webhook adapter, config profile shape, and WhatsApp facade.

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
} from "@switchbord/service";
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
  profile: WatsProfileConfig;       // already validated by @switchbord/config
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

The service package does not read environment variables. Callers resolve env refs from `@switchbord/config` outside the service and pass explicit secret values in memory.

## Routes

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/healthz` | GET | none | Returns `{ ok: true, service: "wats" }`. |
| `/readyz` | GET | none | Returns `{ ok: true, service: "wats" }` after construction. |
| `/openapi.json` | GET | none | Returns the generated OpenAPI 3.1 document. |
| `profile.webhook.path` | GET | Meta verify token | Delegates to `createWebhookAdapter`. |
| `profile.webhook.path` | POST | Meta signature | Delegates to `createWebhookAdapter`. |
| `${profile.service.apiPrefix}/messages/text` | POST | service bearer | Sends a text message through Graph. |
| `${profile.service.apiPrefix}/messages` | POST | service bearer | Sends a supported generic text, media, location, reaction, or contacts message body through Graph. |

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

`POST /messages` accepts either the existing generic Graph-native text body:

```json
{
  "messaging_product": "whatsapp",
  "to": "15551230000",
  "type": "text",
  "text": { "body": "hello" }
}
```

or WATS-73 media composer bodies that are converted through the SDK media builders before the Graph request is sent:

```json
{
  "type": "image",
  "to": "15551230000",
  "mediaId": "1234567890",
  "caption": "hello",
  "replyToMessageId": "wamid.PARENT"
}
```

Supported media `type` values are `image`, `video`, `audio`, `document`, and `sticker`. Each media body must provide exactly one of `mediaId` or `link`. `caption` is accepted for image, video, and document bodies. `filename` is accepted for document bodies only. `replyToMessageId` maps to Graph `context.message_id`.

Location bodies use `type: "location"`, finite `latitude`/`longitude` values in Graph-supported ranges, and optional `name`, `address`, and `replyToMessageId`. Reaction bodies use `type: "reaction"` with `messageId` and non-empty `emoji`. Remove-reaction bodies use `type: "removeReaction"` with `messageId` and map to Graph reaction payloads with an empty emoji. Contacts bodies use `type: "contacts"`, a non-empty `contacts` array, and the same camelCase contact input objects as the SDK composer helper.

The route preserves the service bearer boundary: the service bearer token authorizes the local service route, is never forwarded to Graph, and builder/validation failures return `400` without echoing tokens or request secrets. Interactive message families remain follow-up WATS-73 slices.

## Webhook route

The configured webhook path delegates to `@switchbord/http`:

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

WATS-48 documents a future injected PersistenceStore for service runtimes. There is no persistence integration in current @switchbord/service runtime.

Future service integration should accept an injected PersistenceStore instead of reading database environment variables directly. The service must not log secrets or raw webhook bodies through persistence diagnostics, and persistence failures must not expose database URLs, access tokens, app secrets, webhook verify tokens, service bearer tokens, message text, or raw webhook envelopes.

## WATS-49 Docker/deployment design target

WATS-49 documents the future container deployment contract. There is no supported Dockerfile/Compose/container image yet, and current @switchbord/service has no process wrapper/Docker integration.

Future containers should wrap `wats serve` rather than duplicating service routing. WATS-49 does not add image publication, registry credentials, live Meta startup checks, or release automation. In docs-lock wording: no image publication and no registry credentials.

## Non-goals

WATS-35/WATS-48/WATS-49 do not implement:

- a full Meta Graph API OpenAPI document
- `wats serve` process execution (`wats openapi` already exports the service OpenAPI document)
- live Meta credential checks
- persistence integration, queues, metrics, Docker, TLS, or rate limiting
- interactive service message schemas beyond the current WATS-73 media/location/reaction/contacts slices

## Related

- Linear: WATS-34, WATS-35
- `docs/reference/openapi.md`
- `docs/reference/config.md`
- `docs/reference/webhook-adapter.md`
- `docs/architecture/cli-service-openapi-options.md`
