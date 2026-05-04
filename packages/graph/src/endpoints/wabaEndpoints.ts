// F-7/WATS-39 WABA-scope endpoints.
//
// WATS-39 adds credential-free WhatsApp Business Account message-template
// management parity. All operations are ordinary Graph endpoint callables
// layered on defineEndpoint and MockTransport-testable without live WABA
// credentials.

import { defineEndpoint, type EndpointCallable } from "../endpoint";
import { GraphRequestValidationError } from "../errors";
import type { EndpointInvokeOptions } from "../endpoint";
import { TemplateParamCountMismatchError } from "../errorSubclasses";
import {
  normalizeListPhoneNumbersParams,
  sanitizeBusinessManagementOptions,
  type ListPhoneNumbersInput
} from "./businessManagement";

export interface PhoneNumberListEntry {
  readonly id: string;
  readonly display_phone_number?: string;
  readonly verified_name?: string;
  readonly quality_rating?: string;
}

export interface PhoneNumberListResponse {
  readonly data?: readonly PhoneNumberListEntry[];
  readonly paging?: GraphPaging;
}

export interface GraphPaging {
  readonly cursors?: {
    readonly before?: string;
    readonly after?: string;
  };
  readonly next?: string;
  readonly previous?: string;
}

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type TemplateStatus =
  | "APPROVED"
  | "IN_APPEAL"
  | "PENDING"
  | "REJECTED"
  | "PENDING_DELETION"
  | "DELETED"
  | "DISABLED"
  | "PAUSED"
  | "LIMIT_EXCEEDED";
export type TemplateLanguageCode = string;
export type TemplateParameterFormat = "POSITIONAL" | "NAMED";
export type TemplateQualityScore = "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | string;
export type TemplateHeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";
export type TemplateButtonType =
  | "QUICK_REPLY"
  | "URL"
  | "PHONE_NUMBER"
  | "COPY_CODE"
  | "CATALOG"
  | "FLOW";

export interface TemplateComponent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface TemplateDetails {
  readonly id?: string;
  readonly name?: string;
  readonly language?: string;
  readonly status?: TemplateStatus | string;
  readonly category?: TemplateCategory | string;
  readonly components?: readonly TemplateComponent[];
  readonly parameter_format?: TemplateParameterFormat;
  readonly message_send_ttl_seconds?: number;
  readonly quality_score?: TemplateQualityScore | Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface TemplateListResponse {
  readonly data?: readonly TemplateDetails[];
  readonly paging?: GraphPaging;
}

export interface TemplateMutationResponse {
  readonly id?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface ListMessageTemplatesInput {
  readonly wabaId: string;
  readonly fields?: string;
  readonly status?: TemplateStatus | string;
  readonly category?: TemplateCategory | string;
  readonly language?: TemplateLanguageCode;
  readonly name?: string;
  readonly content?: string;
  readonly nameOrContent?: string;
  readonly qualityScore?: string;
  readonly limit?: string;
  readonly after?: string;
}

export interface GetMessageTemplateInput {
  readonly templateId: string;
  readonly fields?: string;
}

export interface CreateMessageTemplateBody {
  readonly name: string;
  readonly language: TemplateLanguageCode;
  readonly category: TemplateCategory | string;
  readonly components: readonly TemplateComponent[];
  readonly parameterFormat?: TemplateParameterFormat;
  readonly messageSendTtlSeconds?: number;
  readonly [key: string]: unknown;
}

export interface UpdateMessageTemplateBody {
  readonly category?: TemplateCategory | string;
  readonly components?: readonly TemplateComponent[];
  readonly parameterFormat?: TemplateParameterFormat;
  readonly messageSendTtlSeconds?: number;
  readonly [key: string]: unknown;
}

export interface DeleteMessageTemplateInput {
  readonly wabaId: string;
  readonly name: string;
  /** Maps to Graph query parameter `hsm_id`. */
  readonly templateId?: string;
}

export interface TemplateHeaderComponentInput {
  readonly format: TemplateHeaderFormat;
  readonly text?: string;
  readonly example?: unknown;
  readonly [key: string]: unknown;
}

export interface TemplateBodyComponentInput {
  readonly text: string;
  readonly example?: unknown;
  readonly [key: string]: unknown;
}

export interface TemplateFooterComponentInput {
  readonly text: string;
  readonly [key: string]: unknown;
}

export type TemplateButtonInput =
  | { readonly type: "QUICK_REPLY"; readonly text: string; readonly [key: string]: unknown }
  | { readonly type: "URL"; readonly text: string; readonly url: string; readonly [key: string]: unknown }
  | { readonly type: "PHONE_NUMBER"; readonly text: string; readonly phoneNumber: string; readonly [key: string]: unknown }
  | { readonly type: "COPY_CODE"; readonly example: string; readonly [key: string]: unknown }
  | { readonly type: "CATALOG"; readonly text?: string; readonly [key: string]: unknown }
  | { readonly type: "FLOW"; readonly text: string; readonly flowId?: string; readonly flowName?: string; readonly flowAction?: string; readonly navigateScreen?: string; readonly [key: string]: unknown };

export interface TemplateButtonsComponentInput {
  readonly buttons: readonly TemplateButtonInput[];
  readonly [key: string]: unknown;
}

export interface TemplateDefinitionForValidation {
  readonly parameterFormat?: TemplateParameterFormat;
  readonly parameter_format?: TemplateParameterFormat;
  readonly components: readonly TemplateComponent[];
}

export type SendTemplateComponentForValidation = {
  readonly type: string;
  readonly subType?: string;
  readonly sub_type?: string;
  readonly index?: string;
  readonly parameters?: readonly unknown[];
  readonly [key: string]: unknown;
};

const TEMPLATE_NAME_MAX_LENGTH = 512;
const TEMPLATE_TEXT_MAX_LENGTH = 4096;
const TEMPLATE_SHORT_TEXT_MAX_LENGTH = 1024;
const TEMPLATE_MAX_COMPONENTS = 20;
const TEMPLATE_MAX_BUTTONS = 10;
const TEMPLATE_MAX_ARRAY = 100;
const TEMPLATE_MAX_DEPTH = 8;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function validationError(message: string): GraphRequestValidationError {
  return new GraphRequestValidationError(message);
}

function mismatchError(message: string): TemplateParamCountMismatchError {
  return new TemplateParamCountMismatchError({
    status: 400,
    payload: { message, type: "ValidationError", code: 132000 },
    headers: new Headers(),
    requestUrl: "wats://local/template-parameter-validation"
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPlainRecord(value: unknown, helperName: string, path = "input"): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw validationError(`Invalid ${helperName} input: ${path} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw validationError(`Invalid ${helperName} input: ${path} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw validationError(`Invalid ${helperName} input: ${path} must not define toJSON.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw validationError(`Invalid ${helperName} input: ${path}.${key} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol") {
      throw validationError(`Invalid ${helperName} input: ${path}.${key} must be JSON-serializable.`);
    }
  }
  return value;
}

function assertString(value: unknown, fieldName: string, helperName: string, maxLength = TEMPLATE_NAME_MAX_LENGTH): string {
  if (typeof value !== "string") {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be non-empty.`);
  }
  if (hasControlChar(value)) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must not contain control characters (CR/LF/NUL/etc.).`);
  }
  if (value.length > maxLength) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} exceeds ${maxLength}-character limit.`);
  }
  return value;
}

function maybeString(value: unknown, fieldName: string, helperName: string, maxLength = TEMPLATE_NAME_MAX_LENGTH): string | undefined {
  if (value === undefined) return undefined;
  return assertString(value, fieldName, helperName, maxLength);
}

function assertArray(value: unknown, fieldName: string, min: number, max: number, helperName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be an array.`);
  }
  if (value.length < min || value.length > max) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} length must be between ${min} and ${max}.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must use Array.prototype.`);
  }
  if (Object.prototype.hasOwnProperty.call(value, Symbol.iterator) || Object.prototype.hasOwnProperty.call(value, "map")) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must not override Array.prototype methods.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must not define toJSON.`);
  }
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) {
      throw validationError(`Invalid ${helperName} input: ${fieldName} must not contain sparse array holes.`);
    }
    const descriptor = descriptors[String(i)];
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw validationError(`Invalid ${helperName} input: ${fieldName} must not use accessors.`);
    }
    copy.push(descriptor.value);
  }
  return copy;
}

