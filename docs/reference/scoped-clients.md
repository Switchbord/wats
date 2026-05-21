# Scoped Clients Reference

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-22

## Purpose

Document the F-7 scoped sub-clients — `PhoneNumberClient` and
`WABAClient` — that sit on top of the F-6 [endpoint registry](./endpoints.md)
and bind a scope-defining path param (`phoneNumberId` / `wabaId`) at
construction so call sites stop threading it through every request.

Closes WATS-19 (Arch-E).

This page is a companion to the [Client Reference](./client.md) and the
[Endpoints Reference](./endpoints.md). Scoped sub-clients are **thin
ergonomic wrappers** around the same `defineEndpoint` callables — they
never re-implement path construction, sanitization, or error mapping.

## Overview

Graph endpoints come in two shapes:

- **Global / graph-root endpoints** — no scope id in the path.
- **Scope-bound endpoints** — a leading id in the path template
  (`/{phoneNumberId}/messages`, `/{wabaId}/phone_numbers`, ...). These
  are the ones that almost every application repeats a dozen times.

Scoped sub-clients bind the id once at construction, validate it with
the same F-6 sanitizer that every endpoint call would apply, and then
expose endpoint callables as instance methods that inject the bound id
into the params object. A `PhoneNumberClient.sendMessage(body)` is
exactly equivalent to `sendMessage(graphClient, { phoneNumberId }, body)`
at the wire level (byte-parity is covered by a dedicated test).

```
new PhoneNumberClient({ graphClient, phoneNumberId })
  └──→ assertSafePathParamValue("phoneNumberId", phoneNumberId)   // F-6 sanitizer
  └──→ .sendMessage(body, opts?)
         └──→ sendMessage(graphClient, { phoneNumberId }, body, opts)   // F-6 endpoint callable
                └──→ graphClient.request(...)                            // F-4 transport + header/CRLF guards
                       └──→ F-5 error registry on non-2xx
```

## When to use a scoped sub-client vs a direct endpoint callable

| Use                                              | Prefer                                   |
| ------------------------------------------------ | ---------------------------------------- |
| Most application code; multiple calls per scope  | scoped sub-client (`new PhoneNumberClient`) |
| One-off / scripts / tests                        | direct `defineEndpoint` callable         |
| Custom endpoints you've authored yourself        | direct `defineEndpoint` callable         |
| Registering listeners / handlers keyed by scope  | scoped sub-client                        |

Direct callables remain first-class — the sub-clients build on them,
they do not replace them.

## PhoneNumberClient

Scope: a single WhatsApp Business phone number id
(`phoneNumberId`). Used for every messaging call on the path
`/{phoneNumberId}/...`.

```ts
import {
  GraphClient,
  PhoneNumberClient,
  type PhoneNumberClientConfig
} from "@wats/graph";

const graphClient = new GraphClient({
  accessToken: process.env.WHATSAPP_TOKEN!,
  apiVersion: "v25.0"
});

const phone = new PhoneNumberClient({
  graphClient,
  phoneNumberId: "555000111"
});

await phone.sendMessage({
  messaging_product: "whatsapp",
  to: "15551230000",
  type: "text",
  text: { body: "hello" }
});
```

### Construction contract

`PhoneNumberClient` validates its config at construction and throws
`GraphRequestValidationError` (an `instanceof WatsError` — see
[errors.md](./errors.md)) on any violation:

- `config` MUST be a non-null object.
- `config.graphClient` MUST duck-type as a `GraphClient`: it MUST
  expose a `.request(options)` function. A bare `{}` is rejected so
  that misconfigurations fail at the call site rather than later,
  deep inside the request pipeline.
- `config.phoneNumberId` MUST be a non-empty, non-whitespace `string`.
- `config.phoneNumberId` MUST pass the F-6
  `assertSafePathParamValue("phoneNumberId", value)` sanitizer. This
  is the **same** helper the F-6 endpoint registry uses at call time,
  so the rules are reused byte-for-byte rather than re-implemented:
  - No dot-segments (`"."`, `".."`).
  - No forward slash (`/`) or backslash (`\\`).
  - No query-string (`?`) or fragment (`#`) markers.
  - No ASCII control characters (U+0000..U+001F, U+007F), which
    includes CR / LF / NUL.

