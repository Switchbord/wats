// F-6 Graph Messages endpoint, refactored onto the defineEndpoint
// registry (WATS-18 / Arch-D).
//
// Two shapes are exported:
//   1. `sendMessage` — the endpoint-registry callable produced by
//      defineEndpoint. Preferred for new call sites.
//      Usage: `await sendMessage(client, { phoneNumberId }, bodyObject)`.
//   2. `GraphMessagesEndpoint` — the legacy class (kept for backward-
//      compatibility). Its `sendMessage(input)` method still accepts the
//      B2-era high-level `GraphMessagesSendMessageInput` shape with a
//      loose text + optional previewUrl, still throws the F-4 typed
//      `Invalid phoneNumberId` validation error before touching the
//      transport, and ultimately delegates to the new registry callable
//      for path/body plumbing.
//
// Scope ledger: F-6 introduced the shared `sendMessage` endpoint callable.
// WATS-30 adds text payload builders; WATS-38 adds outbound composer
// builders for media, location, contacts, reaction, interactive variants,
// template send, mark-as-read, and typing indicators. Template
// CRUD/management landed in WATS-39; Flow management helpers landed in WATS-40.
// WATS-98 adds credential-free Marketing Messages API request-shape helpers
// for `POST /{phoneNumberId}/marketing_messages` only; no live Meta calls,
// credential validation, Ads Manager dashboards, or ACO automation claims.

import type { GraphClient, GraphRequestOptions } from "../client.js";
import { defineEndpoint, type EndpointInvokeOptions } from "../endpoint.js";
import { GraphRequestValidationError } from "../errors.js";
import { copyOptionalParamsObject } from "../internal/validation/options.js";

interface GraphRequestExecutor {
  request<TResponse>(options: GraphRequestOptions): Promise<TResponse>;
}

export interface GraphMessagesSendMessageInput {
  phoneNumberId: string;
  to: string;
  text: string;
  previewUrl?: boolean;
}