function safeJsonClone(value: unknown, helperName: string, path = "input", seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > TEMPLATE_MAX_DEPTH) {
    throw validationError(`Invalid ${helperName} input: ${path} exceeds maximum nesting depth.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (hasControlChar(value)) throw validationError(`Invalid ${helperName} input: ${path} contains control characters.`);
    if (value.length > TEMPLATE_TEXT_MAX_LENGTH) throw validationError(`Invalid ${helperName} input: ${path} string exceeds limit.`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw validationError(`Invalid ${helperName} input: ${path} contains a non-finite number.`);
    return value;
  }
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw validationError(`Invalid ${helperName} input: ${path} must not contain cycles.`);
    seen.add(value);
    const arr = assertArray(value, path, 0, TEMPLATE_MAX_ARRAY, helperName);
    const out: unknown[] = [];
    for (let index = 0; index < arr.length; index += 1) {
      out.push(safeJsonClone(arr[index], helperName, `${path}[${index}]`, seen, depth + 1));
    }
    seen.delete(value);
    return out;
  }
  const record = assertPlainRecord(value, helperName, path);
  if (seen.has(record)) throw validationError(`Invalid ${helperName} input: ${path} must not contain cycles.`);
  seen.add(record);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key.length === 0 || hasControlChar(key) || key.length > TEMPLATE_SHORT_TEXT_MAX_LENGTH) {
      throw validationError(`Invalid ${helperName} input: ${path} contains an invalid key.`);
    }
    const cloned = safeJsonClone(nested, helperName, `${path}.${key}`, seen, depth + 1);
    if (cloned !== undefined) out[key] = cloned;
  }
  seen.delete(record);
  return out;
}

function maybeExample(value: unknown, helperName: string): unknown {
  if (value === undefined) return undefined;
  const cloned = safeJsonClone(value, helperName, "example");
  if (isPlainObject(cloned)) {
    const rec = cloned as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(rec)) {
      if (key === "headerHandle") out.header_handle = nested;
      else if (key === "bodyText") out.body_text = nested;
      else out[key] = nested;
    }
    return out;
  }
  return cloned;
}

function normalizeComponent(value: unknown, helperName: string): TemplateComponent {
  const cloned = safeJsonClone(value, helperName, "component");
  const record = assertPlainRecord(cloned, helperName, "component");
  const type = assertString(record.type, "component.type", helperName, TEMPLATE_SHORT_TEXT_MAX_LENGTH).toUpperCase();
  const out: Record<string, unknown> = { ...record, type };
  return out as TemplateComponent;
}

function normalizeComponents(value: unknown, helperName: string, required: boolean): TemplateComponent[] | undefined {
  if (value === undefined) {
    if (required) throw validationError(`Invalid ${helperName} input: components must be provided.`);
    return undefined;
  }
  const arr = assertArray(value, "components", required ? 1 : 0, TEMPLATE_MAX_COMPONENTS, helperName);
  const out: TemplateComponent[] = [];
  for (const entry of arr) {
    out.push(normalizeComponent(entry, helperName));
  }
  return out;
}

function mapCommonBodyFields(record: Record<string, unknown>, helperName: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (key === "parameterFormat") out.parameter_format = assertString(value, "parameterFormat", helperName, 32);
    else if (key === "messageSendTtlSeconds") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw validationError(`Invalid ${helperName} input: messageSendTtlSeconds must be a non-negative integer.`);
      }
      out.message_send_ttl_seconds = value;
    } else if (key === "components") {
      const components = normalizeComponents(value, helperName, helperName === "createMessageTemplate");
      if (components !== undefined) out.components = components;
    } else {
      out[key] = safeJsonClone(value, helperName, key);
    }
  }
  return out;
}

export function buildCreateMessageTemplateBody(input: CreateMessageTemplateBody): Record<string, unknown> {
  const record = assertPlainRecord(input, "createMessageTemplate");
  const out = mapCommonBodyFields(record, "createMessageTemplate");
  out.name = assertString(record.name, "name", "createMessageTemplate");
  out.language = assertString(record.language, "language", "createMessageTemplate", 64);
  out.category = assertString(record.category, "category", "createMessageTemplate", 64);
  out.components = normalizeComponents(record.components, "createMessageTemplate", true);
  return out;
}

export function buildUpdateMessageTemplateBody(input: UpdateMessageTemplateBody): Record<string, unknown> {
  const record = assertPlainRecord(input, "updateMessageTemplate");
  const out = mapCommonBodyFields(record, "updateMessageTemplate");
  if (record.category !== undefined) out.category = assertString(record.category, "category", "updateMessageTemplate", 64);
  return out;
}

export function buildTemplateHeaderComponent(input: TemplateHeaderComponentInput | TemplateComponent): TemplateComponent {
  const record = assertPlainRecord(input, "buildTemplateHeaderComponent");
  const format = assertString(record.format, "format", "buildTemplateHeaderComponent", 32).toUpperCase();
  const out: Record<string, unknown> = { type: "HEADER", format };
  if (format === "TEXT") out.text = assertString(record.text, "text", "buildTemplateHeaderComponent", TEMPLATE_TEXT_MAX_LENGTH);
  else if (record.text !== undefined) out.text = assertString(record.text, "text", "buildTemplateHeaderComponent", TEMPLATE_TEXT_MAX_LENGTH);
  const example = maybeExample(record.example, "buildTemplateHeaderComponent");
  if (example !== undefined) out.example = example;
  return out as TemplateComponent;
}

export function buildTemplateBodyComponent(input: TemplateBodyComponentInput | TemplateComponent): TemplateComponent {
  const record = assertPlainRecord(input, "buildTemplateBodyComponent");
  const out: Record<string, unknown> = { type: "BODY", text: assertString(record.text, "text", "buildTemplateBodyComponent", TEMPLATE_TEXT_MAX_LENGTH) };
  const example = maybeExample(record.example, "buildTemplateBodyComponent");
  if (example !== undefined) out.example = example;
  return out as TemplateComponent;
}

export function buildTemplateFooterComponent(input: TemplateFooterComponentInput | TemplateComponent): TemplateComponent {
  const record = assertPlainRecord(input, "buildTemplateFooterComponent");
  return { type: "FOOTER", text: assertString(record.text, "text", "buildTemplateFooterComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH) };
}

function normalizeButton(input: unknown, index: number): Record<string, unknown> {
  const record = assertPlainRecord(input, "buildTemplateButtonComponent", `buttons[${index}]`);
  const type = assertString(record.type, "button.type", "buildTemplateButtonComponent", 32).toUpperCase();
  const out: Record<string, unknown> = { type };
  if (record.text !== undefined) out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
  switch (type) {
    case "QUICK_REPLY":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    case "URL":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      out.url = assertString(record.url, "button.url", "buildTemplateButtonComponent", TEMPLATE_TEXT_MAX_LENGTH);
      break;
    case "PHONE_NUMBER":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      out.phone_number = assertString(record.phoneNumber, "button.phoneNumber", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    case "COPY_CODE":
      out.example = assertString(record.example, "button.example", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    case "CATALOG":
      break;
    case "FLOW":
      out.text = assertString(record.text, "button.text", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.flowId !== undefined) out.flow_id = assertString(record.flowId, "button.flowId", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.flowName !== undefined) out.flow_name = assertString(record.flowName, "button.flowName", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.flowAction !== undefined) out.flow_action = assertString(record.flowAction, "button.flowAction", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      if (record.navigateScreen !== undefined) out.navigate_screen = assertString(record.navigateScreen, "button.navigateScreen", "buildTemplateButtonComponent", TEMPLATE_SHORT_TEXT_MAX_LENGTH);
      break;
    default:
      throw validationError(`Invalid buildTemplateButtonComponent input: unsupported button type ${JSON.stringify(type)}.`);
  }
  return out;
}

export function buildTemplateButtonComponent(input: TemplateButtonsComponentInput | TemplateComponent): TemplateComponent & { readonly buttons: readonly Record<string, unknown>[] } {
  const record = assertPlainRecord(input, "buildTemplateButtonComponent");
  const rawButtons = assertArray(record.buttons, "buttons", 1, TEMPLATE_MAX_BUTTONS, "buildTemplateButtonComponent");
  const buttons: Record<string, unknown>[] = [];
  for (let index = 0; index < rawButtons.length; index += 1) {
    buttons.push(normalizeButton(rawButtons[index], index));
  }
  return { type: "BUTTONS", buttons };
}

function normalizeListParams(input: ListMessageTemplatesInput): Record<string, string> {
  const record = assertPlainRecord(input, "listMessageTemplates");
  const out: Record<string, string> = { wabaId: assertString(record.wabaId, "wabaId", "listMessageTemplates") };
  for (const [publicKey, graphKey] of [
    ["fields", "fields"],
    ["status", "status"],
    ["category", "category"],
    ["language", "language"],
    ["name", "name"],
    ["content", "content"],
    ["nameOrContent", "name_or_content"],
    ["qualityScore", "quality_score"],
    ["limit", "limit"],
    ["after", "after"]
  ] as const) {
    if (record[publicKey] !== undefined) out[graphKey] = assertString(record[publicKey], publicKey, "listMessageTemplates");
  }
  return out;
}

function normalizeGetParams(input: GetMessageTemplateInput): Record<string, string> {
  const record = assertPlainRecord(input, "getMessageTemplate");
  const out: Record<string, string> = { templateId: assertString(record.templateId, "templateId", "getMessageTemplate") };
  if (record.fields !== undefined) out.fields = assertString(record.fields, "fields", "getMessageTemplate");
  return out;
}

function normalizeDeleteParams(input: DeleteMessageTemplateInput): Record<string, string> {
  const record = assertPlainRecord(input, "deleteMessageTemplate");
  const out: Record<string, string> = {
    wabaId: assertString(record.wabaId, "wabaId", "deleteMessageTemplate"),
    name: assertString(record.name, "name", "deleteMessageTemplate")
  };
  if (record.templateId !== undefined) out.hsm_id = assertString(record.templateId, "templateId", "deleteMessageTemplate");
  return out;
}

const listPhoneNumbersRaw = defineEndpoint<
  { wabaId: string; fields?: string; limit?: string; after?: string; before?: string },
  never,
  PhoneNumberListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/phone_numbers",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" },
    before: { in: "query" }
  }
});

export const listPhoneNumbers = Object.assign(
  async function listPhoneNumbers(
    client: Parameters<typeof listPhoneNumbersRaw>[0],
    params: ListPhoneNumbersInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ) {
    if (body !== undefined) {
      throw new GraphRequestValidationError("Invalid listPhoneNumbers input: GET endpoints do not accept a body.");
    }
    return listPhoneNumbersRaw(
      client,
      normalizeListPhoneNumbersParams(params) as Parameters<typeof listPhoneNumbersRaw>[1],
      undefined,
      sanitizeBusinessManagementOptions(opts, "listPhoneNumbers")
    );
  },
  { definition: listPhoneNumbersRaw.definition }
) as unknown as {
  (client: Parameters<typeof listPhoneNumbersRaw>[0], params: ListPhoneNumbersInput, body?: never, opts?: EndpointInvokeOptions): Promise<PhoneNumberListResponse>;
  readonly definition: typeof listPhoneNumbersRaw.definition;
};

const listMessageTemplatesRaw = defineEndpoint<
  {
    wabaId: string;
    fields?: string;
    status?: string;
    category?: string;
    language?: string;
    name?: string;
    content?: string;
    name_or_content?: string;
    quality_score?: string;
    limit?: string;
    after?: string;
  },
  never,
  TemplateListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/message_templates",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    status: { in: "query" },
    category: { in: "query" },
    language: { in: "query" },
    name: { in: "query" },
    content: { in: "query" },
    name_or_content: { in: "query" },
    quality_score: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" }
  }
});

export const listMessageTemplates = Object.assign(
  async function listMessageTemplates(client: Parameters<typeof listMessageTemplatesRaw>[0], params: ListMessageTemplatesInput, body?: never, opts?: Parameters<typeof listMessageTemplatesRaw>[3]) {
    return listMessageTemplatesRaw(client, normalizeListParams(params) as Parameters<typeof listMessageTemplatesRaw>[1], body, opts);
  },
  { definition: listMessageTemplatesRaw.definition }
) as unknown as {
  (client: Parameters<typeof listMessageTemplatesRaw>[0], params: ListMessageTemplatesInput, body?: never, opts?: Parameters<typeof listMessageTemplatesRaw>[3]): Promise<TemplateListResponse>;
  readonly definition: typeof listMessageTemplatesRaw.definition;
};

const getMessageTemplateRaw = defineEndpoint<{ templateId: string; fields?: string }, never, TemplateDetails>({
  method: "GET",
  pathTemplate: "/{templateId}",
  params: { templateId: { in: "path", required: true }, fields: { in: "query" } }
});

export const getMessageTemplate = Object.assign(
  async function getMessageTemplate(client: Parameters<typeof getMessageTemplateRaw>[0], params: GetMessageTemplateInput, body?: never, opts?: Parameters<typeof getMessageTemplateRaw>[3]) {
    return getMessageTemplateRaw(client, normalizeGetParams(params) as Parameters<typeof getMessageTemplateRaw>[1], body, opts);
  },
  { definition: getMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof getMessageTemplateRaw>[0], params: GetMessageTemplateInput, body?: never, opts?: Parameters<typeof getMessageTemplateRaw>[3]): Promise<TemplateDetails>;
  readonly definition: typeof getMessageTemplateRaw.definition;
};

const createMessageTemplateRaw = defineEndpoint<
  { wabaId: string },
  CreateMessageTemplateBody,
  TemplateMutationResponse
>({
  method: "POST",
  pathTemplate: "/{wabaId}/message_templates",
  params: { wabaId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildCreateMessageTemplateBody
});

export const createMessageTemplate = Object.assign(
  async function createMessageTemplate(client: Parameters<typeof createMessageTemplateRaw>[0], params: { readonly wabaId: string }, body: CreateMessageTemplateBody, opts?: Parameters<typeof createMessageTemplateRaw>[3]) {
    const record = assertPlainRecord(params, "createMessageTemplate", "params");
    return createMessageTemplateRaw(client, { wabaId: assertString(record.wabaId, "wabaId", "createMessageTemplate") }, body, opts);
  },
  { definition: createMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof createMessageTemplateRaw>[0], params: { readonly wabaId: string }, body: CreateMessageTemplateBody, opts?: Parameters<typeof createMessageTemplateRaw>[3]): Promise<TemplateMutationResponse>;
  readonly definition: typeof createMessageTemplateRaw.definition;
};

const updateMessageTemplateRaw = defineEndpoint<
  { templateId: string },
  UpdateMessageTemplateBody,
  TemplateMutationResponse
>({
  method: "POST",
  pathTemplate: "/{templateId}",
  params: { templateId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUpdateMessageTemplateBody
});

export const updateMessageTemplate = Object.assign(
  async function updateMessageTemplate(client: Parameters<typeof updateMessageTemplateRaw>[0], params: { readonly templateId: string }, body: UpdateMessageTemplateBody, opts?: Parameters<typeof updateMessageTemplateRaw>[3]) {
    const record = assertPlainRecord(params, "updateMessageTemplate", "params");
    return updateMessageTemplateRaw(client, { templateId: assertString(record.templateId, "templateId", "updateMessageTemplate") }, body, opts);
  },
  { definition: updateMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof updateMessageTemplateRaw>[0], params: { readonly templateId: string }, body: UpdateMessageTemplateBody, opts?: Parameters<typeof updateMessageTemplateRaw>[3]): Promise<TemplateMutationResponse>;
  readonly definition: typeof updateMessageTemplateRaw.definition;
};

const deleteMessageTemplateRaw = defineEndpoint<{ wabaId: string; name: string; hsm_id?: string }, never, TemplateMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{wabaId}/message_templates",
  params: { wabaId: { in: "path", required: true }, name: { in: "query", required: true }, hsm_id: { in: "query" } }
});

export const deleteMessageTemplate = Object.assign(
  async function deleteMessageTemplate(client: Parameters<typeof deleteMessageTemplateRaw>[0], params: DeleteMessageTemplateInput, body?: never, opts?: Parameters<typeof deleteMessageTemplateRaw>[3]) {
    return deleteMessageTemplateRaw(client, normalizeDeleteParams(params) as Parameters<typeof deleteMessageTemplateRaw>[1], body, opts);
  },
  { definition: deleteMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof deleteMessageTemplateRaw>[0], params: DeleteMessageTemplateInput, body?: never, opts?: Parameters<typeof deleteMessageTemplateRaw>[3]): Promise<TemplateMutationResponse>;
  readonly definition: typeof deleteMessageTemplateRaw.definition;
};

function componentText(component: unknown): string | undefined {
  if (!isPlainObject(component)) return undefined;
  const safe = safeJsonClone(component, "validateTemplateParameterCounts", "definition.component");
  if (!isPlainObject(safe)) return undefined;
  const type = typeof safe.type === "string" ? safe.type.toUpperCase() : "";
  if (type !== "HEADER" && type !== "BODY") return undefined;
  return typeof safe.text === "string" ? safe.text : undefined;
}

function placeholders(text: string, format: TemplateParameterFormat): string[] {
  const found: string[] = [];
  const rx = /\{\{\s*([^{}\s]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(text)) !== null) {
    const token = match[1] ?? "";
    if (format === "POSITIONAL" && /^\d+$/.test(token)) found.push(token);
    else if (format === "NAMED" && !/^\d+$/.test(token)) found.push(token);
  }
  return Array.from(new Set(found));
}

function getComponentKind(component: unknown): string | undefined {
  if (!isPlainObject(component)) return undefined;
  const safe = safeJsonClone(component, "validateTemplateParameterCounts", "definition.component");
  if (!isPlainObject(safe) || typeof safe.type !== "string") return undefined;
  return safe.type.toUpperCase();
}

function getSendParameterNames(component: SendTemplateComponentForValidation, helperName: string): string[] {
  const safeComponent = safeJsonClone(component, helperName, "sendComponent");
  if (!isPlainObject(safeComponent)) {
    throw validationError(`Invalid ${helperName} input: sendComponent must be an object.`);
  }
  const params = safeComponent.parameters;
  if (params === undefined) return [];
  const arr = assertArray(params, "component.parameters", 0, TEMPLATE_MAX_ARRAY, helperName);
  const names: string[] = [];
  for (let index = 0; index < arr.length; index += 1) {
    const entry = arr[index];
    if (!isPlainObject(entry)) continue;
    const value = entry.parameter_name;
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || hasControlChar(value)) {
      throw validationError(`Invalid ${helperName} input: component.parameters[${index}].parameter_name must be a safe string.`);
    }
    names.push(value);
  }
  return names;
}

export function validateTemplateParameterCounts(
  definition: TemplateDefinitionForValidation,
  sendComponents: readonly SendTemplateComponentForValidation[]
): void {
  const helperName = "validateTemplateParameterCounts";
  const defRecord = assertPlainRecord(definition, helperName, "definition");
  const formatRaw = defRecord.parameterFormat ?? defRecord.parameter_format ?? "POSITIONAL";
  const format = assertString(formatRaw, "parameterFormat", helperName, 32).toUpperCase() as TemplateParameterFormat;
  if (format !== "POSITIONAL" && format !== "NAMED") throw validationError(`Invalid ${helperName} input: parameterFormat must be POSITIONAL or NAMED.`);
  const defComponents = assertArray(defRecord.components, "definition.components", 0, TEMPLATE_MAX_COMPONENTS, helperName);
  const sendArr = assertArray(sendComponents, "sendComponents", 0, TEMPLATE_MAX_COMPONENTS, helperName);
  const byType = new Map<string, SendTemplateComponentForValidation>();
  for (const entry of sendArr) {
    const safeEntry = safeJsonClone(entry, helperName, "sendComponent");
    const rec = assertPlainRecord(safeEntry, helperName, "sendComponent");
    const kind = assertString(rec.type, "sendComponent.type", helperName, 32).toUpperCase();
    if (kind === "HEADER" || kind === "BODY") byType.set(kind, rec as SendTemplateComponentForValidation);
  }
  for (const defComponent of defComponents) {
    const kind = getComponentKind(defComponent);
    const text = componentText(defComponent);
    if ((kind !== "HEADER" && kind !== "BODY") || text === undefined) continue;
    const expectedTokens = placeholders(text, format);
    const sendComponent = byType.get(kind);
    const actual = sendComponent?.parameters === undefined
      ? []
      : assertArray(sendComponent.parameters, "component.parameters", 0, TEMPLATE_MAX_ARRAY, helperName);
    if (format === "NAMED") {
      const names = getSendParameterNames(sendComponent ?? { type: kind, parameters: [] }, helperName);
      const missing = expectedTokens.filter((token) => !names.includes(token));
      const extra = names.filter((name) => !expectedTokens.includes(name));
      if (missing.length > 0 || extra.length > 0 || names.length !== expectedTokens.length) {
        throw mismatchError(`Template ${kind} named parameters mismatch: expected [${expectedTokens.join(",")}] got [${names.join(",")}].`);
      }
    } else if (actual.length !== expectedTokens.length) {
      throw mismatchError(`Template ${kind} parameter count mismatch: expected ${expectedTokens.length}, got ${actual.length}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// WATS-40 WhatsApp Flows endpoint parity.
// ---------------------------------------------------------------------------

export type FlowStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "DEPRECATED"
  | "BLOCKED"
  | "THROTTLED"
  | string;

export type FlowCategory =
  | "SIGN_UP"
  | "SIGN_IN"
  | "APPOINTMENT_BOOKING"
  | "LEAD_GENERATION"
  | "CONTACT_US"
  | "CUSTOMER_SUPPORT"
  | "SURVEY"
  | "OTHER"
  | string;

export interface FlowDetails {
  readonly id?: string;
  readonly name?: string;
  readonly status?: FlowStatus;
  readonly categories?: readonly FlowCategory[];
  readonly endpoint_uri?: string;
  readonly validation_errors?: readonly unknown[];
  readonly preview?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface FlowListResponse {
  readonly data?: readonly FlowDetails[];
  readonly paging?: GraphPaging;
}

export interface FlowMutationResponse {
  readonly id?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface FlowAssetDetails {
  readonly name?: string;
  readonly asset_type?: string;
  readonly download_url?: string;
  readonly [key: string]: unknown;
}

export interface FlowAssetsResponse {
  readonly data?: readonly FlowAssetDetails[];
  readonly paging?: GraphPaging;
}

export type FlowJson = Record<string, unknown>;

export interface ListFlowsInput {
  readonly wabaId: string;
  readonly fields?: string;
  readonly status?: FlowStatus;
  readonly name?: string;
  readonly invalidatePreview?: string;
  readonly phoneNumberId?: string;
  readonly limit?: string;
  readonly after?: string;
}

export interface GetFlowInput {
  readonly flowId: string;
  readonly fields?: string;
  readonly invalidatePreview?: string;
  readonly phoneNumberId?: string;
}

export interface CreateFlowBody {
  readonly name: string;
  readonly categories: readonly FlowCategory[];
  readonly cloneFlowId?: string;
  readonly endpointUri?: string;
  readonly flowJson?: FlowJson | Record<string, unknown>;
  readonly publish?: boolean;
  readonly [key: string]: unknown;
}

export interface UpdateFlowMetadataBody {
  readonly name?: string;
  readonly categories?: readonly FlowCategory[];
  readonly endpointUri?: string;
  readonly applicationId?: string;
  readonly [key: string]: unknown;
}

export interface UpdateFlowJsonBody {
  readonly flowJson: FlowJson | Record<string, unknown>;
  /** Defaults to Meta's stable Flow JSON asset name, `flow.json`. */
  readonly name?: string;
}

export interface GetFlowAssetsInput {
  readonly flowId: string;
  readonly fields?: string;
  readonly limit?: string;
  readonly after?: string;
}

export interface FlowScreenResponseInput {
  readonly screen: string;
  readonly data?: unknown;
  readonly flowToken?: string;
}

export interface FlowCloseResponseInput {
  readonly data?: unknown;
  readonly flowToken?: string;
}

export interface FlowErrorResponseInput {
  readonly error: string;
  readonly errorMessage?: string;
  readonly flowToken?: string;
}

export interface FlowScreenResponse {
  readonly screen: string;
  readonly data?: unknown;
  readonly flow_token?: string;
}

export interface FlowCloseResponse {
  readonly close_flow: true;
  readonly data?: unknown;
  readonly flow_token?: string;
}

export interface FlowErrorResponse {
  readonly error: string;
  readonly error_message?: string;
  readonly flow_token?: string;
}

export const FLOW_JSON_MAX_DEPTH = 16;
export const FLOW_JSON_MAX_ARRAY_LENGTH = 1_000;
export const FLOW_JSON_MAX_SCREENS = 50;
export const FLOW_JSON_MAX_COMPONENTS = 1_000;
export const FLOW_JSON_MAX_STRING_LENGTH = 16_384;
export const FLOW_JSON_MAX_BYTES = 131_072;
export const FLOW_MAX_CATEGORIES = 5;

function flowError(message: string): GraphRequestValidationError {
  return new GraphRequestValidationError(message);
}

function flowHasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function flowIsUnsafeObjectKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function flowIsPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flowAssertPlainRecord(value: unknown, helperName: string, path = "input"): Record<string, unknown> {
  if (!flowIsPlainObject(value)) {
    throw flowError(`Invalid ${helperName} input: ${path} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw flowError(`Invalid ${helperName} input: ${path} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw flowError(`Invalid ${helperName} input: ${path} must not define toJSON.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw flowError(`Invalid ${helperName} input: ${path}.${key} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol") {
      throw flowError(`Invalid ${helperName} input: ${path}.${key} must be JSON-serializable.`);
    }
  }
  return value;
}

function flowString(value: unknown, fieldName: string, helperName: string, maxLength = TEMPLATE_NAME_MAX_LENGTH): string {
  if (typeof value !== "string") {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be non-empty.`);
  }
  if (flowHasControlChar(value)) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not contain control characters.`);
  }
  if (value.length > maxLength) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} exceeds ${maxLength}-character limit.`);
  }
  return value;
}

function flowMaybeString(value: unknown, fieldName: string, helperName: string, maxLength = TEMPLATE_NAME_MAX_LENGTH): string | undefined {
  if (value === undefined) return undefined;
  return flowString(value, fieldName, helperName, maxLength);
}

function flowUrl(value: unknown, fieldName: string, helperName: string): string {
  const urlValue = flowString(value, fieldName, helperName, 2_048);
  if (urlValue !== urlValue.trim()) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not contain leading/trailing whitespace.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be an absolute http(s) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw flowError(`Invalid ${helperName} input: ${fieldName} protocol must be http: or https:.`);
  }
  return urlValue;
}

function flowArray(value: unknown, fieldName: string, min: number, max: number, helperName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be an array.`);
  }
  if (value.length < min || value.length > max) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} length must be between ${min} and ${max}.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must use Array.prototype.`);
  }
  if (Object.prototype.hasOwnProperty.call(value, Symbol.iterator) || Object.prototype.hasOwnProperty.call(value, "map")) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not override Array.prototype methods.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not define toJSON.`);
  }
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw flowError(`Invalid ${helperName} input: ${fieldName} must not contain sparse array holes.`);
    }
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw flowError(`Invalid ${helperName} input: ${fieldName} must not use accessors.`);
    }
    out.push(descriptor.value);
  }
  return out;
}

