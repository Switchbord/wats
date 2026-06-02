// @wats/core — webhookNormalizer.ts (F-8 GREEN)
//
// Typed-update normalizer above the C2 parser. Takes a loose webhook
// envelope (JSON already parsed) and emits a TypedUpdate discriminated
// union with accumulated skipped[] accounting and soft-truncate limit
// reporting.
//
// Guarantees:
//   - Envelope-level shape failures (not-object, missing/wrong
//     object discriminator, non-array entry) throw
//     WebhookNormalizationError. Nothing else throws.
//   - Entry / change / field-level malformations are accumulated in
//     NormalizedWebhookResult.skipped[] with a taxonomy of reason
//     codes and a dotted `path` pointer — never swallowed silently.
//   - maxEventsPerEnvelope (default 1000) soft-truncates the emitted
//     updates[] and reports overflow via limitError. (WATS-2 / WATS-7)
//   - Within-envelope update-id dedup keyed by (kind, updateId):
//     first wins, duplicates land in skipped[] with
//     `duplicate_update_id`. (WATS-14 L8)
//   - CR / LF / NUL bytes rejected on id-bearing fields: entry.id,
//     message.id, status.id, metadata.phone_number_id (WATS-12 L6).
//     Content fields (e.g. text.body) preserve payload bytes
//     verbatim; sanitization of user content is explicitly not this
//     module's responsibility.
//
// Non-goals / scope ledger:
//   - No cross-envelope dedup persistence (caller responsibility).
//   - No handler registration / routing (F-10).
//   - No filter types (F-9).
//   - No modification of @wats/core/updateParser (the C2 parser).
//     The normalizer consumes raw envelope JSON directly and is
//     independent of the parser; the parser remains available for
//     lower-level observability use-cases.
//   - WATS-43A normalizes common inbound message body families
//     (media, interactive replies, location, reaction, quick-reply
//     button, and context) into camelCase public shapes while
//     preserving `rawChange` as the authoritative wire snapshot.
//     Deeper status/account normalization remains incremental.

import type {
  WhatsAppGroupLifecycleUpdateValue,
  WhatsAppGroupParticipantsUpdateValue,
  WhatsAppGroupSettingsUpdateValue,
  WhatsAppGroupStatusUpdateValue,
  WhatsAppMessage,
  WhatsAppMessageStatus,
  WhatsAppWebhookChange
} from "@wats/types";

export type CallEvent = "connect" | "terminate";
export type CallDirection = "USER_INITIATED" | "BUSINESS_INITIATED";
export type CallStatusType = "RINGING" | "ACCEPTED" | "REJECTED";

export type TypedUpdateKind =
  | "message"
  | "status"
  | "account"
  | "unknown"
  | "callConnect"
  | "callTerminate"
  | "callStatus"
  | "groupLifecycle"
  | "groupParticipants"
  | "groupSettings"
  | "groupStatus";

export type GroupMessage = WhatsAppMessage & { readonly groupId?: string };
export type GroupMessageStatus = WhatsAppMessageStatus & {
  readonly recipientType?: string;
  readonly recipientParticipantId?: string;
};