export interface GraphMessagesSendTextInput {
  readonly to: string;
  readonly text: string;
  readonly previewUrl?: boolean;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendMediaInput {
  readonly to: string;
  readonly mediaId?: string;
  readonly link?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCaptionedMediaInput extends GraphMessagesSendMediaInput {
  readonly caption?: string;
}

export interface GraphMessagesSendDocumentInput extends GraphMessagesSendCaptionedMediaInput {
  readonly filename?: string;
}

export type GraphMessagesSendImageInput = GraphMessagesSendCaptionedMediaInput;
export type GraphMessagesSendVideoInput = GraphMessagesSendCaptionedMediaInput;
export interface GraphMessagesSendAudioInput extends GraphMessagesSendMediaInput {
  /** Graph v24+ voice-message designation for audio sends. Defaults to omitted/false. */
  readonly voice?: boolean;
}
export type GraphMessagesSendStickerInput = GraphMessagesSendMediaInput;

export interface GraphMessagesSendLocationInput {
  readonly to: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly name?: string;
  readonly address?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesContactNameInput {
  readonly formattedName?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly middleName?: string;
  readonly suffix?: string;
  readonly prefix?: string;
}

export interface GraphMessagesContactPhoneInput {
  readonly phone?: string;
  readonly type?: string;
  readonly waId?: string;
}

export interface GraphMessagesContactEmailInput {
  readonly email: string;
  readonly type?: string;
}

export interface GraphMessagesContactUrlInput {
  readonly url: string;
  readonly type?: string;
}

export interface GraphMessagesContactAddressInput {
  readonly street?: string;
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
  readonly country?: string;
  readonly countryCode?: string;
  readonly type?: string;
}

export interface GraphMessagesContactOrgInput {
  readonly company?: string;
  readonly department?: string;
  readonly title?: string;
}

export interface GraphMessagesContactInput {
  readonly name: GraphMessagesContactNameInput;
  readonly phones?: readonly GraphMessagesContactPhoneInput[];
  readonly emails?: readonly GraphMessagesContactEmailInput[];
  readonly urls?: readonly GraphMessagesContactUrlInput[];
  readonly addresses?: readonly GraphMessagesContactAddressInput[];
  readonly org?: GraphMessagesContactOrgInput;
  readonly birthday?: string;
}

export interface GraphMessagesSendContactsInput {
  readonly to: string;
  readonly contacts: readonly GraphMessagesContactInput[];
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendReactionInput {
  readonly to: string;
  readonly messageId: string;
  readonly emoji: string;
}

export interface GraphMessagesRemoveReactionInput {
  readonly to: string;
  readonly messageId: string;
}

export interface GraphMessagesSendButtonsInput {
  readonly to: string;
  readonly bodyText: string;
  readonly buttons: readonly { readonly id: string; readonly title: string }[];
  readonly headerText?: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendListInput {
  readonly to: string;
  readonly bodyText: string;
  readonly buttonText: string;
  readonly sections: readonly {
    readonly title?: string;
    readonly rows: readonly { readonly id: string; readonly title: string; readonly description?: string }[];
  }[];
  readonly headerText?: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCtaUrlInput {
  readonly to: string;
  readonly bodyText: string;
  readonly displayText: string;
  readonly url: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCallPermissionRequestInput {
  readonly to: string;
  readonly bodyText: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendProductInput {
  readonly to: string;
  readonly catalogId: string;
  readonly productRetailerId: string;
  readonly bodyText?: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendProductsInput {
  readonly to: string;
  readonly catalogId: string;
  readonly headerText: string;
  readonly bodyText: string;
  readonly sections: readonly {
    readonly title: string;
    readonly productItems: readonly { readonly productRetailerId: string }[];
  }[];
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCatalogInput {
  readonly to: string;
  readonly bodyText: string;
  readonly footerText?: string;
  readonly thumbnailProductRetailerId?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesRequestLocationInput {
  readonly to: string;
  readonly bodyText: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesMarkMessageAsReadInput {
  readonly messageId: string;
}

export type GraphMessagesTypingIndicatorInput = GraphMessagesMarkMessageAsReadInput;

export interface GraphMessagesTemplateComponentInput {
  readonly type: string;
  readonly parameters?: readonly Record<string, unknown>[];
  readonly subType?: string;
  readonly index?: string;
}

export interface GraphMessagesSendTemplateInput {
  readonly to: string;
  readonly name: string;
  readonly languageCode: string;
  readonly components?: readonly GraphMessagesTemplateComponentInput[];
  readonly replyToMessageId?: string;
}

export type GraphMessagesMarketingProductPolicy = "CLOUD_API_FALLBACK" | "STRICT";
export type GraphMessagesMarketingMessageStatus = "accepted" | "held_for_quality_assessment" | "paused" | string;

export interface GraphMessagesSendMarketingTemplateInput {
  readonly to?: string;
  readonly recipient?: string;
  readonly name: string;
  readonly languageCode: string;
  readonly components?: readonly GraphMessagesTemplateComponentInput[];
  readonly productPolicy?: GraphMessagesMarketingProductPolicy;
  readonly messageActivitySharing?: boolean;
}

export interface GraphMessagesSendResponse {
  messaging_product?: string;
  contacts?: Array<{
    input?: string;
    wa_id?: string;
  }>;
  messages?: Array<{
    id: string;
  }>;
}

export interface GraphMessagesMarketingTemplateResponse {
  messaging_product?: string;
  contacts?: Array<{
    input?: string;
    wa_id?: string;
    /** WATS-98 BSUID response field returned for Business-Scoped User ID sends. */
    user_id?: string;
  }>;
  messages?: Array<{
    id: string;
    /** WATS-98 /marketing_messages status: accepted, held_for_quality_assessment, or paused. */
    message_status?: GraphMessagesMarketingMessageStatus;
  }>;
}

export interface GraphMessagesMarketingTemplatePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to?: string;
  recipient?: string;
  type: "template";
  template: Record<string, unknown>;
  product_policy?: GraphMessagesMarketingProductPolicy;
  message_activity_sharing?: boolean;
}

export interface GraphMessagesTextPayload {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: {
    body: string;
    preview_url?: boolean;
  };
  context?: {
    message_id: string;
  };
}

export type GraphMessagesMediaType = "image" | "video" | "audio" | "document" | "sticker";

interface GraphMessagesMediaReferencePayload {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

interface GraphMessagesAudioReferencePayload extends GraphMessagesMediaReferencePayload {
  voice?: boolean;
}

export type GraphMessagesImagePayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "image";
  image: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesVideoPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "video";
  video: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesAudioPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "audio";
  audio: GraphMessagesAudioReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesDocumentPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "document";
  document: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesStickerPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "sticker";
  sticker: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesMediaPayload =
  | GraphMessagesImagePayload
  | GraphMessagesVideoPayload
  | GraphMessagesAudioPayload
  | GraphMessagesDocumentPayload
  | GraphMessagesStickerPayload;

export type GraphMessagesLocationPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "location";
  location: { latitude: number; longitude: number; name?: string; address?: string };
  context?: { message_id: string };
};

export type GraphMessagesContactsPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "contacts";
  contacts: readonly Record<string, unknown>[];
  context?: { message_id: string };
};

export type GraphMessagesReactionPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "reaction";
  reaction: { message_id: string; emoji: string };
};

export type GraphMessagesInteractivePayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: Record<string, unknown>;
  context?: { message_id: string };
};

export type GraphMessagesTemplatePayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: Record<string, unknown>;
  context?: { message_id: string };
};

export type GraphMessagesStatusPayload = {
  messaging_product: "whatsapp";
  status: "read";
  message_id: string;
  typing_indicator?: { type: "text" };
};

export type GraphMessagesRemainingPayload =
  | GraphMessagesLocationPayload
  | GraphMessagesContactsPayload
  | GraphMessagesReactionPayload
  | GraphMessagesInteractivePayload
  | GraphMessagesTemplatePayload
  | GraphMessagesStatusPayload;

// Structural body shape accepted by the endpoint-registry callable. The
// class-based adapter builds this internally via buildSendMessagePayload.
export type GraphMessagesSendBody = GraphMessagesTextPayload | GraphMessagesMediaPayload | GraphMessagesRemainingPayload;

export const GRAPH_MESSAGES_TEXT_BODY_MAX_LENGTH = 4096;
export const GRAPH_MESSAGES_RECIPIENT_MAX_DIGITS = 15;
export const GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH = 256;
export const GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH = 2048;
export const GRAPH_MESSAGES_MEDIA_LINK_MAX_LENGTH = 2048;
export const GRAPH_MESSAGES_MEDIA_CAPTION_MAX_LENGTH = 1024;
export const GRAPH_MESSAGES_DOCUMENT_FILENAME_MAX_LENGTH = 256;
export const GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH = 1024;
export const GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH = 60;
export const GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH = 20;
export const GRAPH_MESSAGES_BUTTON_ID_MAX_LENGTH = 256;
export const GRAPH_MESSAGES_SECTION_TITLE_MAX_LENGTH = 24;
export const GRAPH_MESSAGES_ROW_TITLE_MAX_LENGTH = 24;
export const GRAPH_MESSAGES_ROW_DESCRIPTION_MAX_LENGTH = 72;
export const GRAPH_MESSAGES_MAX_REPLY_BUTTONS = 3;
export const GRAPH_MESSAGES_MAX_LIST_SECTIONS = 10;
export const GRAPH_MESSAGES_MAX_LIST_ROWS = 10;
export const GRAPH_MESSAGES_MAX_CONTACTS = 257;
export const GRAPH_MESSAGES_MAX_PRODUCT_ITEMS = 30;

function isPlainOptionsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function assertValidRecipient(to: unknown, helperName = "sendText"): string {
  if (typeof to !== "string") {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: to must be a phone-number string.`
    );
  }
  if (to.length === 0 || to.trim().length === 0) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: to must be a non-empty phone-number string.`
    );
  }
  if (hasControlChar(to)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: to must not contain control characters (CR/LF/NUL/etc.).`
    );
  }
  if (
    to.includes("/") ||
    to.includes("\\") ||
    to.includes("?") ||
    to.includes("#") ||
    to.includes(":") ||
    to.includes("@")
  ) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: to must be a phone-number string, not a path, URL, or address.`
    );
  }
  if (!/^\+?\d{1,15}$/.test(to)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: to must be E.164-ish digits with optional leading + and at most ${GRAPH_MESSAGES_RECIPIENT_MAX_DIGITS} digits.`
    );
  }
  return to;
}

function assertValidText(text: unknown): string {
  if (typeof text !== "string") {
    throw new GraphRequestValidationError(
      "Invalid sendText input: text must be a string."
    );
  }
  if (text.length === 0 || text.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid sendText input: text must be a non-empty string."
    );
  }
  if (text.length > GRAPH_MESSAGES_TEXT_BODY_MAX_LENGTH) {
    throw new GraphRequestValidationError(
      `Invalid sendText input: text exceeds ${GRAPH_MESSAGES_TEXT_BODY_MAX_LENGTH}-character limit.`
    );
  }
  return text;
}

function assertValidReplyToMessageId(value: unknown): string {
  if (typeof value !== "string") {
    throw new GraphRequestValidationError(
      "Invalid sendText input: replyToMessageId must be a string when provided."
    );
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid sendText input: replyToMessageId must be non-empty when provided."
    );
  }
  if (hasControlChar(value)) {
    throw new GraphRequestValidationError(
      "Invalid sendText input: replyToMessageId must not contain control characters (CR/LF/NUL/etc.)."
    );
  }
  if (value.length > GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH) {
    throw new GraphRequestValidationError(
      `Invalid sendText input: replyToMessageId exceeds ${GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH}-character limit.`
    );
  }
  return value;
}

export function buildSendTextPayload(
  input: GraphMessagesSendTextInput
): GraphMessagesTextPayload {
  if (!isPlainOptionsObject(input)) {
    throw new GraphRequestValidationError(
      "Invalid sendText input: expected an options object."
    );
  }

  const to = assertValidRecipient(input.to);
  const text = assertValidText(input.text);

  if (input.previewUrl !== undefined && typeof input.previewUrl !== "boolean") {
    throw new GraphRequestValidationError(
      "Invalid sendText input: previewUrl must be a boolean when provided."
    );
  }

  const payload: GraphMessagesTextPayload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: text
    }
  };

  if (input.previewUrl !== undefined) {
    payload.text.preview_url = input.previewUrl;
  }
  if (input.replyToMessageId !== undefined) {
    payload.context = {
      message_id: assertValidReplyToMessageId(input.replyToMessageId)
    };
  }

  return payload;
}


function assertNonEmptyControlFreeString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  helperName: string
): string {
  if (typeof value !== "string") {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: ${fieldName} must be a string when provided.`
    );
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: ${fieldName} must be non-empty when provided.`
    );
  }
  if (hasControlChar(value)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: ${fieldName} must not contain control characters (CR/LF/NUL/etc.).`
    );
  }
  if (value.length > maxLength) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: ${fieldName} exceeds ${maxLength}-character limit.`
    );
  }
  return value;
}

function assertValidMediaLink(value: unknown, helperName: string): string {
  const link = assertNonEmptyControlFreeString(
    value,
    "link",
    GRAPH_MESSAGES_MEDIA_LINK_MAX_LENGTH,
    helperName
  );
  if (/\s/.test(link)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: link must not contain whitespace.`
    );
  }
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: link must be a valid http(s) URL.`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: link must use http or https.`
    );
  }
  return link;
}