interface FlowJsonCloneState {
  readonly seen: WeakSet<object>;
  componentCount: number;
}

function flowJsonClone(value: unknown, helperName: string, path = "input", state: FlowJsonCloneState = { seen: new WeakSet<object>(), componentCount: 0 }, depth = 0, parentKey = ""): unknown {
  if (depth > FLOW_JSON_MAX_DEPTH) {
    throw flowError(`Invalid ${helperName} input: ${path} exceeds maximum depth ${FLOW_JSON_MAX_DEPTH}.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (flowHasControlChar(value)) throw flowError(`Invalid ${helperName} input: ${path} contains control characters.`);
    if (value.length > FLOW_JSON_MAX_STRING_LENGTH) throw flowError(`Invalid ${helperName} input: ${path} string exceeds ${FLOW_JSON_MAX_STRING_LENGTH}-character limit.`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw flowError(`Invalid ${helperName} input: ${path} contains a non-finite number.`);
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value === "function" || typeof value === "symbol") {
    throw flowError(`Invalid ${helperName} input: ${path} must be JSON-serializable.`);
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) throw flowError(`Invalid ${helperName} input: ${path} must not contain cycles.`);
    state.seen.add(value);
    const arr = flowArray(value, path, 0, FLOW_JSON_MAX_ARRAY_LENGTH, helperName);
    const out: unknown[] = [];
    for (let index = 0; index < arr.length; index += 1) {
      out.push(flowJsonClone(arr[index], helperName, `${path}[${index}]`, state, depth + 1, parentKey));
    }
    state.seen.delete(value);
    return out;
  }
  const record = flowAssertPlainRecord(value, helperName, path);
  if (state.seen.has(record)) throw flowError(`Invalid ${helperName} input: ${path} must not contain cycles.`);
  state.seen.add(record);
  if (parentKey === "children" && typeof record.type === "string") {
    state.componentCount += 1;
    if (state.componentCount > FLOW_JSON_MAX_COMPONENTS) {
      throw flowError(`Invalid ${helperName} input: Flow JSON exceeds ${FLOW_JSON_MAX_COMPONENTS}-component limit.`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (flowIsUnsafeObjectKey(key)) {
      throw flowError(`Invalid ${helperName} input: ${path} contains an unsafe prototype key.`);
    }
    if (key.length === 0 || key.length > TEMPLATE_SHORT_TEXT_MAX_LENGTH || flowHasControlChar(key)) {
      throw flowError(`Invalid ${helperName} input: ${path} contains an invalid key.`);
    }
    const cloned = flowJsonClone(nested, helperName, `${path}.${key}`, state, depth + 1, key);
    if (cloned !== undefined) out[key] = cloned;
  }
  state.seen.delete(record);
  return out;
}

export function buildFlowJson(input: FlowJson | Record<string, unknown>): FlowJson {
  const cloned = flowJsonClone(input, "buildFlowJson");
  const record = flowAssertPlainRecord(cloned, "buildFlowJson");
  const screens = flowArray(record.screens, "screens", 1, FLOW_JSON_MAX_SCREENS, "buildFlowJson");
  for (let index = 0; index < screens.length; index += 1) {
    const screen = flowAssertPlainRecord(screens[index], "buildFlowJson", `screens[${index}]`);
    flowString(screen.id, `screens[${index}].id`, "buildFlowJson", 256);
  }
  const encoded = JSON.stringify(record);
  if (new TextEncoder().encode(encoded).byteLength > FLOW_JSON_MAX_BYTES) {
    throw flowError(`Invalid buildFlowJson input: Flow JSON exceeds ${FLOW_JSON_MAX_BYTES}-byte serialized limit.`);
  }
  return record;
}

export function validateFlowJson(input: FlowJson | Record<string, unknown>): void {
  buildFlowJson(input);
}

function normalizeFlowCategories(value: unknown, helperName: string, required: boolean): string[] | undefined {
  if (value === undefined) {
    if (required) throw flowError(`Invalid ${helperName} input: categories must be provided.`);
    return undefined;
  }
  const raw = flowArray(value, "categories", required ? 1 : 0, FLOW_MAX_CATEGORIES, helperName);
  const out: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    out.push(flowString(raw[index], `categories[${index}]`, helperName, 64));
  }
  return out;
}

function normalizeFlowJsonLike(value: unknown, helperName: string): FlowJson | undefined {
  if (value === undefined) return undefined;
  return buildFlowJson(value as FlowJson);
}

function mapCreateFlowBody(input: CreateFlowBody): Record<string, unknown> {
  const record = flowAssertPlainRecord(input, "createFlow");
  const out: Record<string, unknown> = {};
  out.name = flowString(record.name, "name", "createFlow");
  out.categories = normalizeFlowCategories(record.categories, "createFlow", true);
  const cloneFlowId = flowMaybeString(record.cloneFlowId, "cloneFlowId", "createFlow");
  if (cloneFlowId !== undefined) out.clone_flow_id = cloneFlowId;
  if (record.endpointUri !== undefined) out.endpoint_uri = flowUrl(record.endpointUri, "endpointUri", "createFlow");
  const flowJson = normalizeFlowJsonLike(record.flowJson, "createFlow");
  if (flowJson !== undefined) out.flow_json = flowJson;
  if (record.publish !== undefined) {
    if (typeof record.publish !== "boolean") throw flowError("Invalid createFlow input: publish must be boolean.");
    out.publish = record.publish;
  }
  for (const [key, value] of Object.entries(record)) {
    if (flowIsUnsafeObjectKey(key)) throw flowError("Invalid createFlow input: unsafe prototype keys are not allowed.");
    if (["name", "categories", "cloneFlowId", "endpointUri", "flowJson", "publish"].includes(key) || value === undefined) continue;
    out[key] = flowJsonClone(value, "createFlow", key);
  }
  return out;
}

function mapUpdateFlowMetadataBody(input: UpdateFlowMetadataBody): Record<string, unknown> {
  const record = flowAssertPlainRecord(input, "updateFlowMetadata");
  const out: Record<string, unknown> = {};
  if (record.name !== undefined) out.name = flowString(record.name, "name", "updateFlowMetadata");
  const categories = normalizeFlowCategories(record.categories, "updateFlowMetadata", false);
  if (categories !== undefined) out.categories = categories;
  if (record.endpointUri !== undefined) out.endpoint_uri = flowUrl(record.endpointUri, "endpointUri", "updateFlowMetadata");
  if (record.applicationId !== undefined) out.application_id = flowString(record.applicationId, "applicationId", "updateFlowMetadata");
  for (const [key, value] of Object.entries(record)) {
    if (flowIsUnsafeObjectKey(key)) throw flowError("Invalid updateFlowMetadata input: unsafe prototype keys are not allowed.");
    if (["name", "categories", "endpointUri", "applicationId"].includes(key) || value === undefined) continue;
    out[key] = flowJsonClone(value, "updateFlowMetadata", key);
  }
  return out;
}

function mapUpdateFlowJsonBody(input: UpdateFlowJsonBody): Record<string, unknown> {
  const record = flowAssertPlainRecord(input, "updateFlowJson");
  const flowJson = buildFlowJson(record.flowJson as FlowJson);
  const name = flowMaybeString(record.name, "name", "updateFlowJson", 256) ?? "flow.json";
  return { name, asset_type: "FLOW_JSON", file: JSON.stringify(flowJson) };
}

function flowNormalizePathParams(input: unknown, helperName: string, fieldName: "wabaId" | "flowId"): Record<string, string> {
  const record = flowAssertPlainRecord(input, helperName, "params");
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const descriptor = descriptors[fieldName];
  if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function" || typeof descriptor.value !== "string") {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be a string data property.`);
  }
  return { [fieldName]: flowString(descriptor.value, fieldName, helperName) };
}

