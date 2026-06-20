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

/** Read-side `calling.sip.servers[]` entry. `sip_user_password`/`app_id` are GET-only. */
export interface SipServerSettings {
  readonly hostname?: string;
  readonly port?: number;
  readonly request_uri_user_params?: Record<string, string>;
  /** Response-only; present on read only when `include_sip_credentials=true`. Never sent in updates. */
  readonly sip_user_password?: string;
  /** Response-only; never sent in updates. */
  readonly app_id?: number;
  readonly [key: string]: unknown;
}

export interface SipSettings {
  readonly status?: string;
  readonly servers?: readonly SipServerSettings[];
  readonly [key: string]: unknown;
}

export interface CallHoursWeeklyOperatingHoursSettings {
  readonly day_of_week?: string;
  readonly open_time?: string;
  readonly close_time?: string;
  readonly [key: string]: unknown;
}

export interface CallHoursHolidayScheduleSettings {
  readonly date?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly [key: string]: unknown;
}

export interface CallHoursSettings {
  readonly status?: string;
  readonly timezone_id?: string;
  readonly weekly_operating_hours?: readonly CallHoursWeeklyOperatingHoursSettings[];
  readonly holiday_schedule?: readonly CallHoursHolidayScheduleSettings[];
  readonly [key: string]: unknown;
}

export interface CallIconsSettings {
  readonly restrict_to_user_countries?: readonly string[];
  readonly [key: string]: unknown;
}

export interface CallingSettings {
  readonly status?: string;
  readonly call_icon_visibility?: string;
  readonly call_icons?: CallIconsSettings;
  readonly call_hours?: CallHoursSettings;
  readonly callback_permission_status?: string;
  readonly sip?: SipSettings;
  readonly [key: string]: unknown;
}

