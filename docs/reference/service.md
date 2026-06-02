# Service Reference (`@wats/service`)

- status: experimental
- applies-to: WATS-34/WATS-35/WATS-73/WATS-87/WATS-121/WATS-137
- lastReviewed: 2026-06-02

## Purpose

`@wats/service` is the first standalone WATS application boundary. It exposes a runtime-neutral `Request -> Response` app that composes the existing Graph client, webhook adapter, config profile shape, and WhatsApp facade.

It is not a production server by itself. WATS-71 adds a CLI-owned Bun dry-run process wrapper around this app for local smoke checks. WATS-101 adds credential-gated live `wats serve` execution for local testing behind an HTTPS tunnel. WATS-121 adds optional caller-owned `PersistenceStore` injection for webhook dedupe and route idempotency; WATS-87 expands that store shape with outbox methods. Node/Docker packaging, metrics, and production hosting remain separate roadmap items. WATS-35 adds a generated OpenAPI 3.1 document for the routes listed below.

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
  persistence?: PersistenceStore;
  enableGroupRoutes?: boolean;
}
```

`@wats/service` still does not read environment variables. Callers resolve env refs from `@wats/config` outside the service and pass explicit secret values in memory. The CLI live wrapper resolves env-secret refs from an explicit `--env-file .env.local` and process environment, then passes the resolved secrets to this package without changing the service API.

`enableGroupRoutes` is an explicit opt-in for WATS-137 Groups management routes. It defaults to `false`, so deployments that do not want Groups keep the pre-Groups route set and can strip Groups by not enabling the option.

## Routes

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/healthz` | GET | none | Returns `{ ok: true, service: "wats" }`. |
| `/readyz` | GET | none | Returns `{ ok: true, service: "wats" }` after construction. |
| `/openapi.json` | GET | none | Returns the generated OpenAPI 3.1 document. |
| `profile.webhook.path` | GET | Meta verify token | Delegates to `createWebhookAdapter`. |
| `profile.webhook.path` | POST | Meta signature | Delegates to `createWebhookAdapter`. |
| `${profile.service.apiPrefix}/messages/text` | POST | service bearer | Sends a text message through Graph. |
| `${profile.service.apiPrefix}/messages` | POST | service bearer | Sends a supported generic text, media, location, reaction, contacts, or interactive message body through Graph; group text/pin bodies are accepted only when `enableGroupRoutes` is true. |
| `${profile.service.apiPrefix}/groups` | GET, POST | service bearer | Opt-in (`enableGroupRoutes`) list/create Groups using the configured business phone-number id. |
| `${profile.service.apiPrefix}/groups/{groupId}` | GET, POST, DELETE | service bearer | Opt-in get/update/delete a Group. |
| `${profile.service.apiPrefix}/groups/{groupId}/invite-link` | GET, POST | service bearer | Opt-in get/reset a Group invite link. |
| `${profile.service.apiPrefix}/groups/{groupId}/participants` | DELETE | service bearer | Opt-in remove up to 8 Group participants. |
| `${profile.service.apiPrefix}/groups/{groupId}/join-requests` | GET, POST, DELETE | service bearer | Opt-in list/approve/reject Group join requests. |

Unknown routes return `404`. Unsupported methods return `405` with an `Allow` header.

## OpenAPI document

`createWatsServiceOpenApiDocument(profile, options?)` returns a plain-object OpenAPI 3.1 document for the current service routes. `createWatsServiceApp(config)` serves the same document at `GET /openapi.json` with JSON content type and no service bearer requirement. Method mismatch returns `405` with `Allow: GET`.

