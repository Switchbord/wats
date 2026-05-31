# Client Reference

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-21

## Purpose

Define the public client API surface for WATS.

## Configuration Types (B1)

Client initialization references foundational shared types from `@wats/types`.

### `WhatsAppClientConfig`

Use this for external constructor/factory inputs.

Required fields:
- `token: string`
- `phoneNumberId: string`

Optional fields:
- `appSecret?: string`
- `verifyToken?: string`
- `apiVersion?: string`
- `baseUrl?: string`

### `WhatsAppClientRuntimeConfig`

Use this normalized shape internally after resolving defaults (for example `apiVersion` and `baseUrl`) during async startup flows.

## Graph request primitive (B2, F-4)

B2 introduced a minimal Graph API client primitive in `@wats/graph`; F-4 refactored it onto a Transport seam with strict construction-time validation and baseUrl pathname preservation.

### `GraphClientConfig`

Required fields:
- `accessToken: string` — non-empty; max 4096 characters; MUST NOT be whitespace-only; MUST NOT contain CR (U+000D), LF (U+000A), NUL (U+0000), or any other control character (U+0000..U+001F, U+007F). Invalid tokens throw `GraphRequestValidationError` at construction time.
- `apiVersion: string` — MUST match `/^v\d+(\.\d+)?$/` (for example `v20` or `v25.0`). Values containing `/`, `?`, `#`, `..`, or control characters are rejected with `GraphRequestValidationError`.

Optional fields:
- `baseUrl?: string` — defaults to `DEFAULT_GRAPH_BASE_URL` (`"https://graph.facebook.com/"`). MUST parse via `new URL(...)` AND the parsed `protocol` MUST be `http:` or `https:`; every other scheme (`javascript:`, `file:`, `ftp:`, `data:`, `about:`, `blob:`, …) is rejected with `GraphRequestValidationError`. The pathname of `baseUrl` is PRESERVED in resolved request URLs: `baseUrl: "https://proxy.example.com/api"` + `path: "/me"` + `apiVersion: "v25.0"` resolves to `"https://proxy.example.com/api/v25.0/me"`. This matches Open Question #11's default (preserve, not reject).
- `transport?: Transport` — defaults to `createFetchTransport()`. Inject a custom `Transport` to add retry, auth-refresh, tracing, or to mock requests in tests. See the [Transport and Testing guide](../guides/transport-and-testing.md).

`DEFAULT_GRAPH_BASE_URL` is exported for consumers that want to reference the default explicitly.

### `GraphClient.request<TResponse>(options)`

The request helper:
- builds Graph URLs under the API-version prefix (`/${apiVersion}/...`) while preserving any path prefix supplied via `baseUrl`
- validates/normalizes request paths and rejects traversal or injection patterns before network I/O
  - rejects dot-segments (`.` / `..`) across iterative decode stages, including nested/double-encoded markers such as `%252e%252e`
  - rejects path traversal patterns and encoded slash/backslash escapes
  - rejects raw or encoded `?` and `#` in request path input
  - rejects ASCII control characters U+0000..U+001F and U+007F in path segments (WATS-8 L1), including `%0A`, `%0D`, `%00`, and their double-encoded forms
- applies a managed `Authorization` Bearer header using the client's configured access token
- rejects caller-supplied `authorization` header overrides (any casing) with `GraphRequestValidationError`; the managed Bearer header is non-overridable by callers (defense-in-depth against request smuggling and credential confusion)
- rejects CR / LF / NUL in any request header name or value with `GraphRequestValidationError`; the underlying `TypeError` raised by `new Headers(init)` is caught and rewrapped into the typed taxonomy
- serializes JSON-like request bodies
- passes BufferSource view bodies (for example `Uint8Array`, `DataView`) through unchanged without auto-forcing `application/json`
- passes `ReadableStream` request bodies through unchanged; if the caller did not supply a `content-type`, defaults to `application/octet-stream` rather than `application/json`
- supports typed success payloads through `TResponse`
- maps network and Graph API failures to typed errors
- classifies JSON body serialization failures as validation/serialization errors (not network errors)
- throws `GraphSerializationError` when a successful (`2xx`) response declares JSON but contains invalid JSON
- routes every HTTP call through the injected `Transport`

Core request options:
- `method: string`
- `path: string`
- `query?: Record<string, string | number | boolean | null | undefined>`
- `body?: unknown`
- `headers?: HeadersInit`
- `signal?: AbortSignal`

### `GraphClient.requestRaw(options)`

`requestRaw` is the low-level escape hatch for already-resolved absolute URLs such as WATS-37 media binary download URLs. Unlike `request`, it does not prepend `/${apiVersion}` and does not parse JSON; it returns the raw `TransportResponse` from the injected transport.