function normalizeListFlowsParams(input: ListFlowsInput): Record<string, string> {
  const record = flowAssertPlainRecord(input, "listFlows");
  const out: Record<string, string> = { wabaId: flowString(record.wabaId, "wabaId", "listFlows") };
  for (const [publicKey, graphKey] of [
    ["fields", "fields"],
    ["status", "status"],
    ["name", "name"],
    ["invalidatePreview", "invalidate_preview"],
    ["phoneNumberId", "phone_number_id"],
    ["limit", "limit"],
    ["after", "after"]
  ] as const) {
    if (record[publicKey] !== undefined) out[graphKey] = flowString(record[publicKey], publicKey, "listFlows");
  }
  return out;
}

function normalizeGetFlowParams(input: GetFlowInput): Record<string, string> {
  const record = flowAssertPlainRecord(input, "getFlow");
  const out: Record<string, string> = { flowId: flowString(record.flowId, "flowId", "getFlow") };
  for (const [publicKey, graphKey] of [
    ["fields", "fields"],
    ["invalidatePreview", "invalidate_preview"],
    ["phoneNumberId", "phone_number_id"]
  ] as const) {
    if (record[publicKey] !== undefined) out[graphKey] = flowString(record[publicKey], publicKey, "getFlow");
  }
  return out;
}