export interface TypedMessageUpdate {
  readonly kind: "message";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly message: GroupMessage;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedStatusUpdate {
  readonly kind: "status";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly status: GroupMessageStatus;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface NormalizedCallPayload {
  readonly id: string;
  readonly event: CallEvent;
  readonly from?: string;
  readonly to?: string;
  readonly direction?: CallDirection;
  readonly timestamp?: string;
  readonly session?: unknown;
  readonly raw: Record<string, unknown>;
}

export interface NormalizedCallStatusPayload {
  readonly id: string;
  readonly status: CallStatusType;
  readonly recipientId?: string;
  readonly timestamp?: string;
  readonly raw: Record<string, unknown>;
}

export interface TypedCallUpdate {
  readonly kind: "callConnect" | "callTerminate";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly call: NormalizedCallPayload;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedCallStatusUpdate {
  readonly kind: "callStatus";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly callStatus: NormalizedCallStatusPayload;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedAccountUpdate {
  readonly kind: "account";
  readonly updateId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly eventName: string;
  readonly template?: TypedTemplateAccountUpdate;
  readonly account?: TypedGenericAccountUpdate;
  readonly payload: unknown;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedGenericAccountUpdate {
  readonly event?: string;
  readonly disconnectionInfo?: {
    readonly reason?: string;
    readonly partnerId?: string;
    readonly partnerName?: string;
    readonly raw?: unknown;
  };
  readonly phoneNumberQuality?: {
    readonly displayPhoneNumber?: string;
    readonly oldLimit?: string;
    readonly currentLimit?: string;
    readonly maxDailyConversationsPerBusiness?: string;
    readonly raw?: unknown;
  };
  readonly alert?: {
    readonly entityType?: string;
    readonly entityId?: string;
    readonly severity?: string;
    readonly status?: string;
    readonly type?: string;
    readonly description?: string;
    readonly raw?: unknown;
  };
  readonly marketingMessages?: {
    readonly wabaId?: string;
    readonly ownerBusinessId?: string;
    readonly onboardingStatus?: string;
    readonly liteApiStatus?: string;
    readonly raw?: unknown;
  };
}

export interface TypedTemplateAccountUpdate {
  readonly eventName: string;
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly event?: string;
  readonly reason?: string;
  readonly qualityScore?: string;
  readonly previousQualityScore?: string;
  readonly category?: string;
  readonly previousCategory?: string;
  readonly components?: readonly unknown[];
}

export interface TypedUnknownUpdate {
  readonly kind: "unknown";
  readonly updateId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly field: string;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedGroupLifecycleUpdate {
  readonly kind: "groupLifecycle";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly group: WhatsAppGroupLifecycleUpdateValue;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedGroupParticipantsUpdate {
  readonly kind: "groupParticipants";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly group: WhatsAppGroupParticipantsUpdateValue;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedGroupSettingsUpdate {
  readonly kind: "groupSettings";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly group: WhatsAppGroupSettingsUpdateValue;
  readonly rawChange: WhatsAppWebhookChange;
}

export interface TypedGroupStatusUpdate {
  readonly kind: "groupStatus";
  readonly updateId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly receivedAt: number;
  readonly group: WhatsAppGroupStatusUpdateValue;
  readonly rawChange: WhatsAppWebhookChange;
}

export type TypedGroupUpdate =
  | TypedGroupLifecycleUpdate
  | TypedGroupParticipantsUpdate
  | TypedGroupSettingsUpdate
  | TypedGroupStatusUpdate;

export type TypedUpdate =
  | TypedMessageUpdate
  | TypedStatusUpdate
  | TypedCallUpdate
  | TypedCallStatusUpdate
  | TypedAccountUpdate
  | TypedUnknownUpdate
  | TypedGroupUpdate;

export type SkippedReason =
  | "malformed_entry"
  | "malformed_change"
  | "malformed_field"
  | "duplicate_update_id"
  | "unsupported_field";

export interface SkippedUpdate {
  readonly reason: SkippedReason;
  readonly path: string;
  readonly detail?: string;
}

export interface LimitExceededDetail {
  readonly count: number;
  readonly limit: number;
}

export interface NormalizeWebhookOptions {
  readonly maxEventsPerEnvelope?: number;
  readonly clockNow?: () => number;
}

export interface NormalizedWebhookResult {
  readonly updates: readonly TypedUpdate[];
  readonly skipped: readonly SkippedUpdate[];
  readonly limitError?: LimitExceededDetail;
}

export type WebhookNormalizationErrorCode =
  | "invalid_envelope"
  | "missing_object_field"
  | "unsupported_object"
  | "invalid_entry_array"
  | "invalid_option";

export const DEFAULT_MAX_EVENTS_PER_ENVELOPE = 1000;

/**
 * Maximum byte-length allowed for id-bearing strings (entry.id,
 * metadata.phone_number_id, messages[].id, statuses[].id). Chosen
 * to exceed any realistic Meta wire identifier while rejecting
 * pathological / adversarial oversized inputs before they flow into
 * downstream URL / header construction. WATS-29 remediation.
 */
export const MAX_ID_LENGTH = 256;

/**
 * Upper sanity bound for parsed timestamps in unix milliseconds.
 * Chosen as the end of year 9999 so well-formed Meta timestamps
 * remain accepted while pathological numeric strings (e.g.
 * '9999999999999999999' multiplied by 1000) fall through to the
 * clockNow fallback. WATS-29 remediation.
 */
const SANITY_MAX_TS_MS = 253_402_300_799_999;

const SUPPORTED_OBJECT = "whatsapp_business_account";

/**
 * Field names classified as `account`-kind updates. Any other
 * non-`messages` field falls through to `unknown`.
 */
const ACCOUNT_FIELDS: ReadonlySet<string> = new Set([
  "account_update",
  "account_review_update",
  "account_alerts",
  "message_template_status_update",
  "message_template_quality_update",
  "message_template_components_update",
  "phone_number_quality_update",
  "phone_number_name_update",
  "business_status_update",
  "business_capability_update",
  "security",
  "template_category_update",
  "account_offboarded",
  "account_reconnected"
]);

export class WebhookNormalizationError extends Error {
  readonly code: WebhookNormalizationErrorCode;
  readonly path?: string;
  constructor(opts: {
    code: WebhookNormalizationErrorCode;
    path?: string;
    message?: string;
  }) {
    super(opts.message ?? defaultMessageForCode(opts.code));
    this.name = "WebhookNormalizationError";
    this.code = opts.code;
    if (opts.path !== undefined) {
      this.path = opts.path;
    }
  }
}

function defaultMessageForCode(code: WebhookNormalizationErrorCode): string {
  switch (code) {
    case "invalid_envelope":
      return "Webhook envelope is not an object.";
    case "missing_object_field":
      return "Webhook envelope is missing the `object` field.";
    case "unsupported_object":
      return `Webhook envelope \`object\` is not \"${SUPPORTED_OBJECT}\".`;
    case "invalid_entry_array":
      return "Webhook envelope `entry` must be an array.";
    case "invalid_option":
      return "Webhook normalizer option is invalid.";
  }
}

// ---------- low-level helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns true when `value` is a bounded, non-empty, non-whitespace
 * string free of control characters. Used to gate id-bearing fields
 * before they are surfaced on a TypedUpdate. WATS-12 L6 + WATS-29
 * defense: id-bearing values must be byte-safe for downstream URL /
 * header construction.
 *
 * Rejects:
 *   - non-string / empty / whitespace-only
 *   - length > MAX_ID_LENGTH
 *   - any code unit < 0x20 (all ASCII controls incl. NUL/TAB/CR/LF)
 *   - 0x7F (DEL)
 *   - 0x2028 (LINE SEPARATOR) / 0x2029 (PARAGRAPH SEPARATOR)
 */
function isSafeIdString(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.length > MAX_ID_LENGTH) {
    return false;
  }
  if (value.trim().length === 0) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20) {
      return false;
    }
    if (code === 0x7f) {
      return false;
    }
    if (code === 0x2028 || code === 0x2029) {
      return false;
    }
  }
  return true;
}

function validateMaxEventsOption(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_EVENTS_PER_ENVELOPE;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new WebhookNormalizationError({
      code: "invalid_option",
      path: "options.maxEventsPerEnvelope",
      message:
        "options.maxEventsPerEnvelope must be a positive finite integer."
    });
  }
  return value;
}

function parseTimestampMs(
  value: unknown,
  clockNow: () => number
): number {
  if (typeof value === "string" && value.length > 0) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      const valueMs = Math.trunc(seconds * 1000);
      if (valueMs > 0 && valueMs <= SANITY_MAX_TS_MS) {
        return valueMs;
      }
    }
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const valueMs = Math.trunc(value * 1000);
    if (valueMs > 0 && valueMs <= SANITY_MAX_TS_MS) {
      return valueMs;
    }
  }
  return clockNow();
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asSafeTemplateString(value: unknown): string | undefined {
  return isSafeIdString(value) ? value : undefined;
}

function readSafeTemplateString(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(payload, key);
  if (descriptor === undefined) return undefined;
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") return undefined;
  return asSafeTemplateString(descriptor.value);
}

function readRawTemplateField(
  payload: Record<string, unknown>,
  key: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(payload, key);
  if (descriptor === undefined) return undefined;
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") return undefined;
  return descriptor.value;
}

function readOwnDataField(
  payload: Record<string, unknown>,
  key: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(payload, key);
  if (descriptor === undefined) return undefined;
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") return undefined;
  return descriptor.value;
}

function readArrayDataItem(payload: readonly unknown[], index: number): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(payload, String(index));
  if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
    return { ok: false };
  }
  return { ok: true, value: descriptor.value };
}

function readSafeIdField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = readOwnDataField(payload, key);
  return isSafeIdString(value) ? value : undefined;
}

function readStringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = readOwnDataField(payload, key);
  return typeof value === "string" ? value : undefined;
}

function readNumberField(payload: Record<string, unknown>, key: string): number | undefined {
  const value = readOwnDataField(payload, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBooleanField(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = readOwnDataField(payload, key);
  return typeof value === "boolean" ? value : undefined;
}

function readMetadataPhoneNumberId(value: Record<string, unknown>): string | undefined {
  const metadata = readOwnDataField(value, "metadata");
  return isRecord(metadata) ? readSafeIdField(metadata, "phone_number_id") : undefined;
}

function isUnsafePrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function safeCloneMessageJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0
): unknown {
  if (depth > 6) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    if (value.length > 50) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) return undefined;
    seen.add(value);
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = descriptors[String(i)];
      if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        seen.delete(value);
        return undefined;
      }
      const cloned = safeCloneMessageJsonValue(descriptor.value, seen, depth + 1);
      if (cloned === undefined) {
        seen.delete(value);
        return undefined;
      }
      out.push(cloned);
    }
    seen.delete(value);
    return out;
  }
  if (!isRecord(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  if (seen.has(value)) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) return undefined;
  seen.add(value);
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (isUnsafePrototypeKey(key) || key.length === 0) continue;
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      seen.delete(value);
      return undefined;
    }
    const cloned = safeCloneMessageJsonValue(descriptor.value, seen, depth + 1);
    if (cloned !== undefined) out[key] = cloned;
  }
  seen.delete(value);
  return out;
}

function copyMessageBase(raw: Record<string, unknown>, type: string): Record<string, unknown> | undefined {
  const id = readSafeIdField(raw, "id");
  const from = readSafeIdField(raw, "from");
  const timestamp = readStringField(raw, "timestamp");
  if (id === undefined || from === undefined) return undefined;
  const out: Record<string, unknown> = { id, from, type, ...(timestamp !== undefined ? { timestamp } : {}) };
  const context = normalizeMessageContext(readOwnDataField(raw, "context"));
  if (context !== undefined) out.context = context;
  out.raw = raw;
  return out;
}

function normalizeMessageContext(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const messageId = readSafeIdField(value, "message_id") ?? readSafeIdField(value, "id");
  if (messageId === undefined) return undefined;
  const out: Record<string, unknown> = { messageId };
  const from = readSafeIdField(value, "from");
  if (from !== undefined) out.from = from;
  const forwarded = readBooleanField(value, "forwarded");
  if (forwarded !== undefined) out.forwarded = forwarded;
  const frequentlyForwarded = readBooleanField(value, "frequently_forwarded");
  if (frequentlyForwarded !== undefined) out.frequentlyForwarded = frequentlyForwarded;
  const referred = readOwnDataField(value, "referred_product");
  if (isRecord(referred)) {
    const catalogId = readStringField(referred, "catalog_id");
    const productRetailerId = readStringField(referred, "product_retailer_id");
    if (catalogId !== undefined && productRetailerId !== undefined) {
      out.referredProduct = { catalogId, productRetailerId };
    }
  }
  return out;
}