The net effect: an invalid `phoneNumberId` fails at CONSTRUCTION,
never at the first call. This matches the endpoint registry architecture principle that
configuration-shaped errors should surface as early as possible.

### Method catalog

The method catalog now includes the baseline text sender plus the WATS-38
outbound composer helpers. Methods marked implemented exist on the class
today and delegate through the same `POST /{phoneNumberId}/messages`
endpoint callable.

| Method             | Status      | Endpoint                                   |
| ------------------ | ----------- | ------------------------------------------ |
| `sendMessage`      | implemented | `POST /{phoneNumberId}/messages` raw body passthrough |
| `sendText`         | implemented (WATS-30) | `POST /{phoneNumberId}/messages` text payload |
| `sendImage`        | implemented (WATS-38) | `POST /{phoneNumberId}/messages` image payload |
| `sendVideo`        | implemented (WATS-38) | `POST /{phoneNumberId}/messages` video payload |
| `sendAudio`        | implemented (WATS-38/WATS-90) | `POST /{phoneNumberId}/messages` audio payload; WATS-90 adds `voice?: boolean` |
| `sendDocument`     | implemented (WATS-38) | `POST /{phoneNumberId}/messages` document payload |
| `sendSticker`      | implemented (WATS-38) | `POST /{phoneNumberId}/messages` sticker payload |
| `sendLocation`    | implemented (WATS-38) | `POST /{phoneNumberId}/messages` location payload |
| `sendContacts`    | implemented (WATS-38) | `POST /{phoneNumberId}/messages` contacts payload |
| `sendReaction` / `removeReaction` | implemented (WATS-38) | `POST /{phoneNumberId}/messages` reaction payload |
| `sendButtons` / `sendList` / `sendCtaUrl` / `sendCallPermissionRequest` | implemented (WATS-38/WATS-90) | interactive button/list/CTA/call-permission payloads |
| `sendProduct` / `sendProducts` / `sendCatalog` | implemented (WATS-38) | commerce interactive payloads |
| `requestLocation` | implemented (WATS-38) | interactive location request payload |
| `sendTemplate`    | implemented (WATS-38) | approved template send payload |
| `markMessageAsRead` | implemented (WATS-38) | read status update payload |
| `indicateTyping` | implemented (WATS-38) | read status + typing indicator payload |
| `getInfo({ fields? })` | implemented (WATS-42A) | `GET /{phoneNumberId}` |
| `getSettings({ fields?, includeSipCredentials? })` | implemented (WATS-42A) | `GET /{phoneNumberId}/settings`; `includeSipCredentials` maps to `include_sip_credentials` and responses may be sensitive |
| `updateSettings({ storageConfiguration })` | implemented (WATS-93) | `POST /{phoneNumberId}/settings`; emits `storage_configuration` and never `data_localization_region` |
| `getBusinessProfile({ fields? })` | implemented (WATS-42A) | `GET /{phoneNumberId}/whatsapp_business_profile` |
| `getCommerceSettings({ fields? })` | implemented (WATS-42A) | `GET /{phoneNumberId}/whatsapp_commerce_settings` |
| `initiateCall` | implemented (WATS-41) | `POST /{phoneNumberId}/calls` action `connect` |
| `preAcceptCall` | implemented (WATS-41) | `POST /{phoneNumberId}/calls` action `pre_accept` |
| `acceptCall` | implemented (WATS-41) | `POST /{phoneNumberId}/calls` action `accept` |
| `rejectCall` | implemented (WATS-41) | `POST /{phoneNumberId}/calls` action `reject` |
| `terminateCall` | implemented (WATS-41) | `POST /{phoneNumberId}/calls` action `terminate` |
| `uploadMedia` scoped method | deferred | Use root `uploadMedia(client, { phoneNumberId }, ...)` from `@wats/graph` today (WATS-37); a bound scoped convenience method may land later. |

