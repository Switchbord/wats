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
import { assertDenseDataArray, assertJoinedStringQueryArray } from "../internal/validation/arrays.js";
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
  /** WATS-95 display-name certification status when requested via `fields=name_status`. */
  readonly name_status?: string;
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

export interface BusinessProfileUpdateResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface CommerceSettingsUpdateResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface UpdateBusinessProfileInput {
  readonly phoneNumberId: string;
  readonly about?: string;
  readonly address?: string;
  readonly description?: string;
  readonly email?: string;
  readonly vertical?: string;
  readonly websites?: readonly string[];
  readonly profilePictureHandle?: string;
}

export interface UpdateCommerceSettingsInput {
  readonly phoneNumberId: string;
  readonly isCartEnabled?: boolean;
  readonly isCatalogVisible?: boolean;
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

export interface BlockedUser {
  readonly messaging_product?: string;
  readonly wa_id?: string;
  readonly [key: string]: unknown;
}

export interface BlockedUsersResponse {
  readonly data?: readonly BlockedUser[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

export interface BlockedUserOperation {
  readonly input?: string;
  readonly wa_id?: string;
  readonly [key: string]: unknown;
}

export interface BlockUsersResponse {
  readonly block_users?: {
    readonly added_users?: readonly BlockedUserOperation[];
    readonly [key: string]: unknown;
  };
  readonly messaging_product?: string;
  readonly [key: string]: unknown;
}

export interface UnblockUsersResponse {
  readonly block_users?: {
    readonly removed_users?: readonly BlockedUserOperation[];
    readonly [key: string]: unknown;
  };
  readonly messaging_product?: string;
  readonly [key: string]: unknown;
}

export interface ListBlockedUsersInput {
  readonly phoneNumberId: string;
}

export interface BlockUsersInput {
  readonly phoneNumberId: string;
  readonly users: readonly string[];
}

export interface UnblockUsersInput {
  readonly phoneNumberId: string;
  readonly users: readonly string[];
}

export interface OfficialBusinessAccountStatusResponse {
  readonly id?: string;
  readonly oba_status?: string;
  readonly status_message?: string;
  readonly [key: string]: unknown;
}

export interface GetOfficialBusinessAccountStatusInput {
  readonly phoneNumberId: string;
  readonly fields?: BusinessManagementFields;
}

export interface RequestOfficialBusinessAccountReviewInput {
  readonly phoneNumberId: string;
  readonly businessWebsiteUrl: string;
  readonly primaryCountryOfOperation: string;
  readonly primaryLanguage?: string;
  readonly parentBusinessOrBrand?: string;
  readonly supportingLinks?: readonly string[];
  readonly additionalSupportingInformation?: string;
}

export interface OfficialBusinessAccountReviewResponse {
  readonly success?: boolean;
  readonly message?: string;
  readonly updated_status?: OfficialBusinessAccountStatusResponse;
  readonly tracking_id?: string;
  readonly [key: string]: unknown;
}

export interface SubmitDisplayNameForReviewInput {
  readonly phoneNumberId: string;
  readonly newDisplayName: string;
}

export interface SubmitDisplayNameForReviewResponse {
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
const MAX_BLOCK_USERS = 50;
const MAX_RECIPIENT_DIGITS = 15;
const MAX_DISPLAY_NAME_LENGTH = 128;
const MAX_OBA_TEXT_LENGTH = 2048;
const MAX_OBA_URL_LENGTH = 2048;
const MAX_OBA_SUPPORTING_LINKS = 10;
const MIN_OBA_SUPPORTING_LINKS = 5;
const MAX_BUSINESS_PROFILE_TEXT_LENGTH = 1024;
const MAX_BUSINESS_PROFILE_EMAIL_LENGTH = 320;
const MAX_BUSINESS_PROFILE_WEBSITES = 2;
const MAX_BUSINESS_PROFILE_WEBSITE_LENGTH = 2048;
const MAX_PROFILE_PICTURE_HANDLE_LENGTH = 1024;

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

function assertRecipient(value: unknown, fieldName: string, helperName: string): string {
  if (typeof value !== "string") {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be a phone-number string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be a non-empty phone-number string.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw validationError(`Invalid ${helperName} input: ${fieldName} must not contain control characters.`);
    }
  }
  if (value.includes("/") || value.includes("\\") || value.includes("?") || value.includes("#") || value.includes(":") || value.includes("@")) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be a phone-number string, not a path, URL, or address.`);
  }
  if (!/^\+?\d{1,15}$/u.test(value)) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be E.164-ish digits with optional leading + and at most ${MAX_RECIPIENT_DIGITS} digits.`);
  }
  return value;
}

function normalizeBlockUserList(value: unknown, helperName: string): readonly { readonly user: string }[] {
  const items = assertDenseDataArray(value, {
    helperName,
    path: "users",
    minLength: 1,
    maxLength: MAX_BLOCK_USERS,
    invalidTypeMessage: `Invalid ${helperName} input: users must be an array of phone-number strings.`,
    invalidLengthMessage: `Invalid ${helperName} input: users length must be between 1 and ${MAX_BLOCK_USERS}.`,
    sparseArrayMessage: `Invalid ${helperName} input: users must not contain sparse array holes.`,
    unsafePrototypeKeyMessage: `Invalid ${helperName} input: users contains an unsafe prototype key.`,
    unsupportedPropertyMessage: `Invalid ${helperName} input: users contains unsupported properties.`
  });
  return items.map((item, index) => ({ user: assertRecipient(item, `users[${index}]`, helperName) }));
}

function assertBoundedPlainString(value: unknown, fieldName: string, helperName: string, maxLength: number): string {
  const out = assertQueryString(value, fieldName, helperName, maxLength);
  return out;
}

function assertHttpUrl(value: unknown, fieldName: string, helperName: string): string {
  const raw = assertBoundedPlainString(value, fieldName, helperName, MAX_OBA_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be an http(s) URL.`, error);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be an http(s) URL.`);
  }
  return raw;
}