function normalizeMediaReference(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const id = readSafeIdField(value, "id");
  const mimeType = readStringField(value, "mime_type") ?? readStringField(value, "mimeType");
  if (id === undefined || mimeType === undefined) return undefined;
  const out: Record<string, unknown> = { id, mimeType };
  const sha256 = readStringField(value, "sha256");
  if (sha256 !== undefined) out.sha256 = sha256;
  const caption = readStringField(value, "caption");
  if (caption !== undefined) out.caption = caption;
  const filename = readStringField(value, "filename");
  if (filename !== undefined) out.filename = filename;
  const url = readStringField(value, "url");
  if (url !== undefined) out.url = url;
  const voice = readBooleanField(value, "voice");
  if (voice !== undefined) out.voice = voice;
  const animated = readBooleanField(value, "animated");
  if (animated !== undefined) out.animated = animated;
  return out;
}

function normalizeLocationPayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const latitude = readNumberField(value, "latitude");
  const longitude = readNumberField(value, "longitude");
  if (latitude === undefined || longitude === undefined) return undefined;
  const out: Record<string, unknown> = { latitude, longitude };
  const name = readStringField(value, "name");
  if (name !== undefined) out.name = name;
  const address = readStringField(value, "address");
  if (address !== undefined) out.address = address;
  return out;
}

function normalizeReactionPayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const messageId = readSafeIdField(value, "message_id") ?? readSafeIdField(value, "messageId");
  const emojiValue = readOwnDataField(value, "emoji");
  if (messageId === undefined || typeof emojiValue !== "string") return undefined;
  return { messageId, emoji: emojiValue };
}

function normalizeButtonPayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const text = readStringField(value, "text");
  if (text === undefined) return undefined;
  const out: Record<string, unknown> = { text };
  const payload = readStringField(value, "payload");
  if (payload !== undefined) out.payload = payload;
  return out;
}

function normalizeInteractivePayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const type = readStringField(value, "type");
  if (type === undefined) return undefined;
  if (type === "button_reply") {
    const button = readOwnDataField(value, "button_reply");
    if (!isRecord(button)) return undefined;
    const id = readStringField(button, "id");
    const title = readStringField(button, "title");
    if (id === undefined || title === undefined) return undefined;
    return { type, buttonReply: { id, title } };
  }
  if (type === "list_reply") {
    const list = readOwnDataField(value, "list_reply");
    if (!isRecord(list)) return undefined;
    const id = readStringField(list, "id");
    const title = readStringField(list, "title");
    if (id === undefined || title === undefined) return undefined;
    const out: Record<string, unknown> = { id, title };
    const description = readStringField(list, "description");
    if (description !== undefined) out.description = description;
    return { type, listReply: out };
  }
  if (type === "nfm_reply") {
    const nfm = readOwnDataField(value, "nfm_reply");
    if (!isRecord(nfm)) return undefined;
    const out: Record<string, unknown> = {};
    const responseJson = readStringField(nfm, "response_json") ?? readStringField(nfm, "responseJson");
    if (responseJson !== undefined) out.responseJson = responseJson;
    const body = readStringField(nfm, "body");
    if (body !== undefined) out.body = body;
    const name = readStringField(nfm, "name");
    if (name !== undefined) out.name = name;
    return { type, nfmReply: out };
  }
  if (type === "product_reply") {
    const product = readOwnDataField(value, "product_reply");
    if (!isRecord(product)) return undefined;
    const catalogId = readStringField(product, "catalog_id");
    const productRetailerId = readStringField(product, "product_retailer_id");
    if (catalogId === undefined || productRetailerId === undefined) return undefined;
    return { type, productReply: { catalogId, productRetailerId } };
  }
  if (type === "product_list_reply") {
    const productList = readOwnDataField(value, "product_list_reply");
    if (!isRecord(productList)) return undefined;
    const catalogId = readStringField(productList, "catalog_id");
    const productItemsRaw = readOwnDataField(productList, "product_items");
    if (catalogId === undefined || !Array.isArray(productItemsRaw)) return undefined;
    const productItems: Record<string, unknown>[] = [];
    for (let i = 0; i < productItemsRaw.length; i += 1) {
      const itemResult = readArrayDataItem(productItemsRaw, i);
      if (!itemResult.ok || !isRecord(itemResult.value)) return undefined;
      const productRetailerId = readStringField(itemResult.value, "product_retailer_id");
      if (productRetailerId === undefined) return undefined;
      productItems.push({ productRetailerId });
    }
    return { type, productListReply: { catalogId, productItems } };
  }
  if (type === "cta_url_reply") {
    const cta = readOwnDataField(value, "cta_url_reply");
    if (!isRecord(cta)) return undefined;
    const displayText = readStringField(cta, "display_text");
    const url = readStringField(cta, "url");
    if (displayText === undefined || url === undefined) return undefined;
    return { type, ctaUrlReply: { displayText, url } };
  }
  if (type === "call_permission_reply") {
    const reply = readOwnDataField(value, "call_permission_reply");
    if (!isRecord(reply)) return undefined;
    const response = readStringField(reply, "response");
    const expirationTimestamp = readStringField(reply, "expiration_timestamp");
    const out: Record<string, unknown> = {};
    if (response === "accepted" || response === "rejected") out.response = response;
    if (expirationTimestamp !== undefined) out.expirationTimestamp = expirationTimestamp;
    return { type, callPermissionReply: out };
  }
  return safeCloneMessageJsonValue(value) as Record<string, unknown> | undefined;
}

function normalizeMessagePayload(raw: Record<string, unknown>): GroupMessage | undefined {
  const type = readStringField(raw, "type");
  if (type === undefined) return undefined;
  const base = copyMessageBase(raw, type);
  if (base === undefined) return undefined;
  const groupId = readSafeIdField(raw, "group_id");
  if (groupId !== undefined) base.groupId = groupId;

  if (type === "text") {
    const text = safeCloneMessageJsonValue(readOwnDataField(raw, "text"));
    if (text !== undefined) base.text = text;
    return base as unknown as WhatsAppMessage;
  }
  if (type === "image" || type === "video" || type === "audio" || type === "document" || type === "sticker") {
    const media = normalizeMediaReference(readOwnDataField(raw, type));
    if (media !== undefined) base[type] = media;
    return base as unknown as WhatsAppMessage;
  }
  if (type === "interactive") {
    const interactive = normalizeInteractivePayload(readOwnDataField(raw, "interactive"));
    if (interactive !== undefined) base.interactive = interactive;
    return base as unknown as WhatsAppMessage;
  }
  if (type === "location") {
    const location = normalizeLocationPayload(readOwnDataField(raw, "location"));
    if (location !== undefined) base.location = location;
    return base as unknown as WhatsAppMessage;
  }
  if (type === "reaction") {
    const reaction = normalizeReactionPayload(readOwnDataField(raw, "reaction"));
    if (reaction !== undefined) base.reaction = reaction;
    return base as unknown as WhatsAppMessage;
  }
  if (type === "button") {
    const button = normalizeButtonPayload(readOwnDataField(raw, "button"));
    if (button !== undefined) base.button = button;
    return base as unknown as WhatsAppMessage;
  }
  if (type === "unsupported") {
    const unsupported = readOwnDataField(raw, "unsupported");
    if (isRecord(unsupported)) {
      const out: Record<string, unknown> = {};
      const unsupportedType = readStringField(unsupported, "type");
      const title = readStringField(unsupported, "title");
      const description = readStringField(unsupported, "description");
      if (unsupportedType !== undefined) out.type = unsupportedType;
      if (title !== undefined) out.title = title;
      if (description !== undefined) out.description = description;
      out.raw = unsupported;
      base.unsupported = out;
    }
    const errors = safeCloneMessageJsonValue(readOwnDataField(raw, "errors"));
    if (Array.isArray(errors)) base.errors = errors;
    return base as unknown as WhatsAppMessage;
  }
  const cloned = safeCloneMessageJsonValue(raw);
  return isRecord(cloned) ? (cloned as unknown as WhatsAppMessage) : (base as unknown as WhatsAppMessage);
}

