// WATS-157C — Embedded Signup code→token exchange helper (oauth/access_token).
//
// Mirrors pywa `GraphAPI.get_business_access_token(client_id, client_secret,
// code)` — "Exchange the Embedded Signup token code for a business token."
//
// Wire contract (authoritative: REFERENCE-157.md Surface 3, candidate (b)):
//   GET /oauth/access_token
//   query params (all required): client_id, client_secret, code
//   response: {"access_token": "...", "token_type": "bearer"[, "expires_in": N]}
//
// SECURITY-SENSITIVE: `client_secret`, `code`, and the returned `access_token`
// are all SECRETS. Validation error messages reference the field name ONLY and
// NEVER echo the caller-supplied value (pywa marks this call `log_kwargs=False`;
// WATS enforces the same discipline at the validation boundary). This module is
// exercised exclusively through MockTransport tests — no live credentials.

import { defineEndpoint, type EndpointInvokeOptions } from "../endpoint.js";
import { GraphRequestValidationError } from "../errors.js";
import {
  assertPlainDataRecord,
  ownDataValue as ownInternalDataValue
} from "../internal/validation/records.js";
import { sanitizeHeaderInit } from "../internal/validation/headers.js";
import type { GraphClient } from "../client.js";

/**
 * Input for the Embedded Signup code→token exchange. All three fields are
 * required. `clientSecret` and `code` are SECRETS and are never echoed in
 * validation error messages.
 */
export interface ExchangeBusinessAccessTokenInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
}

/**
 * Response shape for `GET /oauth/access_token`. The Graph API returns
 * `access_token` (NOT `business_token` — pywa's docstring is wrong per the
 * reference). All fields are optional with an index signature for tolerance.
 */
export interface BusinessAccessTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly [key: string]: unknown;
}

type WireParams = Record<string, string>;

// Generous sane caps; Meta publishes no fixed max for these fields.
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_CLIENT_SECRET_LENGTH = 4096;
const MAX_CODE_LENGTH = 4096;

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

/**
 * Validate a secret-bearing query string (client_id / client_secret / code).
 *
 * Accepts a non-empty string with no ASCII control characters (charCode < 0x20
 * or 0x7f, which covers NUL / CR / LF / DEL / tab) and length ≤ maxLength.
 *
 * ERROR MESSAGES REFERENCE THE FIELD NAME ONLY — the caller-supplied value is
 * a SECRET and must NEVER appear in the message text.
 */
function assertBoundedSecretString(
  value: unknown,
  fieldName: string,
  _helperName: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw validationError(`${fieldName} must be a non-empty string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw validationError(`${fieldName} must be a non-empty string.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      throw validationError(`${fieldName} must not contain control characters.`);
    }
  }
  if (value.length > maxLength) {
    throw validationError(`${fieldName} length must not exceed ${maxLength}.`);
  }
  return value;
}

/**
 * Normalize the camelCase {@link ExchangeBusinessAccessTokenInput} into the
 * Graph wire query params `{ client_id, client_secret, code }`. Each field is
 * validated with {@link assertBoundedSecretString}; secret values are never
 * echoed in any thrown error message.
 */
export function normalizeExchangeBusinessAccessTokenParams(input: ExchangeBusinessAccessTokenInput): WireParams {
  const helperName = "exchangeBusinessAccessToken";
  const record = assertPlainRecord(input, helperName);
  return {
    client_id: assertBoundedSecretString(
      ownDataValue(record, "clientId", helperName, true),
      "clientId",
      helperName,
      MAX_CLIENT_ID_LENGTH
    ),
    client_secret: assertBoundedSecretString(
      ownDataValue(record, "clientSecret", helperName, true),
      "clientSecret",
      helperName,
      MAX_CLIENT_SECRET_LENGTH
    ),
    code: assertBoundedSecretString(
      ownDataValue(record, "code", helperName, true),
      "code",
      helperName,
      MAX_CODE_LENGTH
    )
  };
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

/**
 * Minimal opts sanitizer mirroring
 * `sanitizeBusinessManagementOptions` (which is not exported from
 * businessManagement.ts): validates `opts` is a plain object, passes
 * `signal` through, and routes `headers` through {@link sanitizeHeaders}.
 */
export function sanitizeOauthOptions(
  opts: EndpointInvokeOptions | undefined,
  helperName: string
): EndpointInvokeOptions | undefined {
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

const exchangeBusinessAccessTokenRaw = defineEndpoint<
  { client_id: string; client_secret: string; code: string },
  never,
  BusinessAccessTokenResponse
>({
  method: "GET",
  pathTemplate: "/oauth/access_token",
  params: {
    client_id: { in: "query", required: true },
    client_secret: { in: "query", required: true },
    code: { in: "query", required: true }
  }
});

/**
 * Exchange an Embedded Signup `code` for a business access token.
 *
 * Wraps `GET /oauth/access_token` with query params `client_id`,
 * `client_secret`, and `code` (all required, all secrets except client_id).
 * The returned object carries `access_token` on success.
 *
 * `client_secret` and `code` are SECRETS and are never echoed in validation
 * error messages; the same applies to the returned `access_token` (which is
 * not validated by this helper beyond being part of the response).
 */
export const exchangeBusinessAccessToken = Object.assign(
  async function exchangeBusinessAccessToken(
    client: GraphClient,
    params: ExchangeBusinessAccessTokenInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<BusinessAccessTokenResponse> {
    assertNoBody(body, "exchangeBusinessAccessToken");
    return exchangeBusinessAccessTokenRaw(
      client,
      normalizeExchangeBusinessAccessTokenParams(params) as Parameters<typeof exchangeBusinessAccessTokenRaw>[1],
      undefined,
      sanitizeOauthOptions(opts, "exchangeBusinessAccessToken")
    );
  },
  { definition: exchangeBusinessAccessTokenRaw.definition }
);