function assertNoUnsupportedMediaFields(
  input: Record<string, unknown>,
  helperName: string,
  options: { readonly caption: boolean; readonly filename: boolean }
): void {
  if (!options.caption && input.caption !== undefined) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: caption is not supported for this media type.`
    );
  }
  if (!options.filename && input.filename !== undefined) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: filename is only supported for document messages.`
    );
  }
}

function buildSendMediaPayload<TType extends GraphMessagesMediaType>(
  input: GraphMessagesSendMediaInput,
  mediaType: TType,
  helperName: string,
  options: { readonly caption: boolean; readonly filename: boolean }
): GraphMessagesMediaPayload {
  if (!isPlainOptionsObject(input)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: expected an options object.`
    );
  }

  const record = input as Record<string, unknown>;
  assertNoUnsupportedMediaFields(record, helperName, options);

  const to = assertValidRecipient(record.to, helperName);
  const hasMediaId = record.mediaId !== undefined;
  const hasLink = record.link !== undefined;
  if (hasMediaId === hasLink) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: exactly one of mediaId or link is required.`
    );
  }

  const media: GraphMessagesMediaReferencePayload = {};
  if (hasMediaId) {
    media.id = assertNonEmptyControlFreeString(
      record.mediaId,
      "mediaId",
      GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH,
      helperName
    );
  } else {
    media.link = assertValidMediaLink(record.link, helperName);
  }

  if (record.caption !== undefined) {
    media.caption = assertNonEmptyControlFreeString(
      record.caption,
      "caption",
      GRAPH_MESSAGES_MEDIA_CAPTION_MAX_LENGTH,
      helperName
    );
  }
  if (record.filename !== undefined) {
    media.filename = assertNonEmptyControlFreeString(
      record.filename,
      "filename",
      GRAPH_MESSAGES_DOCUMENT_FILENAME_MAX_LENGTH,
      helperName
    );
  }

  const payload = {
    messaging_product: "whatsapp" as const,
    to,
    type: mediaType,
    [mediaType]: media
  } as unknown as GraphMessagesMediaPayload;

  if (record.replyToMessageId !== undefined) {
    (payload as GraphMessagesMediaPayload & { context?: { message_id: string } }).context = {
      message_id: assertValidReplyToMessageId(record.replyToMessageId)
    };
  }

  return payload;
}

export function buildSendImagePayload(
  input: GraphMessagesSendImageInput
): GraphMessagesImagePayload {
  return buildSendMediaPayload(input, "image", "sendImage", {
    caption: true,
    filename: false
  }) as GraphMessagesImagePayload;
}

export function buildSendVideoPayload(
  input: GraphMessagesSendVideoInput
): GraphMessagesVideoPayload {
  return buildSendMediaPayload(input, "video", "sendVideo", {
    caption: true,
    filename: false
  }) as GraphMessagesVideoPayload;
}