function normalizeFlowAssetsParams(input: GetFlowAssetsInput): Record<string, string> {
  const record = flowAssertPlainRecord(input, "getFlowAssets");
  const out: Record<string, string> = { flowId: flowString(record.flowId, "flowId", "getFlowAssets") };
  for (const key of ["fields", "limit", "after"] as const) {
    if (record[key] !== undefined) out[key] = flowString(record[key], key, "getFlowAssets");
  }
  return out;
}

function cloneFlowResponseData(value: unknown, helperName: string): unknown {
  if (value === undefined) return undefined;
  return flowJsonClone(value, helperName, "data", { seen: new WeakSet<object>(), componentCount: 0 }, 0);
}

export function buildFlowScreenResponse(input: FlowScreenResponseInput): FlowScreenResponse {
  const record = flowAssertPlainRecord(input, "buildFlowScreenResponse");
  const out: Record<string, unknown> = { screen: flowString(record.screen, "screen", "buildFlowScreenResponse", 256) };
  const data = cloneFlowResponseData(record.data, "buildFlowScreenResponse");
  if (data !== undefined) out.data = data;
  const token = flowMaybeString(record.flowToken, "flowToken", "buildFlowScreenResponse", 2_048);
  if (token !== undefined) out.flow_token = token;
  return out as unknown as FlowScreenResponse;
}

