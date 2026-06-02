# Webhook Normalizer

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo,
  typed-updates, f-8]
- package: `@wats/core`
- subpath: `@wats/core/webhookNormalizer`
- source: `packages/core/src/webhookNormalizer.ts`
- tests: `packages/core/tests/webhookNormalizer.test.ts`
- spec: architecture notes (Typed Updates and Handler Model); F-8 in the
  `foundations-pivot_part2` plan
- closes: WATS-2, WATS-6, WATS-7, WATS-12, WATS-14, WATS-16

## Overview

`normalizeWebhookEnvelope(envelope, options?)` is the typed-update
normalizer that sits above the C2 update parser. It consumes a
loose (already-JSON-parsed) Meta webhook envelope and emits a flat
array of `TypedUpdate` discriminated-union values, paired with a
`skipped[]` accumulator and a `limitError?` surface.

It is the layer that translates Meta's snake_case wire envelope into
WATS-native typed objects with stable `updateId`, `wabaId`,
`phoneNumberId`, and `receivedAt` fields — the exact surface handler
registrations and listeners consume downstream.

Contract at a glance:

- **Does not throw** for entry / change / field malformations. Every
  such failure lands in `skipped[]` with a reason code and a dotted
  `path` pointer. Envelope-level failures (shape violations above the
  entry array) throw `WebhookNormalizationError`.
- **Soft-truncates** at `maxEventsPerEnvelope` (default 1000). Excess
  updates do not crash the caller; the overflow count is reported via
  `limitError`.
- **Dedups** within a single envelope on `(kind, updateId)`. First
  wins, duplicates go to `skipped[]` with reason
  `duplicate_update_id`.
- **Rejects control characters on id-bearing fields**: all
  control codepoints < 0x20 (NUL, TAB, CR, LF, …), 0x7F (DEL), and
  U+2028 / U+2029 (line / paragraph separators) are rejected on
  `entry.id`, `metadata.phone_number_id`, `messages[].id`,
  `statuses[].id` (WATS-12 L6 / WATS-29 remediation). Whitespace-only
  strings are also rejected as non-meaningful ids.
- **Preserves payload fidelity**: content fields like `text.body`
  keep wire bytes verbatim; sanitization of user content is *not*
  this module's responsibility. The original wire change is always
  attached on the typed update as `rawChange` for advanced
  consumers.

## TypedUpdate catalog

`TypedUpdate` is a discriminated union keyed by `kind`:

- `TypedMessageUpdate` — `kind: "message"`. Carries the normalized
  message plus `phoneNumberId` / `wabaId` / `updateId` (= message
  id) / `receivedAt` (ms; derived from `message.timestamp` when
  present, else `clockNow()`).
- `TypedStatusUpdate` — `kind: "status"`. Same scope fields; WATS-89 normalizes `recipient_id` to `recipientId`, accepts `played`, and documents that `conversation is optional` because v24+ omits `status.conversation` by default outside special conversation windows.
- `TypedAccountUpdate` — `kind: "account"`. Produced by
  account-scoped webhook fields: `account_update`,
  `account_review_update`, `account_alerts`,
  `message_template_status_update`,
  `message_template_quality_update`,
  `message_template_components_update`,
  `phone_number_quality_update`, `phone_number_name_update`,
  `business_status_update`, `business_capability_update`,
  `security`, `template_category_update`, `account_offboarded`,
  `account_reconnected`. `wabaId` only; no
  `phoneNumberId` (most account updates are WABA-scoped). WATS-39 adds
  an optional `template` helper object on template status/quality/category/components
  account updates when the payload includes safe `message_template_id`,
  `message_template_name`, and `message_template_language` strings. WATS-89 also adds
  `account.event` and Coexistence `account.disconnectionInfo` for `PARTNER_REMOVED`,
  plus typed `account_offboarded` and `account_reconnected` account updates. WATS-95
  adds `account.phoneNumberQuality` for `phone_number_quality_update` events such as
  `THROUGHPUT_UPGRADE` and `TIER_UNLIMITED`, and `account.alert` for `account_alerts`
  values such as `PROFILE_PICTURE_LOST`. WATS-98 keeps current Marketing Messages
  status webhooks visible through `pricing.category = "marketing_lite"` and
  `conversation.origin.type = "marketing_lite"`, and promotes `account_update`
  onboarding fields into `account.marketingMessages` for events such as
  `MM_LITE_TERMS_SIGNED`.