export function buildSendAudioPayload(
  input: GraphMessagesSendAudioInput
): GraphMessagesAudioPayload {
  const payload = buildSendMediaPayload(input, "audio", "sendAudio", {
    caption: false,
    filename: false
  }) as GraphMessagesAudioPayload;
  const record = input as unknown as Record<string, unknown>;
  if (record.voice !== undefined) {
    if (typeof record.voice !== "boolean") {
      throw new GraphRequestValidationError("Invalid sendAudio input: voice must be a boolean when provided.");
    }
    if (record.voice) payload.audio.voice = true;
  }
  return payload;
}

export function buildSendDocumentPayload(
  input: GraphMessagesSendDocumentInput
): GraphMessagesDocumentPayload {
  return buildSendMediaPayload(input, "document", "sendDocument", {
    caption: true,
    filename: true
  }) as GraphMessagesDocumentPayload;
}

export function buildSendStickerPayload(
  input: GraphMessagesSendStickerInput
): GraphMessagesStickerPayload {
  return buildSendMediaPayload(input, "sticker", "sendSticker", {
    caption: false,
    filename: false
  }) as GraphMessagesStickerPayload;
}

function assertValidNumberInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  helperName: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: ${fieldName} must be a finite number between ${min} and ${max}.`
    );
  }
  return value;
}

function maybeText(
  value: unknown,
  fieldName: string,
  maxLength: number,
  helperName: string
): string | undefined {
  if (value === undefined) return undefined;
  return assertNonEmptyControlFreeString(value, fieldName, maxLength, helperName);
}

function withReplyContext<T extends object>(
  payload: T,
  input: Record<string, unknown>
): T & { context?: { message_id: string } } {
  if (input.replyToMessageId === undefined) return payload;
  return {
    ...payload,
    context: { message_id: assertValidReplyToMessageId(input.replyToMessageId) }
  };
}

function asRecordInput(input: unknown, helperName: string): Record<string, unknown> {
  if (!isPlainOptionsObject(input)) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: expected an options object.`);
  }
  return input as Record<string, unknown>;
}

function assertArray(value: unknown, fieldName: string, helperName: string): readonly unknown[] {
  const isArray = inspectTemplateValue(helperName, fieldName, () => Array.isArray(value));
  if (!isArray) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} must be an array.`);
  }
  return value as readonly unknown[];
}

function assertBoundedArray(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  helperName: string
): readonly unknown[] {
  const arr = assertArray(value, fieldName, helperName);
  const length = inspectTemplateValue(helperName, fieldName, () => arr.length);
  if (length < min || length > max) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} length must be between ${min} and ${max}.`);
  }
  for (let i = 0; i < length; i += 1) {
    const hasIndex = inspectTemplateValue(helperName, fieldName, () => i in arr);
    if (!hasIndex) {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} must not contain sparse array holes.`);
    }
  }
  const proto = inspectTemplateValue(helperName, fieldName, () => Object.getPrototypeOf(arr));
  if (proto !== Array.prototype) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} must use Array.prototype.`);
  }
  const descriptors = inspectTemplateValue(helperName, fieldName, () => Object.getOwnPropertyDescriptors(arr));
  if (descriptors.map !== undefined || Object.prototype.hasOwnProperty.call(descriptors, Symbol.iterator)) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} must not override Array.prototype methods.`);
  }
  const copy: unknown[] = [];
  for (let i = 0; i < length; i += 1) {
    const descriptor = descriptors[String(i)];
    if (descriptor === undefined) {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} must not contain inherited elements.`);
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} must not use accessors.`);
    }
    copy.push(descriptor.value);
  }
  return copy;
}

function mapValidatedArray<T>(
  values: readonly unknown[],
  mapper: (value: unknown, index: number) => T
): T[] {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 1) {
    out.push(mapper(values[i], i));
  }
  return out;
}

function assertOnlyKnownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  helperName: string
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: unknown field ${key}.`);
    }
  }
}