export function buildFlowCloseResponse(input: FlowCloseResponseInput = {}): FlowCloseResponse {
  const record = flowAssertPlainRecord(input, "buildFlowCloseResponse");
  const out: Record<string, unknown> = { close_flow: true };
  const data = cloneFlowResponseData(record.data, "buildFlowCloseResponse");
  if (data !== undefined) out.data = data;
  const token = flowMaybeString(record.flowToken, "flowToken", "buildFlowCloseResponse", 2_048);
  if (token !== undefined) out.flow_token = token;
  return out as unknown as FlowCloseResponse;
}

export function buildFlowErrorResponse(input: FlowErrorResponseInput): FlowErrorResponse {
  const record = flowAssertPlainRecord(input, "buildFlowErrorResponse");
  const out: Record<string, unknown> = { error: flowString(record.error, "error", "buildFlowErrorResponse", 256) };
  const message = flowMaybeString(record.errorMessage, "errorMessage", "buildFlowErrorResponse", 2_048);
  if (message !== undefined) out.error_message = message;
  const token = flowMaybeString(record.flowToken, "flowToken", "buildFlowErrorResponse", 2_048);
  if (token !== undefined) out.flow_token = token;
  return out as unknown as FlowErrorResponse;
}

const listFlowsRaw = defineEndpoint<
  { wabaId: string; fields?: string; status?: string; name?: string; invalidate_preview?: string; phone_number_id?: string; limit?: string; after?: string },
  never,
  FlowListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/flows",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    status: { in: "query" },
    name: { in: "query" },
    invalidate_preview: { in: "query" },
    phone_number_id: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" }
  }
});

