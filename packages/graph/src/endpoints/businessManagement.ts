// WATS-42A read-only Business Management / admin inventory endpoints.
//
// Credential-free SDK request-shape parity for stable read-only WABA and
// phone-number inventory/profile/settings surfaces. All public JavaScript
// inputs are descriptor-validated and cloned before defineEndpoint / transport;
// tests use MockTransport only.

import { defineEndpoint, type EndpointInvokeOptions } from "../endpoint.js";
import { GraphRequestValidationError } from "../errors.js";
import {
  assertRepeatedlyDecodedSafePathId
} from "../internal/validation/paths.js";
import {
  assertQueryString as assertInternalQueryString
} from "../internal/validation/strings.js";
import { assertJoinedStringQueryArray } from "../internal/validation/arrays.js";
import { sanitizeHeaderInit } from "../internal/validation/headers.js";
import {
  assertPlainDataRecord,
  ownDataValue as ownInternalDataValue
} from "../internal/validation/records.js";
import type { GraphClient } from "../client.js";
import type { GraphPaging } from "./waba/types.js";

export type BusinessManagementFields = string | readonly string[];


export interface WabaInfo {
  readonly id?: string;
  readonly name?: string;
  readonly timezone_id?: string;
  readonly message_template_namespace?: string;
  readonly status?: string;
  readonly business_verification_status?: string;
  readonly is_enabled_for_insights?: boolean;
  readonly marketing_messages_lite_api_status?: string;
  readonly marketing_messages_onboarding_status?: string;
  /** WATS-91 / Graph v24+ portfolio-level messaging limit. */
  readonly whatsapp_business_manager_messaging_limit?: string;
  readonly ownership_type?: string;
  readonly health_status?: unknown;
  readonly currency?: string;
  readonly country?: string;
  readonly subscribed_apps?: unknown;
  readonly [key: string]: unknown;
}

export interface SubscribedAppInfo {
  readonly app_id?: string;
  readonly id?: string;
  readonly name?: string;
  readonly whatsapp_business_api_data?: unknown;
  readonly override_callback_uri?: string;
  readonly [key: string]: unknown;
}