Live template/Flow/calling validation, production Flow hosting, encrypted data-exchange
request handling, live call sessions, and broad admin APIs remain separate credential-gated
or roadmap issues. Consumer code may type-check this list via the exported method/input
types.


### `updateSettings({ storageConfiguration })` (WATS-93)

`PhoneNumberClient.updateSettings(...)` binds the configured phone-number id and
POSTs local-storage settings to `/{phoneNumberId}/settings`. Pass camelCase
`storageConfiguration`; WATS emits Graph `storage_configuration` (the same
local-storage settings surface used alongside authentication templates whose
OTP buttons use `supported_apps` records with `package_name` and
`signature_hash`). The removed registration field `data_localization_region` is
rejected/documented as not emitted by WATS.

```ts
await phone.updateSettings({
  storageConfiguration: { status: "ENABLED" }
});
```

### `sendText(input, opts?)` (WATS-30)

`PhoneNumberClient.sendText({ to, text, previewUrl?, replyToMessageId? }, opts?)` builds the Meta text payload and delegates to `sendMessage(...)` with the bound `phoneNumberId`. It is the low-level ergonomic primitive behind `WhatsApp.startChat(...)`.

```ts
await phone.sendText({
  to: "+155****0000",
  text: "Hello",
  previewUrl: false,
  replyToMessageId: "wamid.OPTIONAL"
});
```


WATS-90 adds two v24 send-message deltas:

```ts
await phone.sendAudio({
  to: "+155****0000",
  mediaId: "AUDIO_ID",
  voice: true
});

await phone.sendCallPermissionRequest({
  to: "+155****0000",
  bodyText: "May we call you?",
  replyToMessageId: "wamid.OPTIONAL"
});
```

`sendAudio(..., { voice: true })` emits Graph `audio.voice = true`; omitting
`voice` preserves the pre-WATS-90 audio body. `sendCallPermissionRequest(...)`
emits `interactive.type = "call_permission_request"` with
`interactive.action.name = "call_permission_request"` and validates unknown or
malformed fields before transport.

Validation is runtime-enforced for JavaScript callers and rejects with
`GraphRequestValidationError` before any transport call:

- `input` must be a non-null object.
- `to` must be E.164-ish digits with optional leading `+`, max 15 digits; it must not be empty, whitespace-only, non-string, a URL/path/address, or contain control characters. This is deliberately not a contacts check — arbitrary non-contact phone numbers are accepted when they satisfy the shape.
- `text` must be non-empty and max 4096 characters.
- `previewUrl`, when provided, must be boolean.
- `replyToMessageId`, when provided, must be non-empty, max 256 characters, and control-character-free.
- Existing F-5 Graph error taxonomy is preserved after the request reaches Meta/transport.

### `sendImage|sendVideo|sendAudio|sendDocument|sendSticker(input, opts?)` (WATS-38)

Outbound media helpers build Meta `messages` payloads that reference an
existing media id or an http(s) link. They do not upload bytes; use the
WATS-37 media runtime (`uploadMedia`, `downloadMedia`,
`downloadMediaBytes`, `deleteMedia`, `decryptEncryptedMedia`) for media
file operations.

```ts
await phone.sendImage({
  to: "+155****0000",
  mediaId: "MEDIA_ID_FROM_UPLOAD",
  caption: "Optional image caption",
  replyToMessageId: "wamid.OPTIONAL"
});

await phone.sendDocument({
  to: "+155****0000",
  link: "https://cdn.example.test/report.pdf",
  filename: "report.pdf"
});
```

Validation is runtime-enforced for JavaScript callers and rejects with
`GraphRequestValidationError` before any transport call:

- `input` must be a non-null object.
- `to` follows the `sendText` recipient policy: E.164-ish digits with optional leading `+`, max 15 digits, no control characters or URL/path/address markers.
- Exactly one of `mediaId` and `link` is required. Missing both or providing both rejects before transport.
- `mediaId` must be a non-empty string, control-character-free, and at most 2048 characters.
- `link` must be a non-empty `http:` or `https:` URL, control-character-free, and at most 2048 characters.
- `caption` is supported on image/video/document only, must be non-empty when provided, and is capped at 1024 characters.
- `filename` is document-only, must be non-empty when provided, control-character-free, and is capped at 256 characters.
- `replyToMessageId` follows the same non-empty/control-free/256-character policy as `sendText`.
- Existing F-5 Graph error taxonomy is preserved after the request reaches Meta/transport.

### Remaining WATS-38 composers

`PhoneNumberClient` also exposes `sendLocation`, `sendContacts`,
`sendReaction`, `removeReaction`, `sendButtons`, `sendList`,
`sendCtaUrl`, `sendProduct`, `sendProducts`, `sendCatalog`,
`requestLocation`, `sendTemplate`, `markMessageAsRead`, and
`indicateTyping`. Each helper validates public JavaScript inputs before
transport and delegates to `sendMessage(...)` with the bound
`phoneNumberId`. Invalid options reject with `GraphRequestValidationError`;
Graph API failures preserve the F-5 error registry taxonomy.

### Calling lifecycle helpers (WATS-41)

`PhoneNumberClient` exposes the credential-free Calling API lifecycle over the bound phone-number scope:

```ts
await phone.initiateCall({
  to: "+155****0000",
  session: { sdpType: "offer", sdp: "v=0\r\n..." },
  bizOpaqueCallbackData: "tracker-optional"
});

await phone.acceptCall({
  callId: "wacid.ABGG...",
  session: { sdpType: "answer", sdp: "v=0\r\n..." }
});
await phone.terminateCall({ callId: "wacid.ABGG..." });
```

Direct callables are also exported from `@wats/graph`: `initiateCall`,
`preAcceptCall`, `acceptCall`, `rejectCall`, and `terminateCall`. All five
delegate to `POST /{phoneNumberId}/calls`; only the Graph body `action` differs
(`connect`, `pre_accept`, `accept`, `reject`, `terminate`).

Validation is runtime-enforced for JavaScript callers and rejects with
`GraphRequestValidationError` before any transport call:

- `phoneNumberId`, `to`, and `callId` must be non-empty strings with no control
  characters, dot segments, slashes, query/fragment markers, malformed percent
  encoding, encoded dot-segments, or double-encoded dot-segments.
- `bizOpaqueCallbackData`, when provided, must be a non-empty string no longer
  than `CALL_BIZ_OPAQUE_CALLBACK_DATA_MAX_LENGTH` (`512`) and free of control
  characters.
- `session` must be a descriptor-safe plain object. WATS clones it before
  transport, maps `sdpType` to Graph `sdp_type`, rejects accessors, `toJSON`,
  custom prototypes, cycles, unsafe prototype keys (`__proto__`, `constructor`,
  `prototype`), non-finite numbers, functions, symbols, empty/oversized strings,
  NUL/DEL-bearing SDP text, and serialized bodies over `CALL_SESSION_MAX_BYTES`
  (`65_536`).
- Undefined optional fields are omitted from the Graph JSON body.
- Existing F-5/pywa error taxonomy is preserved after the request reaches
  transport, including calling subclasses such as `CallingNotEnabledError`,
  `DuplicateCallError`, and `CallConnectionError`.

All WATS-41 tests use `createMockTransport`; live call sessions remain
credential-gated and are not performed in CI.

### Bound-id path substitution

`PhoneNumberClient.sendMessage(body, opts?)` is a pure delegation to
the F-6 `sendMessage` endpoint-registry callable with
`{ phoneNumberId: this.phoneNumberId }` injected. `sendText` and the
WATS-38 media helpers build typed bodies and then use that same path.
The wire-level result is byte-identical to calling
`sendMessage(graphClient, { phoneNumberId }, body, opts)` directly —
the consumer fixture asserts this equivalence.

## WABAClient