function optionalBoundedString(record: Record<string, unknown>, key: keyof RequestOfficialBusinessAccountReviewInput, helperName: string): string | undefined {
  const value = ownDataValue(record, key as string, helperName, false);
  if (value === undefined) return undefined;
  return assertBoundedPlainString(value, key as string, helperName, MAX_OBA_TEXT_LENGTH);
}

function optionalSupportingLinks(record: Record<string, unknown>, helperName: string): readonly string[] | undefined {
  const value = ownDataValue(record, "supportingLinks", helperName, false);
  if (value === undefined) return undefined;
  const items = assertDenseDataArray(value, {
    helperName,
    path: "supportingLinks",
    minLength: MIN_OBA_SUPPORTING_LINKS,
    maxLength: MAX_OBA_SUPPORTING_LINKS,
    invalidTypeMessage: `Invalid ${helperName} input: supportingLinks must be an array of http(s) URLs.`,
    invalidLengthMessage: `Invalid ${helperName} input: supportingLinks length must be between ${MIN_OBA_SUPPORTING_LINKS} and ${MAX_OBA_SUPPORTING_LINKS}.`,
    sparseArrayMessage: `Invalid ${helperName} input: supportingLinks must not contain sparse array holes.`,
    unsafePrototypeKeyMessage: `Invalid ${helperName} input: supportingLinks contains an unsafe prototype key.`,
    unsupportedPropertyMessage: `Invalid ${helperName} input: supportingLinks contains unsupported properties.`
  });
  const out = items.map((item, index) => assertHttpUrl(item, `supportingLinks[${index}]`, helperName));
  if (new Set(out).size !== out.length) {
    throw validationError(`Invalid ${helperName} input: supportingLinks must not contain duplicates.`);
  }
  return out;
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

export function normalizeListBlockedUsersParams(input: ListBlockedUsersInput): WireParams {
  const helperName = "listBlockedUsers";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function buildBlockUsersBody(input: BlockUsersInput | UnblockUsersInput): Record<string, unknown> {
  const helperName = "blockUsers";
  const record = assertPlainRecord(input, helperName);
  return {
    messaging_product: "whatsapp",
    block_users: normalizeBlockUserList(ownDataValue(record, "users", helperName, true), helperName)
  };
}

export function normalizeBlockUsersParams(input: BlockUsersInput): WireParams {
  const helperName = "blockUsers";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function buildUnblockUsersBody(input: UnblockUsersInput): Record<string, unknown> {
  const helperName = "unblockUsers";
  const record = assertPlainRecord(input, helperName);
  return {
    messaging_product: "whatsapp",
    block_users: normalizeBlockUserList(ownDataValue(record, "users", helperName, true), helperName)
  };
}

export function normalizeUnblockUsersParams(input: UnblockUsersInput): WireParams {
  const helperName = "unblockUsers";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function normalizeOfficialBusinessAccountStatusParams(input: GetOfficialBusinessAccountStatusInput): WireParams {
  const helperName = "getOfficialBusinessAccountStatus";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
  const fields = optionalFields(record, helperName);
  if (fields !== undefined) out.fields = fields;
  return out;
}

export function buildOfficialBusinessAccountReviewBody(input: RequestOfficialBusinessAccountReviewInput): Record<string, unknown> {
  const helperName = "requestOfficialBusinessAccountReview";
  const record = assertPlainRecord(input, helperName);
  const out: Record<string, unknown> = {
    business_website_url: assertHttpUrl(ownDataValue(record, "businessWebsiteUrl", helperName, true), "businessWebsiteUrl", helperName),
    primary_country_of_operation: assertBoundedPlainString(ownDataValue(record, "primaryCountryOfOperation", helperName, true), "primaryCountryOfOperation", helperName, 2).toUpperCase()
  };
  if (!/^[A-Z]{2}$/u.test(out.primary_country_of_operation as string)) {
    throw validationError(`Invalid ${helperName} input: primaryCountryOfOperation must be an ISO 3166-1 alpha-2 country code.`);
  }
  const primaryLanguage = optionalBoundedString(record, "primaryLanguage", helperName);
  const parentBusinessOrBrand = optionalBoundedString(record, "parentBusinessOrBrand", helperName);
  const supportingLinks = optionalSupportingLinks(record, helperName);
  const additional = optionalBoundedString(record, "additionalSupportingInformation", helperName);
  if (primaryLanguage !== undefined) out.primary_language = primaryLanguage;
  if (parentBusinessOrBrand !== undefined) out.parent_business_or_brand = parentBusinessOrBrand;
  if (supportingLinks !== undefined) out.supporting_links = supportingLinks;
  if (additional !== undefined) out.additional_supporting_information = additional;
  return out;
}

export function normalizeOfficialBusinessAccountReviewParams(input: RequestOfficialBusinessAccountReviewInput): WireParams {
  const helperName = "requestOfficialBusinessAccountReview";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function buildDisplayNameReviewBody(input: SubmitDisplayNameForReviewInput): Record<string, unknown> {
  const helperName = "submitDisplayNameForReview";
  const record = assertPlainRecord(input, helperName);
  return { new_display_name: assertBoundedPlainString(ownDataValue(record, "newDisplayName", helperName, true), "newDisplayName", helperName, MAX_DISPLAY_NAME_LENGTH) };
}

export function normalizeDisplayNameReviewParams(input: SubmitDisplayNameForReviewInput): WireParams {
  const helperName = "submitDisplayNameForReview";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
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

function optionalBusinessProfileString(
  record: Record<string, unknown>,
  key: keyof UpdateBusinessProfileInput,
  helperName: string,
  maxLength = MAX_BUSINESS_PROFILE_TEXT_LENGTH
): string | undefined {
  const value = ownDataValue(record, key as string, helperName, false);
  if (value === undefined) return undefined;
  return assertBoundedPlainString(value, key as string, helperName, maxLength);
}

function optionalBusinessProfileWebsites(record: Record<string, unknown>, helperName: string): readonly string[] | undefined {
  const value = ownDataValue(record, "websites", helperName, false);
  if (value === undefined) return undefined;
  const items = assertDenseDataArray(value, {
    helperName,
    path: "websites",
    minLength: 1,
    maxLength: MAX_BUSINESS_PROFILE_WEBSITES,
    invalidTypeMessage: `Invalid ${helperName} input: websites must be an array of http(s) URLs.`,
    invalidLengthMessage: `Invalid ${helperName} input: websites length must be between 1 and ${MAX_BUSINESS_PROFILE_WEBSITES}.`,
    sparseArrayMessage: `Invalid ${helperName} input: websites must not contain sparse array holes.`,
    unsafePrototypeKeyMessage: `Invalid ${helperName} input: websites contains an unsafe prototype key.`,
    unsupportedPropertyMessage: `Invalid ${helperName} input: websites contains unsupported properties.`
  });
  return items.map((item, index) => assertHttpUrl(item, `websites[${index}]`, helperName));
}

function optionalBoolean(record: Record<string, unknown>, key: keyof UpdateCommerceSettingsInput, helperName: string): boolean | undefined {
  const value = ownDataValue(record, key as string, helperName, false);
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw validationError(`Invalid ${helperName} input: ${String(key)} must be boolean when provided.`);
  }
  return value;
}

export function buildUpdateBusinessProfileBody(input: UpdateBusinessProfileInput): Record<string, unknown> {
  const helperName = "updateBusinessProfile";
  const record = assertPlainRecord(input, helperName);
  const out: Record<string, unknown> = { messaging_product: "whatsapp" };
  const about = optionalBusinessProfileString(record, "about", helperName);
  const address = optionalBusinessProfileString(record, "address", helperName);
  const description = optionalBusinessProfileString(record, "description", helperName);
  const email = optionalBusinessProfileString(record, "email", helperName, MAX_BUSINESS_PROFILE_EMAIL_LENGTH);
  const vertical = optionalBusinessProfileString(record, "vertical", helperName, 128);
  const websites = optionalBusinessProfileWebsites(record, helperName);
  const profilePictureHandle = optionalBusinessProfileString(record, "profilePictureHandle", helperName, MAX_PROFILE_PICTURE_HANDLE_LENGTH);
  if (about !== undefined) out.about = about;
  if (address !== undefined) out.address = address;
  if (description !== undefined) out.description = description;
  if (email !== undefined) out.email = email;
  if (vertical !== undefined) out.vertical = vertical;
  if (websites !== undefined) out.websites = websites;
  if (profilePictureHandle !== undefined) out.profile_picture_handle = profilePictureHandle;
  if (Object.keys(out).length === 1) {
    throw validationError(`Invalid ${helperName} input: at least one profile field is required.`);
  }
  return out;
}

export function normalizeUpdateBusinessProfileParams(input: UpdateBusinessProfileInput): WireParams {
  const helperName = "updateBusinessProfile";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function buildUpdateCommerceSettingsBody(input: UpdateCommerceSettingsInput): Record<string, unknown> {
  const helperName = "updateCommerceSettings";
  const record = assertPlainRecord(input, helperName);
  const out: Record<string, unknown> = {};
  const isCartEnabled = optionalBoolean(record, "isCartEnabled", helperName);
  const isCatalogVisible = optionalBoolean(record, "isCatalogVisible", helperName);
  if (isCartEnabled !== undefined) out.is_cart_enabled = isCartEnabled;
  if (isCatalogVisible !== undefined) out.is_catalog_visible = isCatalogVisible;
  if (Object.keys(out).length === 0) {
    throw validationError(`Invalid ${helperName} input: at least one commerce setting is required.`);
  }
  return out;
}

export function normalizeUpdateCommerceSettingsParams(input: UpdateCommerceSettingsInput): WireParams {
  const helperName = "updateCommerceSettings";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
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

const listBlockedUsersRaw = defineEndpoint<{ phoneNumberId: string }, never, BlockedUsersResponse>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/block_users",
  params: { phoneNumberId: { in: "path", required: true } }
});

const blockUsersRaw = defineEndpoint<{ phoneNumberId: string }, BlockUsersInput, BlockUsersResponse>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/block_users",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildBlockUsersBody
});

const unblockUsersRaw = defineEndpoint<{ phoneNumberId: string }, UnblockUsersInput, UnblockUsersResponse>({
  method: "DELETE",
  pathTemplate: "/{phoneNumberId}/block_users",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUnblockUsersBody
});

const getOfficialBusinessAccountStatusRaw = defineEndpoint<
  { phoneNumberId: string; fields?: string },
  never,
  OfficialBusinessAccountStatusResponse
>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/official_business_account",
  params: { phoneNumberId: { in: "path", required: true }, fields: { in: "query" } }
});

const requestOfficialBusinessAccountReviewRaw = defineEndpoint<
  { phoneNumberId: string },
  RequestOfficialBusinessAccountReviewInput,
  OfficialBusinessAccountReviewResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/official_business_account",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildOfficialBusinessAccountReviewBody
});