export interface PhoneNumberSettingsEntry {
  readonly calling?: CallingSettings;
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

export type CallingStatus = "ENABLED" | "DISABLED";

export interface CallIconsInput {
  readonly restrictToUserCountries?: readonly string[];
}

export interface WeeklyOperatingHoursInput {
  readonly dayOfWeek: string;
  readonly openTime: string;
  readonly closeTime: string;
}

export interface HolidayScheduleInput {
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
}

export interface CallHoursInput {
  readonly status?: CallingStatus | string;
  readonly timezoneId?: string;
  readonly weeklyOperatingHours?: readonly WeeklyOperatingHoursInput[];
  readonly holidaySchedule?: readonly HolidayScheduleInput[];
}

export interface SipServerInput {
  readonly hostname: string;
  readonly port?: number;
  readonly requestUriUserParams?: Record<string, string>;
}

export interface SipInput {
  readonly status?: CallingStatus | string;
  readonly servers?: readonly SipServerInput[];
}

export interface CallingInput {
  readonly status?: CallingStatus | string;
  readonly callIconVisibility?: "DEFAULT" | "DISABLE_ALL" | string;
  readonly callIcons?: CallIconsInput;
  readonly callHours?: CallHoursInput;
  readonly callbackPermissionStatus?: CallingStatus | string;
  readonly sip?: SipInput;
}

export interface UpdatePhoneNumberSettingsInput {
  readonly phoneNumberId: string;
  readonly storageConfiguration?: StorageConfigurationInput;
  readonly calling?: CallingInput;
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

export interface CreatePhoneNumberInput {
  readonly wabaId: string;
  readonly countryCode: string;
  readonly phoneNumber: string;
  readonly verifiedName: string;
}

export interface CreatePhoneNumberResponse {
  readonly id?: string;
  readonly [key: string]: unknown;
}

export interface RequestVerificationCodeInput {
  readonly phoneNumberId: string;
  readonly codeMethod: "SMS" | "VOICE" | string;
  readonly language: string;
}

export interface RequestVerificationCodeResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface VerifyPhoneNumberInput {
  readonly phoneNumberId: string;
  readonly code: string;
}

export interface VerifyPhoneNumberResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface RegisterPhoneNumberInput {
  readonly phoneNumberId: string;
  readonly pin: string;
  readonly dataLocalizationRegion?: string;
}

export interface RegisterPhoneNumberResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface DeregisterPhoneNumberInput {
  readonly phoneNumberId: string;
}

export interface DeregisterPhoneNumberResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface SetTwoStepVerificationPinInput {
  readonly phoneNumberId: string;
  readonly pin: string;
}

export interface SetTwoStepVerificationPinResponse {
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

const CODE_METHOD_VALUES = new Set(["SMS", "VOICE"]);

function assertCodeMethod(value: unknown, helperName: string): string {
  const str = assertQueryString(value, "codeMethod", helperName, 16).toUpperCase();
  if (!CODE_METHOD_VALUES.has(str)) {
    throw validationError(`Invalid ${helperName} input: codeMethod must be one of SMS, VOICE.`);
  }
  return str;
}

function assertLanguage(value: unknown, helperName: string): string {
  const str = assertQueryString(value, "language", helperName, 8).toLowerCase();
  if (!/^[a-z]{2}$/u.test(str)) {
    throw validationError(`Invalid ${helperName} input: language must be a 2-letter language code.`);
  }
  return str;
}

// SECURITY: `value` is a verification code. It MUST NEVER be interpolated
// into any error message — the message templates below are static and
// intentionally describe only the validation rule that failed.
function assertVerificationCode(value: unknown, helperName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError(`Invalid ${helperName} input: code must be a non-empty string.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw validationError(`Invalid ${helperName} input: code must not contain control characters.`);
    }
  }
  if (!/^\d{1,32}$/u.test(value)) {
    throw validationError(`Invalid ${helperName} input: code must be 1-32 digits.`);
  }
  return value;
}

function assertCountryCode(value: unknown, helperName: string): string {
  const str = assertQueryString(value, "countryCode", helperName, 6);
  if (!/^\d{1,6}$/u.test(str)) {
    throw validationError(`Invalid ${helperName} input: countryCode must be 1-6 digits.`);
  }
  return str;
}

function assertNationalPhoneNumber(value: unknown, helperName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError(`Invalid ${helperName} input: phoneNumber must be a non-empty digits string.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw validationError(`Invalid ${helperName} input: phoneNumber must not contain control characters.`);
    }
  }
  if (!/^\d{1,15}$/u.test(value)) {
    throw validationError(`Invalid ${helperName} input: phoneNumber must be 1-15 digits.`);
  }
  return value;
}

// SECURITY: `value` is a registration / two-step verification PIN. It MUST
// NEVER be interpolated into any error message — the message templates
// below are static and intentionally describe only the validation rule
// that failed.
function assertPin(value: unknown, helperName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError(`Invalid ${helperName} input: pin must be a non-empty string.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw validationError(`Invalid ${helperName} input: pin must not contain control characters.`);
    }
  }
  if (!/^\d{6}$/u.test(value)) {
    throw validationError(`Invalid ${helperName} input: pin must be exactly 6 digits.`);
  }
  return value;
}

function assertDataLocalizationRegion(value: unknown, helperName: string): string {
  const str = assertBoundedPlainString(value, "dataLocalizationRegion", helperName, 2).toUpperCase();
  if (!/^[A-Z]{2}$/u.test(str)) {
    throw validationError(`Invalid ${helperName} input: dataLocalizationRegion must be an ISO 3166-1 alpha-2 country code.`);
  }
  return str;
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

const MAX_SIP_SERVERS = 3;
const MAX_WEEKLY_OPERATING_HOURS_PER_DAY = 2;
const MAX_HOLIDAY_SCHEDULE_ENTRIES = 20;
const MAX_RESTRICT_COUNTRIES = 64;
const MAX_URI_USER_PARAM_KEYS = 32;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_TIMEZONE_LENGTH = 64;
const MAX_PORT = 65535;
const CALLING_STATUS_VALUES = new Set(["ENABLED", "DISABLED"]);
const CALL_ICON_VISIBILITY_VALUES = new Set(["DEFAULT", "DISABLE_ALL"]);
const DAY_OF_WEEK_VALUES = new Set(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);
const HHMM_PATTERN = /^([01]\d|2[0-3])[0-5]\d$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function assertCallingEnum(value: unknown, allowed: ReadonlySet<string>, fieldName: string, helperName: string): string {
  const str = assertQueryString(value, fieldName, helperName, 64).toUpperCase();
  if (!allowed.has(str)) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be one of ${[...allowed].join(", ")}.`);
  }
  return str;
}

function assertHhmm(value: unknown, fieldName: string, helperName: string): string {
  const str = assertQueryString(value, fieldName, helperName, 4);
  if (!HHMM_PATTERN.test(str)) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be a 24h "HHMM" string.`);
  }
  return str;
}

function assertPort(value: unknown, fieldName: string, helperName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_PORT) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be an integer between 0 and ${MAX_PORT}.`);
  }
  return value;
}

