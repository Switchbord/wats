// WATS-66 WhatsApp Flow JSON and request-body validation.

import type {
  CreateFlowBody,
  FlowJson,
  GetFlowAssetsInput,
  GetFlowInput,
  ListFlowsInput,
  UpdateFlowJsonBody,
  UpdateFlowMetadataBody
} from "./types";
import {
  FLOW_JSON_MAX_ARRAY_LENGTH,
  FLOW_JSON_MAX_BYTES,
  FLOW_JSON_MAX_COMPONENTS,
  FLOW_JSON_MAX_DEPTH,
  FLOW_JSON_MAX_SCREENS,
  FLOW_JSON_MAX_STRING_LENGTH,
  FLOW_MAX_CATEGORIES,
  flowArray,
  flowAssertPlainRecord,
  flowError,
  flowHasControlChar,
  flowIsUnsafeObjectKey,
  flowMaybeString,
  flowString,
  flowUrl
} from "./shared";

interface FlowJsonCloneState {
  readonly seen: WeakSet<object>;
  componentCount: number;
}

export function flowJsonClone(value: unknown, helperName: string, path = "input", state: FlowJsonCloneState = { seen: new WeakSet<object>(), componentCount: 0 }, depth = 0, parentKey = ""): unknown {
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

export function normalizeFlowCategories(value: unknown, helperName: string, required: boolean): string[] | undefined {
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

export function normalizeFlowJsonLike(value: unknown, helperName: string): FlowJson | undefined {
  if (value === undefined) return undefined;
  return buildFlowJson(value as FlowJson);
}

export function mapCreateFlowBody(input: CreateFlowBody): Record<string, unknown> {
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

export function mapUpdateFlowMetadataBody(input: UpdateFlowMetadataBody): Record<string, unknown> {
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

export function mapUpdateFlowJsonBody(input: UpdateFlowJsonBody): Record<string, unknown> {
  const record = flowAssertPlainRecord(input, "updateFlowJson");
  const flowJson = buildFlowJson(record.flowJson as FlowJson);
  const name = flowMaybeString(record.name, "name", "updateFlowJson", 256) ?? "flow.json";
  return { name, asset_type: "FLOW_JSON", file: JSON.stringify(flowJson) };
}

export function flowNormalizePathParams(input: unknown, helperName: string, fieldName: "wabaId" | "flowId"): Record<string, string> {
  const record = flowAssertPlainRecord(input, helperName, "params");
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const descriptor = descriptors[fieldName];
  if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function" || typeof descriptor.value !== "string") {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be a string data property.`);
  }
  return { [fieldName]: flowString(descriptor.value, fieldName, helperName) };
}

export function normalizeListFlowsParams(input: ListFlowsInput): Record<string, string> {
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

export function normalizeGetFlowParams(input: GetFlowInput): Record<string, string> {
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

export function normalizeFlowAssetsParams(input: GetFlowAssetsInput): Record<string, string> {
  const record = flowAssertPlainRecord(input, "getFlowAssets");
  const out: Record<string, string> = { flowId: flowString(record.flowId, "flowId", "getFlowAssets") };
  for (const key of ["fields", "limit", "after"] as const) {
    if (record[key] !== undefined) out[key] = flowString(record[key], key, "getFlowAssets");
  }
  return out;
}