Preconditions and validation:
- `options` MUST be a non-null, non-array object. Malformed JavaScript inputs reject with `GraphRequestValidationError` before transport.
- `method` MUST be one of `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` (case-insensitive). Non-string, empty, whitespace-only, control-character, and unsupported methods reject with `GraphRequestValidationError`.
- `url` MUST be an absolute `http:` or `https:` URL. Relative URLs, malformed URLs, every other scheme (`ftp:`, `file:`, `data:`, `javascript:`, …), and values containing CR/LF/NUL or other ASCII controls reject with `GraphRequestValidationError`. The URL is used as the request URL directly; no Graph API-version prefix is added.
- `headers?: HeadersInit` is optional. The client always applies a managed `Authorization` Bearer header, and caller-supplied `authorization` overrides (any casing, object/tuple/`Headers`) reject with `GraphRequestValidationError`. CR/LF/NUL/header wrapping in header names or values is caught and rewrapped as `GraphRequestValidationError` rather than leaking a raw `TypeError`.
- `body?: unknown` follows the same BodyInit matrix as `request`: `null`/`undefined` become `null`; `string`, `FormData`, `Blob`, `ArrayBuffer`, typed-array/DataView views, `URLSearchParams`, and `ReadableStream` pass through unchanged; other objects are JSON-stringified and serialization failures reject with `GraphSerializationError`. `requestRaw` does not auto-set `content-type`.
- `signal?: AbortSignal` MUST be AbortSignal-like (`aborted: boolean`, `addEventListener()` and `removeEventListener()` functions). Fake partial objects such as `{ aborted: false }` reject with `GraphRequestValidationError` before transport.

Error taxonomy:
- Request-shape, URL, method, header, authorization-override, and signal validation failures: `GraphRequestValidationError` before network I/O.
- Request-body JSON serialization failures: `GraphSerializationError` before network I/O.
- Transport/fetch failures: `GraphNetworkError`, preserving existing network-error wrapping semantics.
- HTTP status handling and response parsing are left to the caller because the raw `TransportResponse` is returned unchanged.

### Transport seam (F-4)

F-4 introduces the `Transport` seam so every HTTP concern — retry, auth-refresh, tracing, mocking — lives in a composable layer the caller controls. Key exports:

- `Transport`, `TransportRequest`, `TransportResponse`, `TransportHttpMethod`, `TransportInterceptor`, `TransportRetryPolicy`, `DEFAULT_TRANSPORT_RETRY_POLICY`
- `createFetchTransport(options?)` — production default wrapping `globalThis.fetch`
- `createReliableTransport(inner, options?)` — opt-in retry/backoff/per-attempt-timeout decorator; default GraphClient behavior is unchanged
- `createMockTransport(config?)` — in-memory Transport for tests, exposed via the `@wats/graph/testing` subpath

The default transport does NOT retry. Reliability is opt-in via `createReliableTransport`: it retries transient `GET`/`DELETE` failures and HTTP `429` rate limits, honors `Retry-After`, composes native `AbortSignal.timeout` / `AbortSignal.any`, and avoids ambiguous non-idempotent POST `5xx`/network retries by default. See the [Transport and Testing guide](../guides/transport-and-testing.md) for the full recipe.

### Endpoint scaffold

`GraphClient` now exposes `messages` endpoint scaffolding:
- `messages.sendMessage({ phoneNumberId, to, text, previewUrl? })`

This method builds a WhatsApp text payload and routes it through the shared request helper.

Path safety note:
- `phoneNumberId` is normalized and must be a numeric Graph phone number ID path segment.
- Non-numeric values (including `/`, `?`, `#`, dot-segments, or mixed characters) are rejected before any network call with a typed `GraphRequestValidationError` (a subclass of `GraphApiError`, so pre-existing `instanceof GraphApiError` checks remain valid).

### Endpoint registry (F-6)

F-6 introduces the `defineEndpoint` primitive as the uniform plumbing for every Graph endpoint. The legacy `GraphMessagesEndpoint` class remains for backward-compatibility and now delegates to the endpoint-registry callable `sendMessage` under the hood. See the dedicated [Endpoints Reference](./endpoints.md) for the full contract, path-template syntax, param kinds, body handling, F-5 error-registry integration, and a custom-endpoint tutorial.

### Scoped sub-clients (F-7 + WATS-30 + WATS-38)

