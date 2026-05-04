// @wats/http — WebhookAdapter (F-12 GREEN).
//
// Runtime-neutral core of the webhook HTTP adapter. Takes a
// runtime-agnostic WebhookRequest (method, url, headers, raw body
// bytes) and returns a WebhookResponse (status, headers, body). The
// three framework wrappers (fetch/bun/node) are thin shims that
// adapt their runtime's request/response shape to this core.
//
// Closes WATS-22 (Arch-K: runtime-neutral webhook surface) and the
// adapter-shape half of WATS-25 (edge-runtime harness).
//
// Status-code taxonomy (plan F-12 DoD):
//   200 — valid GET verify (body = challenge)
//   200 — valid POST signed + normalized; dispatched to facade
//   400 — malformed body/signature header/verify query
//   401 — missing or invalid signature; missing/invalid verify token
//   405 — HTTP method other than GET/POST
//   413 — POST body exceeds maxBodyBytes
//   500 — unexpected adapter-internal failure (should be rare)
//
// Non-goals (scope ledger):
//   - No rate limiting (runtime / infra concern).
//   - No TLS configuration (runtime concern).
//   - No media endpoints (F-13).
//   - No deprecation of the legacy verifyWebhookChallenge /
//     validateWebhookSignature primitives — they are reused
//     verbatim here.

import { normalizeWebhookEnvelope, WebhookNormalizationError } from "@wats/core/webhookNormalizer";
import type { CryptoProvider } from "@wats/crypto";
import { validateWebhookSignature } from "../signature";
import { verifyWebhookChallenge } from "../webhookServer";

// ---- Public types --------------------------------------------------

// Structural typing: the adapter only needs `dispatch(update)` from
// whatever the caller passes. Declaring the shape locally keeps
// @wats/http decoupled from a hard runtime dependency on
// @wats/core. A real `WhatsApp` facade from @wats/core satisfies
// this shape.
export interface WebhookFacadeLike {
  dispatch(update: unknown): Promise<unknown> | unknown;
}

export interface WebhookAdapterConfig {
  readonly verifyToken: string;
  readonly appSecret: string;
  readonly whatsapp: WebhookFacadeLike;
  readonly cryptoProvider?: CryptoProvider;
  readonly maxBodyBytes?: number;
  readonly logger?: (event: WebhookAdapterEvent) => void;
}

export interface WebhookRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  // Accept any ArrayBufferView (Uint8Array, DataView, ...) or raw
  // ArrayBuffer, or null for GET/HEAD. A runtime guard
  // (`isAcceptableBody`) in handleDispatch enforces this at request
  // time so a non-compliant JS caller does not bypass the contract.
  readonly body: ArrayBuffer | ArrayBufferView | null;
}

export interface WebhookResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string | Uint8Array;
}

export interface WebhookDispatchSummary {
  readonly received: number;
  readonly dispatched: number;
  readonly skipped: number;
}

export type WebhookAdapterEvent =
  | { readonly type: "request_received"; readonly method: string; readonly url: string }
  | { readonly type: "signature_verified"; readonly success: boolean }
  | { readonly type: "body_normalized"; readonly updates: number; readonly skipped: number }
  | { readonly type: "dispatched"; readonly updates: number }
  | { readonly type: "response_sent"; readonly status: number }
  | { readonly type: "error"; readonly stage: string; readonly error: unknown };

export type WebhookAdapterConfigErrorCode =
  | "invalid_config"
  | "invalid_verify_token"
  | "invalid_app_secret"
  | "invalid_whatsapp"
  | "invalid_crypto_provider"
  | "invalid_max_body_bytes"
  | "invalid_logger";

export class WebhookAdapterConfigError extends Error {
  readonly code: WebhookAdapterConfigErrorCode;
  constructor(code: WebhookAdapterConfigErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WebhookAdapterConfigError";
    this.code = code;
  }
}

export interface WebhookAdapter {
  handle(request: WebhookRequest): Promise<WebhookResponse>;
  // F-12 remediation (WATS-29): expose the applied cap so the
  // Node + Fetch adapter wrappers can short-circuit at read time
  // (before buffering the full payload) instead of deferring the
  // check to the core which runs after all bytes are resident.
  readonly maxBodyBytes: number;
}

// ---- Constants -----------------------------------------------------

const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MiB
const MAX_VERIFY_TOKEN_LENGTH = 512;

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

// ---- Helpers -------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c === 0 || c === 10 || c === 13) return true; // NUL LF CR
  }
  return false;
}

function validateVerifyToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new WebhookAdapterConfigError(
      "invalid_verify_token",
      "WebhookAdapter: verifyToken must be a non-empty string."
    );
  }
  if (value.length === 0) {
    throw new WebhookAdapterConfigError(
      "invalid_verify_token",
      "WebhookAdapter: verifyToken must be a non-empty string."
    );
  }
  // F-12 remediation (WATS-29): whitespace-only tokens pass the
  // length check but are effectively empty. Reject at construction
  // so a whitespace-only config cannot boot cleanly and surface
  // only at live traffic as a 500.
  if (value.trim().length === 0) {
    throw new WebhookAdapterConfigError(
      "invalid_verify_token",
      "WebhookAdapter: verifyToken must not be whitespace-only."
    );
  }
  if (value.length > MAX_VERIFY_TOKEN_LENGTH) {
    throw new WebhookAdapterConfigError(
      "invalid_verify_token",
      `WebhookAdapter: verifyToken exceeds maximum length of ${MAX_VERIFY_TOKEN_LENGTH}.`
    );
  }
  if (hasControlChars(value)) {
    throw new WebhookAdapterConfigError(
      "invalid_verify_token",
      "WebhookAdapter: verifyToken must not contain CR/LF/NUL bytes."
    );
  }
  return value;
}

function validateAppSecret(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WebhookAdapterConfigError(
      "invalid_app_secret",
      "WebhookAdapter: appSecret must be a non-empty string."
    );
  }
  // F-12 remediation (WATS-29): whitespace-only secrets are
  // effectively empty — reject at construction.
  if (value.trim().length === 0) {
    throw new WebhookAdapterConfigError(
      "invalid_app_secret",
      "WebhookAdapter: appSecret must not be whitespace-only."
    );
  }
  // F-12 remediation (WATS-29): parity with verifyToken —
  // reject CR/LF/NUL bytes. Defense-in-depth; removes the
  // asymmetry that was a latent injection liability if the
  // secret ever flows through a log line / header.
  if (hasControlChars(value)) {
    throw new WebhookAdapterConfigError(
      "invalid_app_secret",
      "WebhookAdapter: appSecret must not contain CR/LF/NUL bytes."
    );
  }
  return value;
}

function validateFacade(value: unknown): WebhookFacadeLike {
  if (!isObject(value) || typeof (value as { dispatch?: unknown }).dispatch !== "function") {
    throw new WebhookAdapterConfigError(
      "invalid_whatsapp",
      "WebhookAdapter: whatsapp must expose a dispatch() method."
    );
  }
  return value as unknown as WebhookFacadeLike;
}

function validateCryptoProvider(value: unknown): CryptoProvider | undefined {
  if (value === undefined) return undefined;
  if (
    !isObject(value) ||
    typeof (value as { hmacSha256?: unknown }).hmacSha256 !== "function" ||
    typeof (value as { timingSafeEqual?: unknown }).timingSafeEqual !== "function"
  ) {
    throw new WebhookAdapterConfigError(
      "invalid_crypto_provider",
      "WebhookAdapter: cryptoProvider must be a CryptoProvider."
    );
  }
  return value as unknown as CryptoProvider;
}

function validateMaxBodyBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_BODY_BYTES;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new WebhookAdapterConfigError(
      "invalid_max_body_bytes",
      "WebhookAdapter: maxBodyBytes must be a positive integer."
    );
  }
  return value;
}

function validateLogger(
  value: unknown
): ((event: WebhookAdapterEvent) => void) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "function") {
    throw new WebhookAdapterConfigError(
      "invalid_logger",
      "WebhookAdapter: logger must be a function."
    );
  }
  return value as (event: WebhookAdapterEvent) => void;
}

function bodyByteLength(body: ArrayBuffer | ArrayBufferView): number {
  // ArrayBufferView covers Uint8Array, DataView, Int16Array, etc.
  return body.byteLength;
}

function bodyToUint8(body: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return new Uint8Array(body);
}

// F-12 remediation (WATS-29): runtime guard against callers that
// hand us something outside the declared body union. `body` is typed
// `ArrayBuffer | Uint8Array | null`, but a JS caller (or a
// WebhookRequest forged from `as unknown`) can slip through a
// string / number / plain-object / Blob. Left unguarded, a string
// body flows to `bodyByteLength` (returns `undefined`, comparison
// fails silently) and `bodyToUint8` (yields empty bytes), producing
// a 401 signature_mismatch by accident. Reject up front with a
// typed 400 so the brittleness is closed in depth.
function isAcceptableBody(
  value: unknown
): value is ArrayBuffer | ArrayBufferView | null {
  if (value === null || value === undefined) return true;
  if (value instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(value)) return true;
  return false;
}