function sanitizeCallingArray(value: unknown, path: string, helperName: string, maxLength: number): unknown[] {
  return assertDenseDataArray(value, {
    helperName,
    path,
    maxLength,
    invalidTypeMessage: `Invalid ${helperName} input: ${path} must be an array.`,
    invalidLengthMessage: `Invalid ${helperName} input: ${path} must contain at most ${maxLength} entries.`,
    sparseArrayMessage: `Invalid ${helperName} input: ${path} must not contain sparse array holes.`,
    unsafePrototypeKeyMessage: `Invalid ${helperName} input: ${path} contains an unsafe prototype key.`,
    unsupportedPropertyMessage: `Invalid ${helperName} input: ${path} contains unsupported properties.`
  });
}

function sanitizeRequestUriUserParams(value: unknown, path: string, helperName: string): Record<string, string> {
  const record = assertPlainRecord(value, helperName, path);
  const out: Record<string, string> = {};
  const keys = Object.keys(record);
  if (keys.length > MAX_URI_USER_PARAM_KEYS) {
    throw validationError(`Invalid ${helperName} input: ${path} must contain at most ${MAX_URI_USER_PARAM_KEYS} keys.`);
  }
  for (const key of keys) {
    const nested = ownDataValue(record, key, helperName, false);
    out[key] = assertQueryString(nested, `${path}.${key}`, helperName, 256);
  }
  return out;
}

function sanitizeSipServer(value: unknown, path: string, helperName: string): Record<string, unknown> {
  const record = assertPlainRecord(value, helperName, path);
  const out: Record<string, unknown> = {
    hostname: assertQueryString(ownDataValue(record, "hostname", helperName, true), `${path}.hostname`, helperName, MAX_HOSTNAME_LENGTH)
  };
  const port = ownDataValue(record, "port", helperName, false);
  if (port !== undefined) out.port = assertPort(port, `${path}.port`, helperName);
  const requestUriUserParams = ownDataValue(record, "requestUriUserParams", helperName, false);
  if (requestUriUserParams !== undefined) {
    out.request_uri_user_params = sanitizeRequestUriUserParams(requestUriUserParams, `${path}.requestUriUserParams`, helperName);
  }
  // Response-only credential/identity fields (sip_user_password, app_id, camelCase variants) are
  // never copied into `out`, so they are silently dropped even if a GET response is round-tripped here.
  return out;
}

function sanitizeSip(value: unknown, helperName: string): Record<string, unknown> {
  const path = "calling.sip";
  const record = assertPlainRecord(value, helperName, path);
  const out: Record<string, unknown> = {};
  const status = ownDataValue(record, "status", helperName, false);
  if (status !== undefined) out.status = assertCallingEnum(status, CALLING_STATUS_VALUES, `${path}.status`, helperName);
  const servers = ownDataValue(record, "servers", helperName, false);
  if (servers !== undefined) {
    const items = sanitizeCallingArray(servers, `${path}.servers`, helperName, MAX_SIP_SERVERS);
    out.servers = items.map((item, index) => sanitizeSipServer(item, `${path}.servers[${index}]`, helperName));
  }
  return out;
}

function sanitizeWeeklyOperatingHours(value: unknown, helperName: string): Record<string, unknown>[] {
  const path = "calling.callHours.weeklyOperatingHours";
  const items = assertDenseDataArray(value, {
    helperName,
    path,
    invalidTypeMessage: `Invalid ${helperName} input: ${path} must be an array.`,
    sparseArrayMessage: `Invalid ${helperName} input: ${path} must not contain sparse array holes.`,
    unsafePrototypeKeyMessage: `Invalid ${helperName} input: ${path} contains an unsafe prototype key.`,
    unsupportedPropertyMessage: `Invalid ${helperName} input: ${path} contains unsupported properties.`
  });
  const perDay = new Map<string, number>();
  return items.map((item, index) => {
    const entryPath = `${path}[${index}]`;
    const record = assertPlainRecord(item, helperName, entryPath);
    const day = assertCallingEnum(ownDataValue(record, "dayOfWeek", helperName, true), DAY_OF_WEEK_VALUES, `${entryPath}.dayOfWeek`, helperName);
    const count = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, count);
    if (count > MAX_WEEKLY_OPERATING_HOURS_PER_DAY) {
      throw validationError(`Invalid ${helperName} input: ${path} must contain at most ${MAX_WEEKLY_OPERATING_HOURS_PER_DAY} entries per day.`);
    }
    return {
      day_of_week: day,
      open_time: assertHhmm(ownDataValue(record, "openTime", helperName, true), `${entryPath}.openTime`, helperName),
      close_time: assertHhmm(ownDataValue(record, "closeTime", helperName, true), `${entryPath}.closeTime`, helperName)
    };
  });
}