Scope: a WhatsApp Business Account id (`wabaId`). Used for endpoints
rooted at `/{wabaId}/...` — the most visible of which is the
phone-number registry.

```ts
import { GraphClient, WABAClient } from "@wats/graph";

const waba = new WABAClient({
  graphClient,
  wabaId: "9876543210"
});

const { data } = await waba.listPhoneNumbers();
for (const pn of data ?? []) {
  console.log(pn.id, pn.display_phone_number);
}
```

### Construction contract

Parallel to `PhoneNumberClient`:

- `config` MUST be a non-null object.
- `config.graphClient` MUST expose a `.request(options)` function.
- `config.wabaId` MUST be a non-empty, non-whitespace `string`.
- `config.wabaId` MUST pass `assertSafePathParamValue("wabaId",
  value)` — reusing the F-6 path-param sanitizer rules (no
  dot-segments, no slashes, no `?`/`#`, no ASCII control chars).

Violations throw `GraphRequestValidationError` at construction.

### Method catalog

| Method             | Status      | Endpoint                                      |
| ------------------ | ----------- | --------------------------------------------- |
| `getInfo({ fields? })` | implemented (WATS-42A) | `GET /{wabaId}` |
| `listSubscribedApps()` | implemented (WATS-42A) | `GET /{wabaId}/subscribed_apps` |
| `listPhoneNumbers({ fields?, limit?, after?, before? })` | implemented / enhanced (WATS-42A) | `GET /{wabaId}/phone_numbers` |
| `listMessageTemplates` | implemented (WATS-39) | `GET /{wabaId}/message_templates` |
| `createMessageTemplate` | implemented (WATS-39) | `POST /{wabaId}/message_templates` |
| `getMessageTemplate` | implemented (WATS-39) | `GET /{templateId}` |
| `updateMessageTemplate` | implemented (WATS-39) | `POST /{templateId}` |
| `deleteMessageTemplate` | implemented (WATS-39) | `DELETE /{wabaId}/message_templates?name=...&hsm_id=...` |
| `listTemplateGroups` / `createTemplateGroup` / `getTemplateGroup` / `updateTemplateGroup` / `deleteTemplateGroup` / `getTemplateGroupAnalytics` | implemented (WATS-94) | `/{wabaId}/template_groups`, `/{templateGroupId}`, and `/{wabaId}/template_group_analytics` |
| `listFlows` | implemented (WATS-40) | `GET /{wabaId}/flows` |
| `createFlow` | implemented (WATS-40) | `POST /{wabaId}/flows` |
| `getFlow` | implemented (WATS-40) | `GET /{flowId}` |
| `updateFlowMetadata` | implemented (WATS-40) | `POST /{flowId}` |
| `updateFlowJson` | implemented (WATS-40) | `POST /{flowId}/assets` |
| `publishFlow` | implemented (WATS-40) | `POST /{flowId}/publish` |
| `deleteFlow` | implemented (WATS-40) | `DELETE /{flowId}` |
| `deprecateFlow` | implemented (WATS-40) | `POST /{flowId}/deprecate` |
| `getFlowAssets` | implemented (WATS-40) | `GET /{flowId}/assets` |
| `subscribeApp`     | deferred    | `POST /{wabaId}/subscribed_apps` (later)      |

The `listPhoneNumbers`, WATS-39 template endpoint callables, and WATS-40 Flow endpoint callables are
also exported from `@wats/graph` so direct-callable users do not need
the sub-client:

```ts
import {
  buildTemplateBodyComponent,
  createMessageTemplate,
  listMessageTemplates
} from "@wats/graph";

const { data } = await listMessageTemplates(graphClient, {
  wabaId: "999",
  status: "APPROVED"
});

await createMessageTemplate(graphClient, { wabaId: "999" }, {
  name: "order_ready",
  language: "en_US",
  category: "UTILITY",
  components: [buildTemplateBodyComponent({ text: "Hi {{1}}" })]
});
```


### Template groups and analytics (WATS-94)