export function buildSendLocationPayload(input: GraphMessagesSendLocationInput): GraphMessagesLocationPayload {
  const record = asRecordInput(input, "sendLocation");
  const payload: GraphMessagesLocationPayload = {
    messaging_product: "whatsapp",
    to: assertValidRecipient(record.to, "sendLocation"),
    type: "location",
    location: {
      latitude: assertValidNumberInRange(record.latitude, "latitude", -90, 90, "sendLocation"),
      longitude: assertValidNumberInRange(record.longitude, "longitude", -180, 180, "sendLocation")
    }
  };
  const name = maybeText(record.name, "name", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendLocation");
  const address = maybeText(record.address, "address", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendLocation");
  if (name !== undefined) payload.location.name = name;
  if (address !== undefined) payload.location.address = address;
  return withReplyContext(payload, record);
}

function normalizeContactName(value: unknown, helperName: string): Record<string, unknown> {
  if (!isPlainOptionsObject(value)) throw new GraphRequestValidationError(`Invalid ${helperName} input: contact.name must be an object.`);
  const name = value as Record<string, unknown>;
  const formatted = maybeText(name.formattedName ?? name.formatted, "name.formattedName", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
  if (formatted === undefined) throw new GraphRequestValidationError(`Invalid ${helperName} input: contact.name.formattedName is required.`);
  const out: Record<string, unknown> = { formatted_name: formatted };
  const pairs: readonly [string, string][] = [["firstName", "first_name"], ["lastName", "last_name"], ["middleName", "middle_name"], ["suffix", "suffix"], ["prefix", "prefix"]];
  for (const [camel, snake] of pairs) {
    const v = maybeText(name[camel] ?? name[snake], `name.${camel}`, GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
    if (v !== undefined) out[snake] = v;
  }
  return out;
}

function normalizeTypedStringRecord(value: unknown, fieldName: string, requiredField: string, helperName: string): Record<string, unknown> {
  if (!isPlainOptionsObject(value)) throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} entries must be objects.`);
  const record = value as Record<string, unknown>;
  const primary = maybeText(record[requiredField], `${fieldName}.${requiredField}`, GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
  if (primary === undefined) throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName}.${requiredField} is required.`);
  const out: Record<string, unknown> = { [requiredField]: primary };
  const type = maybeText(record.type, `${fieldName}.type`, GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  if (type !== undefined) out.type = type;
  return out;
}

function normalizeContact(value: unknown, helperName: string): Record<string, unknown> {
  if (!isPlainOptionsObject(value)) throw new GraphRequestValidationError(`Invalid ${helperName} input: contacts entries must be objects.`);
  const contact = value as Record<string, unknown>;
  const out: Record<string, unknown> = { name: normalizeContactName(contact.name, helperName) };
  if (contact.phones !== undefined) {
    out.phones = mapValidatedArray(assertBoundedArray(contact.phones, "contact.phones", 1, 20, helperName), (entry) => {
      if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError(`Invalid ${helperName} input: phone entries must be objects.`);
      const phone = entry as Record<string, unknown>;
      const rawPhone = maybeText(phone.phone, "phone.phone", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
      const waId = maybeText(phone.waId ?? phone.wa_id, "phone.waId", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
      if (rawPhone === undefined && waId === undefined) throw new GraphRequestValidationError(`Invalid ${helperName} input: phone requires phone or waId.`);
      const normalized: Record<string, unknown> = {};
      if (rawPhone !== undefined) normalized.phone = rawPhone;
      if (waId !== undefined) normalized.wa_id = waId;
      const type = maybeText(phone.type, "phone.type", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
      if (type !== undefined) normalized.type = type;
      return normalized;
    });
  }
  if (contact.emails !== undefined) out.emails = mapValidatedArray(assertBoundedArray(contact.emails, "contact.emails", 1, 20, helperName), (entry) => normalizeTypedStringRecord(entry, "email", "email", helperName));
  if (contact.urls !== undefined) {
    out.urls = mapValidatedArray(assertBoundedArray(contact.urls, "contact.urls", 1, 20, helperName), (entry) => {
      const normalized = normalizeTypedStringRecord(entry, "url", "url", helperName);
      normalized.url = assertValidMediaLink(normalized.url, helperName);
      return normalized;
    });
  }
  if (contact.addresses !== undefined) {
    out.addresses = mapValidatedArray(assertBoundedArray(contact.addresses, "contact.addresses", 1, 20, helperName), (entry) => {
      if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError(`Invalid ${helperName} input: address entries must be objects.`);
      const address = entry as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const [camel, snake] of [["street", "street"], ["city", "city"], ["state", "state"], ["zip", "zip"], ["country", "country"], ["countryCode", "country_code"], ["type", "type"]] as const) {
        const v = maybeText(address[camel] ?? address[snake], `address.${camel}`, GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
        if (v !== undefined) normalized[snake] = v;
      }
      if (Object.keys(normalized).length === 0) throw new GraphRequestValidationError(`Invalid ${helperName} input: address entries must contain at least one field.`);
      return normalized;
    });
  }
  if (contact.org !== undefined) {
    if (!isPlainOptionsObject(contact.org)) throw new GraphRequestValidationError(`Invalid ${helperName} input: org must be an object.`);
    const org = contact.org as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of ["company", "department", "title"] as const) {
      const v = maybeText(org[key], `org.${key}`, GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
      if (v !== undefined) normalized[key] = v;
    }
    if (Object.keys(normalized).length > 0) out.org = normalized;
  }
  const birthday = maybeText(contact.birthday, "birthday", 32, helperName);
  if (birthday !== undefined) out.birthday = birthday;
  return out;
}

export function buildSendContactsPayload(input: GraphMessagesSendContactsInput): GraphMessagesContactsPayload {
  const record = asRecordInput(input, "sendContacts");
  const contacts = mapValidatedArray(assertBoundedArray(record.contacts, "contacts", 1, GRAPH_MESSAGES_MAX_CONTACTS, "sendContacts"), (c) => normalizeContact(c, "sendContacts"));
  return withReplyContext({ messaging_product: "whatsapp", to: assertValidRecipient(record.to, "sendContacts"), type: "contacts", contacts }, record);
}

export function buildSendReactionPayload(input: GraphMessagesSendReactionInput): GraphMessagesReactionPayload {
  const record = asRecordInput(input, "sendReaction");
  const emoji = assertNonEmptyControlFreeString(record.emoji, "emoji", 32, "sendReaction");
  return {
    messaging_product: "whatsapp",
    to: assertValidRecipient(record.to, "sendReaction"),
    type: "reaction",
    reaction: {
      message_id: assertNonEmptyControlFreeString(record.messageId, "messageId", GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH, "sendReaction"),
      emoji
    }
  };
}

export function buildRemoveReactionPayload(input: GraphMessagesRemoveReactionInput): GraphMessagesReactionPayload {
  const record = asRecordInput(input, "removeReaction");
  return {
    messaging_product: "whatsapp",
    to: assertValidRecipient(record.to, "removeReaction"),
    type: "reaction",
    reaction: {
      message_id: assertNonEmptyControlFreeString(record.messageId, "messageId", GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH, "removeReaction"),
      emoji: ""
    }
  };
}

function interactiveBase(
  input: unknown,
  helperName: string,
  interactive: Record<string, unknown>
): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, helperName);
  return withReplyContext({ messaging_product: "whatsapp", to: assertValidRecipient(record.to, helperName), type: "interactive", interactive }, record);
}

function addHeaderFooter(target: Record<string, unknown>, record: Record<string, unknown>, helperName: string): void {
  const headerText = maybeText(record.headerText, "headerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  if (headerText !== undefined) target.header = { type: "text", text: headerText };
  if (footerText !== undefined) target.footer = { text: footerText };
}

export function buildSendButtonsPayload(input: GraphMessagesSendButtonsInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendButtons");
  const buttons = mapValidatedArray(assertBoundedArray(record.buttons, "buttons", 1, GRAPH_MESSAGES_MAX_REPLY_BUTTONS, "sendButtons"), (entry) => {
    if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError("Invalid sendButtons input: button entries must be objects.");
    const button = entry as Record<string, unknown>;
    return { type: "reply", reply: { id: assertNonEmptyControlFreeString(button.id, "button.id", GRAPH_MESSAGES_BUTTON_ID_MAX_LENGTH, "sendButtons"), title: assertNonEmptyControlFreeString(button.title, "button.title", GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH, "sendButtons") } };
  });
  const interactive: Record<string, unknown> = { type: "button", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendButtons") }, action: { buttons } };
  addHeaderFooter(interactive, record, "sendButtons");
  return interactiveBase(input, "sendButtons", interactive);
}

export function buildSendListPayload(input: GraphMessagesSendListInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendList");
  let totalRows = 0;
  const sections = mapValidatedArray(assertBoundedArray(record.sections, "sections", 1, GRAPH_MESSAGES_MAX_LIST_SECTIONS, "sendList"), (entry) => {
    if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError("Invalid sendList input: section entries must be objects.");
    const section = entry as Record<string, unknown>;
    const rows = mapValidatedArray(assertBoundedArray(section.rows, "section.rows", 1, GRAPH_MESSAGES_MAX_LIST_ROWS, "sendList"), (rowEntry) => {
      totalRows += 1;
      if (!isPlainOptionsObject(rowEntry)) throw new GraphRequestValidationError("Invalid sendList input: row entries must be objects.");
      const row = rowEntry as Record<string, unknown>;
      const normalized: Record<string, unknown> = { id: assertNonEmptyControlFreeString(row.id, "row.id", GRAPH_MESSAGES_BUTTON_ID_MAX_LENGTH, "sendList"), title: assertNonEmptyControlFreeString(row.title, "row.title", GRAPH_MESSAGES_ROW_TITLE_MAX_LENGTH, "sendList") };
      const desc = maybeText(row.description, "row.description", GRAPH_MESSAGES_ROW_DESCRIPTION_MAX_LENGTH, "sendList");
      if (desc !== undefined) normalized.description = desc;
      return normalized;
    });
    const normalized: Record<string, unknown> = { rows };
    const title = maybeText(section.title, "section.title", GRAPH_MESSAGES_SECTION_TITLE_MAX_LENGTH, "sendList");
    if (title !== undefined) normalized.title = title;
    return normalized;
  });
  if (totalRows > GRAPH_MESSAGES_MAX_LIST_ROWS) throw new GraphRequestValidationError(`Invalid sendList input: total row count exceeds ${GRAPH_MESSAGES_MAX_LIST_ROWS}.`);
  const interactive: Record<string, unknown> = { type: "list", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendList") }, action: { button: assertNonEmptyControlFreeString(record.buttonText, "buttonText", GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH, "sendList"), sections } };
  addHeaderFooter(interactive, record, "sendList");
  return interactiveBase(input, "sendList", interactive);
}

export function buildSendCtaUrlPayload(input: GraphMessagesSendCtaUrlInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendCtaUrl");
  const interactive: Record<string, unknown> = { type: "cta_url", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendCtaUrl") }, action: { name: "cta_url", parameters: { display_text: assertNonEmptyControlFreeString(record.displayText, "displayText", GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH, "sendCtaUrl"), url: assertValidMediaLink(record.url, "sendCtaUrl") } } };
  addHeaderFooter(interactive, record, "sendCtaUrl");
  return interactiveBase(input, "sendCtaUrl", interactive);
}

export function buildSendCallPermissionRequestPayload(input: GraphMessagesSendCallPermissionRequestInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendCallPermissionRequest");
  assertOnlyKnownKeys(record, ["to", "bodyText", "footerText", "replyToMessageId"], "sendCallPermissionRequest");
  const interactive: Record<string, unknown> = {
    type: "call_permission_request",
    body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendCallPermissionRequest") },
    action: { name: "call_permission_request" }
  };
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendCallPermissionRequest");
  if (footerText !== undefined) interactive.footer = { text: footerText };
  return interactiveBase(input, "sendCallPermissionRequest", interactive);
}

export function buildSendProductPayload(input: GraphMessagesSendProductInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendProduct");
  const interactive: Record<string, unknown> = { type: "product", action: { catalog_id: assertNonEmptyControlFreeString(record.catalogId, "catalogId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProduct"), product_retailer_id: assertNonEmptyControlFreeString(record.productRetailerId, "productRetailerId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProduct") } };
  const bodyText = maybeText(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendProduct");
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendProduct");
  if (bodyText !== undefined) interactive.body = { text: bodyText };
  if (footerText !== undefined) interactive.footer = { text: footerText };
  return interactiveBase(input, "sendProduct", interactive);
}

export function buildSendProductsPayload(input: GraphMessagesSendProductsInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendProducts");
  let totalItems = 0;
  const sections = mapValidatedArray(assertBoundedArray(record.sections, "sections", 1, 10, "sendProducts"), (entry) => {
    if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError("Invalid sendProducts input: section entries must be objects.");
    const section = entry as Record<string, unknown>;
    const productItems = mapValidatedArray(assertBoundedArray(section.productItems, "section.productItems", 1, GRAPH_MESSAGES_MAX_PRODUCT_ITEMS, "sendProducts"), (itemEntry) => {
      totalItems += 1;
      if (!isPlainOptionsObject(itemEntry)) throw new GraphRequestValidationError("Invalid sendProducts input: product item entries must be objects.");
      const item = itemEntry as Record<string, unknown>;
      return { product_retailer_id: assertNonEmptyControlFreeString(item.productRetailerId, "productRetailerId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProducts") };
    });
    return { title: assertNonEmptyControlFreeString(section.title, "section.title", GRAPH_MESSAGES_SECTION_TITLE_MAX_LENGTH, "sendProducts"), product_items: productItems };
  });
  if (totalItems > GRAPH_MESSAGES_MAX_PRODUCT_ITEMS) throw new GraphRequestValidationError(`Invalid sendProducts input: total product item count exceeds ${GRAPH_MESSAGES_MAX_PRODUCT_ITEMS}.`);
  const interactive: Record<string, unknown> = { type: "product_list", header: { type: "text", text: assertNonEmptyControlFreeString(record.headerText, "headerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendProducts") }, body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendProducts") }, action: { catalog_id: assertNonEmptyControlFreeString(record.catalogId, "catalogId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProducts"), sections } };
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendProducts");
  if (footerText !== undefined) interactive.footer = { text: footerText };
  return interactiveBase(input, "sendProducts", interactive);
}

export function buildSendCatalogPayload(input: GraphMessagesSendCatalogInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendCatalog");
  const action: Record<string, unknown> = { name: "catalog_message" };
  const thumbnail = maybeText(record.thumbnailProductRetailerId, "thumbnailProductRetailerId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendCatalog");
  if (thumbnail !== undefined) action.parameters = { thumbnail_product_retailer_id: thumbnail };
  const interactive: Record<string, unknown> = { type: "catalog_message", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendCatalog") }, action };
  addHeaderFooter(interactive, record, "sendCatalog");
  return interactiveBase(input, "sendCatalog", interactive);
}

export function buildRequestLocationPayload(input: GraphMessagesRequestLocationInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "requestLocation");
  return interactiveBase(input, "requestLocation", { type: "location_request_message", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "requestLocation") }, action: { name: "send_location" } });
}

export function buildMarkMessageAsReadPayload(input: GraphMessagesMarkMessageAsReadInput): GraphMessagesStatusPayload {
  const record = asRecordInput(input, "markMessageAsRead");
  return { messaging_product: "whatsapp", status: "read", message_id: assertNonEmptyControlFreeString(record.messageId, "messageId", GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH, "markMessageAsRead") };
}

export function buildTypingIndicatorPayload(input: GraphMessagesTypingIndicatorInput): GraphMessagesStatusPayload {
  const payload = buildMarkMessageAsReadPayload(input);
  return { ...payload, typing_indicator: { type: "text" } };
}

function inspectTemplateValue<T>(helperName: string, path: string, inspector: () => T): T {
  try {
    return inspector();
  } catch (error) {
    if (error instanceof GraphRequestValidationError) throw error;
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} could not be inspected.`);
  }
}

function sanitizeTemplateParameter(
  value: unknown,
  helperName: string,
  path: string,
  seen: WeakSet<object>,
  depth = 0
): unknown {
  if (depth > 6) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} exceeds maximum nesting depth.`);
  }
  if (typeof value === "string") {
    if (value.length === 0 || value.length > GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH || hasControlChar(value)) {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} contains an invalid string.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} contains a non-finite number.`);
    }
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const own = inspectTemplateValue(helperName, path, () => Object.getOwnPropertyDescriptors(value));
    if (Object.prototype.hasOwnProperty.call(own, "toJSON") || inspectTemplateValue(helperName, path, () => "toJSON" in value)) {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} must not define toJSON.`);
    }
    for (const [key, descriptor] of Object.entries(own)) {
      if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path}.${key} must not use accessors.`);
      }
    }
    return mapValidatedArray(assertBoundedArray(value, path, 0, 100, helperName), (entry, index) =>
      sanitizeTemplateParameter(entry, helperName, `${path}[${index}]`, seen, depth + 1)
    );
  }
  if (!isPlainOptionsObject(value)) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} must be JSON-serializable.`);
  }
  const record = value as Record<string, unknown>;
  const proto = inspectTemplateValue(helperName, path, () => Object.getPrototypeOf(record));
  if (proto !== Object.prototype && proto !== null) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} must be a plain object.`);
  }
  const descriptors = inspectTemplateValue(helperName, path, () => Object.getOwnPropertyDescriptors(record));
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || inspectTemplateValue(helperName, path, () => "toJSON" in record)) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} must not define toJSON.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path}.${key} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol") {
      throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path}.${key} must be JSON-serializable.`);
    }
  }
  if (seen.has(record)) {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} must not contain cycles.`);
  }
  seen.add(record);
  const out: Record<string, unknown> = {};
  try {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key.length === 0 || key.length > GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH || hasControlChar(key)) {
        throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} contains an invalid key.`);
      }
      const sanitized = sanitizeTemplateParameter(descriptor.value, helperName, `${path}.${key}`, seen, depth + 1);
      if (sanitized !== undefined) out[key] = sanitized;
    }
  } finally {
    seen.delete(record);
  }
  return out;
}

