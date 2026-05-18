export interface GraphApiErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  [key: string]: unknown;
}

export interface GraphErrorEnvelope {
  error: GraphApiErrorPayload;
}

export type GraphErrorClassification = "ClientError" | "ServerError" | "Unknown";

export class GraphApiError extends Error {
  readonly status: number;
  readonly type?: string;
  readonly code?: number;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;
  readonly payload?: GraphApiErrorPayload;
  /**
   * Broad HTTP-status-driven classification:
   *   4xx → "ClientError"
   *   5xx → "ServerError"
   *   anything else → "Unknown"
   *
   * F-5 (WATS-11 L5): this is a coarse axis orthogonal to the registry's
   * per-code subclass identity. A registered subclass (e.g.
   * InvalidParameterError) will still expose the matching classification
   * alongside its own identity.
   */
  readonly classification: GraphErrorClassification;

  constructor(params: {
    message: string;
    status: number;
    payload?: GraphApiErrorPayload;
  }) {
    super(params.message);
    this.name = "GraphApiError";
    this.status = params.status;
    this.classification = classifyStatus(params.status);
    if (params.payload !== undefined) {
      this.payload = params.payload;
      if (params.payload.type !== undefined) {
        this.type = params.payload.type;
      }
      if (params.payload.code !== undefined) {
        this.code = params.payload.code;
      }
      if (params.payload.error_subcode !== undefined) {
        this.errorSubcode = params.payload.error_subcode;
      }
      if (params.payload.fbtrace_id !== undefined) {
        this.fbtraceId = params.payload.fbtrace_id;
      }
    }
  }
}

function classifyStatus(status: number): GraphErrorClassification {
  if (status >= 400 && status < 500) {
    return "ClientError";
  }
  if (status >= 500 && status < 600) {
    return "ServerError";
  }
  return "Unknown";
}

export class GraphAuthError extends GraphApiError {
  constructor(params: {
    message: string;
    status: number;
    payload?: GraphApiErrorPayload;
  }) {
    super(params);
    this.name = "GraphAuthError";
  }
}

export class GraphRateLimitError extends GraphApiError {
  constructor(params: {
    message: string;
    status: number;
    payload?: GraphApiErrorPayload;
  }) {
    super(params);
    this.name = "GraphRateLimitError";
  }
}

export class GraphNetworkError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GraphNetworkError";
    this.cause = cause;
  }
}

export class GraphRequestValidationError extends GraphApiError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super({
      message,
      status: 400,
      payload: {
        message,
        type: "ValidationError"
      }
    });
    this.name = "GraphRequestValidationError";
    this.cause = cause;
  }
}

export class GraphSerializationError extends GraphApiError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super({
      message,
      status: 400,
      payload: {
        message,
        type: "SerializationError"
      }
    });
    this.name = "GraphSerializationError";
    this.cause = cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isGraphApiErrorPayload(value: unknown): value is GraphApiErrorPayload {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  const message = value.message;
  const type = value.type;
  const code = value.code;
  const errorSubcode = value.error_subcode;
  const fbtraceId = value.fbtrace_id;

  if (typeof message !== "string" || message.length === 0) {
    return false;
  }

  if (type !== undefined && typeof type !== "string") {
    return false;
  }

  if (code !== undefined && typeof code !== "number") {
    return false;
  }

  if (errorSubcode !== undefined && typeof errorSubcode !== "number") {
    return false;
  }

  if (fbtraceId !== undefined && typeof fbtraceId !== "string") {
    return false;
  }

  return true;
}

export function isGraphErrorEnvelope(value: unknown): value is GraphErrorEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return isGraphApiErrorPayload(value.error);
}

/**
 * Rate-limit code set externalised so the registry module can grow it
 * without client.ts churn. F-5 (WATS-27). F-5 remediation (WATS-29):
 * reconciled with pywa/errors.py ThrottlingError. Codes 17 and 32 were
 * WATS fabrications and have been dropped. Code 613 is pywa CallingError
 * (not ThrottlingError) and has also been dropped. Code 131056
 * (pywa TooManyMessages) added.
 */
export const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([
  4,         // pywa ToManyAPICalls
  80007,     // pywa RateLimitIssues
  130429,    // pywa RateLimitHit
  131048,    // pywa SpamRateLimitHit
  131056     // pywa TooManyMessages
]);

function isAuthClassification(status: number, payload?: GraphApiErrorPayload): boolean {
  // WATS-11 L5: OAuth-type classification is gated to 4xx. A 5xx with
  // a stray OAuthException type is a server failure, not a caller-side
  // auth failure.
  if (status === 401) {
    return true;
  }
  if (status === 403) {
    return true;
  }
  if (
    payload !== undefined &&
    typeof payload.type === "string" &&
    payload.type === "OAuthException" &&
    status >= 400 &&
    status < 500
  ) {
    return true;
  }
  if (
    payload !== undefined &&
    typeof payload.code === "number" &&
    payload.code === 190 &&
    status >= 400 &&
    status < 500
  ) {
    return true;
  }
  return false;
}

function isRateLimitClassification(
  status: number,
  payload?: GraphApiErrorPayload
): boolean {
  // HTTP 429 always wins.
  if (status === 429) {
    return true;
  }
  // Rate-limit codes only classify as such when the status is also in
  // the 4xx band — a 500 that happens to include a code-4 field is a
  // server error, not throttling.
  if (
    status >= 400 &&
    status < 500 &&
    payload !== undefined &&
    typeof payload.code === "number" &&
    RATE_LIMIT_CODES.has(payload.code)
  ) {
    return true;
  }
  return false;
}