export interface SubscribedAppsResponse {
  readonly data?: readonly SubscribedAppInfo[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

export interface PhoneNumberInfo {
  readonly id?: string;
  readonly display_phone_number?: string;
  readonly verified_name?: string;
  readonly quality_rating?: string;
  readonly code_verification_status?: string;
  readonly platform_type?: string;
  readonly throughput?: unknown;
  readonly webhook_configuration?: unknown;
  /** Graph phone-number field; v24+ semantics return the business-portfolio messaging limit. */
  readonly messaging_limit_tier?: string;
  /** WATS-91 / Graph v24+ explicit portfolio-level messaging limit field. */
  readonly whatsapp_business_manager_messaging_limit?: string;
  readonly [key: string]: unknown;
}

export interface PhoneNumberSettingsEntry {
  readonly [key: string]: unknown;
}

export interface PhoneNumberSettingsResponse {
  readonly data?: readonly PhoneNumberSettingsEntry[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

export interface BusinessProfileEntry {
  readonly about?: string;
  readonly address?: string;
  readonly description?: string;
  readonly email?: string;
  readonly messaging_product?: string;
  readonly profile_picture_url?: string;
  readonly vertical?: string;
  readonly websites?: readonly string[];
  readonly [key: string]: unknown;
}

export interface BusinessProfileResponse {
  readonly data?: readonly BusinessProfileEntry[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

export interface CommerceSettingsEntry {
  readonly is_cart_enabled?: boolean;
  readonly is_catalog_visible?: boolean;
  readonly [key: string]: unknown;
}

export interface CommerceSettingsResponse {
  readonly data?: readonly CommerceSettingsEntry[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

export interface GetWabaInfoInput {
  readonly wabaId: string;
  readonly fields?: BusinessManagementFields;
}

export interface ListSubscribedAppsInput {
  readonly wabaId: string;
}

export interface ListPhoneNumbersInput {
  readonly wabaId: string;
  readonly fields?: BusinessManagementFields;
  readonly limit?: string;
  readonly after?: string;
  readonly before?: string;
}

export interface GetPhoneNumberInfoInput {
  readonly phoneNumberId: string;
  readonly fields?: BusinessManagementFields;
}

export interface GetPhoneNumberSettingsInput {
  readonly phoneNumberId: string;
  readonly fields?: BusinessManagementFields;
  /** Maps to Graph query parameter `include_sip_credentials`; responses may contain sensitive SIP credentials. */
  readonly includeSipCredentials?: boolean;
}

export interface StorageConfigurationInput {
  readonly status: "ENABLED" | "DISABLED" | string;
  readonly [key: string]: unknown;
}

export interface UpdatePhoneNumberSettingsInput {
  readonly phoneNumberId: string;
  readonly storageConfiguration?: StorageConfigurationInput;
}

export interface PhoneNumberSettingsUpdateResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface GetBusinessProfileInput {
  readonly phoneNumberId: string;
  readonly fields?: BusinessManagementFields;
}

export interface GetCommerceSettingsInput {
  readonly phoneNumberId: string;
  readonly fields?: BusinessManagementFields;
}

type WireParams = Record<string, string>;

const MAX_ID_LENGTH = 512;
const MAX_QUERY_STRING_LENGTH = 1024;
const MAX_FIELD_ARRAY_LENGTH = 50;
const MAX_FIELD_ITEM_LENGTH = 128;
const MAX_CURSOR_LENGTH = 512;
const MAX_PERCENT_DECODE_ROUNDS = 8;

function validationError(message: string, cause?: unknown): GraphRequestValidationError {
  return new GraphRequestValidationError(message, cause);
}

function wrapValidation<T>(message: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GraphRequestValidationError) throw error;
    throw validationError(message, error);
  }
}

function assertPlainRecord(value: unknown, helperName: string, path = "params"): Record<string, unknown> {
  try {
    return assertPlainDataRecord(value, {
      helperName,
      path,
      rejectFunctionsSymbolsBigInts: true
    });
  } catch (error) {
    if (error instanceof GraphRequestValidationError) throw error;
    throw validationError(`Invalid ${helperName} input: ${path} could not be inspected.`, error);
  }
}

function ownDataValue(record: Record<string, unknown>, key: string, helperName: string, required: boolean): unknown {
  return ownInternalDataValue(record, key, {
    helperName,
    path: key,
    required
  });
}

function assertPathId(value: unknown, fieldName: "wabaId" | "phoneNumberId", helperName: string): string {
  if (typeof value === "string" && value.length > 0 && value.trim().length === 0) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be non-empty.`);
  }
  return assertRepeatedlyDecodedSafePathId(value, {
    helperName,
    fieldName,
    maxLength: MAX_ID_LENGTH,
    maxDecodeRounds: MAX_PERCENT_DECODE_ROUNDS
  });
}

function assertQueryString(value: unknown, fieldName: string, helperName: string, maxLength = MAX_QUERY_STRING_LENGTH): string {
  return assertInternalQueryString(value, {
    helperName,
    fieldName,
    maxLength
  });
}

function assertFieldsArray(value: unknown, helperName: string): string {
  wrapValidation(`Invalid ${helperName} input: fields could not be inspected.`, () => {
    if (Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value, "toJSON") && "toJSON" in value) {
      throw validationError(`Invalid ${helperName} input: fields must not inherit toJSON.`);
    }
  });
  return assertJoinedStringQueryArray(value, {
    helperName,
    path: "fields",
    minLength: 1,
    maxLength: MAX_FIELD_ARRAY_LENGTH,
    maxItemLength: MAX_FIELD_ITEM_LENGTH,
    rejectCommas: true,
    invalidTypeMessage: `Invalid ${helperName} input: fields must be a string or array of strings.`,
    invalidLengthMessage: `Invalid ${helperName} input: fields length must be between 1 and ${MAX_FIELD_ARRAY_LENGTH}.`,
    unsafePrototypeKeyMessage: `Invalid ${helperName} input: fields contains an unsafe prototype key.`,
    sparseArrayMessage: `Invalid ${helperName} input: fields must not contain sparse array holes.`,
    unsupportedPropertyMessage: `Invalid ${helperName} input: fields contains unsupported properties.`,
    commaMessage: `Invalid ${helperName} input: fields array entries must not contain commas.`
  });
}

function optionalFields(record: Record<string, unknown>, helperName: string): string | undefined {
  const value = ownDataValue(record, "fields", helperName, false);
  if (value === undefined) return undefined;
  if (typeof value === "string") return assertQueryString(value, "fields", helperName);
  return assertFieldsArray(value, helperName);
}

function optionalQueryString(record: Record<string, unknown>, key: "limit" | "after" | "before", helperName: string): string | undefined {
  const value = ownDataValue(record, key, helperName, false);
  if (value === undefined) return undefined;
  return assertQueryString(value, key, helperName, key === "limit" ? 32 : MAX_CURSOR_LENGTH);
}

function optionalIncludeSipCredentials(record: Record<string, unknown>, helperName: string): string | undefined {
  const value = ownDataValue(record, "includeSipCredentials", helperName, false);
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw validationError(`Invalid ${helperName} input: includeSipCredentials must be boolean when provided.`);
  }
  return value ? "true" : "false";
}

function sanitizeStorageConfiguration(value: unknown, helperName: string): Record<string, unknown> {
  const record = assertPlainRecord(value, helperName, "storageConfiguration");
  const status = ownDataValue(record, "status", helperName, true);
  const out: Record<string, unknown> = {
    status: assertQueryString(status, "storageConfiguration.status", helperName, 32).toUpperCase()
  };
  for (const [key, nested] of Object.entries(record)) {
    if (key === "status") continue;
    if (key === "dataLocalizationRegion" || key === "data_localization_region") {
      throw validationError(`Invalid ${helperName} input: dataLocalizationRegion is not supported; use storageConfiguration.`);
    }
    if (nested !== undefined) out[key] = nested;
  }
  return out;
}

export function buildUpdatePhoneNumberSettingsBody(input: UpdatePhoneNumberSettingsInput): Record<string, unknown> {
  const helperName = "updatePhoneNumberSettings";
  const record = assertPlainRecord(input, helperName);
  if (ownDataValue(record, "dataLocalizationRegion", helperName, false) !== undefined || ownDataValue(record, "data_localization_region", helperName, false) !== undefined) {
    throw validationError(`Invalid ${helperName} input: dataLocalizationRegion is not supported; use storageConfiguration.`);
  }
  const storageConfiguration = ownDataValue(record, "storageConfiguration", helperName, false);
  if (storageConfiguration === undefined) {
    throw validationError(`Invalid ${helperName} input: storageConfiguration is required.`);
  }
  return { storage_configuration: sanitizeStorageConfiguration(storageConfiguration, helperName) };
}

export function normalizeUpdatePhoneNumberSettingsParams(input: UpdatePhoneNumberSettingsInput): WireParams {
  const helperName = "updatePhoneNumberSettings";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function normalizeWabaInfoParams(input: GetWabaInfoInput): WireParams {
  const helperName = "getWabaInfo";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { wabaId: assertPathId(ownDataValue(record, "wabaId", helperName, true), "wabaId", helperName) };
  const fields = optionalFields(record, helperName);
  if (fields !== undefined) out.fields = fields;
  return out;
}

export function normalizeListSubscribedAppsParams(input: ListSubscribedAppsInput): WireParams {
  const helperName = "listSubscribedApps";
  const record = assertPlainRecord(input, helperName);
  return { wabaId: assertPathId(ownDataValue(record, "wabaId", helperName, true), "wabaId", helperName) };
}

export function normalizeListPhoneNumbersParams(input: ListPhoneNumbersInput): WireParams {
  const helperName = "listPhoneNumbers";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { wabaId: assertPathId(ownDataValue(record, "wabaId", helperName, true), "wabaId", helperName) };
  const fields = optionalFields(record, helperName);
  const limit = optionalQueryString(record, "limit", helperName);
  const after = optionalQueryString(record, "after", helperName);
  const before = optionalQueryString(record, "before", helperName);
  if (fields !== undefined) out.fields = fields;
  if (limit !== undefined) out.limit = limit;
  if (after !== undefined) out.after = after;
  if (before !== undefined) out.before = before;
  return out;
}

export function normalizePhoneNumberInfoParams(input: GetPhoneNumberInfoInput): WireParams {
  const helperName = "getPhoneNumberInfo";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
  const fields = optionalFields(record, helperName);
  if (fields !== undefined) out.fields = fields;
  return out;
}

export function normalizePhoneNumberSettingsParams(input: GetPhoneNumberSettingsInput): WireParams {
  const helperName = "getPhoneNumberSettings";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
  const fields = optionalFields(record, helperName);
  const includeSipCredentials = optionalIncludeSipCredentials(record, helperName);
  if (fields !== undefined) out.fields = fields;
  if (includeSipCredentials !== undefined) out.include_sip_credentials = includeSipCredentials;
  return out;
}

export function normalizeBusinessProfileParams(input: GetBusinessProfileInput): WireParams {
  const helperName = "getBusinessProfile";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
  const fields = optionalFields(record, helperName);
  if (fields !== undefined) out.fields = fields;
  return out;
}

export function normalizeCommerceSettingsParams(input: GetCommerceSettingsInput): WireParams {
  const helperName = "getCommerceSettings";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
  const fields = optionalFields(record, helperName);
  if (fields !== undefined) out.fields = fields;
  return out;
}

function sanitizeHeaders(headers: unknown, helperName: string): Headers | Record<string, string> {
  return sanitizeHeaderInit(headers, {
    helperName,
    path: "opts.headers",
    invalidTypeMessage: `Invalid ${helperName} input: opts.headers must be a plain object.`,
    inspectMessage: `Invalid ${helperName} input: opts.headers could not be inspected.`,
    descriptorInspectMessage: `Invalid ${helperName} input: opts.headers descriptors could not be inspected.`,
    accessorMessage: `Invalid ${helperName} options: headers must not use accessors.`,
    nonStringValueMessage: `Invalid ${helperName} options: header values must be strings.`,
    unsafePrototypeKeyMessage: `Invalid ${helperName} input: opts.headers contains an unsafe prototype key.`,
    invalidKeyMessage: `Invalid ${helperName} input: opts.headers contains an invalid key.`,
    symbolAccessorMessage: `Invalid ${helperName} input: opts.headers must not use symbol-keyed accessors.`,
    symbolKeyMessage: `Invalid ${helperName} input: opts.headers must not contain symbol keys.`,
    ownToJSONMessage: `Invalid ${helperName} input: opts.headers must not define toJSON.`
  });
}

export function sanitizeBusinessManagementOptions(opts: EndpointInvokeOptions | undefined, helperName: string): EndpointInvokeOptions | undefined {
  if (opts === undefined) return undefined;
  const record = assertPlainRecord(opts, helperName, "opts");
  const out: { signal?: AbortSignal; headers?: Headers | Record<string, string> } = {};
  const signal = ownDataValue(record, "signal", helperName, false);
  const headers = ownDataValue(record, "headers", helperName, false);
  if (signal !== undefined) out.signal = signal as AbortSignal;
  if (headers !== undefined) out.headers = sanitizeHeaders(headers, helperName);
  return out;
}

function assertNoBody(body: unknown, helperName: string): void {
  if (body !== undefined) {
    throw validationError(`Invalid ${helperName} input: GET endpoints do not accept a body.`);
  }
}

const getWabaInfoRaw = defineEndpoint<{ wabaId: string; fields?: string }, never, WabaInfo>({
  method: "GET",
  pathTemplate: "/{wabaId}",
  params: { wabaId: { in: "path", required: true }, fields: { in: "query" } }
});

const listSubscribedAppsRaw = defineEndpoint<{ wabaId: string }, never, SubscribedAppsResponse>({
  method: "GET",
  pathTemplate: "/{wabaId}/subscribed_apps",
  params: { wabaId: { in: "path", required: true } }
});

const getPhoneNumberInfoRaw = defineEndpoint<{ phoneNumberId: string; fields?: string }, never, PhoneNumberInfo>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}",
  params: { phoneNumberId: { in: "path", required: true }, fields: { in: "query" } }
});

const getPhoneNumberSettingsRaw = defineEndpoint<
  { phoneNumberId: string; fields?: string; include_sip_credentials?: string },
  never,
  PhoneNumberSettingsResponse
>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/settings",
  params: {
    phoneNumberId: { in: "path", required: true },
    fields: { in: "query" },
    include_sip_credentials: { in: "query" }
  }
});


const updatePhoneNumberSettingsRaw = defineEndpoint<
  { phoneNumberId: string },
  UpdatePhoneNumberSettingsInput,
  PhoneNumberSettingsUpdateResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/settings",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUpdatePhoneNumberSettingsBody
});

const getBusinessProfileRaw = defineEndpoint<{ phoneNumberId: string; fields?: string }, never, BusinessProfileResponse>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/whatsapp_business_profile",
  params: { phoneNumberId: { in: "path", required: true }, fields: { in: "query" } }
});

const getCommerceSettingsRaw = defineEndpoint<{ phoneNumberId: string; fields?: string }, never, CommerceSettingsResponse>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/whatsapp_commerce_settings",
  params: { phoneNumberId: { in: "path", required: true }, fields: { in: "query" } }
});

export const getWabaInfo = Object.assign(
  async function getWabaInfo(client: GraphClient, params: GetWabaInfoInput, body?: never, opts?: EndpointInvokeOptions): Promise<WabaInfo> {
    assertNoBody(body, "getWabaInfo");
    return getWabaInfoRaw(client, normalizeWabaInfoParams(params) as Parameters<typeof getWabaInfoRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "getWabaInfo"));
  },
  { definition: getWabaInfoRaw.definition }
);

export const listSubscribedApps = Object.assign(
  async function listSubscribedApps(client: GraphClient, params: ListSubscribedAppsInput, body?: never, opts?: EndpointInvokeOptions): Promise<SubscribedAppsResponse> {
    assertNoBody(body, "listSubscribedApps");
    return listSubscribedAppsRaw(client, normalizeListSubscribedAppsParams(params) as Parameters<typeof listSubscribedAppsRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "listSubscribedApps"));
  },
  { definition: listSubscribedAppsRaw.definition }
);

export const getPhoneNumberInfo = Object.assign(
  async function getPhoneNumberInfo(client: GraphClient, params: GetPhoneNumberInfoInput, body?: never, opts?: EndpointInvokeOptions): Promise<PhoneNumberInfo> {
    assertNoBody(body, "getPhoneNumberInfo");
    return getPhoneNumberInfoRaw(client, normalizePhoneNumberInfoParams(params) as Parameters<typeof getPhoneNumberInfoRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "getPhoneNumberInfo"));
  },
  { definition: getPhoneNumberInfoRaw.definition }
);

export const getPhoneNumberSettings = Object.assign(
  async function getPhoneNumberSettings(client: GraphClient, params: GetPhoneNumberSettingsInput, body?: never, opts?: EndpointInvokeOptions): Promise<PhoneNumberSettingsResponse> {
    assertNoBody(body, "getPhoneNumberSettings");
    return getPhoneNumberSettingsRaw(client, normalizePhoneNumberSettingsParams(params) as Parameters<typeof getPhoneNumberSettingsRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "getPhoneNumberSettings"));
  },
  { definition: getPhoneNumberSettingsRaw.definition }
);

export const updatePhoneNumberSettings = Object.assign(
  async function updatePhoneNumberSettings(client: GraphClient, params: UpdatePhoneNumberSettingsInput, body?: never, opts?: EndpointInvokeOptions): Promise<PhoneNumberSettingsUpdateResponse> {
    assertNoBody(body, "updatePhoneNumberSettings");
    return updatePhoneNumberSettingsRaw(client, normalizeUpdatePhoneNumberSettingsParams(params) as Parameters<typeof updatePhoneNumberSettingsRaw>[1], params, sanitizeBusinessManagementOptions(opts, "updatePhoneNumberSettings"));
  },
  { definition: updatePhoneNumberSettingsRaw.definition }
);

export const getBusinessProfile = Object.assign(
  async function getBusinessProfile(client: GraphClient, params: GetBusinessProfileInput, body?: never, opts?: EndpointInvokeOptions): Promise<BusinessProfileResponse> {
    assertNoBody(body, "getBusinessProfile");
    return getBusinessProfileRaw(client, normalizeBusinessProfileParams(params) as Parameters<typeof getBusinessProfileRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "getBusinessProfile"));
  },
  { definition: getBusinessProfileRaw.definition }
);

export const getCommerceSettings = Object.assign(
  async function getCommerceSettings(client: GraphClient, params: GetCommerceSettingsInput, body?: never, opts?: EndpointInvokeOptions): Promise<CommerceSettingsResponse> {
    assertNoBody(body, "getCommerceSettings");
    return getCommerceSettingsRaw(client, normalizeCommerceSettingsParams(params) as Parameters<typeof getCommerceSettingsRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "getCommerceSettings"));
  },
  { definition: getCommerceSettingsRaw.definition }
);