function normalizeTemplateComponent(value: unknown, helperName: string): Record<string, unknown> {
  const cloned = sanitizeTemplateParameter(value, helperName, "component", new WeakSet<object>());
  if (!isPlainOptionsObject(cloned)) throw new GraphRequestValidationError(`Invalid ${helperName} input: component entries must be objects.`);
  const component = cloned as Record<string, unknown>;
  const out: Record<string, unknown> = { type: assertNonEmptyControlFreeString(component.type, "component.type", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName) };
  if (component.subType !== undefined) out.sub_type = assertNonEmptyControlFreeString(component.subType, "component.subType", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  if (component.index !== undefined) out.index = assertNonEmptyControlFreeString(component.index, "component.index", 8, helperName);
  if (component.parameters !== undefined) {
    const parameters = assertBoundedArray(component.parameters, "component.parameters", 0, 100, helperName);
    out.parameters = mapValidatedArray(parameters, (parameter, index) => {
      if (!isPlainOptionsObject(parameter)) throw new GraphRequestValidationError(`Invalid ${helperName} input: component parameters must be objects.`);
      return sanitizeTemplateParameter(parameter, helperName, `component.parameters[${index}]`, new WeakSet<object>());
    });
  }
  return out;
}

export function buildSendTemplatePayload(input: GraphMessagesSendTemplateInput): GraphMessagesTemplatePayload {
  const record = asRecordInput(input, "sendTemplate");
  const template: Record<string, unknown> = { name: assertNonEmptyControlFreeString(record.name, "name", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendTemplate"), language: { code: assertNonEmptyControlFreeString(record.languageCode, "languageCode", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendTemplate") } };
  if (record.components !== undefined) template.components = mapValidatedArray(assertBoundedArray(record.components, "components", 0, 100, "sendTemplate"), (c) => normalizeTemplateComponent(c, "sendTemplate"));
  return withReplyContext({ messaging_product: "whatsapp", to: assertValidRecipient(record.to, "sendTemplate"), type: "template", template }, record);
}

