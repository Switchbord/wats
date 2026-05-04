# OpenAPI Reference (`@wats/service`)

- status: experimental
- applies-to: WATS-35
- lastReviewed: 2026-04-28

## Purpose

`@wats/service` can generate and serve an OpenAPI 3.1 document for the standalone WATS service API that exists today.

This is not a Meta Graph API OpenAPI document. It describes only WATS service routes: status checks, configured webhook ingress, the current text-message service APIs, and `/openapi.json`.

## Public API

```ts
import {
  createWatsServiceOpenApiDocument,
  type WatsServiceOpenApiOptions
} from "@wats/service";

const document = createWatsServiceOpenApiDocument(profile, {
  serverUrl: "https://service.example"
});
```

### `createWatsServiceOpenApiDocument(profile, options?)`

Preconditions:

- `profile` is an already validated `WatsProfileConfig` from `@wats/config`.
- `profile.webhook.path` and `profile.service.apiPrefix` must be safe absolute paths: start with `/`, contain at least one segment, and contain no query string, hash, backslash, control character, dot segment, or encoded traversal marker.
- `profile.webhook.path` must not collide with reserved service routes (`/healthz`, `/readyz`, `/openapi.json`) or generated message routes.
- `profile.service.apiPrefix` must not collide with reserved service routes or the configured webhook path.
- `options`, when present, must be an object.
- `options.serverUrl`, when present, must be an `http:` or `https:` URL. Query strings and fragments are stripped from the emitted server URL; unsafe pathnames are rejected.
- `options.title` and `options.version`, when present, must be non-empty strings.

Options:

```ts
interface WatsServiceOpenApiOptions {
  serverUrl?: string;
  title?: string;
  version?: string;
}
```

Defaults:

- `openapi`: `3.1.0`
- `info.title`: `WATS Service API`
- `info.version`: current package foundation version (`0.2.0`)
- `servers[0].url`: `http://{profile.service.host}:{profile.service.port}` when no `serverUrl` is provided

Construction failures throw `WatsServiceError`, not raw host errors:

- `invalid_profile` for missing malformed profile shape
- `invalid_path` for unsafe webhook/apiPrefix/server URL path material
- `invalid_config` for malformed OpenAPI option shapes

## Served route

`createWatsServiceApp(config)` serves:

```http
GET /openapi.json
```

Behavior:

- returns `200`
- content type is `application/json; charset=utf-8`
- no service bearer token required
- generated from the same runtime profile as the service app
- `POST` or other methods return `405` with `Allow: GET` and the standard JSON error envelope

## Documented routes

The generated document includes only current WATS service routes:

| Path | Methods | Auth in OpenAPI |
| --- | --- | --- |
| `/healthz` | GET | none |
| `/readyz` | GET | none |
| `profile.webhook.path` (for example `/webhooks/whatsapp` or `/webhook`) | GET, POST | none; Meta verify token/signature is documented as query/header inputs, not as service bearer auth |
| `{profile.service.apiPrefix}/messages/text` | POST | `serviceBearerAuth` |
| `{profile.service.apiPrefix}/messages` | POST | `serviceBearerAuth` |
| `/openapi.json` | GET | none |

## Security scheme

Protected service message routes use:

```yaml
components:
  securitySchemes:
    serviceBearerAuth:
      type: http
      scheme: bearer
      bearerFormat: opaque
```

The OpenAPI document never embeds raw secret values and does not emit config env-var secret refs such as `WATS_ACCESS_TOKEN` or `WATS_SERVICE_BEARER_TOKEN`.

## Schemas

The document includes JSON schemas for:

- `HealthResponse`: `{ ok: true, service: "wats" }`
- `ReadyResponse`: `{ ok: true, service: "wats" }`
- `ErrorEnvelope`: `{ error: { code, message? } }`
- `TextMessageBody`: convenience body for `POST {apiPrefix}/messages/text`
- `GenericTextMessageBody`: currently supported generic text body for `POST {apiPrefix}/messages`
- `GraphResponsePassthrough`: open object for unmodified Graph JSON responses
- webhook response helpers for the verify challenge and accepted dispatch envelope

## Body matrix and limits

| Route | Accepted body | Rejected body classes | Size limit |
| --- | --- | --- | --- |
| `POST {apiPrefix}/messages/text` | JSON object with non-empty `to`, non-empty `text`, optional boolean `previewUrl` | malformed JSON, arrays, primitives, missing fields, blank/control-character `to` or `text`, non-boolean `previewUrl` | no service-layer byte cap yet |
| `POST {apiPrefix}/messages` | JSON object with `messaging_product: "whatsapp"`, non-empty `to`, `type: "text"`, and `text.body` non-empty; optional boolean `text.preview_url` | malformed JSON, arrays, primitives, non-text message types, missing fields, blank/control-character strings, non-boolean `preview_url` | no service-layer byte cap yet |
| `POST profile.webhook.path` | Signed Meta webhook JSON delegated to `@wats/http` | malformed JSON/signature/envelope per WebhookAdapter taxonomy | `profile.webhook.maxBodyBytes`, default `1_048_576` |

Non-text message schemas are intentionally not included in WATS-35.

## Error taxonomy

Construction-time errors are `WatsServiceError` codes documented in `docs/reference/service.md`.

HTTP error envelopes use:

```json
{ "error": { "code": "method_not_allowed", "message": "Method not allowed." } }
```

Common OpenAPI-related HTTP statuses:

- `200` for `GET /openapi.json`
- `404` when `/openapi.json` is not the exact pathname
- `405` with `Allow: GET` for method mismatch

## Non-goals

The WATS service OpenAPI surface still does not add:

- a full Meta Graph API OpenAPI document
- non-text message request schemas
- live Meta credential checks or WABA mutations

WATS-36A adds a separate static Scalar UI page at [`reference/openapi-ui.md`](./openapi-ui.md) that renders this local service OpenAPI document; it does not change the generated OpenAPI scope.
