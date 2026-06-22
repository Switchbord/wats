// WATS-68 messages endpoint module split: template and Marketing Messages builders.

import { GraphRequestValidationError } from "../../errors.js";
import type {
  GraphMessagesMarketingTemplatePayload,
  GraphMessagesSendMarketingTemplateInput,
  GraphMessagesSendTemplateInput,
  GraphMessagesTemplatePayload,
  GraphMessagesVoiceCallTemplateButtonInput
} from "./types.js";
import {
  GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH,
  GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH,
  GRAPH_MESSAGES_VOICE_CALL_PAYLOAD_MAX_LENGTH,
  GRAPH_MESSAGES_VOICE_CALL_TTL_MINUTES_MAX,
  GRAPH_MESSAGES_VOICE_CALL_TTL_MINUTES_MIN,
  applyRecipientType,
  assertBoundedArray,
  assertMessageRecipient,
  assertNonEmptyControlFreeString,
  assertOnlyKnownKeys,
  assertRecipientType,
  assertValidIntegerInRange,
  assertValidRecipient,
  asRecordInput,
  rejectGroupRecipient,
  inspectTemplateValue,
  isPlainOptionsObject,
  withReplyContext,
  mapValidatedArray,
  sanitizeTemplateParameter
} from "./validation.js";

function assertGroupTemplateCategory(value: unknown): void {
  if (value === undefined) {
    throw new GraphRequestValidationError("Invalid sendTemplate input: templateCategory is required for group recipients.");
  }
  if (value === "AUTHENTICATION") {
    throw new GraphRequestValidationError("Invalid sendTemplate input: auth templates are not supported for group recipients.");
  }
  if (value !== "UTILITY" && value !== "MARKETING") {
    throw new GraphRequestValidationError("Invalid sendTemplate input: templateCategory must be UTILITY or MARKETING for group recipients.");
  }
}