`WABAClient` exposes Template Group helpers over the bound WABA id:
`listTemplateGroups`, `createTemplateGroup`, `getTemplateGroup`,
`updateTemplateGroup`, `deleteTemplateGroup`, and
`getTemplateGroupAnalytics`. Direct callables with the same names are exported
from root `@wats/graph` and `@wats/graph/endpoints/templates`.

```ts
await waba.listTemplateGroups({ limit: "25" });
await waba.createTemplateGroup({
  name: "launch_group",
  category: "MARKETING",
  templateIds: ["template-id-1"]
});
await waba.getTemplateGroupAnalytics({
  templateGroupId: "template-group-id",
  metricTypes: ["sent", "delivered"]
});
```

The wire endpoints are Graph `template_groups` and
`template_group_analytics`. WATS does not claim a dashboard or undocumented
metric schema; unknown analytics fields are preserved structurally.

WATS-39 template helpers and WATS-40 Flow helpers are credential-free SDK surfaces. They build
and validate Graph request shapes and are covered through MockTransport;
they do not run live Meta/WABA mutations in CI.

```ts
import { buildFlowJson, createFlow, listFlows } from "@wats/graph";

await listFlows(graphClient, { wabaId: "999", status: "DRAFT" });

await createFlow(graphClient, { wabaId: "999" }, {
  name: "signup_flow",
  categories: ["SIGN_UP"],
  endpointUri: "https://flows.example.test/data-exchange",
  flowJson: buildFlowJson({
    version: "7.0",
    screens: [{ id: "WELCOME", layout: { type: "SingleColumnLayout", children: [] } }]
  })
});
```

Flow JSON/data-exchange helpers enforce finite local caps before transport:
`FLOW_JSON_MAX_DEPTH = 16`, `FLOW_JSON_MAX_ARRAY_LENGTH = 1000`,
`FLOW_JSON_MAX_SCREENS = 50`, `FLOW_JSON_MAX_COMPONENTS = 1000`,
`FLOW_JSON_MAX_STRING_LENGTH = 16384`, and `FLOW_JSON_MAX_BYTES = 131072`.
Malformed JavaScript runtime inputs reject with `GraphRequestValidationError`;
live Flow mutations and production Flow hosting remain credential-gated.

### Business/admin inventory (read-only, WATS-42A)

WATS-42A adds credential-free MockTransport-tested read-only business/admin inventory callables and scoped methods:

```ts
import {
  getWabaInfo,
  getBusinessProfile,
  getPhoneNumberSettings
} from "@wats/graph";

await waba.getInfo({ fields: ["id", "name", "business_verification_status"] });
await waba.listSubscribedApps();
await waba.listPhoneNumbers({ fields: ["id", "display_phone_number"], limit: "25" });

await phone.getInfo({ fields: ["id", "display_phone_number", "quality_rating"] });
await phone.getBusinessProfile({ fields: ["about", "address", "websites"] });
await phone.getCommerceSettings({ fields: ["is_cart_enabled", "is_catalog_visible"] });
await phone.getSettings({ fields: "calling", includeSipCredentials: false });
```

Direct callables mirror those methods: `getWabaInfo`, `listSubscribedApps`, enhanced `listPhoneNumbers`, `getPhoneNumberInfo`, `getPhoneNumberSettings`, `getBusinessProfile`, and `getCommerceSettings`. They are exported from root `@wats/graph` and from `@wats/graph/endpoints/business-management`.

Validation is fail-closed before transport: path ids reject raw/encoded/double-encoded traversal and control characters; `fields` accepts a string or dense readonly string array and is joined with commas through URLSearchParams; `includeSipCredentials` must be boolean when provided and maps to Graph `include_sip_credentials=true|false`. `getPhoneNumberSettings({ includeSipCredentials: true })` may return SIP credentials, so treat that response as sensitive and avoid logging it. Mutating admin endpoints and live Meta verification remain credential-gated.

### Block API, OBA, and display-name review helpers (WATS-95)