function decodeBody(body: ArrayBuffer | ArrayBufferView): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bodyToUint8(body));
}

function jsonResponse(status: number, payload: unknown): WebhookResponse {
  return {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE },
    body: JSON.stringify(payload)
  };
}

function textResponse(status: number, text: string, extra?: Record<string, string>): WebhookResponse {
  return {
    status,
    headers: { "content-type": TEXT_CONTENT_TYPE, ...(extra ?? {}) },
    body: text
  };
}

function errorResponse(
  status: number,
  code: string,
  message?: string,
  extraHeaders?: Record<string, string>
): WebhookResponse {
  const body = JSON.stringify({ error: { code, ...(message ? { message } : {}) } });
  return {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, ...(extraHeaders ?? {}) },
    body
  };
}

function safeLog(
  logger: ((event: WebhookAdapterEvent) => void) | undefined,
  event: WebhookAdapterEvent
): void {
  if (logger === undefined) return;
  try {
    logger(event);
  } catch {
    // Logger failures must not escape into response handling.
  }
}

// ---- Adapter -------------------------------------------------------

export function createWebhookAdapter(config: WebhookAdapterConfig): WebhookAdapter {
  if (!isObject(config)) {
    throw new WebhookAdapterConfigError(
      "invalid_config",
      "WebhookAdapter: config must be an options object."
    );
  }
  const verifyToken = validateVerifyToken(config.verifyToken);
  const appSecret = validateAppSecret(config.appSecret);
  const whatsapp = validateFacade(config.whatsapp);
  const cryptoProvider = validateCryptoProvider(config.cryptoProvider);
  const maxBodyBytes = validateMaxBodyBytes(config.maxBodyBytes);
  const logger = validateLogger(config.logger);

  return {
    maxBodyBytes,
    handle(request: WebhookRequest): Promise<WebhookResponse> {
      return handleRequest({
        request,
        verifyToken,
        appSecret,
        whatsapp,
        cryptoProvider,
        maxBodyBytes,
        logger
      });
    }
  };
}

interface HandleContext {
  readonly request: WebhookRequest;
  readonly verifyToken: string;
  readonly appSecret: string;
  readonly whatsapp: WebhookFacadeLike;
  readonly cryptoProvider: CryptoProvider | undefined;
  readonly maxBodyBytes: number;
  readonly logger: ((event: WebhookAdapterEvent) => void) | undefined;
}

async function handleRequest(ctx: HandleContext): Promise<WebhookResponse> {
  const { request, logger } = ctx;
  safeLog(logger, {
    type: "request_received",
    method: request.method,
    url: request.url
  });

  let response: WebhookResponse;
  try {
    const method = request.method.toUpperCase();
    if (method === "GET") {
      response = await handleVerify(ctx);
    } else if (method === "POST") {
      response = await handleDispatch(ctx);
    } else {
      response = errorResponse(
        405,
        "method_not_allowed",
        `Method ${request.method} not allowed.`,
        // F-12 remediation (WATS-29): canonical casing in the raw
        // WebhookResponse map. HTTP header comparison is
        // case-insensitive at the wire, but the map we expose is
        // case-sensitive so downstream consumers should see the
        // canonical RFC-style name.
        { Allow: "GET, POST" }
      );
    }
  } catch (err) {
    safeLog(logger, { type: "error", stage: "handle", error: err });
    response = errorResponse(500, "internal_error", "Unexpected adapter error.");
  }

  safeLog(logger, { type: "response_sent", status: response.status });
  return response;
}

async function handleVerify(ctx: HandleContext): Promise<WebhookResponse> {
  const { request, verifyToken, cryptoProvider } = ctx;
  let searchParams: URLSearchParams;
  try {
    searchParams = new URL(request.url).searchParams;
  } catch {
    return errorResponse(400, "invalid_request", "Malformed request URL.");
  }
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const receivedToken = searchParams.get("hub.verify_token");

  const result = await verifyWebhookChallenge({
    mode,
    challenge,
    verifyToken: receivedToken,
    expectedVerifyToken: verifyToken,
    ...(cryptoProvider !== undefined ? { crypto: cryptoProvider } : {})
  });

  if (result.ok) {
    return textResponse(200, result.challenge);
  }
  // Map internal challenge error codes onto the F-12 HTTP taxonomy.
  // invalid_verify_token → 401 (unauthorized)
  // invalid_mode → 400 (bad request — mode must be "subscribe")
  // missing_challenge → 400
  // invalid_expected_verify_token → 500 (configuration problem, rare)
  // crypto_provider_unavailable → 500
  switch (result.error.code) {
    case "invalid_verify_token":
      return errorResponse(401, "invalid_verify_token", result.error.message);
    case "invalid_mode":
      return errorResponse(400, "invalid_mode", result.error.message);
    case "missing_challenge":
      return errorResponse(400, "missing_challenge", result.error.message);
    case "invalid_expected_verify_token":
    case "crypto_provider_unavailable":
    default:
      return errorResponse(500, result.error.code, result.error.message);
  }
}