function assertMarketingRecipient(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return assertNonEmptyControlFreeString(value, "recipient", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendMarketingTemplate");
}

function buildMarketingTemplateObject(record: Record<string, unknown>): Record<string, unknown> {
  const name = record.name;
  const languageCode = record.languageCode;
  const components = record.components;
  const template: Record<string, unknown> = {
    name: assertNonEmptyControlFreeString(name, "name", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendMarketingTemplate"),
    language: { code: assertNonEmptyControlFreeString(languageCode, "languageCode", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendMarketingTemplate") }
  };
  if (components !== undefined) {
    template.components = mapValidatedArray(assertBoundedArray(components, "components", 0, 100, "sendMarketingTemplate"), (c) => normalizeTemplateComponent(c, "sendMarketingTemplate"));
  }
  return template;
}

function copySendMarketingTemplateInput(input: GraphMessagesSendMarketingTemplateInput): Record<string, unknown> {
  const record = copyOptionalParamsObject(input, "sendMarketingTemplate");
  assertOnlyKnownKeys(record, ["to", "recipient", "name", "languageCode", "components", "productPolicy", "messageActivitySharing"], "sendMarketingTemplate");
  return record;
}

export function buildSendMarketingTemplatePayload(input: GraphMessagesSendMarketingTemplateInput): GraphMessagesMarketingTemplatePayload {
  const record = copySendMarketingTemplateInput(input);
  const to = record.to === undefined ? undefined : assertValidRecipient(record.to, "sendMarketingTemplate");
  const recipient = assertMarketingRecipient(record.recipient);
  if (to === undefined && recipient === undefined) {
    throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: at least one of to or recipient is required.");
  }
  const payload: GraphMessagesMarketingTemplatePayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    type: "template",
    template: buildMarketingTemplateObject(record)
  };
  if (to !== undefined) payload.to = to;
  if (recipient !== undefined) payload.recipient = recipient;
  const productPolicy = record.productPolicy;
  if (productPolicy !== undefined) {
    if (productPolicy !== "CLOUD_API_FALLBACK" && productPolicy !== "STRICT") {
      throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: productPolicy must be CLOUD_API_FALLBACK or STRICT.");
    }
    payload.product_policy = productPolicy;
  }
  const messageActivitySharing = record.messageActivitySharing;
  if (messageActivitySharing !== undefined) {
    if (typeof messageActivitySharing !== "boolean") {
      throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: messageActivitySharing must be a boolean when provided.");
    }
    payload.message_activity_sharing = messageActivitySharing;
  }
  return payload;
}

const sendMarketingTemplateEndpoint = defineEndpoint<
  { phoneNumberId: string },
  GraphMessagesSendMarketingTemplateInput,
  GraphMessagesMarketingTemplateResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/marketing_messages",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildSendMarketingTemplatePayload
});

export async function sendMarketingTemplate(
  client: GraphClient,
  params: { phoneNumberId: string },
  body: GraphMessagesSendMarketingTemplateInput,
  opts?: EndpointInvokeOptions
): Promise<GraphMessagesMarketingTemplateResponse> {
  if (body === undefined) {
    throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: body is required.");
  }
  return sendMarketingTemplateEndpoint(client, params, body, opts);
}

sendMarketingTemplate.definition = sendMarketingTemplateEndpoint.definition;

export function buildSendMessagePayload(
  input: GraphMessagesSendMessageInput
): GraphMessagesTextPayload {
  const payload: GraphMessagesTextPayload = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "text",
    text: {
      body: input.text
    }
  };

  if (typeof input.previewUrl === "boolean") {
    payload.text.preview_url = input.previewUrl;
  }

  return payload;
}