function safeCloneTemplateComponents(value: unknown): readonly unknown[] | undefined {
  return safeCloneTemplateComponentsWithSeen(value, new WeakSet<object>(), 0);
}

function safeCloneTemplateComponentsWithSeen(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (seen.has(value)) return undefined;
  if (depth > 6) return undefined;
  if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  if (Object.prototype.hasOwnProperty.call(value, Symbol.iterator) || Object.prototype.hasOwnProperty.call(value, "map")) return undefined;
  if (value.length > 20) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) return undefined;
  seen.add(value);
  const out: unknown[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = descriptors[String(i)];
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      seen.delete(value);
      return undefined;
    }
    const cloned = safeCloneTemplateJsonValue(descriptor.value, depth + 1, seen);
    if (cloned === undefined) {
      seen.delete(value);
      return undefined;
    }
    out.push(cloned);
  }
  seen.delete(value);
  return out;
}

function safeCloneTemplateJsonValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > 6) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return isSafeIdString(value) ? value : undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return safeCloneTemplateComponentsWithSeen(value, seen, depth + 1);
  }
  if (!isRecord(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    seen.delete(value);
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key.length === 0 || !isSafeIdString(key)) {
      seen.delete(value);
      return undefined;
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      seen.delete(value);
      return undefined;
    }
    const cloned = safeCloneTemplateJsonValue(descriptor.value, depth + 1, seen);
    if (cloned !== undefined) out[key] = cloned;
  }
  seen.delete(value);
  return out;
}