const submitDisplayNameForReviewRaw = defineEndpoint<
  { phoneNumberId: string },
  SubmitDisplayNameForReviewInput,
  SubmitDisplayNameForReviewResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildDisplayNameReviewBody
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

const updateBusinessProfileRaw = defineEndpoint<
  { phoneNumberId: string },
  UpdateBusinessProfileInput,
  BusinessProfileUpdateResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/whatsapp_business_profile",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUpdateBusinessProfileBody
});

const updateCommerceSettingsRaw = defineEndpoint<
  { phoneNumberId: string },
  UpdateCommerceSettingsInput,
  CommerceSettingsUpdateResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/whatsapp_commerce_settings",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUpdateCommerceSettingsBody
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

export const listBlockedUsers = Object.assign(
  async function listBlockedUsers(client: GraphClient, params: ListBlockedUsersInput, body?: never, opts?: EndpointInvokeOptions): Promise<BlockedUsersResponse> {
    assertNoBody(body, "listBlockedUsers");
    return listBlockedUsersRaw(client, normalizeListBlockedUsersParams(params) as Parameters<typeof listBlockedUsersRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "listBlockedUsers"));
  },
  { definition: listBlockedUsersRaw.definition }
);

export const blockUsers = Object.assign(
  async function blockUsers(client: GraphClient, params: BlockUsersInput, body?: never, opts?: EndpointInvokeOptions): Promise<BlockUsersResponse> {
    assertNoBody(body, "blockUsers");
    return blockUsersRaw(client, normalizeBlockUsersParams(params) as Parameters<typeof blockUsersRaw>[1], params, sanitizeBusinessManagementOptions(opts, "blockUsers"));
  },
  { definition: blockUsersRaw.definition }
);