function sanitizeHolidaySchedule(value: unknown, helperName: string): Record<string, unknown>[] {
  const path = "calling.callHours.holidaySchedule";
  const items = sanitizeCallingArray(value, path, helperName, MAX_HOLIDAY_SCHEDULE_ENTRIES);
  return items.map((item, index) => {
    const entryPath = `${path}[${index}]`;
    const record = assertPlainRecord(item, helperName, entryPath);
    const date = assertQueryString(ownDataValue(record, "date", helperName, true), `${entryPath}.date`, helperName, 10);
    if (!DATE_PATTERN.test(date)) {
      throw validationError(`Invalid ${helperName} input: ${entryPath}.date must be a "YYYY-MM-DD" string.`);
    }
    return {
      date,
      start_time: assertHhmm(ownDataValue(record, "startTime", helperName, true), `${entryPath}.startTime`, helperName),
      end_time: assertHhmm(ownDataValue(record, "endTime", helperName, true), `${entryPath}.endTime`, helperName)
    };
  });
}

function sanitizeCallHours(value: unknown, helperName: string): Record<string, unknown> {
  const path = "calling.callHours";
  const record = assertPlainRecord(value, helperName, path);
  const out: Record<string, unknown> = {};
  const status = ownDataValue(record, "status", helperName, false);
  if (status !== undefined) out.status = assertCallingEnum(status, CALLING_STATUS_VALUES, `${path}.status`, helperName);
  const timezoneId = ownDataValue(record, "timezoneId", helperName, false);
  if (timezoneId !== undefined) out.timezone_id = assertQueryString(timezoneId, `${path}.timezoneId`, helperName, MAX_TIMEZONE_LENGTH);
  const weekly = ownDataValue(record, "weeklyOperatingHours", helperName, false);
  if (weekly !== undefined) out.weekly_operating_hours = sanitizeWeeklyOperatingHours(weekly, helperName);
  const holiday = ownDataValue(record, "holidaySchedule", helperName, false);
  if (holiday !== undefined) out.holiday_schedule = sanitizeHolidaySchedule(holiday, helperName);
  return out;
}

function sanitizeCallIcons(value: unknown, helperName: string): Record<string, unknown> {
  const path = "calling.callIcons";
  const record = assertPlainRecord(value, helperName, path);
  const out: Record<string, unknown> = {};
  const restrict = ownDataValue(record, "restrictToUserCountries", helperName, false);
  if (restrict !== undefined) {
    const items = sanitizeCallingArray(restrict, `${path}.restrictToUserCountries`, helperName, MAX_RESTRICT_COUNTRIES);
    out.restrict_to_user_countries = items.map((item, index) =>
      assertQueryString(item, `${path}.restrictToUserCountries[${index}]`, helperName, 8)
    );
  }
  return out;
}

function sanitizeCalling(value: unknown, helperName: string): Record<string, unknown> {
  const path = "calling";
  const record = assertPlainRecord(value, helperName, path);
  const out: Record<string, unknown> = {};
  const status = ownDataValue(record, "status", helperName, false);
  if (status !== undefined) out.status = assertCallingEnum(status, CALLING_STATUS_VALUES, `${path}.status`, helperName);
  const callIconVisibility = ownDataValue(record, "callIconVisibility", helperName, false);
  if (callIconVisibility !== undefined) out.call_icon_visibility = assertCallingEnum(callIconVisibility, CALL_ICON_VISIBILITY_VALUES, `${path}.callIconVisibility`, helperName);
  const callIcons = ownDataValue(record, "callIcons", helperName, false);
  if (callIcons !== undefined) out.call_icons = sanitizeCallIcons(callIcons, helperName);
  const callHours = ownDataValue(record, "callHours", helperName, false);
  if (callHours !== undefined) out.call_hours = sanitizeCallHours(callHours, helperName);
  const callbackPermissionStatus = ownDataValue(record, "callbackPermissionStatus", helperName, false);
  if (callbackPermissionStatus !== undefined) out.callback_permission_status = assertCallingEnum(callbackPermissionStatus, CALLING_STATUS_VALUES, `${path}.callbackPermissionStatus`, helperName);
  const sip = ownDataValue(record, "sip", helperName, false);
  if (sip !== undefined) out.sip = sanitizeSip(sip, helperName);
  return out;
}

