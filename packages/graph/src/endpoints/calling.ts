// WATS-41 Calling API endpoint callables.
//
// Credential-free Graph parity for pywa initiate/pre-accept/accept/reject/
// terminate call operations. Public input uses camelCase; Graph wire bodies
// use snake_case only at this transport boundary.
/**
 * @experimental Calling endpoint helpers may change in 0.x minors while live calling parity expands.
 */

import { defineEndpoint, type EndpointInvokeOptions } from "../endpoint.js";
import { GraphRequestValidationError } from "../errors.js";
import type { GraphClient } from "../client.js";

export type CallAction = "connect" | "pre_accept" | "accept" | "reject" | "terminate";
export type CallSdpType = "offer" | "answer" | string;

export const CALL_BIZ_OPAQUE_CALLBACK_DATA_MAX_LENGTH = 512;
export const CALL_SESSION_MAX_STRING_LENGTH = 16_384;
export const CALL_SESSION_MAX_DEPTH = 8;
export const CALL_SESSION_MAX_ARRAY_LENGTH = 100;
export const CALL_SESSION_MAX_BYTES = 65_536;

export interface CallSessionDescription {
  readonly sdpType?: CallSdpType;
  readonly sdp: string;
  readonly [key: string]: unknown;
}

export interface CallSessionDescriptionPayload {
  readonly sdp_type?: CallSdpType;
  readonly sdp: string;
  readonly [key: string]: unknown;
}

export interface InitiateCallRequest {
  readonly to: string;
  readonly session: CallSessionDescription | Record<string, unknown>;
  readonly bizOpaqueCallbackData?: string;
}

export interface PreAcceptCallRequest {
  readonly callId: string;
  readonly session?: CallSessionDescription | Record<string, unknown>;
}

export interface AcceptCallRequest {
  readonly callId: string;
  readonly session?: CallSessionDescription | Record<string, unknown>;
  readonly bizOpaqueCallbackData?: string;
}

export interface RejectCallRequest {
  readonly callId: string;
}

export interface TerminateCallRequest {
  readonly callId: string;
}