export const listFlows = Object.assign(
  async function listFlows(client: Parameters<typeof listFlowsRaw>[0], params: ListFlowsInput, body?: never, opts?: Parameters<typeof listFlowsRaw>[3]) {
    return listFlowsRaw(client, normalizeListFlowsParams(params) as Parameters<typeof listFlowsRaw>[1], body, opts);
  },
  { definition: listFlowsRaw.definition }
) as unknown as {
  (client: Parameters<typeof listFlowsRaw>[0], params: ListFlowsInput, body?: never, opts?: Parameters<typeof listFlowsRaw>[3]): Promise<FlowListResponse>;
  readonly definition: typeof listFlowsRaw.definition;
};

const getFlowRaw = defineEndpoint<{ flowId: string; fields?: string; invalidate_preview?: string; phone_number_id?: string }, never, FlowDetails>({
  method: "GET",
  pathTemplate: "/{flowId}",
  params: { flowId: { in: "path", required: true }, fields: { in: "query" }, invalidate_preview: { in: "query" }, phone_number_id: { in: "query" } }
});

export const getFlow = Object.assign(
  async function getFlow(client: Parameters<typeof getFlowRaw>[0], params: GetFlowInput, body?: never, opts?: Parameters<typeof getFlowRaw>[3]) {
    return getFlowRaw(client, normalizeGetFlowParams(params) as Parameters<typeof getFlowRaw>[1], body, opts);
  },
  { definition: getFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof getFlowRaw>[0], params: GetFlowInput, body?: never, opts?: Parameters<typeof getFlowRaw>[3]): Promise<FlowDetails>;
  readonly definition: typeof getFlowRaw.definition;
};