export function buildUpdatePhoneNumberSettingsBody(input: UpdatePhoneNumberSettingsInput): Record<string, unknown> {
  const helperName = "updatePhoneNumberSettings";
  const record = assertPlainRecord(input, helperName);
  if (ownDataValue(record, "dataLocalizationRegion", helperName, false) !== undefined || ownDataValue(record, "data_localization_region", helperName, false) !== undefined) {
    throw validationError(`Invalid ${helperName} input: dataLocalizationRegion is not supported; use storageConfiguration.`);
  }
  const storageConfiguration = ownDataValue(record, "storageConfiguration", helperName, false);
  const calling = ownDataValue(record, "calling", helperName, false);
  if (storageConfiguration === undefined && calling === undefined) {
    throw validationError(`Invalid ${helperName} input: at least one of storageConfiguration or calling is required.`);
  }
  const body: Record<string, unknown> = {};
  if (storageConfiguration !== undefined) body.storage_configuration = sanitizeStorageConfiguration(storageConfiguration, helperName);
  if (calling !== undefined) body.calling = sanitizeCalling(calling, helperName);
  return body;
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

export function buildCreatePhoneNumberBody(input: CreatePhoneNumberInput): Record<string, unknown> {
  const helperName = "createPhoneNumber";
  const record = assertPlainRecord(input, helperName);
  return {
    country_code: assertCountryCode(ownDataValue(record, "countryCode", helperName, true), helperName),
    phone_number: assertNationalPhoneNumber(ownDataValue(record, "phoneNumber", helperName, true), helperName),
    verified_name: assertBoundedPlainString(ownDataValue(record, "verifiedName", helperName, true), "verifiedName", helperName, MAX_DISPLAY_NAME_LENGTH)
  };
}

export function normalizeCreatePhoneNumberParams(input: CreatePhoneNumberInput): WireParams {
  const helperName = "createPhoneNumber";
  const record = assertPlainRecord(input, helperName);
  return { wabaId: assertPathId(ownDataValue(record, "wabaId", helperName, true), "wabaId", helperName) };
}

export function normalizeRequestVerificationCodeParams(input: RequestVerificationCodeInput): WireParams {
  const helperName = "requestVerificationCode";
  const record = assertPlainRecord(input, helperName);
  return {
    phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName),
    code_method: assertCodeMethod(ownDataValue(record, "codeMethod", helperName, true), helperName),
    language: assertLanguage(ownDataValue(record, "language", helperName, true), helperName)
  };
}

export function normalizeVerifyPhoneNumberParams(input: VerifyPhoneNumberInput): WireParams {
  const helperName = "verifyPhoneNumber";
  const record = assertPlainRecord(input, helperName);
  return {
    phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName),
    code: assertVerificationCode(ownDataValue(record, "code", helperName, true), helperName)
  };
}

export function buildRegisterPhoneNumberBody(input: RegisterPhoneNumberInput): Record<string, unknown> {
  const helperName = "registerPhoneNumber";
  const record = assertPlainRecord(input, helperName);
  const out: Record<string, unknown> = {
    messaging_product: "whatsapp",
    pin: assertPin(ownDataValue(record, "pin", helperName, true), helperName)
  };
  const dataLocalizationRegion = ownDataValue(record, "dataLocalizationRegion", helperName, false);
  if (dataLocalizationRegion !== undefined) {
    out.data_localization_region = assertDataLocalizationRegion(dataLocalizationRegion, helperName);
  }
  return out;
}