function normalizeGenericAccountPayload(payload: Record<string, unknown>): TypedGenericAccountUpdate | undefined {
  const event = readStringField(payload, "event");
  const out: {
    event?: string;
    disconnectionInfo?: { reason?: string; partnerId?: string; partnerName?: string; raw?: unknown };
    phoneNumberQuality?: { displayPhoneNumber?: string; oldLimit?: string; currentLimit?: string; maxDailyConversationsPerBusiness?: string; raw?: unknown };
    alert?: { entityType?: string; entityId?: string; severity?: string; status?: string; type?: string; description?: string; raw?: unknown };
    marketingMessages?: { wabaId?: string; ownerBusinessId?: string; onboardingStatus?: string; liteApiStatus?: string; raw?: unknown };
  } = {};
  if (event !== undefined) out.event = event;
  const disconnection = readOwnDataField(payload, "disconnection_info");
  if (isRecord(disconnection)) {
    const info: { reason?: string; partnerId?: string; partnerName?: string; raw?: unknown } = { raw: disconnection };
    const reason = readStringField(disconnection, "reason");
    const partnerId = readStringField(disconnection, "partner_id");
    const partnerName = readStringField(disconnection, "partner_name");
    if (reason !== undefined) info.reason = reason;
    if (partnerId !== undefined) info.partnerId = partnerId;
    if (partnerName !== undefined) info.partnerName = partnerName;
    out.disconnectionInfo = info;
  }

  const phoneNumberQuality: { displayPhoneNumber?: string; oldLimit?: string; currentLimit?: string; maxDailyConversationsPerBusiness?: string; raw?: unknown } = { raw: payload };
  const displayPhoneNumber = readStringField(payload, "display_phone_number");
  const oldLimit = readStringField(payload, "old_limit");
  const currentLimit = readStringField(payload, "current_limit");
  const maxDaily = readStringField(payload, "max_daily_conversations_per_business");
  if (displayPhoneNumber !== undefined) phoneNumberQuality.displayPhoneNumber = displayPhoneNumber;
  if (oldLimit !== undefined) phoneNumberQuality.oldLimit = oldLimit;
  if (currentLimit !== undefined) phoneNumberQuality.currentLimit = currentLimit;
  if (maxDaily !== undefined) phoneNumberQuality.maxDailyConversationsPerBusiness = maxDaily;
  if (Object.keys(phoneNumberQuality).length > 1) out.phoneNumberQuality = phoneNumberQuality;

  const marketingMessages: { wabaId?: string; ownerBusinessId?: string; onboardingStatus?: string; liteApiStatus?: string; raw?: unknown } = { raw: payload };
  const wabaInfo = readOwnDataField(payload, "waba_info");
  if (isRecord(wabaInfo)) {
    const wabaId = readStringField(wabaInfo, "waba_id");
    const ownerBusinessId = readStringField(wabaInfo, "owner_business_id");
    if (wabaId !== undefined) marketingMessages.wabaId = wabaId;
    if (ownerBusinessId !== undefined) marketingMessages.ownerBusinessId = ownerBusinessId;
  }
  const onboardingStatus = readStringField(payload, "marketing_messages_onboarding_status");
  const liteApiStatus = readStringField(payload, "marketing_messages_lite_api_status");
  if (onboardingStatus !== undefined) marketingMessages.onboardingStatus = onboardingStatus;
  if (liteApiStatus !== undefined) marketingMessages.liteApiStatus = liteApiStatus;
  if (Object.keys(marketingMessages).length > 1) out.marketingMessages = marketingMessages;

  const entityType = readStringField(payload, "entity_type");
  const entityId = readStringField(payload, "entity_id");
  const alertInfo = readOwnDataField(payload, "alert_info");
  if (isRecord(alertInfo)) {
    const alert: { entityType?: string; entityId?: string; severity?: string; status?: string; type?: string; description?: string; raw?: unknown } = { raw: alertInfo };
    const severity = readStringField(alertInfo, "alert_severity");
    const status = readStringField(alertInfo, "alert_status");
    const type = readStringField(alertInfo, "alert_type");
    const description = readStringField(alertInfo, "alert_description");
    if (entityType !== undefined) alert.entityType = entityType;
    if (entityId !== undefined) alert.entityId = entityId;
    if (severity !== undefined) alert.severity = severity;
    if (status !== undefined) alert.status = status;
    if (type !== undefined) alert.type = type;
    if (description !== undefined) alert.description = description;
    if (Object.keys(alert).length > 1) out.alert = alert;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function safeCloneGroupJsonValue(value: unknown): unknown {
  return safeCloneMessageJsonValue(value);
}

function normalizeGroupParticipant(value: unknown): { waId: string } | undefined {
  if (!isRecord(value)) return undefined;
  const waId = readSafeIdField(value, "wa_id");
  return waId === undefined ? undefined : { waId };
}

function normalizeGroupParticipantsArray(value: unknown): { waId: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { waId: string }[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = readArrayDataItem(value, i);
    if (!item.ok) return undefined;
    const participant = normalizeGroupParticipant(item.value);
    if (participant === undefined) return undefined;
    out.push(participant);
  }
  return out;
}

function normalizeRemovedParticipants(value: unknown): { input?: string; waId?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { input?: string; waId?: string }[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = readArrayDataItem(value, i);
    if (!item.ok || !isRecord(item.value)) return undefined;
    const input = readStringField(item.value, "input");
    const waId = readSafeIdField(item.value, "wa_id");
    const row: { input?: string; waId?: string } = {};
    if (input !== undefined) row.input = input;
    if (waId !== undefined) row.waId = waId;
    out.push(row);
  }
  return out;
}

function normalizeFailedParticipants(value: unknown): { input?: string; waId?: string; errors?: unknown[] }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { input?: string; waId?: string; errors?: unknown[] }[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = readArrayDataItem(value, i);
    if (!item.ok || !isRecord(item.value)) return undefined;
    const input = readStringField(item.value, "input");
    const waId = readSafeIdField(item.value, "wa_id");
    const errors = safeCloneGroupJsonValue(readOwnDataField(item.value, "errors"));
    const row: { input?: string; waId?: string; errors?: unknown[] } = {};
    if (input !== undefined) row.input = input;
    if (waId !== undefined) row.waId = waId;
    if (Array.isArray(errors)) row.errors = errors;
    out.push(row);
  }
  return out;
}

function normalizeGroupErrors(value: unknown): unknown[] | undefined {
  const cloned = safeCloneGroupJsonValue(value);
  return Array.isArray(cloned) ? cloned : undefined;
}

function normalizeGroupLifecyclePayload(payload: Record<string, unknown>): WhatsAppGroupLifecycleUpdateValue {
  const out: Record<string, unknown> = {
    messagingProduct: "whatsapp",
    metadata: normalizeGroupMetadata(payload),
    type: readStringField(payload, "type") ?? ""
  };
  const requestId = readSafeIdField(payload, "request_id");
  const groupId = readSafeIdField(payload, "group_id");
  const subject = readStringField(payload, "subject");
  const inviteLink = readStringField(payload, "invite_link");
  const joinApprovalMode = readStringField(payload, "join_approval_mode");
  const errors = normalizeGroupErrors(readOwnDataField(payload, "errors"));
  if (requestId !== undefined) out.requestId = requestId;
  if (groupId !== undefined) out.groupId = groupId;
  if (subject !== undefined) out.subject = subject;
  if (inviteLink !== undefined) out.inviteLink = inviteLink;
  if (joinApprovalMode === "auto_approve" || joinApprovalMode === "approval_required") out.joinApprovalMode = joinApprovalMode;
  if (errors !== undefined) out.errors = errors;
  out.raw = payload;
  return out as unknown as WhatsAppGroupLifecycleUpdateValue;
}

function normalizeGroupParticipantsPayload(payload: Record<string, unknown>, groupId: string): WhatsAppGroupParticipantsUpdateValue {
  const out: Record<string, unknown> = {
    messagingProduct: "whatsapp",
    metadata: normalizeGroupMetadata(payload),
    groupId,
    type: readStringField(payload, "type") ?? ""
  };
  const reason = readStringField(payload, "reason");
  const initiatedBy = readSafeIdField(payload, "initiated_by");
  const requestId = readSafeIdField(payload, "request_id");
  const joinRequestId = readSafeIdField(payload, "join_request_id");
  const waId = readSafeIdField(payload, "wa_id");
  const addedParticipants = normalizeGroupParticipantsArray(readOwnDataField(payload, "added_participants"));
  const removedParticipants = normalizeRemovedParticipants(readOwnDataField(payload, "removed_participants"));
  const failedParticipants = normalizeFailedParticipants(readOwnDataField(payload, "failed_participants"));
  const errors = normalizeGroupErrors(readOwnDataField(payload, "errors"));
  if (reason !== undefined) out.reason = reason;
  if (initiatedBy !== undefined) out.initiatedBy = initiatedBy;
  if (requestId !== undefined) out.requestId = requestId;
  if (joinRequestId !== undefined) out.joinRequestId = joinRequestId;
  if (waId !== undefined) out.waId = waId;
  if (addedParticipants !== undefined) out.addedParticipants = addedParticipants;
  if (removedParticipants !== undefined) out.removedParticipants = removedParticipants;
  if (failedParticipants !== undefined) out.failedParticipants = failedParticipants;
  if (errors !== undefined) out.errors = errors;
  out.raw = payload;
  return out as unknown as WhatsAppGroupParticipantsUpdateValue;
}

function normalizeGroupMetadata(payload: Record<string, unknown>): { displayPhoneNumber: string; phoneNumberId: string } {
  const metadata = readOwnDataField(payload, "metadata");
  const displayPhoneNumber = isRecord(metadata) ? readStringField(metadata, "display_phone_number") : undefined;
  const phoneNumberId = isRecord(metadata) ? readSafeIdField(metadata, "phone_number_id") : undefined;
  return { displayPhoneNumber: displayPhoneNumber ?? "", phoneNumberId: phoneNumberId ?? "" };
}

function normalizeGroupSettingResult(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  const text = readStringField(value, "text");
  const mimeType = readStringField(value, "mime_type");
  const sha256 = readStringField(value, "sha256");
  const updateSuccessful = readBooleanField(value, "update_successful");
  const errors = normalizeGroupErrors(readOwnDataField(value, "errors"));
  if (text !== undefined) out.text = text;
  if (mimeType !== undefined) out.mimeType = mimeType;
  if (sha256 !== undefined) out.sha256 = sha256;
  if (updateSuccessful !== undefined) out.updateSuccessful = updateSuccessful;
  if (errors !== undefined) out.errors = errors;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeGroupSettingsPayload(payload: Record<string, unknown>, groupId: string): WhatsAppGroupSettingsUpdateValue {
  const out: Record<string, unknown> = {
    messagingProduct: "whatsapp",
    metadata: normalizeGroupMetadata(payload),
    groupId,
    type: readStringField(payload, "type") ?? ""
  };
  const groupSubject = normalizeGroupSettingResult(readOwnDataField(payload, "group_subject"));
  const groupDescription = normalizeGroupSettingResult(readOwnDataField(payload, "group_description"));
  const profilePicture = normalizeGroupSettingResult(readOwnDataField(payload, "profile_picture"));
  const errors = normalizeGroupErrors(readOwnDataField(payload, "errors"));
  if (groupSubject !== undefined) out.groupSubject = groupSubject;
  if (groupDescription !== undefined) out.groupDescription = groupDescription;
  if (profilePicture !== undefined) out.profilePicture = profilePicture;
  if (errors !== undefined) out.errors = errors;
  out.raw = payload;
  return out as unknown as WhatsAppGroupSettingsUpdateValue;
}

function normalizeGroupStatusPayload(payload: Record<string, unknown>, groupId: string): WhatsAppGroupStatusUpdateValue {
  return {
    messagingProduct: "whatsapp",
    metadata: normalizeGroupMetadata(payload),
    groupId,
    type: readStringField(payload, "type") ?? "",
    raw: payload
  } as unknown as WhatsAppGroupStatusUpdateValue;
}

function makeGroupItemPayload(
  valuePayload: Record<string, unknown>,
  groupPayload: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const messagingProduct = readOwnDataField(valuePayload, "messaging_product");
  const metadata = readOwnDataField(valuePayload, "metadata");
  if (messagingProduct !== undefined) out.messaging_product = messagingProduct;
  if (metadata !== undefined) out.metadata = metadata;

  const descriptors = Object.getOwnPropertyDescriptors(groupPayload);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") continue;
    out[key] = descriptor.value;
  }
  return out;
}

function normalizeTemplateAccountPayload(
  eventName: string,
  payload: Record<string, unknown>
): TypedTemplateAccountUpdate | undefined {
  if (
    eventName !== "message_template_status_update" &&
    eventName !== "message_template_quality_update" &&
    eventName !== "template_category_update" &&
    eventName !== "message_template_components_update"
  ) {
    return undefined;
  }
  const id = readSafeTemplateString(payload, "message_template_id");
  const name = readSafeTemplateString(payload, "message_template_name");
  const language = readSafeTemplateString(payload, "message_template_language");
  if (id === undefined || name === undefined || language === undefined) {
    return undefined;
  }
  const out: {
    eventName: string;
    id: string;
    name: string;
    language: string;
    event?: string;
    reason?: string;
    qualityScore?: string;
    previousQualityScore?: string;
    category?: string;
    previousCategory?: string;
    components?: readonly unknown[];
  } = { eventName, id, name, language };
  const event = readSafeTemplateString(payload, "event");
  if (event !== undefined) out.event = event;
  const reason = readSafeTemplateString(payload, "reason");
  if (reason !== undefined) out.reason = reason;
  const qualityScore =
    readSafeTemplateString(payload, "new_quality_score") ??
    readSafeTemplateString(payload, "quality_score");
  if (qualityScore !== undefined) out.qualityScore = qualityScore;
  const previousQualityScore = readSafeTemplateString(payload, "previous_quality_score");
  if (previousQualityScore !== undefined) out.previousQualityScore = previousQualityScore;
  const category =
    readSafeTemplateString(payload, "new_category") ??
    readSafeTemplateString(payload, "category");
  if (category !== undefined) out.category = category;
  const previousCategory = readSafeTemplateString(payload, "previous_category");
  if (previousCategory !== undefined) out.previousCategory = previousCategory;
  const components = safeCloneTemplateComponents(readRawTemplateField(payload, "components"));
  if (components !== undefined) out.components = components;
  return out;
}

// ---------- accumulator ----------

interface NormalizerAccumulator {
  readonly updates: TypedUpdate[];
  readonly skipped: SkippedUpdate[];
  readonly seenKeys: Set<string>;
  readonly limit: number;
  readonly clockNow: () => number;
  overflow: number; // count of updates beyond the limit, ignored
  limitHit: boolean;
}

function pushSkip(
  acc: NormalizerAccumulator,
  reason: SkippedReason,
  path: string,
  detail?: string
): void {
  const skip: SkippedUpdate =
    detail === undefined ? { reason, path } : { reason, path, detail };
  acc.skipped.push(skip);
}

function pushUpdate(
  acc: NormalizerAccumulator,
  update: TypedUpdate,
  path: string
): boolean {
  const key = `${update.kind}\u0000${update.updateId}`;
  if (acc.seenKeys.has(key)) {
    pushSkip(acc, "duplicate_update_id", path, update.updateId);
    return false;
  }
  if (acc.updates.length >= acc.limit) {
    acc.overflow += 1;
    acc.limitHit = true;
    return false;
  }
  acc.seenKeys.add(key);
  acc.updates.push(update);
  return true;
}

// ---------- main entrypoint ----------

export function normalizeWebhookEnvelope(
  envelope: unknown,
  options?: NormalizeWebhookOptions
): NormalizedWebhookResult {
  // Strict option validation FIRST so caller misuse cannot be
  // silently swallowed (WATS-29 remediation). Accepts only
  // positive finite integers; throws WebhookNormalizationError
  // with code `invalid_option` otherwise.
  const limit = validateMaxEventsOption(options?.maxEventsPerEnvelope);

  // Envelope shape validation (throws).
  if (!isRecord(envelope)) {
    throw new WebhookNormalizationError({ code: "invalid_envelope" });
  }
  const objectValue = readOwnDataField(envelope, "object");
  if (typeof objectValue !== "string") {
    throw new WebhookNormalizationError({
      code: "missing_object_field",
      path: "object"
    });
  }
  if (objectValue !== SUPPORTED_OBJECT) {
    throw new WebhookNormalizationError({
      code: "unsupported_object",
      path: "object",
      message: `Unsupported webhook object: \"${String(objectValue)}\".`
    });
  }
  const entryValue = readOwnDataField(envelope, "entry");
  if (!Array.isArray(entryValue)) {
    throw new WebhookNormalizationError({
      code: "invalid_entry_array",
      path: "entry"
    });
  }

  const clockNow = options?.clockNow ?? Date.now;

  const acc: NormalizerAccumulator = {
    updates: [],
    skipped: [],
    seenKeys: new Set(),
    limit,
    clockNow,
    overflow: 0,
    limitHit: false
  };

  for (let entryIndex = 0; entryIndex < entryValue.length; entryIndex += 1) {
    const entryPath = `entry[${entryIndex}]`;
    const entryResult = readArrayDataItem(entryValue, entryIndex);
    if (!entryResult.ok || !isRecord(entryResult.value)) {
      pushSkip(acc, "malformed_entry", entryPath, "not-an-object");
      continue;
    }
    const entry = entryResult.value;
    const entryId = readSafeIdField(entry, "id");
    if (entryId === undefined) {
      pushSkip(acc, "malformed_entry", entryPath, "invalid-id");
      continue;
    }
    const changes = readOwnDataField(entry, "changes");
    if (!Array.isArray(changes)) {
      pushSkip(acc, "malformed_entry", entryPath, "changes-not-array");
      continue;
    }

    const wabaId: string = entryId;
    const entryTimeMs = parseEntryTime(readOwnDataField(entry, "time"), clockNow);

    for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
      if (acc.limitHit) {
        acc.overflow += 1;
        continue;
      }
      const changePath = `${entryPath}.changes[${changeIndex}]`;
      const changeResult = readArrayDataItem(changes, changeIndex);
      if (!changeResult.ok) {
        pushSkip(acc, "malformed_change", changePath, "not-an-object");
        continue;
      }
      normalizeChange(changeResult.value, changePath, wabaId, entryTimeMs, acc);
    }
  }

  if (acc.limitHit) {
    return {
      updates: acc.updates,
      skipped: acc.skipped,
      limitError: {
        count: acc.updates.length + acc.overflow,
        limit
      }
    };
  }

  return {
    updates: acc.updates,
    skipped: acc.skipped
  };
}