- `TypedGroupLifecycleUpdate` — `kind: "groupLifecycle"`. Produced by
  `group_lifecycle_update`; normalizes `group_create` success/failure
  and `group_delete` outcomes into `group.groupId`, `requestId`,
  `inviteLink`, `joinApprovalMode`, and `errors`.
- `TypedGroupParticipantsUpdate` — `kind: "groupParticipants"`. Produced by
  `group_participants_update`; normalizes `added_participants`,
  `removed_participants`, `failed_participants`, `join_request_id`,
  `wa_id`, and `initiated_by` into camelCase group payload fields.
- `TypedGroupSettingsUpdate` — `kind: "groupSettings"`. Produced by
  `group_settings_update`; normalizes `profile_picture`,
  `group_subject`, and `group_description` update outcomes, including
  `updateSuccessful` and `errors`.
- `TypedGroupStatusUpdate` — `kind: "groupStatus"`. Produced by
  `group_status_update`; carries `group_suspend` and
  `group_suspend_cleared` moderation lifecycle events.
- `TypedUnknownUpdate` — `kind: "unknown"`. Catch-all for webhook
  field names Meta has not yet published a typed shape for.
  Preserves `field` + `rawChange` so the consumer can inspect.

All variants carry `rawChange` (the wire `WhatsAppWebhookChange`).

### Narrowing recipe

```ts
import { normalizeWebhookEnvelope, type TypedUpdate } from "@wats/core";

const { updates, skipped, limitError } = normalizeWebhookEnvelope(req.body);

for (const u of updates) {
  switch (u.kind) {
    case "message":
      // u is TypedMessageUpdate — u.message is typed WhatsAppMessage.
      console.log("msg", u.updateId, u.phoneNumberId, u.message);
      break;
    case "status":
      // u is TypedStatusUpdate — u.status is typed WhatsAppMessageStatus.
      console.log("status", u.updateId, u.status.status);
      break;
    case "account":
      console.log("account", u.eventName, u.payload);
      break;
    case "groupLifecycle":
    case "groupParticipants":
    case "groupSettings":
    case "groupStatus":
      console.log("group", u.kind, u.group.groupId);
      break;
    case "unknown":
      console.log("unknown field", u.field);
      break;
  }
}
```


## WATS-89 v24/v25 webhook deltas

WATS-89 updates the normalizer for recent WhatsApp Cloud API webhook changes:

- `WhatsAppMessageStatusKind` includes `played`, used for voice-message playback receipts.
- `status.conversation` remains optional; in v24+ `conversation is optional` and is absent by default except when Meta includes a conversation object for special conversation windows.
- Media references include `media.url` when incoming media webhook payloads carry a Meta lookaside download URL.
- Unsupported messages carry `unsupported.type`, `unsupported.title`, `unsupported.description`, and `unsupported.raw`, so removed/unsupported shapes such as `request_welcome` are preserved without pretending WATS supports them.
- Account/coexistence updates include `account.event`, `account.disconnectionInfo` for `PARTNER_REMOVED`, and typed `account_offboarded` / `account_reconnected` account update classification.

All of these remain credential-free synthetic-envelope checks in CI; live Meta validation stays in the credential-gated campaign.

## WATS-135 Groups webhook normalization

WATS-135 adds credential-free normalization for the official Groups webhook fields. Meta sends each group field entry under `value.groups[]`; WATS emits one typed update per group item:

- `group_lifecycle_update`: `group_create` (success or `errors[]`) and `group_delete`; successful creates surface `groupId`, `subject`, `inviteLink`, `joinApprovalMode`, and `requestId`.
- `group_participants_update`: `group_participants_add`, `group_join_request_created`, `group_join_request_revoked`, and `group_participants_remove`; participant arrays are camelCased (`waId`, `addedParticipants`, `removedParticipants`, `failedParticipants`, `initiatedBy`).
- `group_settings_update`: `profilePicture`, `groupSubject`, and `groupDescription` update outcomes, including `updateSuccessful` and `errors`.
- `group_status_update`: `group_suspend` and `group_suspend_cleared`.
- Group inbound `messages` carry `message.groupId`. Group status webhooks carry `status.recipientType === "group"` and `status.recipientParticipantId` when Meta includes `recipient_participant_id`.