async function handleDispatch(ctx: HandleContext): Promise<WebhookResponse> {
  const { request, appSecret, whatsapp, cryptoProvider, maxBodyBytes, logger } =
    ctx;

  const body: unknown = request.body;

  // F-12 remediation (WATS-29): runtime body-type guard. Typescript
  // types are erased at runtime — a JS caller (or a forged
  // WebhookRequest) can smuggle through a string / number / object
  // body that would otherwise coerce to empty bytes and leak out as
  // a 401 signature_mismatch by accident. Reject explicitly with a
  // typed 400 code so the brittle path is closed in depth.
  if (!isAcceptableBody(body)) {
    return errorResponse(
      400,
      "invalid_request_body",
      "POST body must be ArrayBuffer, ArrayBufferView, or null."
    );
  }

  if (body === null || body === undefined) {
    return errorResponse(400, "missing_body", "POST body is required.");
  }
  if (bodyByteLength(body) > maxBodyBytes) {
    return errorResponse(413, "payload_too_large", "Body exceeds maxBodyBytes.");
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");

  // Early guards: distinguish missing signature (401) from malformed
  // signature (400) before handing to @wats/http's validator, which
  // reports both as typed results.
  if (signatureHeader === null) {
    return errorResponse(401, "missing_signature", "Missing X-Hub-Signature-256 header.");
  }
  if (!/^sha256=[a-f0-9]{64}$/.test(signatureHeader)) {
    return errorResponse(
      400,
      "invalid_signature_format",
      "X-Hub-Signature-256 must be 'sha256=<64 hex chars>'."
    );
  }

  const bytes = bodyToUint8(body);
  const sigResult = await validateWebhookSignature({
    appSecret,
    rawBody: bytes,
    signatureHeader,
    ...(cryptoProvider !== undefined ? { crypto: cryptoProvider } : {})
  });

  if (!sigResult.ok) {
    safeLog(logger, { type: "signature_verified", success: false });
    switch (sigResult.error.code) {
      case "missing_signature":
        return errorResponse(401, "missing_signature", sigResult.error.message);
      case "signature_mismatch":
        return errorResponse(401, "signature_mismatch", sigResult.error.message);
      case "invalid_signature_format":
        return errorResponse(400, "invalid_signature_format", sigResult.error.message);
      case "invalid_raw_body":
      case "invalid_app_secret":
      case "crypto_provider_unavailable":
      default:
        return errorResponse(500, sigResult.error.code, sigResult.error.message);
    }
  }
  safeLog(logger, { type: "signature_verified", success: true });

  // Parse JSON body.
  let envelope: unknown;
  try {
    envelope = JSON.parse(decodeBody(bytes));
  } catch {
    return errorResponse(400, "invalid_json", "Request body is not valid JSON.");
  }

  // Normalize.
  let normalized;
  try {
    normalized = normalizeWebhookEnvelope(envelope);
  } catch (err) {
    if (err instanceof WebhookNormalizationError) {
      return errorResponse(400, err.code, err.message);
    }
    safeLog(logger, { type: "error", stage: "normalize", error: err });
    return errorResponse(500, "normalize_failed", "Envelope normalization failed.");
  }
  safeLog(logger, {
    type: "body_normalized",
    updates: normalized.updates.length,
    skipped: normalized.skipped.length
  });

  // Dispatch each update. Failures are isolated — the webhook
  // acknowledgement contract says: once we verified + normalized,
  // the event IS received from an HTTP perspective. Downstream
  // handler errors are a @wats/core concern and don't propagate as
  // 5xx (Meta would retry the webhook otherwise, creating a
  // duplicate-event flood against a bug that isn't a transport
  // failure).
  let dispatched = 0;
  for (const update of normalized.updates) {
    try {
      await whatsapp.dispatch(update);
      dispatched += 1;
    } catch (err) {
      safeLog(logger, { type: "error", stage: "dispatch", error: err });
    }
  }
  safeLog(logger, { type: "dispatched", updates: dispatched });

  const summary: WebhookDispatchSummary = {
    received: normalized.updates.length,
    dispatched,
    skipped: normalized.skipped.length
  };
  return jsonResponse(200, { status: "ok", ...summary });
}