function parseEntryTime(value: unknown, clockNow: () => number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Meta encodes entry.time as unix seconds.
    return Math.trunc(value * 1000);
  }
  return clockNow();
}

function normalizeChange(
  change: unknown,
  path: string,
  wabaId: string,
  entryTimeMs: number,
  acc: NormalizerAccumulator
): void {
  if (!isRecord(change)) {
    pushSkip(acc, "malformed_change", path, "not-an-object");
    return;
  }
  const fieldValue = readOwnDataField(change, "field");
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    pushSkip(acc, "malformed_change", path, "missing-or-invalid-field");
    return;
  }
  const changeValue = readOwnDataField(change, "value");
  if (!isRecord(changeValue)) {
    pushSkip(acc, "malformed_change", path, "value-not-an-object");
    return;
  }

  const field = fieldValue;
  const rawChange = change as unknown as WhatsAppWebhookChange;

  if (field === "messages") {
    normalizeMessagesChange(change, path, wabaId, entryTimeMs, rawChange, acc);
    return;
  }

  if (field === "calls") {
    normalizeCallsChange(change, path, wabaId, entryTimeMs, rawChange, acc);
    return;
  }

  if (field === "group_lifecycle_update") {
    normalizeGroupFieldChange("groupLifecycle", change, path, wabaId, entryTimeMs, rawChange, acc);
    return;
  }
  if (field === "group_participants_update") {
    normalizeGroupFieldChange("groupParticipants", change, path, wabaId, entryTimeMs, rawChange, acc);
    return;
  }
  if (field === "group_settings_update") {
    normalizeGroupFieldChange("groupSettings", change, path, wabaId, entryTimeMs, rawChange, acc);
    return;
  }
  if (field === "group_status_update") {
    normalizeGroupFieldChange("groupStatus", change, path, wabaId, entryTimeMs, rawChange, acc);
    return;
  }

  if (ACCOUNT_FIELDS.has(field)) {
    const payload = readOwnDataField(change, "value");
    const template = isRecord(payload) ? normalizeTemplateAccountPayload(field, payload) : undefined;
    const account = isRecord(payload) ? normalizeGenericAccountPayload(payload) : undefined;
    const update: TypedAccountUpdate = {
      kind: "account",
      updateId: deriveSyntheticId("account", wabaId, field, path),
      wabaId,
      receivedAt: entryTimeMs,
      eventName: field,
      ...(template !== undefined ? { template } : {}),
      ...(account !== undefined ? { account } : {}),
      payload,
      rawChange
    };
    pushUpdate(acc, update, path);
    return;
  }

  // Unknown field — carry through as TypedUnknownUpdate so consumers
  // have the opportunity to inspect Meta's forward-compat payloads.
  const unknownUpdate: TypedUnknownUpdate = {
    kind: "unknown",
    updateId: deriveSyntheticId("unknown", wabaId, field, path),
    wabaId,
    receivedAt: entryTimeMs,
    field,
    rawChange
  };
  pushUpdate(acc, unknownUpdate, path);
}