export function normalizeRegisterPhoneNumberParams(input: RegisterPhoneNumberInput): WireParams {
  const helperName = "registerPhoneNumber";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function normalizeDeregisterPhoneNumberParams(input: DeregisterPhoneNumberInput): WireParams {
  const helperName = "deregisterPhoneNumber";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

export function buildSetTwoStepVerificationPinBody(input: SetTwoStepVerificationPinInput): Record<string, unknown> {
  const helperName = "setTwoStepVerificationPin";
  const record = assertPlainRecord(input, helperName);
  return {
    two_step_verification: {
      pin: assertPin(ownDataValue(record, "pin", helperName, true), helperName)
    }
  };
}

export function normalizeSetTwoStepVerificationPinParams(input: SetTwoStepVerificationPinInput): WireParams {
  const helperName = "setTwoStepVerificationPin";
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

// WATS-157A — public key get/set admin helpers (whatsapp_business_encryption).
//
// pywa exposes ONLY a setter (`set_business_public_key`) that POSTs a
// form-encoded `business_public_key=<PEM>` body. WATS implements BOTH a
// getter and a setter (the issue title says get/set). The GET response shape
// is UNVERIFIED live (pywa has no getter and Meta's doc page is
// client-rendered), so the getter response is typed tolerantly with optional
// fields + `[key: string]: unknown` — shape-only, do not rely on it without a
// live confirmation. The setter matches pywa's proven form-encoded wire
// contract exactly. `business_public_key` is a 2048-bit RSA PUBLIC key (NOT a
// secret); it is safe to reference in diagnostics, though we still avoid
// echoing the caller-supplied value in validation-error messages.
// ---------------------------------------------------------------------------

const MAX_BUSINESS_PUBLIC_KEY_LENGTH = 4096;
const PEM_BEGIN_MARKER = "-----BEGIN PUBLIC KEY-----";
const PEM_END_MARKER = "-----END PUBLIC KEY-----";

/**
 * Response shape for `GET /{phoneNumberId}/whatsapp_business_encryption`.
 *
 * NOTE: this GET edge is UNVERIFIED live (pywa does not implement a getter).
 * `business_public_key` is the symmetric Graph-convention best-guess. All
 * fields are optional and the `[key: string]: unknown` index provides
 * tolerance until the live shape is confirmed.
 */
export interface BusinessPublicKeyResponse {
  readonly business_public_key?: string;
  readonly id?: string;
  readonly [key: string]: unknown;
}

/** Response shape for `POST /{phoneNumberId}/whatsapp_business_encryption`. */
export interface BusinessPublicKeyUpdateResponse {
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface GetBusinessPublicKeyInput {
  readonly phoneNumberId: string;
  readonly fields?: BusinessManagementFields;
}

export interface SetBusinessPublicKeyInput {
  readonly phoneNumberId: string;
  readonly businessPublicKey: string;
}

/**
 * Validate a `businessPublicKey` PEM string. The value is a PUBLIC key (not a
 * secret), but the caller-supplied value is never echoed in error messages.
 * LF (`\n`) is allowed (PEM armor newlines); NUL (`\0`) and CR (`\r`) are
 * rejected. Length is bounded to `MAX_BUSINESS_PUBLIC_KEY_LENGTH` and the PEM
 * armor markers must both be present.
 */
export function assertBusinessPublicKey(value: unknown, helperName: string): string {
  if (typeof value !== "string") {
    throw validationError(`Invalid ${helperName} input: businessPublicKey must be a non-empty PEM string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw validationError(`Invalid ${helperName} input: businessPublicKey must be a non-empty PEM string.`);
  }
  if (value.includes("\0")) {
    throw validationError(`Invalid ${helperName} input: businessPublicKey must not contain NUL characters.`);
  }
  if (value.includes("\r")) {
    throw validationError(`Invalid ${helperName} input: businessPublicKey must not contain CR characters.`);
  }
  if (value.length > MAX_BUSINESS_PUBLIC_KEY_LENGTH) {
    throw validationError(
      `Invalid ${helperName} input: businessPublicKey length must not exceed ${MAX_BUSINESS_PUBLIC_KEY_LENGTH} characters.`
    );
  }
  if (!value.includes(PEM_BEGIN_MARKER)) {
    throw validationError(
      `Invalid ${helperName} input: businessPublicKey must include the "${PEM_BEGIN_MARKER}" armor marker.`
    );
  }
  if (!value.includes(PEM_END_MARKER)) {
    throw validationError(
      `Invalid ${helperName} input: businessPublicKey must include the "${PEM_END_MARKER}" armor marker.`
    );
  }
  return value;
}

export function normalizeGetBusinessPublicKeyParams(input: GetBusinessPublicKeyInput): WireParams {
  const helperName = "getBusinessPublicKey";
  const record = assertPlainRecord(input, helperName);
  const out: WireParams = { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
  const fields = optionalFields(record, helperName);
  if (fields !== undefined) out.fields = fields;
  return out;
}

export function normalizeSetBusinessPublicKeyParams(input: SetBusinessPublicKeyInput): WireParams {
  const helperName = "setBusinessPublicKey";
  const record = assertPlainRecord(input, helperName);
  return { phoneNumberId: assertPathId(ownDataValue(record, "phoneNumberId", helperName, true), "phoneNumberId", helperName) };
}

/**
 * Build the form-encoded body for the public-key setter. pywa sends the key
 * as `data={"business_public_key": <PEM>}` (httpx `data=` →
 * `application/x-www-form-urlencoded`), so WATS mirrors that exactly with a
 * `URLSearchParams` body rather than JSON.
 */
export function buildSetBusinessPublicKeyBody(input: SetBusinessPublicKeyInput): URLSearchParams {
  const helperName = "setBusinessPublicKey";
  const record = assertPlainRecord(input, helperName);
  const businessPublicKey = assertBusinessPublicKey(
    ownDataValue(record, "businessPublicKey", helperName, true),
    helperName
  );
  const params = new URLSearchParams();
  params.set("business_public_key", businessPublicKey);
  return params;
}

const getBusinessPublicKeyRaw = defineEndpoint<{ phoneNumberId: string; fields?: string }, never, BusinessPublicKeyResponse>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/whatsapp_business_encryption",
  params: { phoneNumberId: { in: "path", required: true }, fields: { in: "query" } }
});

const setBusinessPublicKeyRaw = defineEndpoint<{ phoneNumberId: string }, SetBusinessPublicKeyInput, BusinessPublicKeyUpdateResponse>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/whatsapp_business_encryption",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/x-www-form-urlencoded",
  buildBody: buildSetBusinessPublicKeyBody
});

export const getBusinessPublicKey = Object.assign(
  async function getBusinessPublicKey(client: GraphClient, params: GetBusinessPublicKeyInput, body?: never, opts?: EndpointInvokeOptions): Promise<BusinessPublicKeyResponse> {
    assertNoBody(body, "getBusinessPublicKey");
    return getBusinessPublicKeyRaw(client, normalizeGetBusinessPublicKeyParams(params) as Parameters<typeof getBusinessPublicKeyRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "getBusinessPublicKey"));
  },
  { definition: getBusinessPublicKeyRaw.definition }
);

export const setBusinessPublicKey = Object.assign(
  async function setBusinessPublicKey(client: GraphClient, params: SetBusinessPublicKeyInput, body?: never, opts?: EndpointInvokeOptions): Promise<BusinessPublicKeyUpdateResponse> {
    assertNoBody(body, "setBusinessPublicKey");
    return setBusinessPublicKeyRaw(client, normalizeSetBusinessPublicKeyParams(params) as Parameters<typeof setBusinessPublicKeyRaw>[1], params, sanitizeBusinessManagementOptions(opts, "setBusinessPublicKey"));
  },
  { definition: setBusinessPublicKeyRaw.definition }
);

const createPhoneNumberRaw = defineEndpoint<{ wabaId: string }, CreatePhoneNumberInput, CreatePhoneNumberResponse>({
  method: "POST",
  pathTemplate: "/{wabaId}/phone_numbers",
  params: { wabaId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildCreatePhoneNumberBody
});

const requestVerificationCodeRaw = defineEndpoint<
  { phoneNumberId: string; code_method?: string; language?: string },
  never,
  RequestVerificationCodeResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/request_code",
  params: {
    phoneNumberId: { in: "path", required: true },
    code_method: { in: "query" },
    language: { in: "query" }
  }
});

const verifyPhoneNumberRaw = defineEndpoint<
  { phoneNumberId: string; code?: string },
  never,
  VerifyPhoneNumberResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/verify_code",
  params: {
    phoneNumberId: { in: "path", required: true },
    code: { in: "query" }
  }
});

const registerPhoneNumberRaw = defineEndpoint<
  { phoneNumberId: string },
  RegisterPhoneNumberInput,
  RegisterPhoneNumberResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/register",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildRegisterPhoneNumberBody
});

const deregisterPhoneNumberRaw = defineEndpoint<
  { phoneNumberId: string },
  never,
  DeregisterPhoneNumberResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/deregister",
  params: { phoneNumberId: { in: "path", required: true } }
});

const setTwoStepVerificationPinRaw = defineEndpoint<
  { phoneNumberId: string },
  SetTwoStepVerificationPinInput,
  SetTwoStepVerificationPinResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildSetTwoStepVerificationPinBody
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

export const createPhoneNumber = Object.assign(
  async function createPhoneNumber(client: GraphClient, params: CreatePhoneNumberInput, body?: never, opts?: EndpointInvokeOptions): Promise<CreatePhoneNumberResponse> {
    assertNoBody(body, "createPhoneNumber");
    return createPhoneNumberRaw(client, normalizeCreatePhoneNumberParams(params) as Parameters<typeof createPhoneNumberRaw>[1], params, sanitizeBusinessManagementOptions(opts, "createPhoneNumber"));
  },
  { definition: createPhoneNumberRaw.definition }
);

export const requestVerificationCode = Object.assign(
  async function requestVerificationCode(client: GraphClient, params: RequestVerificationCodeInput, body?: never, opts?: EndpointInvokeOptions): Promise<RequestVerificationCodeResponse> {
    assertNoBody(body, "requestVerificationCode");
    return requestVerificationCodeRaw(client, normalizeRequestVerificationCodeParams(params) as Parameters<typeof requestVerificationCodeRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "requestVerificationCode"));
  },
  { definition: requestVerificationCodeRaw.definition }
);

export const verifyPhoneNumber = Object.assign(
  async function verifyPhoneNumber(client: GraphClient, params: VerifyPhoneNumberInput, body?: never, opts?: EndpointInvokeOptions): Promise<VerifyPhoneNumberResponse> {
    assertNoBody(body, "verifyPhoneNumber");
    return verifyPhoneNumberRaw(client, normalizeVerifyPhoneNumberParams(params) as Parameters<typeof verifyPhoneNumberRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "verifyPhoneNumber"));
  },
  { definition: verifyPhoneNumberRaw.definition }
);

export const registerPhoneNumber = Object.assign(
  async function registerPhoneNumber(client: GraphClient, params: RegisterPhoneNumberInput, body?: never, opts?: EndpointInvokeOptions): Promise<RegisterPhoneNumberResponse> {
    assertNoBody(body, "registerPhoneNumber");
    return registerPhoneNumberRaw(client, normalizeRegisterPhoneNumberParams(params) as Parameters<typeof registerPhoneNumberRaw>[1], params, sanitizeBusinessManagementOptions(opts, "registerPhoneNumber"));
  },
  { definition: registerPhoneNumberRaw.definition }
);

export const deregisterPhoneNumber = Object.assign(
  async function deregisterPhoneNumber(client: GraphClient, params: DeregisterPhoneNumberInput, body?: never, opts?: EndpointInvokeOptions): Promise<DeregisterPhoneNumberResponse> {
    assertNoBody(body, "deregisterPhoneNumber");
    return deregisterPhoneNumberRaw(client, normalizeDeregisterPhoneNumberParams(params) as Parameters<typeof deregisterPhoneNumberRaw>[1], undefined, sanitizeBusinessManagementOptions(opts, "deregisterPhoneNumber"));
  },
  { definition: deregisterPhoneNumberRaw.definition }
);

export const setTwoStepVerificationPin = Object.assign(
  async function setTwoStepVerificationPin(client: GraphClient, params: SetTwoStepVerificationPinInput, body?: never, opts?: EndpointInvokeOptions): Promise<SetTwoStepVerificationPinResponse> {
    assertNoBody(body, "setTwoStepVerificationPin");
    return setTwoStepVerificationPinRaw(client, normalizeSetTwoStepVerificationPinParams(params) as Parameters<typeof setTwoStepVerificationPinRaw>[1], params, sanitizeBusinessManagementOptions(opts, "setTwoStepVerificationPin"));
  },
  { definition: setTwoStepVerificationPinRaw.definition }
);
