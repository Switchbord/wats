// WATS-68 messages endpoint module split: validation helpers shared by focused builders.

import { GraphRequestValidationError } from "../../errors.js";

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
export const GRAPH_MESSAGES_GROUP_ID_MAX_LENGTH = 256;
export const GRAPH_MESSAGES_VOICE_CALL_DISPLAY_TEXT_MAX_LENGTH = 20;
export const GRAPH_MESSAGES_VOICE_CALL_TTL_MINUTES_MIN = 1;
export const GRAPH_MESSAGES_VOICE_CALL_TTL_MINUTES_MAX = 43200;
export const GRAPH_MESSAGES_VOICE_CALL_TTL_MINUTES_DEFAULT = 10080;
export const GRAPH_MESSAGES_VOICE_CALL_TEMPLATE_TTL_MINUTES_MIN = 1440;
export const GRAPH_MESSAGES_VOICE_CALL_PAYLOAD_MAX_LENGTH = 512;

export function isPlainOptionsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function assertValidGroupId(to: unknown, helperName = "sendText"): string {
  if (typeof to !== "string") {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: to must be a group id string when recipientType is group.`
    );
  }
  if (to.length === 0 || to.trim().length === 0) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: to must be a non-empty group id string when recipientType is group.`
    );
  }
  if (hasControlChar(to)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: group to must not contain control characters (CR/LF/NUL/etc.).`
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
      `Invalid ${helperName} input: group to must be an opaque id, not a path, URL, or address.`
    );
  }
  if (to.length > GRAPH_MESSAGES_GROUP_ID_MAX_LENGTH) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: group to exceeds ${GRAPH_MESSAGES_GROUP_ID_MAX_LENGTH}-character limit.`
    );
  }
  if (/^\+?\d{1,15}$/.test(to)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: recipientType group requires a group-id-shaped to, not a phone number.`
    );
  }
  return to;
}

export function assertValidRecipient(to: unknown, helperName = "sendText"): string {
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

export function assertRecipientType(value: unknown, helperName: string): "individual" | "group" | undefined {
  if (value === undefined) return undefined;
  if (value === "individual" || value === "group") return value;
  throw new GraphRequestValidationError(
    `Invalid ${helperName} input: recipientType must be individual or group when provided.`
  );
}

export function assertMessageRecipient(record: Record<string, unknown>, helperName: string): {
  readonly to: string;
  readonly recipientType?: "individual" | "group";
} {
  const recipientType = assertRecipientType(record.recipientType, helperName);
  if (recipientType === "group") {
    return { to: assertValidGroupId(record.to, helperName), recipientType };
  }
  const to = assertValidRecipient(record.to, helperName);
  return recipientType === "individual" ? { to, recipientType } : { to };
}

export function applyRecipientType<T extends object>(
  payload: T,
  recipientType: "individual" | "group" | undefined
): T & { recipient_type?: "individual" | "group" } {
  const next = payload as T & { recipient_type?: "individual" | "group" };
  if (recipientType !== undefined) next.recipient_type = recipientType;
  return next;
}

export function rejectGroupRecipient(record: Record<string, unknown>, helperName: string, reason: string): void {
  if (assertRecipientType(record.recipientType, helperName) === "group") {
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${reason} is not supported for group recipients.`);
  }
}

export function assertValidText(text: unknown): string {
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

export function assertValidReplyToMessageId(value: unknown): string {
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

export function assertNonEmptyControlFreeString(
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

export function assertNoUnsupportedMediaFields(
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

export function assertValidMediaLink(value: unknown, helperName: string): string {
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

export function assertValidNumberInRange(
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

export function assertValidIntegerInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  helperName: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: ${fieldName} must be an integer between ${min} and ${max}.`
    );
  }
  return value;
}

export function maybeText(
  value: unknown,
  fieldName: string,
  maxLength: number,
  helperName: string
): string | undefined {
  if (value === undefined) return undefined;
  return assertNonEmptyControlFreeString(value, fieldName, maxLength, helperName);
}

export function withReplyContext<T extends object>(
  payload: T,
  input: Record<string, unknown>
): T & { context?: { message_id: string } } {
  if (input.replyToMessageId === undefined) return payload;
  return {
    ...payload,
    context: { message_id: assertValidReplyToMessageId(input.replyToMessageId) }
  };
}

export function asRecordInput(input: unknown, helperName: string): Record<string, unknown> {
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

export function assertBoundedArray(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  helperName: string
): readonly unknown[] {
  const arr = assertArray(value, fieldName, helperName);
  const length = inspectTemplateValue(helperName, fieldName, () => arr.length);
  if (!Number.isInteger(length) || length < min || length > max) {
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

export function mapValidatedArray<T>(
  values: readonly unknown[],
  mapper: (value: unknown, index: number) => T
): T[] {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 1) {
    out.push(mapper(values[i], i));
  }
  return out;
}

export function assertOnlyKnownKeys(
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

export function inspectTemplateValue<T>(helperName: string, path: string, inspector: () => T): T {
  try {
    return inspector();
  } catch (error) {
    if (error instanceof GraphRequestValidationError) throw error;
    throw new GraphRequestValidationError(`Invalid ${helperName} input: ${path} could not be inspected.`);
  }
}

export function sanitizeTemplateParameter(
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
  const maybeObject = value as object;
  const isArrayValue = inspectTemplateValue(helperName, path, () => Array.isArray(maybeObject));
  if (isArrayValue) {
    const own = inspectTemplateValue(helperName, path, () => Object.getOwnPropertyDescriptors(maybeObject));
    if (Object.prototype.hasOwnProperty.call(own, "toJSON") || inspectTemplateValue(helperName, path, () => "toJSON" in maybeObject)) {
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