F-7 adds `PhoneNumberClient` and `WABAClient` — ergonomic wrappers over the endpoint registry that bind a `phoneNumberId` / `wabaId` at construction and inject it into every call. WATS-30 extends the phone-number scope with `PhoneNumberClient.sendText({ to, text, previewUrl?, replyToMessageId? })`. WATS-38 completes the credential-free composer catalog for media, location, contacts, reaction, interactive buttons/lists/CTA/catalog/product/product-list/location-request, template send, mark-as-read, and typing indicators. WATS-39 extends the WABA scope with credential-free message-template management callables (`listMessageTemplates`, `createMessageTemplate`, `getMessageTemplate`, `updateMessageTemplate`, `deleteMessageTemplate`), template component builders, and parameter-count validation helpers. Media file bytes still live in the WATS-37 media runtime. See the [Scoped Clients Reference](./scoped-clients.md) for the construction contract, method catalog, validation rules, and interplay with the F-5 error registry.

### `WhatsApp.startChat(input)` (WATS-30)

`WhatsApp.startChat(input)` is the facade-level text conversation starter for contacts/inbox flows that need to initiate a conversation with an arbitrary phone number. The facade MUST be constructed with `phoneNumberId`; otherwise the method rejects before transport with `GraphRequestValidationError`.

Stable object-form input:

```ts
await wa.startChat({
  to: "15551230000",
  text: "Hello from WATS",
  previewUrl: false,
  replyToMessageId: "wamid.OPTIONAL"
});
```

Preconditions and error taxonomy:

- `input` MUST be a non-null object, not an array.
- `to` MUST be a string containing E.164-ish digits with an optional leading `+`, at most 15 digits. Empty, whitespace-only, non-string, control characters, slashes, URL markers, and address-like values are rejected. This is phone-number shape validation only; WATS does not check whether the recipient is a saved contact.
- `text` MUST be a non-empty, non-whitespace string at most 4096 characters.
- `previewUrl`, when present, MUST be boolean and maps to wire `text.preview_url`.
- `replyToMessageId`, when present, MUST be a non-empty string at most 256 characters and must not contain control characters; it maps to wire `context.message_id`.
- Validation failures reject with `GraphRequestValidationError` before any network call. Graph API failures still route through the existing `GraphApiError` / F-5 registry taxonomy.

### `WhatsApp` composer helpers (WATS-38)

Facade composer helpers mirror the phone-number scoped methods and require the facade to be constructed with `phoneNumberId`; otherwise they reject before transport with `GraphRequestValidationError`. Media helpers send existing media references only — either a previously uploaded media id or a public/resolvable http(s) link — while `uploadMedia`/download/delete/decrypt remain WATS-37 media runtime APIs.

```ts
await wa.sendImage({
  to: "15551230000",
  mediaId: "MEDIA_ID_FROM_UPLOAD",
  caption: "Optional image caption",
  replyToMessageId: "wamid.OPTIONAL"
});

await wa.sendDocument({
  to: "15551230000",
  link: "https://cdn.example.test/report.pdf",
  caption: "Optional document caption",
  filename: "report.pdf"
});
```

Body matrix:

| Helper | Wire `type` | Media reference | Supported optional fields |
| --- | --- | --- | --- |
| `sendImage` | `image` | exactly one of `mediaId` → `image.id` or `link` → `image.link` | `caption`, `replyToMessageId` |
| `sendVideo` | `video` | exactly one of `mediaId` or `link` | `caption`, `replyToMessageId` |
| `sendAudio` | `audio` | exactly one of `mediaId` or `link` | `replyToMessageId` only |
| `sendDocument` | `document` | exactly one of `mediaId` or `link` | `caption`, `filename`, `replyToMessageId` |
| `sendSticker` | `sticker` | exactly one of `mediaId` or `link` | `replyToMessageId` only |

Validation and limits:

- `input` MUST be a non-null object, not an array.
- `to` uses the same recipient policy as `startChat`: E.164-ish digits with optional leading `+`, max 15 digits, no control characters or URL/path/address markers.
- Exactly one of `mediaId` and `link` is required. Missing both or providing both rejects before transport.
- `mediaId` must be non-empty, non-whitespace, control-character-free, and at most 2048 characters.
- `link` must be non-empty, non-whitespace, control-character-free, at most 2048 characters, parse with `new URL(...)`, and use `http:` or `https:`.
- `caption`, where supported, must be non-empty when provided and at most 1024 characters.
- `filename`, document-only, must be non-empty, control-character-free, and at most 256 characters.
- `replyToMessageId` must be non-empty, control-character-free, and at most 256 characters; it maps to wire `context.message_id`.
- Validation failures reject with `GraphRequestValidationError` before transport. Downstream Graph failures preserve `GraphApiError` / F-5 registry subclasses such as `UnsupportedMessageTypeError`.

Additional WATS-38 helpers:

| Helper | Wire shape | Notes |
| --- | --- | --- |
| `sendLocation` | `type: "location"` | finite `latitude` [-90, 90] and `longitude` [-180, 180]; optional `name`, `address`, `replyToMessageId` |
| `sendContacts` | `type: "contacts"` | 1..257 contacts; each contact requires `name.formattedName`; phone entries require `phone` or `waId` |
| `sendReaction` / `removeReaction` | `type: "reaction"` | `sendReaction` requires non-empty `emoji`; `removeReaction` sends `emoji: ""` |
| `sendButtons` | `interactive.type: "button"` | 1..3 reply buttons; bounded button id/title |
| `sendList` | `interactive.type: "list"` | bounded sections/rows with `buttonText` |
| `sendCtaUrl` | `interactive.type: "cta_url"` | http(s) URL only |
| `sendProduct` / `sendProducts` / `sendCatalog` | commerce interactive variants | validates catalog/product ids and section/product counts |
| `requestLocation` | `interactive.type: "location_request_message"` | asks the user to share location |
| `sendTemplate` | `type: "template"` | sends an approved template by name/language/components; WATS-39 adds template management and parameter-count validation helpers |
| `markMessageAsRead` | `{ status: "read", message_id }` | marks inbound message thread read |
| `indicateTyping` | read + `typing_indicator: { type: "text" }` | typing indicator helper |

## API Surface

B2 exports:
- `GraphClient`
- typed request configuration primitives
- Graph typed error classes and mapping helpers
- messages endpoint scaffold + payload builders

WATS-30 exports:
- `GraphMessagesSendTextInput`
- `buildSendTextPayload`
- `PhoneNumberClient.sendText(input, opts?)`
- `WhatsApp.startChat(input)`
- `WhatsAppStartChatInput`

WATS-38 exports:
- `GraphMessagesSendImageInput`, `GraphMessagesSendVideoInput`, `GraphMessagesSendAudioInput`, `GraphMessagesSendDocumentInput`, `GraphMessagesSendStickerInput`, plus remaining composer input types for location, contacts, reaction, interactive variants, template, read receipts, and typing indicators.
- `GraphMessagesImagePayload`, `GraphMessagesVideoPayload`, `GraphMessagesAudioPayload`, `GraphMessagesDocumentPayload`, `GraphMessagesStickerPayload`, `GraphMessagesLocationPayload`, `GraphMessagesContactsPayload`, `GraphMessagesReactionPayload`, `GraphMessagesInteractivePayload`, `GraphMessagesTemplatePayload`, `GraphMessagesStatusPayload`.
- finite composer constants such as `GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH`, `GRAPH_MESSAGES_MEDIA_LINK_MAX_LENGTH`, `GRAPH_MESSAGES_MAX_REPLY_BUTTONS`, `GRAPH_MESSAGES_MAX_LIST_ROWS`, `GRAPH_MESSAGES_MAX_CONTACTS`, and `GRAPH_MESSAGES_MAX_PRODUCT_ITEMS`.
- all WATS-38 `buildSend*Payload` helpers for media, location, contacts, reaction/remove-reaction, interactive variants, template send, mark-as-read, and typing indicators.
- matching `PhoneNumberClient.*` and `WhatsApp.*` helper methods.

WATS-39 exports:
- WABA-scoped template callables: `listMessageTemplates`, `createMessageTemplate`, `getMessageTemplate`, `updateMessageTemplate`, and `deleteMessageTemplate`.
- Template model aliases and response types: `TemplateCategory`, `TemplateStatus`, `TemplateLanguageCode`, `TemplateParameterFormat`, `TemplateComponent`, `TemplateDetails`, `TemplateListResponse`, and `TemplateMutationResponse`.
- Component helpers: `buildTemplateHeaderComponent`, `buildTemplateBodyComponent`, `buildTemplateFooterComponent`, and `buildTemplateButtonComponent`.
- `validateTemplateParameterCounts(definition, sendComponents)`, which compares HEADER/BODY placeholders (`{{1}}` positional or `{{name}}` named) with send-time template parameters and throws `TemplateParamCountMismatchError` on mismatch.
- `WABAClient` methods for the same template operations with the bound `wabaId` injected where applicable.

## Usage Examples

```ts
import { GraphClient } from "@wats/graph";
import { WhatsApp } from "@wats/core";

const graphClient = new GraphClient({
  accessToken: process.env.WHATSAPP_TOKEN!,
  apiVersion: "v25.0"
});

const wa = new WhatsApp({
  graphClient,
  phoneNumberId: "1234567890"
});

await wa.startChat({
  to: "+15551230000",
  text: "Hi — starting this chat from WATS.",
  previewUrl: false
});

await wa.sendImage({
  to: "+15551230000",
  mediaId: "MEDIA_ID_FROM_UPLOAD",
  caption: "Image sent from WATS"
});
```

## Parity Notes

B1 aligns WATS client config typing with the pywa-style requirement for token/phone identity plus optional webhook verification and API customization settings.