function normalizeGroupFieldChange(
  kind: "groupLifecycle" | "groupParticipants" | "groupSettings" | "groupStatus",
  change: Record<string, unknown>,
  path: string,
  wabaId: string,
  entryTimeMs: number,
  rawChange: WhatsAppWebhookChange,
  acc: NormalizerAccumulator
): void {
  const payload = readOwnDataField(change, "value");
  if (!isRecord(payload)) {
    pushSkip(acc, "malformed_change", `${path}.value`, "value-not-an-object");
    return;
  }
  const phoneNumberId = readMetadataPhoneNumberId(payload);
  if (phoneNumberId === undefined) {
    pushSkip(acc, "malformed_field", `${path}.value.metadata.phone_number_id`, "missing-or-unsafe-phone-number-id");
    return;
  }
  const groups = readOwnDataField(payload, "groups");
  if (Array.isArray(groups)) {
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      if (acc.limitHit) {
        acc.overflow += 1;
        continue;
      }
      const groupPath = `${path}.value.groups[${groupIndex}]`;
      const groupResult = readArrayDataItem(groups, groupIndex);
      if (!groupResult.ok || !isRecord(groupResult.value)) {
        pushSkip(acc, "malformed_field", groupPath, "not-an-object");
        continue;
      }
      pushGroupFieldUpdate(
        kind,
        makeGroupItemPayload(payload, groupResult.value),
        groupPath,
        wabaId,
        parseTimestampMs(readOwnDataField(groupResult.value, "timestamp"), () => entryTimeMs),
        rawChange,
        acc
      );
    }
    return;
  }

  pushGroupFieldUpdate(kind, payload, `${path}.value`, wabaId, entryTimeMs, rawChange, acc);
}

function pushGroupFieldUpdate(
  kind: "groupLifecycle" | "groupParticipants" | "groupSettings" | "groupStatus",
  payload: Record<string, unknown>,
  path: string,
  wabaId: string,
  receivedAt: number,
  rawChange: WhatsAppWebhookChange,
  acc: NormalizerAccumulator
): void {
  const phoneNumberId = readMetadataPhoneNumberId(payload);
  if (phoneNumberId === undefined) {
    pushSkip(acc, "malformed_field", `${path}.metadata.phone_number_id`, "missing-or-unsafe-phone-number-id");
    return;
  }
  const type = readStringField(payload, "type") ?? "unknown";
  const groupId = readSafeIdField(payload, "group_id");
  if (kind !== "groupLifecycle" && groupId === undefined) {
    pushSkip(acc, "malformed_field", `${path}.group_id`, "missing-or-unsafe-group-id");
    return;
  }
  const requestId = readSafeIdField(payload, "request_id");
  const effectiveGroupId = groupId ?? "";
  const updateId = deriveGroupSyntheticId(kind, wabaId, type, effectiveGroupId, requestId, path);
  if (kind === "groupLifecycle") {
    pushUpdate(acc, {
      kind,
      updateId,
      phoneNumberId,
      wabaId,
      receivedAt,
      group: normalizeGroupLifecyclePayload(payload),
      rawChange
    }, path);
    return;
  }
  if (kind === "groupParticipants") {
    pushUpdate(acc, {
      kind,
      updateId,
      phoneNumberId,
      wabaId,
      receivedAt,
      group: normalizeGroupParticipantsPayload(payload, effectiveGroupId),
      rawChange
    }, path);
    return;
  }
  if (kind === "groupSettings") {
    pushUpdate(acc, {
      kind,
      updateId,
      phoneNumberId,
      wabaId,
      receivedAt,
      group: normalizeGroupSettingsPayload(payload, effectiveGroupId),
      rawChange
    }, path);
    return;
  }
  pushUpdate(acc, {
    kind,
    updateId,
    phoneNumberId,
    wabaId,
    receivedAt,
    group: normalizeGroupStatusPayload(payload, effectiveGroupId),
    rawChange
  }, path);
}

function normalizeMessagesChange(
  change: Record<string, unknown>,
  path: string,
  wabaId: string,
  entryTimeMs: number,
  rawChange: WhatsAppWebhookChange,
  acc: NormalizerAccumulator
): void {
  const valueRaw = readOwnDataField(change, "value");
  if (!isRecord(valueRaw)) {
    pushSkip(acc, "malformed_change", `${path}.value`, "value-not-an-object");
    return;
  }
  const value = valueRaw;

  // phone_number_id extraction + CR/LF/NUL defense.
  let phoneNumberId: string | undefined;
  const metadata = readOwnDataField(value, "metadata");
  if (isRecord(metadata)) {
    phoneNumberId = readSafeIdField(metadata, "phone_number_id");
  }
  if (phoneNumberId === undefined) {
    pushSkip(
      acc,
      "malformed_field",
      `${path}.value.metadata.phone_number_id`,
      "missing-or-unsafe-phone-number-id"
    );
    return;
  }

  const messages = readOwnDataField(value, "messages");
  if (Array.isArray(messages)) {
    for (let i = 0; i < messages.length; i += 1) {
      if (acc.limitHit) {
        acc.overflow += 1;
        continue;
      }
      const msgPath = `${path}.value.messages[${i}]`;
      const itemResult = readArrayDataItem(messages, i);
      if (!itemResult.ok || !isRecord(itemResult.value)) {
        pushSkip(acc, "malformed_field", msgPath, "message-not-an-object");
        continue;
      }
      const msg = itemResult.value;
      const messageId = readSafeIdField(msg, "id");
      if (messageId === undefined) {
        pushSkip(acc, "malformed_field", msgPath, "invalid-message-id");
        continue;
      }
      const timestamp = readOwnDataField(msg, "timestamp");
      const normalizedMessage = normalizeMessagePayload(msg);
      if (normalizedMessage === undefined) {
        pushSkip(acc, "malformed_field", msgPath, "invalid-message");
        continue;
      }
      const receivedAt = parseTimestampMs(timestamp, acc.clockNow);
      const update: TypedMessageUpdate = {
        kind: "message",
        updateId: messageId,
        phoneNumberId,
        wabaId,
        receivedAt,
        message: normalizedMessage,
        rawChange
      };
      pushUpdate(acc, update, msgPath);
    }
  }

  const statuses = readOwnDataField(value, "statuses");
  if (Array.isArray(statuses)) {
    for (let i = 0; i < statuses.length; i += 1) {
      if (acc.limitHit) {
        acc.overflow += 1;
        continue;
      }
      const stPath = `${path}.value.statuses[${i}]`;
      const itemResult = readArrayDataItem(statuses, i);
      if (!itemResult.ok || !isRecord(itemResult.value)) {
        pushSkip(acc, "malformed_field", stPath, "status-not-an-object");
        continue;
      }
      const st = itemResult.value;
      const statusId = readSafeIdField(st, "id");
      if (statusId === undefined) {
        pushSkip(acc, "malformed_field", stPath, "invalid-status-id");
        continue;
      }
      const receivedAt = parseTimestampMs(readOwnDataField(st, "timestamp"), acc.clockNow);
      const statusValue = readStringField(st, "status");
      const recipientId = readSafeIdField(st, "recipient_id");
      const recipientType = readStringField(st, "recipient_type");
      const recipientParticipantId = readSafeIdField(st, "recipient_participant_id");
      const normalizedStatus: Record<string, unknown> = {
        id: statusId,
        ...(recipientId !== undefined ? { recipientId } : {}),
        ...(recipientType !== undefined ? { recipientType } : {}),
        ...(recipientParticipantId !== undefined ? { recipientParticipantId } : {}),
        ...(statusValue !== undefined ? { status: statusValue } : {}),
        ...(typeof readOwnDataField(st, "timestamp") === "string" ? { timestamp: readOwnDataField(st, "timestamp") } : {}),
        raw: st
      };
      const conversation = readOwnDataField(st, "conversation");
      if (isRecord(conversation)) {
        const id = readStringField(conversation, "id");
        const origin = readOwnDataField(conversation, "origin");
        const expirationTimestamp = readStringField(conversation, "expiration_timestamp");
        const out: Record<string, unknown> = {};
        if (id !== undefined) out.id = id;
        if (isRecord(origin)) out.origin = safeCloneMessageJsonValue(origin);
        if (expirationTimestamp !== undefined) out.expirationTimestamp = expirationTimestamp;
        if (Object.keys(out).length > 0) normalizedStatus.conversation = out;
      }
      const pricing = readOwnDataField(st, "pricing");
      if (isRecord(pricing)) {
        const category = readStringField(pricing, "category");
        const pricingModel = readStringField(pricing, "pricing_model");
        const billable = readBooleanField(pricing, "billable");
        const out: Record<string, unknown> = {};
        if (category !== undefined) out.category = category;
        if (pricingModel !== undefined) out.pricingModel = pricingModel;
        if (billable !== undefined) out.billable = billable;
        if (Object.keys(out).length > 0) normalizedStatus.pricing = out;
      }
      const messageStatus = readStringField(st, "message_status");
      if (messageStatus !== undefined) normalizedStatus.messageStatus = messageStatus;
      const errors = safeCloneMessageJsonValue(readOwnDataField(st, "errors"));
      if (Array.isArray(errors)) normalizedStatus.errors = errors;
      const update: TypedStatusUpdate = {
        kind: "status",
        updateId: statusId,
        phoneNumberId,
        wabaId,
        receivedAt,
        status: normalizedStatus as unknown as WhatsAppMessageStatus,
        rawChange
      };
      pushUpdate(acc, update, stPath);
    }
  }
}