export const unblockUsers = Object.assign(
  async function unblockUsers(client: GraphClient, params: UnblockUsersInput, body?: never, opts?: EndpointInvokeOptions): Promise<UnblockUsersResponse> {
    assertNoBody(body, "unblockUsers");
    return unblockUsersRaw(client, normalizeUnblockUsersParams(params) as Parameters<typeof unblockUsersRaw>[1], params, sanitizeBusinessManagementOptions(opts, "unblockUsers"));
  },
  { definition: unblockUsersRaw.definition }
);

export const getOfficialBusinessAccountStatus = Object.assign(
  async function getOfficialBusinessAccountStatus(client: GraphClient, params: GetOfficialBusinessAccountStatusInput, body?: never, opts?: EndpointInvokeOptions): Promise<OfficialBusinessAccountStatusResponse> {
    assertNoBody(body, "getOfficialBusinessAccountStatus");
    return getOfficialBusinessAccountStatusRaw(client, normalizeOfficialBusinessAccountStatusParams(params) as Parameters<typeof getOfficialBusinessAccountStatusRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "getOfficialBusinessAccountStatus"));
  },
  { definition: getOfficialBusinessAccountStatusRaw.definition }
);

export const requestOfficialBusinessAccountReview = Object.assign(
  async function requestOfficialBusinessAccountReview(client: GraphClient, params: RequestOfficialBusinessAccountReviewInput, body?: never, opts?: EndpointInvokeOptions): Promise<OfficialBusinessAccountReviewResponse> {
    assertNoBody(body, "requestOfficialBusinessAccountReview");
    return requestOfficialBusinessAccountReviewRaw(client, normalizeOfficialBusinessAccountReviewParams(params) as Parameters<typeof requestOfficialBusinessAccountReviewRaw>[1], params, sanitizeBusinessManagementOptions(opts, "requestOfficialBusinessAccountReview"));
  },
  { definition: requestOfficialBusinessAccountReviewRaw.definition }
);