const createFlowRaw = defineEndpoint<{ wabaId: string }, CreateFlowBody, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{wabaId}/flows",
  params: { wabaId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: mapCreateFlowBody
});

export const createFlow = Object.assign(
  async function createFlow(client: Parameters<typeof createFlowRaw>[0], params: { readonly wabaId: string }, body: CreateFlowBody, opts?: Parameters<typeof createFlowRaw>[3]) {
    return createFlowRaw(client, flowNormalizePathParams(params, "createFlow", "wabaId") as Parameters<typeof createFlowRaw>[1], body, opts);
  },
  { definition: createFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof createFlowRaw>[0], params: { readonly wabaId: string }, body: CreateFlowBody, opts?: Parameters<typeof createFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof createFlowRaw.definition;
};

const updateFlowMetadataRaw = defineEndpoint<{ flowId: string }, UpdateFlowMetadataBody, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}",
  params: { flowId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: mapUpdateFlowMetadataBody
});

export const updateFlowMetadata = Object.assign(
  async function updateFlowMetadata(client: Parameters<typeof updateFlowMetadataRaw>[0], params: { readonly flowId: string }, body: UpdateFlowMetadataBody, opts?: Parameters<typeof updateFlowMetadataRaw>[3]) {
    return updateFlowMetadataRaw(client, flowNormalizePathParams(params, "updateFlowMetadata", "flowId") as Parameters<typeof updateFlowMetadataRaw>[1], body, opts);
  },
  { definition: updateFlowMetadataRaw.definition }
) as unknown as {
  (client: Parameters<typeof updateFlowMetadataRaw>[0], params: { readonly flowId: string }, body: UpdateFlowMetadataBody, opts?: Parameters<typeof updateFlowMetadataRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof updateFlowMetadataRaw.definition;
};

const updateFlowJsonRaw = defineEndpoint<{ flowId: string }, UpdateFlowJsonBody, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}/assets",
  params: { flowId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: mapUpdateFlowJsonBody
});

export const updateFlowJson = Object.assign(
  async function updateFlowJson(client: Parameters<typeof updateFlowJsonRaw>[0], params: { readonly flowId: string }, body: UpdateFlowJsonBody, opts?: Parameters<typeof updateFlowJsonRaw>[3]) {
    return updateFlowJsonRaw(client, flowNormalizePathParams(params, "updateFlowJson", "flowId") as Parameters<typeof updateFlowJsonRaw>[1], body, opts);
  },
  { definition: updateFlowJsonRaw.definition }
) as unknown as {
  (client: Parameters<typeof updateFlowJsonRaw>[0], params: { readonly flowId: string }, body: UpdateFlowJsonBody, opts?: Parameters<typeof updateFlowJsonRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof updateFlowJsonRaw.definition;
};

const publishFlowRaw = defineEndpoint<{ flowId: string }, never, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}/publish",
  params: { flowId: { in: "path", required: true } }
});

export const publishFlow = Object.assign(
  async function publishFlow(client: Parameters<typeof publishFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof publishFlowRaw>[3]) {
    return publishFlowRaw(client, flowNormalizePathParams(params, "publishFlow", "flowId") as Parameters<typeof publishFlowRaw>[1], body, opts);
  },
  { definition: publishFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof publishFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof publishFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof publishFlowRaw.definition;
};

const deleteFlowRaw = defineEndpoint<{ flowId: string }, never, FlowMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{flowId}",
  params: { flowId: { in: "path", required: true } }
});

export const deleteFlow = Object.assign(
  async function deleteFlow(client: Parameters<typeof deleteFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deleteFlowRaw>[3]) {
    return deleteFlowRaw(client, flowNormalizePathParams(params, "deleteFlow", "flowId") as Parameters<typeof deleteFlowRaw>[1], body, opts);
  },
  { definition: deleteFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof deleteFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deleteFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof deleteFlowRaw.definition;
};

const deprecateFlowRaw = defineEndpoint<{ flowId: string }, never, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}/deprecate",
  params: { flowId: { in: "path", required: true } }
});

export const deprecateFlow = Object.assign(
  async function deprecateFlow(client: Parameters<typeof deprecateFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deprecateFlowRaw>[3]) {
    return deprecateFlowRaw(client, flowNormalizePathParams(params, "deprecateFlow", "flowId") as Parameters<typeof deprecateFlowRaw>[1], body, opts);
  },
  { definition: deprecateFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof deprecateFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deprecateFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof deprecateFlowRaw.definition;
};

const getFlowAssetsRaw = defineEndpoint<{ flowId: string; fields?: string; limit?: string; after?: string }, never, FlowAssetsResponse>({
  method: "GET",
  pathTemplate: "/{flowId}/assets",
  params: { flowId: { in: "path", required: true }, fields: { in: "query" }, limit: { in: "query" }, after: { in: "query" } }
});

export const getFlowAssets = Object.assign(
  async function getFlowAssets(client: Parameters<typeof getFlowAssetsRaw>[0], params: GetFlowAssetsInput, body?: never, opts?: Parameters<typeof getFlowAssetsRaw>[3]) {
    return getFlowAssetsRaw(client, normalizeFlowAssetsParams(params) as Parameters<typeof getFlowAssetsRaw>[1], body, opts);
  },
  { definition: getFlowAssetsRaw.definition }
) as unknown as {
  (client: Parameters<typeof getFlowAssetsRaw>[0], params: GetFlowAssetsInput, body?: never, opts?: Parameters<typeof getFlowAssetsRaw>[3]): Promise<FlowAssetsResponse>;
  readonly definition: typeof getFlowAssetsRaw.definition;
};