export interface CallLifecycleResponse {
  readonly id?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

type CallsParams = { readonly phoneNumberId: string };
type WireBody = Record<string, unknown>;

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

function isUnsafePrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function assertPublicString(value: unknown, fieldName: string, maxLength = 256): string {
  if (typeof value !== "string") {
    throw validationError(`Invalid Calling API input: ${fieldName} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw validationError(`Invalid Calling API input: ${fieldName} must be non-empty.`);
  }
  if (value.length > maxLength) {
    throw validationError(`Invalid Calling API input: ${fieldName} exceeds ${maxLength}-character limit.`);
  }
  if (hasControlChar(value)) {
    throw validationError(`Invalid Calling API input: ${fieldName} must not contain control characters.`);
  }
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw validationError(`Invalid Calling API input: ${fieldName} contains an unsafe path segment.`);
  }
  let decoded = value;
  for (let round = 0; round < 5; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw validationError(`Invalid Calling API input: ${fieldName} contains malformed percent encoding.`);
    }
    if (next === decoded) break;
    decoded = next;
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("?") ||
      decoded.includes("#")
    ) {
      throw validationError(`Invalid Calling API input: ${fieldName} contains an unsafe path segment.`);
    }
  }
  return value;
}

function assertNoEncodedUnsafePathSegment(value: string, fieldName: string): void {
  let decoded = value;
  for (let round = 0; round < 5; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw validationError(`Invalid Calling API input: ${fieldName} contains malformed percent encoding.`);
    }
    if (next === decoded) break;
    decoded = next;
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("?") ||
      decoded.includes("#")
    ) {
      throw validationError(`Invalid Calling API input: ${fieldName} contains an unsafe path segment.`);
    }
  }
}

function optionalTracker(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return assertPublicString(value, "bizOpaqueCallbackData", CALL_BIZ_OPAQUE_CALLBACK_DATA_MAX_LENGTH);
}

function assertPlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(`Invalid Calling API input: ${path} must be a plain object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw validationError(`Invalid Calling API input: ${path} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw validationError(`Invalid Calling API input: ${path} must not define toJSON.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (isUnsafePrototypeKey(key)) {
      throw validationError(`Invalid Calling API input: ${path} contains an unsafe prototype key.`);
    }
    if (key.length === 0 || hasControlChar(key)) {
      throw validationError(`Invalid Calling API input: ${path} contains an invalid key.`);
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw validationError(`Invalid Calling API input: ${path}.${key} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol") {
      throw validationError(`Invalid Calling API input: ${path}.${key} must be JSON-serializable.`);
    }
  }
  return value as Record<string, unknown>;
}

function assertArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(`Invalid Calling API input: ${path} must be an array.`);
  }
  if (value.length > CALL_SESSION_MAX_ARRAY_LENGTH) {
    throw validationError(`Invalid Calling API input: ${path} exceeds ${CALL_SESSION_MAX_ARRAY_LENGTH}-item limit.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw validationError(`Invalid Calling API input: ${path} must use Array.prototype.`);
  }
  if (Object.prototype.hasOwnProperty.call(value, Symbol.iterator) || Object.prototype.hasOwnProperty.call(value, "map")) {
    throw validationError(`Invalid Calling API input: ${path} must not override Array.prototype methods.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw validationError(`Invalid Calling API input: ${path} must not define toJSON.`);
  }
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw validationError(`Invalid Calling API input: ${path} must not contain sparse array holes.`);
    }
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw validationError(`Invalid Calling API input: ${path} must not use accessors.`);
    }
    out.push(descriptor.value);
  }
  return out;
}

function cloneJson(value: unknown, path: string, seen: WeakSet<object>, depth: number): unknown {
  if (depth > CALL_SESSION_MAX_DEPTH) {
    throw validationError(`Invalid Calling API input: ${path} exceeds maximum depth ${CALL_SESSION_MAX_DEPTH}.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length === 0 || value.length > CALL_SESSION_MAX_STRING_LENGTH || value.includes("\0") || value.includes("\u007f")) {
      throw validationError(`Invalid Calling API input: ${path} contains an invalid string.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw validationError(`Invalid Calling API input: ${path} contains a non-finite number.`);
    }
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value === "function" || typeof value === "symbol") {
    throw validationError(`Invalid Calling API input: ${path} must be JSON-serializable.`);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw validationError(`Invalid Calling API input: ${path} must not contain cycles.`);
    seen.add(value);
    const arr = assertArray(value, path);
    const out: unknown[] = [];
    for (let index = 0; index < arr.length; index += 1) {
      const cloned = cloneJson(arr[index], `${path}[${index}]`, seen, depth + 1);
      if (cloned !== undefined) out.push(cloned);
    }
    seen.delete(value);
    return out;
  }
  const record = assertPlainRecord(value, path);
  if (seen.has(record)) throw validationError(`Invalid Calling API input: ${path} must not contain cycles.`);
  seen.add(record);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const out: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (path === "session" && key === "sdp_type") {
      throw validationError("Invalid Calling API input: session.sdpType must use camelCase; Graph snake_case is reserved for the transport boundary.");
    }
    const wireKey = key === "sdpType" ? "sdp_type" : key;
    const cloned = cloneJson(descriptor.value, `${path}.${key}`, seen, depth + 1);
    if (cloned !== undefined) out[wireKey] = cloned;
  }
  seen.delete(record);
  return out;
}

export function sanitizeCallSession(input: unknown): CallSessionDescriptionPayload {
  const cloned = cloneJson(input, "session", new WeakSet<object>(), 0);
  const record = assertPlainRecord(cloned, "session") as CallSessionDescriptionPayload;
  if (record.sdp_type !== undefined && typeof record.sdp_type !== "string") {
    throw validationError("Invalid Calling API input: session.sdpType must be a string.");
  }
  if (typeof record.sdp !== "string" || record.sdp.length === 0 || record.sdp.length > CALL_SESSION_MAX_STRING_LENGTH) {
    throw validationError("Invalid Calling API input: session.sdp must be a non-empty string within the session string limit.");
  }
  const encoded = JSON.stringify(record);
  if (new TextEncoder().encode(encoded).byteLength > CALL_SESSION_MAX_BYTES) {
    throw validationError(`Invalid Calling API input: session exceeds ${CALL_SESSION_MAX_BYTES}-byte serialized limit.`);
  }
  return record;
}

function assertBodyRecord(value: unknown, helperName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(`Invalid ${helperName} input: expected an object.`);
  }
  return assertPlainRecord(value, helperName);
}

function buildInitiate(body: InitiateCallRequest): WireBody {
  const record = assertBodyRecord(body, "initiateCall");
  const tracker = optionalTracker(record.bizOpaqueCallbackData);
  return {
    messaging_product: "whatsapp",
    to: assertPublicString(record.to, "to"),
    action: "connect",
    session: sanitizeCallSession(record.session),
    ...(tracker !== undefined ? { biz_opaque_callback_data: tracker } : {})
  };
}

function buildPreAccept(body: PreAcceptCallRequest): WireBody {
  const record = assertBodyRecord(body, "preAcceptCall");
  const out: WireBody = {
    messaging_product: "whatsapp",
    call_id: assertPublicString(record.callId, "callId"),
    action: "pre_accept"
  };
  if (record.session !== undefined) out.session = sanitizeCallSession(record.session);
  return out;
}

function buildAccept(body: AcceptCallRequest): WireBody {
  const record = assertBodyRecord(body, "acceptCall");
  const tracker = optionalTracker(record.bizOpaqueCallbackData);
  const out: WireBody = {
    messaging_product: "whatsapp",
    call_id: assertPublicString(record.callId, "callId"),
    action: "accept"
  };
  if (record.session !== undefined) out.session = sanitizeCallSession(record.session);
  if (tracker !== undefined) out.biz_opaque_callback_data = tracker;
  return out;
}

function buildReject(body: RejectCallRequest): WireBody {
  const record = assertBodyRecord(body, "rejectCall");
  return {
    messaging_product: "whatsapp",
    call_id: assertPublicString(record.callId, "callId"),
    action: "reject"
  };
}

function buildTerminate(body: TerminateCallRequest): WireBody {
  const record = assertBodyRecord(body, "terminateCall");
  return {
    messaging_product: "whatsapp",
    call_id: assertPublicString(record.callId, "callId"),
    action: "terminate"
  };
}

const callsEndpoint = defineEndpoint<CallsParams, WireBody, CallLifecycleResponse>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/calls",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

function safeParams(params: CallsParams): CallsParams {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw validationError("Invalid Calling API input: params must be an object.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(params);
  const descriptor = descriptors.phoneNumberId;
  if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
    throw validationError("Invalid Calling API input: phoneNumberId must be a string data property.");
  }
  return { phoneNumberId: assertPublicString(descriptor.value, "phoneNumberId") };
}

export const initiateCall = Object.assign(
  async (client: GraphClient, params: CallsParams, body: InitiateCallRequest, opts?: EndpointInvokeOptions) =>
    callsEndpoint(client, safeParams(params), buildInitiate(body), opts),
  { definition: callsEndpoint.definition }
);

export const preAcceptCall = Object.assign(
  async (client: GraphClient, params: CallsParams, body: PreAcceptCallRequest, opts?: EndpointInvokeOptions) =>
    callsEndpoint(client, safeParams(params), buildPreAccept(body), opts),
  { definition: callsEndpoint.definition }
);

export const acceptCall = Object.assign(
  async (client: GraphClient, params: CallsParams, body: AcceptCallRequest, opts?: EndpointInvokeOptions) =>
    callsEndpoint(client, safeParams(params), buildAccept(body), opts),
  { definition: callsEndpoint.definition }
);

export const rejectCall = Object.assign(
  async (client: GraphClient, params: CallsParams, body: RejectCallRequest, opts?: EndpointInvokeOptions) =>
    callsEndpoint(client, safeParams(params), buildReject(body), opts),
  { definition: callsEndpoint.definition }
);

export const terminateCall = Object.assign(
  async (client: GraphClient, params: CallsParams, body: TerminateCallRequest, opts?: EndpointInvokeOptions) =>
    callsEndpoint(client, safeParams(params), buildTerminate(body), opts),
  { definition: callsEndpoint.definition }
);

// --- WATS-77 slice 1: GET Call Permissions ------------------------------
//
// GET /{phoneNumberId}/call_permissions — read a consumer's calling
// permission state. Exactly one of user_wa_id / recipient is required on
// the wire. Public input is camelCase ({ phoneNumberId, userWaId?,
// recipient? }); the snake_case response is normalized back to camelCase
// while preserving any unknown fields via index signatures.

export type CallPermissionStatus = "no_permission" | "temporary" | "permanent";

export interface CallPermissionActionLimit {
  readonly timePeriod?: string;
  readonly maxAllowed?: number;
  readonly currentUsage?: number;
  readonly limitExpirationTime?: number;
  readonly [key: string]: unknown;
}

export interface CallPermissionAction {
  readonly actionName?: string;
  readonly canPerformAction?: boolean;
  readonly limits?: ReadonlyArray<CallPermissionActionLimit>;
  readonly [key: string]: unknown;
}

export interface CallPermission {
  readonly status?: CallPermissionStatus | string;
  readonly expirationTime?: number;
  readonly [key: string]: unknown;
}

export interface CallPermissionsResponse {
  readonly messagingProduct?: string;
  readonly permission?: CallPermission;
  readonly actions?: ReadonlyArray<CallPermissionAction>;
  readonly [key: string]: unknown;
}

export interface GetCallPermissionsInput {
  readonly phoneNumberId: string;
  readonly userWaId?: string;
  readonly recipient?: string;
}

type CallPermissionsParams = {
  readonly phoneNumberId: string;
  readonly user_wa_id?: string;
  readonly recipient?: string;
};

type WireResponse = Record<string, unknown>;

const callPermissionsEndpoint = defineEndpoint<CallPermissionsParams, never, WireResponse>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/call_permissions",
  params: {
    phoneNumberId: { in: "path", required: true },
    user_wa_id: { in: "query" },
    recipient: { in: "query" }
  }
});

function asWireRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asWireArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

// Normalize a known camelCase target field from its snake_case wire key,
// then copy through every remaining (unknown) field verbatim.
function normalizeWith(
  source: Record<string, unknown>,
  rename: Record<string, string>,
  transform: Record<string, (value: unknown) => unknown> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (isUnsafePrototypeKey(key)) continue;
    const targetKey = rename[key] ?? key;
    const fn = transform[key];
    out[targetKey] = fn !== undefined ? fn(value) : value;
  }
  return out;
}

function normalizeLimit(value: unknown): CallPermissionActionLimit {
  const record = asWireRecord(value);
  if (record === undefined) return {} as CallPermissionActionLimit;
  return normalizeWith(record, {
    time_period: "timePeriod",
    max_allowed: "maxAllowed",
    current_usage: "currentUsage",
    limit_expiration_time: "limitExpirationTime"
  }) as CallPermissionActionLimit;
}

function normalizeAction(value: unknown): CallPermissionAction {
  const record = asWireRecord(value);
  if (record === undefined) return {} as CallPermissionAction;
  return normalizeWith(
    record,
    { action_name: "actionName", can_perform_action: "canPerformAction" },
    {
      limits: (limits) => {
        const arr = asWireArray(limits);
        return arr !== undefined ? arr.map(normalizeLimit) : limits;
      }
    }
  ) as CallPermissionAction;
}

function normalizePermission(value: unknown): CallPermission {
  const record = asWireRecord(value);
  if (record === undefined) return value as CallPermission;
  return normalizeWith(record, { expiration_time: "expirationTime" }) as CallPermission;
}

function normalizeCallPermissionsResponse(wire: WireResponse): CallPermissionsResponse {
  const record = asWireRecord(wire);
  if (record === undefined) return {} as CallPermissionsResponse;
  return normalizeWith(
    record,
    { messaging_product: "messagingProduct" },
    {
      permission: normalizePermission,
      actions: (actions) => {
        const arr = asWireArray(actions);
        return arr !== undefined ? arr.map(normalizeAction) : actions;
      }
    }
  ) as CallPermissionsResponse;
}

function buildCallPermissionsParams(input: GetCallPermissionsInput): CallPermissionsParams {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw validationError("Invalid Calling API input: getCallPermissions input must be an object.");
  }
  const phoneNumberId = safeParams({ phoneNumberId: (input as { phoneNumberId?: unknown }).phoneNumberId as string }).phoneNumberId;

  const hasUserWaId = input.userWaId !== undefined;
  const hasRecipient = input.recipient !== undefined;
  if (hasUserWaId === hasRecipient) {
    throw validationError(
      "Invalid Calling API input: exactly one of userWaId or recipient is required."
    );
  }

  if (hasUserWaId) {
    return { phoneNumberId, user_wa_id: assertPublicString(input.userWaId, "userWaId") };
  }
  return { phoneNumberId, recipient: assertPublicString(input.recipient, "recipient") };
}

export const getCallPermissions = Object.assign(
  async (
    client: GraphClient,
    input: GetCallPermissionsInput,
    _body?: undefined,
    opts?: EndpointInvokeOptions
  ): Promise<CallPermissionsResponse> => {
    const params = buildCallPermissionsParams(input);
    const wire = await callPermissionsEndpoint(client, params, undefined, opts);
    return normalizeCallPermissionsResponse(wire);
  },
  { definition: callPermissionsEndpoint.definition }
);