// F-4 typed validation: numeric, trimmed, non-empty phoneNumberId. The
// error message is kept byte-for-byte identical to preserve backward
// compatibility with existing consumer assertions.
function normalizePhoneNumberId(phoneNumberId: string): string {
  const normalized = phoneNumberId.trim();

  if (!/^\d+$/.test(normalized)) {
    throw new GraphRequestValidationError(
      "Invalid phoneNumberId. Expected a numeric Graph phone number ID path segment."
    );
  }

  return normalized;
}

// --- endpoint-registry callable ----------------------------------------

/**
 * `sendMessage` — Graph `POST /{phoneNumberId}/messages`.
 *
 * Built via `defineEndpoint`, so path-template parsing, param validation,
 * control-char rejection, body passthrough, and F-5 error registry
 * routing are handled uniformly.
 */
export const sendMessage = defineEndpoint<
  { phoneNumberId: string },
  GraphMessagesSendBody,
  GraphMessagesSendResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/messages",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

// --- legacy class-based endpoint (backward-compat) ---------------------

export class GraphMessagesEndpoint {
  private readonly requestExecutor: GraphRequestExecutor;

  constructor(requestExecutor: GraphRequestExecutor) {
    this.requestExecutor = requestExecutor;
  }

  async sendMessage(
    input: GraphMessagesSendMessageInput
  ): Promise<GraphMessagesSendResponse> {
    // Preserve the F-4 typed-error guarantee (message string is part of
    // our public contract surface): validate the phoneNumberId first
    // with a dedicated error message before delegating into the
    // endpoint-registry callable (which would otherwise surface a
    // generic "path traversal"/"control chars" message from the
    // pathParam sanitizer).
    const phoneNumberId = normalizePhoneNumberId(input.phoneNumberId);

    if (typeof (this.requestExecutor as { request: unknown }).request !== "function") {
      throw new GraphRequestValidationError(
        "Invalid GraphMessagesEndpoint: requestExecutor must expose a request() method."
      );
    }
    // Delegate to the endpoint-registry callable. The callable only
    // needs the executor's `request<T>(options)` shape — it never
    // touches GraphClient internals — so the structural cast is safe
    // and the legacy `GraphRequestExecutor` test doubles keep working.
    return sendMessage(
      this.requestExecutor as unknown as GraphClient,
      { phoneNumberId },
      buildSendMessagePayload({ ...input, phoneNumberId })
    );
  }
}