The document includes `serviceBearerAuth` only on the protected message routes and, when `enableGroupRoutes` is true, the protected Groups routes. It never embeds raw service bearer, Graph access, app secret, verify token, or config env-var secret reference values. See `docs/reference/openapi.md` for option validation, schemas, body matrix, and non-goals.

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
  "type": "callPermissionRequest",
  "to": "15551230000",
  "bodyText": "May we call you?"
}
```

```json
{
  "type": "image",
  "to": "15551230000",
  "mediaId": "1234567890",
  "caption": "hello",
  "replyToMessageId": "wamid.PARENT"
}
```

Supported media `type` values are `image`, `video`, `audio`, `document`, and `sticker`. Each media body must provide exactly one of `mediaId` or `link`. `caption` is accepted for image, video, and document bodies. `filename` is accepted for document bodies only. `replyToMessageId` maps to Graph `context.message_id`. WATS-90 adds audio `voice: true`, which maps to Graph `audio.voice = true`; omitting it preserves the standard audio payload.

Location bodies use `type: "location"`, finite `latitude`/`longitude` values in Graph-supported ranges, and optional `name`, `address`, and `replyToMessageId`. Reaction bodies use `type: "reaction"` with `messageId` and non-empty `emoji`. Remove-reaction bodies use `type: "removeReaction"` with `messageId` and map to Graph reaction payloads with an empty emoji. Contacts bodies use `type: "contacts"`, a non-empty `contacts` array, and the same camelCase contact input objects as the SDK composer helper. Interactive bodies support `interactiveButtons`, `interactiveList`, `interactiveCtaUrl`, `callPermissionRequest`, `interactiveProduct`, `interactiveProducts`, `interactiveCatalog`, and `interactiveLocationRequest`, and map through the corresponding SDK builders. WATS-90 `type: "callPermissionRequest"` emits Graph `interactive.type = "call_permission_request"` and `interactive.action.name = "call_permission_request"`.

The route preserves the service bearer boundary: the service bearer token authorizes the local service route, is never forwarded to Graph, and builder/validation failures return `400` without echoing tokens or request secrets.

## Groups routes (opt-in)

Pass `enableGroupRoutes: true` to expose WATS-137 Groups routes. Groups hang off `profile.whatsapp.phoneNumberId`, not the WABA id. Route inputs stay camelCase and are mapped to Meta snake_case only at the Graph boundary.

- `POST /groups` sends `POST /<phoneNumberId>/groups` with `subject`, optional `description`, and optional `joinApprovalMode`.
- `GET /groups` sends `GET /<phoneNumberId>/groups` with optional `limit`, `after`, and `before` query values.
- `GET|POST|DELETE /groups/{groupId}` map to get, update, and delete on `/<groupId>`.
- `GET|POST /groups/{groupId}/invite-link` map to `GET|POST /<groupId>/invite_link`; reset is POST, not DELETE.
- `DELETE /groups/{groupId}/participants` removes up to 8 participants with `waIds` mapped to `participants[].wa_id`.
- `GET|POST|DELETE /groups/{groupId}/join-requests` list, approve, or reject join requests. Reject is DELETE, not POST.

All Groups routes require the service bearer token, forward only the Graph access token to Graph, and return the same sanitized `graph_request_failed` envelope as message routes on Meta errors.

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
- `invalid_persistence`

HTTP errors use JSON bodies:

```json
{ "error": { "code": "unauthorized", "message": "Missing or invalid bearer token." } }
```

Common HTTP error codes:

- `400` malformed request/body
- `401` missing or invalid service bearer token
- `404` route not found
- `405` method not allowed
- `502` Graph request failure. When the underlying `GraphApiError` exposes sanitized Meta details, the body includes `metaCode`, `metaSubcode`, `metaType`, and `fbtraceId` alongside the stable `graph_request_failed` code. The service deliberately omits Meta's free-form error message because it may quote request/account identifiers; it never includes access tokens, app secrets, verify tokens, service bearer tokens, request bodies, or `Authorization` headers.

Example:

```json
{
  "error": {
    "code": "graph_request_failed",
    "message": "Graph request failed.",
    "metaCode": 131030,
    "metaType": "OAuthException",
    "fbtraceId": "TRACE123"
  }
}
```

## Persistence boundary

WATS-121 adds optional `PersistenceStore` injection to `createWatsServiceApp(...)`. The service does not read database environment variables directly; callers pass an already-created store.

Injected persistence must be the expanded WATS-87 outbox-capable `PersistenceStore` shape. Construction validates that the store exposes:

- `migrate()` and `health()`
- `recordWebhookEvent(...)`
- `getServiceRequest(...)`
- `recordServiceRequest(...)`
- `enqueueOutboxItem(...)`
- `claimOutboxItems(...)`
- `markOutboxItemFailed(...)`
- `markOutboxItemSucceeded(...)`
- `close()`

Missing any method fails construction with `WatsServiceError` code `invalid_persistence`.

When persistence is injected:

- signed webhook POSTs are recorded by event key/hash and duplicate deliveries are acknowledged without redispatching the same update;
- message send routes honor `Idempotency-Key`: matching key/body hash replays the stored response, while the same key with a different body returns `409 idempotency_conflict`.

The outbox APIs are part of the accepted service persistence contract even though current service message routes still send synchronously. `claimOutboxItems(...)` returns `OutboxItem` records with `leaseId`; callers must pass that same `leaseId` to `markOutboxItemFailed(...)` or `markOutboxItemSucceeded(...)` so stale workers cannot complete a newer reclaimed lease.

The service must not log secrets or raw webhook bodies through persistence diagnostics, and persistence failures must not expose database URLs, access tokens, app secrets, webhook verify tokens, service bearer tokens, message text, or raw webhook envelopes.

## WATS-71/WATS-101 CLI wrappers

`wats serve --config <path> --dry-run` wraps this app in a local Bun process with synthetic in-memory secrets and a no-network Graph transport.

`wats serve --config <path> --live --yes-live --env-file .env.local` wraps this app for local live testing. The CLI owns the live guard, env-file parsing, secret resolution, and process lifecycle. `@wats/service` remains runtime-neutral and receives explicit in-memory values only.

For local webhook verification, run the CLI live wrapper behind ngrok or an equivalent secure HTTPS tunnel. Meta will not accept plain HTTP or a bare local IP callback URL.

## WATS-49 Docker/deployment design target

WATS-49 documents the future container deployment contract. There is no supported Dockerfile/Compose/container image yet. Future containers should wrap the implemented `wats serve` contract rather than duplicating service routing. WATS-49 does not add image publication, registry credentials, live Meta startup checks, or release automation. In docs-lock wording: no image publication and no registry credentials.

## Non-goals

WATS-35/WATS-48/WATS-49 do not implement:

- a full Meta Graph API OpenAPI document
- live Meta credential checks
- background queues/outbox workers, metrics, Docker, TLS, or rate limiting
- additional future service message schemas beyond the current WATS-73 text/media/location/contacts/reaction/interactive slices

## Related

- Linear: WATS-34, WATS-35
- `docs/reference/openapi.md`
- `docs/reference/config.md`
- `docs/reference/webhook-adapter.md`
- `docs/reference/openapi.md`
