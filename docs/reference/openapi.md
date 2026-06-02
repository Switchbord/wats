# OpenAPI Reference (`@wats/service`)

- status: experimental
- applies-to: WATS-35/WATS-73/WATS-96/WATS-137
- lastReviewed: 2026-06-02

## Purpose

`@wats/service` can generate and serve an OpenAPI 3.1 document for the standalone WATS service API that exists today.

This is not a Meta Graph API OpenAPI document. It describes only WATS service routes: status checks, configured webhook ingress, the current text, media, location, reaction, contacts, group pin, interactive service APIs, opt-in Groups routes, and `/openapi.json`.

## WATS-96 Graph v25 metadata compatibility

Meta Graph v25 deprecates using the Graph query flag `metadata=1` for API metadata/introspection. WATS-96 keeps the service OpenAPI contract explicitly separate from that deprecated Graph metadata path: WATS does not send `metadata=1`, does not append it to Graph runtime requests, and does not use it during docs generation.

The generated `/openapi.json` remains a local WATS service document, not a live Meta Graph v25 schema scrape. Consumers should treat any Meta-owned Graph OpenAPI/source-of-truth material as external documentation and should not expect WATS runtime or generation code to request `metadata=1`.

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
  enableGroupRoutes?: boolean;
}
```

Defaults:

- `openapi`: `3.1.0`
- `info.title`: `WATS Service API`
- `info.version`: current package version
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
| `{profile.service.apiPrefix}/groups` | GET, POST when `enableGroupRoutes` is true | `serviceBearerAuth` |
| `{profile.service.apiPrefix}/groups/{groupId}` | GET, POST, DELETE when `enableGroupRoutes` is true | `serviceBearerAuth` |
| `{profile.service.apiPrefix}/groups/{groupId}/invite-link` | GET, POST when `enableGroupRoutes` is true | `serviceBearerAuth` |
| `{profile.service.apiPrefix}/groups/{groupId}/participants` | DELETE when `enableGroupRoutes` is true | `serviceBearerAuth` |
| `{profile.service.apiPrefix}/groups/{groupId}/join-requests` | GET, POST, DELETE when `enableGroupRoutes` is true | `serviceBearerAuth` |
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
- `GenericTextMessageBody`: generic Graph-native text body for `POST {apiPrefix}/messages`
- `MediaMessageBody`: WATS media composer bodies for image, video, audio, document, and sticker messages
- `LocationMessageBody`: WATS location composer body for `POST {apiPrefix}/messages`
- `ContactsMessageBody`: WATS contacts composer body for `POST {apiPrefix}/messages`
- `ReactionMessageBody`: WATS reaction/remove-reaction composer bodies for `POST {apiPrefix}/messages`
- `GroupPinMessageBody`: WATS Groups pin/unpin body for `POST {apiPrefix}/messages` when `enableGroupRoutes` is true
- `CreateGroupBody`, `UpdateGroupBody`, `RemoveGroupParticipantsBody`, and `ManageGroupJoinRequestsBody`: opt-in WATS-137 Groups route bodies when `enableGroupRoutes` is true
- `BasicInteractiveMessageBody`: WATS button, list, and CTA URL interactive composer bodies for `POST {apiPrefix}/messages`
- `CommerceInteractiveMessageBody`: WATS product, product-list, catalog, and location-request interactive composer bodies for `POST {apiPrefix}/messages`
- `SupportedMessageBody`: `oneOf` wrapper for text, media, location, contacts, reaction, optional group pin, or interactive bodies on `POST {apiPrefix}/messages`
- `GraphResponsePassthrough`: open object for unmodified Graph JSON responses
- webhook response helpers for the verify challenge and accepted dispatch envelope

## Body matrix and limits

| Route | Accepted body | Rejected body classes | Size limit |
| --- | --- | --- | --- |
| `POST {apiPrefix}/messages/text` | JSON object with non-empty `to`, non-empty `text`, optional boolean `previewUrl` | malformed JSON, arrays, primitives, missing fields, blank/control-character `to` or `text`, non-boolean `previewUrl` | no service-layer byte cap yet |
| `POST {apiPrefix}/messages` | Generic Graph-native text, media composer body, location composer body, contacts composer body, reaction/remove-reaction composer body, optional group text/pin body when `enableGroupRoutes` is true, or interactive body | malformed JSON, arrays, primitives, unsupported message types, group bodies while disabled, missing fields, blank/control-character strings, both/missing media references, caption on audio/sticker, filename outside document, invalid links, out-of-range/non-finite coordinates, invalid reaction message ids or emoji, invalid pin range | no service-layer byte cap yet |
| Opt-in `GET|POST|DELETE {apiPrefix}/groups...` | Groups management bodies: `subject`/`description`/`joinApprovalMode`, `waIds`, or `joinRequestIds` depending on route | malformed JSON, arrays, primitives, unsafe route params, missing fields, blank/control-character strings, >8 participants, empty join-request ids | no service-layer byte cap yet |
| `POST profile.webhook.path` | Signed Meta webhook JSON delegated to `@wats/http` | malformed JSON/signature/envelope per WebhookAdapter taxonomy | `profile.webhook.maxBodyBytes`, default `1_048_576` |

This is still a WATS service OpenAPI document, not a full Meta Graph API OpenAPI document.

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
- future service route families outside the current WATS-73 text/media/location/contacts/reaction/interactive message body set plus WATS-137 opt-in Groups routes
- live Meta credential checks or WABA mutations

WATS-36A adds a separate static Scalar UI page at [`reference/openapi-ui.md`](./openapi-ui.md) that renders this local service OpenAPI document; it does not change the generated OpenAPI scope.