Unknown future group fields still become `TypedUnknownUpdate`. Missing or unsafe `metadata.phone_number_id` / `group_id` values are reported through `skipped[]`; they do not throw.

## Input contract

```ts
normalizeWebhookEnvelope(
  envelope: unknown,
  options?: NormalizeWebhookOptions
): NormalizedWebhookResult
```

```ts
interface NormalizeWebhookOptions {
  readonly maxEventsPerEnvelope?: number; // default 1000
  readonly clockNow?: () => number;        // default Date.now
}

interface NormalizedWebhookResult {
  readonly updates: readonly TypedUpdate[];
  readonly skipped: readonly SkippedUpdate[];
  readonly limitError?: LimitExceededDetail;
}
```

- `envelope` — the HTTP JSON body already parsed by the consumer (or
  by whatever framework sits in front of `@wats/http`). Must be a
  plain object with the canonical Meta shape. Bad shapes throw.
- `maxEventsPerEnvelope` — positive finite integer cap. Invalid
  values (NaN / Infinity / 0 / negative / non-integer) throw
  `WebhookNormalizationError` with code `invalid_option`. This
  validation runs FIRST, before any envelope shape check, so caller
  misuse cannot be silently swallowed (WATS-29 remediation).
  `undefined` falls back to `DEFAULT_MAX_EVENTS_PER_ENVELOPE`
  (exported, currently `1000`).
- `clockNow` — test seam. Used only when an inner update lacks a
  usable `timestamp`.

### Options validation (WATS-29)

Invalid `maxEventsPerEnvelope` values now throw explicitly:

```ts
normalizeWebhookEnvelope(envelope, { maxEventsPerEnvelope: 0 });
// throws WebhookNormalizationError { code: "invalid_option" }
```

This replaces the previous "silently fall back to the default"
behavior. Caller misuse surfaces at the top of the call.

## Envelope-level error taxonomy

`WebhookNormalizationError` extends `Error` and carries a
machine-readable `.code` + optional `.path`.

| Condition | `code` |
| --- | --- |
| Envelope is not a plain object (null, undefined, array, primitive) | `invalid_envelope` |
| Envelope is missing the `object` string field | `missing_object_field` |
| Envelope `object` is not `"whatsapp_business_account"` | `unsupported_object` |
| Envelope `entry` is not an array (null / string / object) | `invalid_entry_array` |
| `options.maxEventsPerEnvelope` is not a positive finite integer (0, negative, NaN, Infinity, non-integer) | `invalid_option` |

These are the ONLY cases that throw. Everything else lands in
`skipped[]`.

## `skipped[]` reason taxonomy

| Reason | Emitted when |
| --- | --- |
| `malformed_entry` | Entry slot is null / non-object / missing `id` / has non-array `changes`, OR `entry.id` fails the id-safety gate (control chars, DEL, U+2028/U+2029, whitespace-only, or length > `MAX_ID_LENGTH`). |
| `malformed_change` | Change slot is null / non-object / missing/empty `field` / non-string `field` / has non-object `value`. |
| `malformed_field` | A field-level problem inside a valid change: e.g. a `messages[i]` object missing `id`, a `statuses[i]` object whose id fails the id-safety gate, a `metadata.phone_number_id` that is missing or fails the id-safety gate (WATS-12 L6 / WATS-29 defense — rejects all control chars < 0x20, 0x7F, U+2028/U+2029, whitespace-only, or length > `MAX_ID_LENGTH`). |
| `duplicate_update_id` | A second update with the same `(kind, updateId)` was seen in the same envelope. First wins. (WATS-14 L8). |
| `unsupported_field` | Reserved. Not currently emitted — unknown fields become `TypedUnknownUpdate` rather than skips. |

Every `SkippedUpdate` carries a `path` (dotted indexed path such as
`entry[0].changes[2].value.messages[1]`) and an optional short
`detail` describing the sub-condition.