function assertTemplateRecipient(record: Record<string, unknown>): {
  readonly to?: string;
  readonly recipient?: string;
  readonly recipientType?: "individual" | "group";
} {
  const recipientType = assertRecipientType(record.recipientType, "sendTemplate");
  if (recipientType === "group") return assertMessageRecipient(record, "sendTemplate");
  const to = record.to === undefined ? undefined : assertValidRecipient(record.to, "sendTemplate");
  const recipient = record.recipient === undefined
    ? undefined
    : assertNonEmptyControlFreeString(record.recipient, "recipient", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendTemplate");
  if (to === undefined && recipient === undefined) {
    throw new GraphRequestValidationError("Invalid sendTemplate input: at least one of to or recipient is required.");
  }
  return {
    ...(to !== undefined ? { to } : {}),
    ...(recipient !== undefined ? { recipient } : {}),
    ...(recipientType !== undefined ? { recipientType } : recipient !== undefined ? { recipientType: "individual" as const } : {})
  };
}

export function buildVoiceCallTemplateButtonComponent(input: GraphMessagesVoiceCallTemplateButtonInput): Record<string, unknown> {
  const record = asRecordInput(input, "buildVoiceCallTemplateButtonComponent");
  assertOnlyKnownKeys(record, ["ttlMinutes", "payload", "index"], "buildVoiceCallTemplateButtonComponent");
  const parameters: Record<string, unknown>[] = [];
  if (record.ttlMinutes !== undefined) {
    parameters.push({
      type: "ttl_minutes",
      ttl_minutes: assertValidIntegerInRange(record.ttlMinutes, "ttlMinutes", GRAPH_MESSAGES_VOICE_CALL_TTL_MINUTES_MIN, GRAPH_MESSAGES_VOICE_CALL_TTL_MINUTES_MAX, "buildVoiceCallTemplateButtonComponent")
    });
  }
  if (record.payload !== undefined) {
    parameters.push({
      type: "payload",
      payload: assertNonEmptyControlFreeString(record.payload, "payload", GRAPH_MESSAGES_VOICE_CALL_PAYLOAD_MAX_LENGTH, "buildVoiceCallTemplateButtonComponent")
    });
  }
  const out: Record<string, unknown> = { type: "button", sub_type: "voice_call" };
  if (record.index !== undefined) out.index = assertNonEmptyControlFreeString(record.index, "index", 8, "buildVoiceCallTemplateButtonComponent");
  if (parameters.length > 0) out.parameters = parameters;
  return out;
}

function normalizeTemplateComponent(value: unknown, helperName: string): Record<string, unknown> {
  const cloned = sanitizeTemplateParameter(value, helperName, "component", new WeakSet<object>());
  if (!isPlainOptionsObject(cloned)) throw new GraphRequestValidationError(`Invalid ${helperName} input: component entries must be objects.`);
  const component = cloned as Record<string, unknown>;
  const out: Record<string, unknown> = { type: assertNonEmptyControlFreeString(component.type, "component.type", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName) };
  if (component.subType !== undefined) out.sub_type = assertNonEmptyControlFreeString(component.subType, "component.subType", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  else if (component.sub_type !== undefined) out.sub_type = assertNonEmptyControlFreeString(component.sub_type, "component.sub_type", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
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
  assertOnlyKnownKeys(record, ["to", "recipient", "recipientType", "name", "languageCode", "templateCategory", "components", "replyToMessageId"], "sendTemplate");
  const recipient = assertTemplateRecipient(record);
  if (recipient.recipientType === "group") {
    assertGroupTemplateCategory(record.templateCategory);
  }
  const template: Record<string, unknown> = { name: assertNonEmptyControlFreeString(record.name, "name", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendTemplate"), language: { code: assertNonEmptyControlFreeString(record.languageCode, "languageCode", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendTemplate") } };
  if (record.components !== undefined) template.components = mapValidatedArray(assertBoundedArray(record.components, "components", 0, 100, "sendTemplate"), (c) => normalizeTemplateComponent(c, "sendTemplate"));
  return withReplyContext(applyRecipientType({
    messaging_product: "whatsapp",
    ...(recipient.to !== undefined ? { to: recipient.to } : {}),
    ...(recipient.recipient !== undefined ? { recipient: recipient.recipient } : {}),
    type: "template",
    template
  }, recipient.recipientType), record);
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
  if (typeof input !== "object" || input === null) {
    throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: expected an options object.");
  }
  const record = input as unknown as Record<string, unknown>;
  const isArrayInput = inspectTemplateValue("sendMarketingTemplate", "input", () => Array.isArray(record));
  if (isArrayInput) {
    throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: expected an options object.");
  }
  const proto = inspectTemplateValue("sendMarketingTemplate", "input", () => Object.getPrototypeOf(record));
  if (proto !== Object.prototype && proto !== null) {
    throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: expected a plain options object.");
  }
  const descriptors = inspectTemplateValue("sendMarketingTemplate", "input", () => Object.getOwnPropertyDescriptors(record));
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || inspectTemplateValue("sendMarketingTemplate", "input", () => "toJSON" in record)) {
    throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: input must not define toJSON.");
  }
  const out: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw new GraphRequestValidationError(`Invalid sendMarketingTemplate input: ${key} must not use accessors.`);
    }
    if (descriptor.value !== undefined) out[key] = descriptor.value;
  }
  assertOnlyKnownKeys(out, ["to", "recipient", "recipientType", "name", "languageCode", "components", "productPolicy", "messageActivitySharing"], "sendMarketingTemplate");
  return out;
}

export function buildSendMarketingTemplatePayload(input: GraphMessagesSendMarketingTemplateInput): GraphMessagesMarketingTemplatePayload {
  const record = copySendMarketingTemplateInput(input);
  rejectGroupRecipient(record, "sendMarketingTemplate", "marketing templates");
  assertRecipientType(record.recipientType, "sendMarketingTemplate");
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