const BEARER_TOKEN_REGEXP=/Beare...+/g;

function redactString(value: string): string {
  return value.replace(BEARER_TOKEN_REGEXP, "Bearer ***");
}

function isErrorLike(value: unknown): value is Error {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function cloneErrorWithRedaction(err: Error, seen: WeakSet<object>): Error {
  if (seen.has(err)) {
    return err;
  }
  seen.add(err);

  // Preserve prototype (so instanceof checks still pass).
  const proto = Object.getPrototypeOf(err) as object | null;
  const clone = Object.create(proto ?? Error.prototype) as Error;
  clone.name = err.name;
  clone.message = redactString(err.message);
  if (typeof err.stack === "string") {
    clone.stack = redactString(err.stack);
  }

  const maybeCause = (err as Error & { cause?: unknown }).cause;
  if (maybeCause !== undefined) {
    (clone as Error & { cause?: unknown }).cause = scrubErrorCauseInner(
      maybeCause,
      seen
    );
  }

  // Copy enumerable own properties, redacting string values.
  for (const key of Object.keys(err)) {
    if (key === "message" || key === "stack" || key === "name" || key === "cause") {
      continue;
    }
    const value = (err as unknown as Record<string, unknown>)[key];
    (clone as unknown as Record<string, unknown>)[key] =
      typeof value === "string" ? redactString(value) : value;
  }
  return clone;
}

function scrubErrorCauseInner(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (isErrorLike(value)) {
    return cloneErrorWithRedaction(value, seen);
  }
  return value;
}

/**
 * Returns a shallow-cloned copy of `err` with any occurrences of
 * `Bearer <token>` strings redacted to `Bearer ***` in the message,
 * stack, and shallow cause chain. Non-Error / non-string values are
 * returned unchanged.
 *
 * Intended for log/metrics sinks that need to record a Graph failure
 * without leaking the caller's access token. See WATS-13 L7.
 */
export function scrubErrorCause(err: unknown): unknown {
  return scrubErrorCauseInner(err, new WeakSet<object>());
}

export function createGraphApiError(params: {
  status: number;
  payload?: GraphApiErrorPayload;
  fallbackMessage?: string;
  classify?: boolean;
  headers?: Headers;
  requestUrl?: string;
}): GraphApiError {
  const message =
    params.payload?.message ?? params.fallbackMessage ?? "Graph API request failed";
  const shouldClassify = params.classify ?? true;

  const ctorParams: { message: string; status: number; payload?: GraphApiErrorPayload } = {
    message,
    status: params.status
  };
  if (params.payload !== undefined) {
    ctorParams.payload = params.payload;
  }

  if (!shouldClassify) {
    return new GraphApiError(ctorParams);
  }

  // F-5: consult the registry first. Lazy-imported via a local binding
  // so errors.ts does not create a static import cycle with the
  // seeding module (errorSubclasses imports errors).
  const code = typeof params.payload?.code === "number" ? params.payload.code : undefined;
  const subcode =
    typeof params.payload?.error_subcode === "number"
      ? params.payload.error_subcode
      : undefined;

  if (code !== undefined) {
    const entry = resolveRegisteredErrorSafely(code, subcode);
    if (entry !== undefined) {
      // Build the factory context. The registry factory is responsible
      // for constructing the correct subclass.
      const ctx = {
        payload: params.payload,
        status: params.status,
        headers: params.headers ?? new Headers(),
        requestUrl: params.requestUrl ?? ""
      };
      // WATS-11 L5 guard: a registered subclass that is an auth subclass
      // should NOT be used at 5xx (where OAuth-type is server noise).
      // Registered subclasses that map to GraphAuthError enforce this
      // implicitly via the axis check below; we only fall back to the
      // generic taxonomy when the HTTP status contradicts the registry.
      const instance = entry.factory(ctx);
      if (
        instance instanceof GraphAuthError &&
        !isAuthClassification(params.status, params.payload)
      ) {
        // Disagreement: drop to generic.
        return new GraphApiError(ctorParams);
      }
      if (
        instance instanceof GraphRateLimitError &&
        !isRateLimitClassification(params.status, params.payload)
      ) {
        return new GraphApiError(ctorParams);
      }
      return instance;
    }
  }

  if (isAuthClassification(params.status, params.payload)) {
    return new GraphAuthError(ctorParams);
  }

  if (isRateLimitClassification(params.status, params.payload)) {
    return new GraphRateLimitError(ctorParams);
  }

  return new GraphApiError(ctorParams);
}

// Late-binding lookup into the registry to avoid importing a module that
// itself imports this file. The errorRegistry module has no circular
// dependency back to errors.ts — it only uses GraphApiError as a type —
// so a direct import is safe, but we keep the indirection for clarity.
import { resolveRegisteredError as _resolveRegisteredError } from "./errorRegistry.js";
function resolveRegisteredErrorSafely(
  code: number,
  subcode: number | undefined
): ReturnType<typeof _resolveRegisteredError> {
  return _resolveRegisteredError(code, subcode);
}

// NOTE: seeding of built-in error codes happens in ./errorSubclasses at
// its module top-level. The package barrel (./index.ts) imports that
// module unconditionally, so any consumer of `@wats/graph` receives the
// seeded registry without having to invoke anything manually. errors.ts
// intentionally does NOT import errorSubclasses to avoid an ESM cycle.

