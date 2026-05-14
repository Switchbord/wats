// F-7/WATS-39 WABA-scope endpoints.
//
// WATS-39 adds credential-free WhatsApp Business Account message-template
// management parity. All operations are ordinary Graph endpoint callables
// layered on defineEndpoint and MockTransport-testable without live WABA
// credentials.

import { defineEndpoint } from "../endpoint";
import { GraphRequestValidationError } from "../errors";
import type { EndpointInvokeOptions } from "../endpoint";
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

export {
  buildCreateMessageTemplateBody,
  buildUpdateMessageTemplateBody,
  buildTemplateBodyComponent,
  buildTemplateButtonComponent,
  buildTemplateFooterComponent,
  buildTemplateHeaderComponent,
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplate,
  listMessageTemplates,
  updateMessageTemplate,
  validateTemplateParameterCounts
} from "./templates/index";

export type {
  CreateMessageTemplateBody,
  DeleteMessageTemplateInput,
  GetMessageTemplateInput,
  ListMessageTemplatesInput,
  SendTemplateComponentForValidation,
  TemplateBodyComponentInput,
  TemplateButtonInput,
  TemplateButtonsComponentInput,
  TemplateButtonType,
  TemplateCategory,
  TemplateComponent,
  TemplateDefinitionForValidation,
  TemplateDetails,
  TemplateFooterComponentInput,
  TemplateHeaderComponentInput,
  TemplateHeaderFormat,
  TemplateLanguageCode,
  TemplateListResponse,
  TemplateMutationResponse,
  TemplateParameterFormat,
  TemplateQualityScore,
  TemplateStatus,
  UpdateMessageTemplateBody
} from "./templates/index";


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

function flowString(value: unknown, fieldName: string, helperName: string, maxLength = 512): string {
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

function flowMaybeString(value: unknown, fieldName: string, helperName: string, maxLength = 512): string | undefined {
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
    if (key.length === 0 || key.length > 1024 || flowHasControlChar(key)) {
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