export const submitDisplayNameForReview = Object.assign(
  async function submitDisplayNameForReview(client: GraphClient, params: SubmitDisplayNameForReviewInput, body?: never, opts?: EndpointInvokeOptions): Promise<SubmitDisplayNameForReviewResponse> {
    assertNoBody(body, "submitDisplayNameForReview");
    return submitDisplayNameForReviewRaw(client, normalizeDisplayNameReviewParams(params) as Parameters<typeof submitDisplayNameForReviewRaw>[1], params, sanitizeBusinessManagementOptions(opts, "submitDisplayNameForReview"));
  },
  { definition: submitDisplayNameForReviewRaw.definition }
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

export const updateBusinessProfile = Object.assign(
  async function updateBusinessProfile(client: GraphClient, params: UpdateBusinessProfileInput, body?: never, opts?: EndpointInvokeOptions): Promise<BusinessProfileUpdateResponse> {
    assertNoBody(body, "updateBusinessProfile");
    return updateBusinessProfileRaw(client, normalizeUpdateBusinessProfileParams(params) as Parameters<typeof updateBusinessProfileRaw>[1], params, sanitizeBusinessManagementOptions(opts, "updateBusinessProfile"));
  },
  { definition: updateBusinessProfileRaw.definition }
);

export const updateCommerceSettings = Object.assign(
  async function updateCommerceSettings(client: GraphClient, params: UpdateCommerceSettingsInput, body?: never, opts?: EndpointInvokeOptions): Promise<CommerceSettingsUpdateResponse> {
    assertNoBody(body, "updateCommerceSettings");
    return updateCommerceSettingsRaw(client, normalizeUpdateCommerceSettingsParams(params) as Parameters<typeof updateCommerceSettingsRaw>[1], params, sanitizeBusinessManagementOptions(opts, "updateCommerceSettings"));
  },
  { definition: updateCommerceSettingsRaw.definition }
);