WATS-95 adds credential-free, MockTransport-tested request-shape helpers for current Meta business phone-number deltas. They make no live Meta calls in CI, perform no credential validation, and make no automatic user-block decisions. Policy/appeal automation remains out of scope.

```ts
await phone.listBlockedUsers();
await phone.blockUsers({ users: ["15551234567"] });
await phone.unblockUsers({ users: ["15551234567"] });

await phone.getOfficialBusinessAccountStatus({ fields: ["oba_status", "status_message"] });
await phone.requestOfficialBusinessAccountReview({
  businessWebsiteUrl: "https://example.com",
  primaryCountryOfOperation: "US"
});
await phone.submitDisplayNameForReview({ newDisplayName: "Acme Support" });
```

Direct callables mirror the scoped methods and are exported from root `@wats/graph` and `@wats/graph/endpoints/business-management`: `listBlockedUsers`, `blockUsers`, `unblockUsers`, `getOfficialBusinessAccountStatus`, `requestOfficialBusinessAccountReview`, and `submitDisplayNameForReview`. The wire paths and fields are Meta's `GET|POST|DELETE /{phoneNumberId}/block_users`, `GET|POST /{phoneNumberId}/official_business_account`, and `POST /{phoneNumberId}` with Graph `new_display_name`. OBA review bodies use `business_website_url` and `primary_country_of_operation` plus optional `primary_language`, `parent_business_or_brand`, `supporting_links`, and `additional_supporting_information`.

Validation rejects bad path ids, empty/non-array/sparse/accessor-backed `users`, non-phone-number user strings, invalid display names, non-http(s) OBA URLs, invalid country codes, duplicate or invalid supporting links, GET bodies, and unsafe headers before transport with `GraphRequestValidationError`. Existing Graph error taxonomy is preserved after a request reaches transport.

## Interplay with the F-5 error registry

Both sub-clients route ALL errors through `GraphClient.request`, which
routes Graph error envelopes through the F-5
`resolveRegisteredError(code, subcode?)` registry. Consumers rely on
`instanceof` narrowing exactly as with the direct callable shape:

```ts
import {
  PhoneNumberClient,
  GraphAuthError,
  UnsupportedMessageTypeError,
  InvalidParameterError
} from "@wats/graph";

try {
  await phone.sendMessage(body);
} catch (error) {
  if (error instanceof UnsupportedMessageTypeError) {
    // code 131051 — sibling-NOT InvalidParameterError / GraphAuthError
    // (the two would otherwise be reasonable mis-guesses for a 400)
  } else if (error instanceof GraphAuthError) {
    // 401/403 with OAuth / code 190, etc.
  }
}
```

The **sibling-NOT** language is important: an `instanceof
UnsupportedMessageTypeError` on a 131051 response is NOT also an
`instanceof InvalidParameterError` and NOT an `instanceof
GraphAuthError` — the taxonomy is axis-exclusive. The same parity is
exercised in the `PhoneNumberClient` and `WABAClient` test suites for
at least two error pairs per sub-client.

## Scope ledger (what F-7 deliberately does NOT do)

- No separate `TemplateClient`, `MediaClient`, or `FlowClient`; WABA-scoped
  template and Flow operations live on `WABAClient` plus direct callables.
- No OAuth token refresh or lifecycle management.
- No convenience helpers that aren't in pywa; F-7 stays parity-driven.
- The legacy `GraphMessagesEndpoint` class (exposed as
  `client.messages`) is preserved — `PhoneNumberClient` does NOT
  replace it, and does NOT remove it. Deprecate-in-place lands in a
  later F-step per the plan.
- No listener registration — that lands in F-11.

## Related

- [Endpoints Reference](./endpoints.md) — the `defineEndpoint`
  primitive that every sub-client method delegates to.
- [Client Reference](./client.md) — `GraphClient` construction and
  `request` semantics.
- [Errors Reference](./errors.md) — the F-5 error registry that
  consumer `instanceof` narrowing rides on.
- endpoint registry architecture: Endpoint registry & error taxonomy — rationale for scoped sub-clients.