function normalizeCallsChange(
  change: Record<string, unknown>,
  path: string,
  wabaId: string,
  entryTimeMs: number,
  rawChange: WhatsAppWebhookChange,
  acc: NormalizerAccumulator
): void {
  const valueRaw = readOwnDataField(change, "value");
  if (!isRecord(valueRaw)) {
    pushSkip(acc, "malformed_change", `${path}.value`, "value-not-an-object");
    return;
  }
  const value = valueRaw;
  let phoneNumberId: string | undefined;
  const metadata = readOwnDataField(value, "metadata");
  if (isRecord(metadata)) {
    phoneNumberId = readSafeIdField(metadata, "phone_number_id");
  }
  if (phoneNumberId === undefined) {
    pushSkip(acc, "malformed_field", `${path}.value.metadata.phone_number_id`, "missing-or-unsafe-phone-number-id");
    return;
  }

  const calls = readOwnDataField(value, "calls");
  if (Array.isArray(calls)) {
    for (let i = 0; i < calls.length; i += 1) {
      if (acc.limitHit) { acc.overflow += 1; continue; }
      const callPath = `${path}.value.calls[${i}]`;
      const itemResult = readArrayDataItem(calls, i);
      if (!itemResult.ok || !isRecord(itemResult.value)) {
        pushSkip(acc, "malformed_field", callPath, "call-not-an-object");
        continue;
      }
      const item = itemResult.value;
      const id = readSafeIdField(item, "id");
      const event = readOwnDataField(item, "event");
      if (id === undefined || (event !== "connect" && event !== "terminate")) {
        pushSkip(acc, "malformed_field", callPath, "invalid-call");
        continue;
      }
      const direction = readOwnDataField(item, "direction");
      const from = readSafeIdField(item, "from");
      const to = readSafeIdField(item, "to");
      const timestamp = readOwnDataField(item, "timestamp");
      const call: NormalizedCallPayload = {
        id,
        event,
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(direction === "USER_INITIATED" || direction === "BUSINESS_INITIATED" ? { direction } : {}),
        ...(typeof timestamp === "string" ? { timestamp } : {}),
        ...(readOwnDataField(item, "session") !== undefined ? { session: readOwnDataField(item, "session") } : {}),
        raw: item
      };
      const update: TypedCallUpdate = {
        kind: event === "connect" ? "callConnect" : "callTerminate",
        updateId: id,
        phoneNumberId,
        wabaId,
        receivedAt: parseTimestampMs(timestamp, acc.clockNow) || entryTimeMs,
        call,
        rawChange
      };
      pushUpdate(acc, update, callPath);
    }
  }

  const statuses = readOwnDataField(value, "statuses");
  if (Array.isArray(statuses)) {
    for (let i = 0; i < statuses.length; i += 1) {
      if (acc.limitHit) { acc.overflow += 1; continue; }
      const stPath = `${path}.value.statuses[${i}]`;
      const itemResult = readArrayDataItem(statuses, i);
      if (!itemResult.ok || !isRecord(itemResult.value)) {
        pushSkip(acc, "malformed_field", stPath, "call-status-not-an-object");
        continue;
      }
      const item = itemResult.value;
      const id = readSafeIdField(item, "id");
      const status = readOwnDataField(item, "status");
      if (id === undefined || (status !== "RINGING" && status !== "ACCEPTED" && status !== "REJECTED")) {
        pushSkip(acc, "malformed_field", stPath, "invalid-call-status");
        continue;
      }
      const timestamp = readOwnDataField(item, "timestamp");
      const recipientId = readSafeIdField(item, "recipient_id");
      const update: TypedCallStatusUpdate = {
        kind: "callStatus",
        updateId: id,
        phoneNumberId,
        wabaId,
        receivedAt: parseTimestampMs(timestamp, acc.clockNow) || entryTimeMs,
        callStatus: {
          id,
          status,
          ...(recipientId !== undefined ? { recipientId } : {}),
          ...(typeof timestamp === "string" ? { timestamp } : {}),
          raw: item
        },
        rawChange
      };
      pushUpdate(acc, update, stPath);
    }
  }
}

function deriveSyntheticId(
  prefix: string,
  wabaId: string,
  field: string,
  path: string
): string {
  // Account/unknown updates often lack stable ids on the wire; we
  // synthesize a per-envelope-unique id so downstream dedup still
  // behaves deterministically. Byte content is safe by construction
  // (no CR/LF/NUL).
  const safeWaba = wabaId.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeField = field.replace(/[^A-Za-z0-9_-]/g, "_");
  const safePath = path.replace(/[^A-Za-z0-9_\-[\]\.]/g, "_");
  return `${prefix}:${safeWaba}:${safeField}:${safePath}`;
}

function deriveGroupSyntheticId(
  kind: "groupLifecycle" | "groupParticipants" | "groupSettings" | "groupStatus",
  wabaId: string,
  type: string,
  groupId: string,
  requestId: string | undefined,
  path: string
): string {
  const prefix = kind;
  const safeWaba = wabaId.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeType = type.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeGroupId = groupId.length > 0 ? groupId.replace(/[^A-Za-z0-9_-]/g, "_") : "no_group";
  const safeRequestId = requestId?.replace(/[^A-Za-z0-9_-]/g, "_") ?? path.replace(/[^A-Za-z0-9_\-[\]\.]/g, "_");
  return `${prefix}:${safeWaba}:${safeType}:${safeGroupId}:${safeRequestId}`;
}