## Soft-truncate: `maxEventsPerEnvelope` / `limitError`

The default limit is `DEFAULT_MAX_EVENTS_PER_ENVELOPE = 1000`.

- `updates.length === 0` through `limit` → `limitError` is
  `undefined`.
- When the normalizer would produce a `(limit + 1)`th update, it
  stops pushing to `updates`, counts remaining would-be updates in
  `limitError.count`, and sets `limitError.limit`. This is the
  soft-truncate semantics called out in WATS-2 / WATS-7 (M-6): the
  normalizer NEVER throws on size, never drops existing work, and
  always surfaces the overflow count so the caller can report /
  bisect.

```ts
const result = normalizeWebhookEnvelope(envelope, { maxEventsPerEnvelope: 100 });
if (result.limitError) {
  logger.warn("webhook envelope exceeded limit", {
    count: result.limitError.count, // total would-be updates
    limit: result.limitError.limit  // 100
  });
}
```

## Control-character defense on id-bearing fields (WATS-12 L6 / WATS-29)

Id-bearing fields flow into downstream URL path segments, headers,
and log lines. The normalizer enforces a byte-level safety check on:

- `entry.id` (-> TypedUpdate.wabaId)
- `metadata.phone_number_id` (-> TypedMessageUpdate.phoneNumberId /
  TypedStatusUpdate.phoneNumberId)
- `messages[].id` (-> TypedMessageUpdate.updateId)
- `statuses[].id` (-> TypedStatusUpdate.updateId)

All control characters < 0x20 (including CR / LF / NUL / TAB — the
classic CRLF / NUL injection bytes — written as `\r`, `\n`,
`\u0000`, `\t`), plus 0x7F (DEL) and U+2028 / U+2029 (line /
paragraph separators) are rejected. Whitespace-only strings are
rejected as non-meaningful ids. Any violation → the offending
record is skipped with reason `malformed_entry` (for `entry.id`)
or `malformed_field` (for the rest). The skip path points at the
exact location.

Content fields (for example `text.body`) intentionally preserve
these bytes; content sanitization is out of scope for F-8.

### Maximum ID length

All four id-bearing fields are capped at `MAX_ID_LENGTH = 256`
characters. Inputs exceeding the cap are skipped with the same
reason codes as other invalid ids. The cap is exported as
`MAX_ID_LENGTH` for consumer inspection.

### Timestamp sanity cap

`receivedAt` parsing rejects values whose computed unix-ms result
exceeds the end of year 9999 (`253_402_300_799_999`). Absurd
timestamps like `"9999999999999999999"` — which would otherwise
multiply to ~1e22 — fall back to `clockNow()` instead of
propagating. Negative and zero timestamps also fall back.

## Within-envelope duplicate-id dedup (WATS-14 L8)

Dedup key: `(kind, updateId)` — a message and a status that happen
to share an id are both kept (the kinds are different). A second
message with the same `updateId` as a prior message in the same
envelope is dropped with reason `duplicate_update_id`.

The normalizer has no persistent state. Cross-envelope dedup is the
**caller's responsibility** — typically a short-lived Redis SETNX or
in-memory LRU keyed by `updateId`. F-8 intentionally does not
couple normalization to a dedup store.

## receivedAt semantics

- For message / status updates: parsed from the inner
  `timestamp` string (Meta encodes unix seconds as a decimal
  string). Multiplied by 1000 to produce unix milliseconds.
- If the inner timestamp is missing or malformed, the normalizer
  falls back to the injected `clockNow()` (default `Date.now`).
- For account / unknown updates: derived from `entry.time` (unix
  seconds) if present, else `clockNow()`.

`receivedAt` is therefore deterministic for well-formed payloads and
test-seam-friendly for payloads that omit a timestamp.

## WATS-43A deep message normalization

WATS-43A promotes the most common inbound message body families from Meta's
wire snake_case into WATS camelCase public fields while keeping the top-level
update kind as `"message"`:

| Wire family | Normalized public shape |
| --- | --- |
| `image` / `video` / `audio` / `document` / `sticker` | media references expose `mimeType`, `sha256`, optional `caption` / `filename`, plus safe ids. |
| `interactive.button_reply` | `interactive: { type: "button_reply", buttonReply: { id, title } }` |
| `interactive.list_reply` | `interactive: { type: "list_reply", listReply: { id, title, description? } }` |
| `interactive.nfm_reply` | `interactive: { type: "nfm_reply", nfmReply: { responseJson?, body?, name? } }` |
| `location` | `location: { latitude, longitude, name?, address? }` |
| `reaction.message_id` | `reaction: { messageId, emoji }` |
| `button` quick replies | `button: { text, payload? }` |
| `context` | `context: { messageId, from?, forwarded?, frequentlyForwarded?, referredProduct? }` |

The normalizer reads these fields descriptor-safely. Accessor-backed nested
properties, sparse/accessor array slots, cycles, unsafe prototype keys
(`__proto__`, `constructor`, `prototype`), custom prototypes, and `toJSON`
hooks are treated as malformed data: the affected nested helper is omitted or
the record is skipped according to the existing `skipped[]` taxonomy. Host
`TypeError` / getter-thrown errors should not escape expected malformed payloads.

## rawChange passthrough

Every `TypedUpdate` carries `rawChange: WhatsAppWebhookChange` — the
original webhook change object untouched. This is the authoritative
wire snapshot for:

- audit logging (preserve exact bytes Meta sent)
- advanced consumers that need fields the typed surface has not
  promoted yet
- round-trip fidelity (store + replay)

WATS filters inspect normalized public fields, not `rawChange`.

## Scope ledger / non-goals

The normalizer still does NOT:

- Deep-normalize `status` and arbitrary `account` payload internals beyond the
  existing template helpers; WATS-43A is message-body focused.
- Register handlers — F-10.
- Provide Graph API calls — no `@wats/graph` coupling.
- Persist dedup state — caller's responsibility.
- Modify the existing C2 `parseWebhookUpdate` — normalizer is an
  independent producer above it.
- Verify webhook signatures — that is `@wats/http`'s job.
- Talk to live Meta endpoints or require credentials.

## Exported surface

From `@wats/core` (and mirrored at `@wats/core/webhookNormalizer`):

- `normalizeWebhookEnvelope`
- `WebhookNormalizationError` (class; extends `Error`)
- `DEFAULT_MAX_EVENTS_PER_ENVELOPE` (number constant)
- `MAX_ID_LENGTH` (number constant; currently `256`)
- Types: `TypedUpdate`, `TypedUpdateKind`, `TypedMessageUpdate`,
  `TypedStatusUpdate`, `TypedAccountUpdate`, `TypedUnknownUpdate`,
  `SkippedUpdate`, `SkippedReason`, `LimitExceededDetail`,
  `NormalizeWebhookOptions`, `NormalizedWebhookResult`,
  `WebhookNormalizationErrorCode`

## End-to-end usage sample

```ts
import {
  normalizeWebhookEnvelope,
  WebhookNormalizationError,
  DEFAULT_MAX_EVENTS_PER_ENVELOPE,
  type TypedUpdate
} from "@wats/core";

async function handleWebhook(rawBody: string) {
  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return { status: 400 };
  }

  let result;
  try {
    result = normalizeWebhookEnvelope(envelope, {
      maxEventsPerEnvelope: DEFAULT_MAX_EVENTS_PER_ENVELOPE
    });
  } catch (err) {
    if (err instanceof WebhookNormalizationError) {
      // err.code ∈ { invalid_envelope, missing_object_field,
      //              unsupported_object, invalid_entry_array,
      //              invalid_option }
      return { status: 400, error: err.code };
    }
    throw err;
  }

  if (result.limitError) {
    logger.warn("envelope soft-truncated", result.limitError);
  }
  for (const skip of result.skipped) {
    logger.debug("skipped update", skip);
  }

  for (const update of result.updates as readonly TypedUpdate[]) {
    await dispatch(update);
  }

  return { status: 200 };
}
```

## Related

- architecture notes — Typed Updates and Handler Model (specification).
- `docs/reference/webhook.md` — low-level envelope parser (C2).
- `docs/reference/types.md` — the F-1 discriminated-union domain
  types that flow through `TypedUpdate.message` /
  `TypedUpdate.status`.
