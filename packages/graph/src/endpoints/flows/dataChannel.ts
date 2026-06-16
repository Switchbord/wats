// WATS-76 slice B — WhatsApp Flow encrypted data-channel runtime.
//
// Pure, framework-agnostic implementation of Meta's Flow endpoint crypto
// (REFERENCE-76 PART B). The request body is RSA-OAEP-wrapped AES key +
// AES-GCM-encrypted Flow payload; the response is AES-GCM-encrypted under the
// same key with the IV bit-flipped. All crypto is delegated to an injected
// CryptoProvider (slice C) — this module never reaches for node:crypto or
// SubtleCrypto directly, and never logs or echoes the AES key, IV, private
// key, or decrypted plaintext.

import type { CryptoProvider } from "@wats/crypto";
import { flowIsPlainObject, flowIsUnsafeObjectKey } from "./shared.js";
import type {
  EncryptedFlowRequestInput,
  FlowRequest,
  FlowRequestAction,
  FlowResponsePayload
} from "./types.js";

// ── Limits ──────────────────────────────────────────────────────────────────

/**
 * Maximum number of decoded bytes accepted for any single base64 field of the
 * encrypted request, and for the decrypted plaintext before it is parsed as
 * JSON. Finite by construction so a hostile body cannot drive unbounded
 * allocation or JSON parsing. Meta's Flow payloads are far smaller than this.
 */
export const FLOW_DATA_CHANNEL_MAX_BYTES = 131_072;

const FLOW_REQUEST_ACTIONS: ReadonlySet<string> = new Set<FlowRequestAction>([
  "INIT",
  "BACK",
  "data_exchange",
  "navigate",
  "ping"
]);

// ── HTTP status mapping (REFERENCE-76 §B.8) ──────────────────────────────────

/**
 * Endpoint error → HTTP status mapping for the Flow data-channel endpoint.
 *   421 — decryption failed (plain body, NOT encrypted)
 *   427 — FlowTokenNoLongerValid (plain `{ error_msg }` body)
 *   432 — request signature authentication failed (plain body)
 *   500 — construction / unhandled handler failure (plain body)
 */
export const FLOW_ENDPOINT_STATUS = {
  decryptionFailure: 421,
  flowTokenInvalid: 427,
  signatureFailure: 432,
  serverError: 500
} as const;

// ── Typed errors ─────────────────────────────────────────────────────────────

/**
 * Thrown by `decryptRequest` for ANY failure on the decrypt path — missing or
 * malformed fields, invalid base64, RSA/GCM failure, JSON parse failure, or a
 * structurally invalid decrypted payload. Carries no key/IV/plaintext material;
 * the `cause` is preserved for server-side diagnostics but the public message
 * is a fixed string so nothing sensitive is leaked. Maps to HTTP 421.
 */
export class FlowRequestDecryptionError extends Error {
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super("Flow request could not be decrypted");
    this.name = "FlowRequestDecryptionError";
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Thrown by a Flow handler when the supplied `flow_token` is no longer valid.
 * Maps to HTTP 427 with a plain `{ "error_msg": <message> }` body. The message
 * is caller-supplied and SHOULD NOT contain secrets.
 */
export class FlowTokenNoLongerValidError extends Error {
  readonly errorMsg: string;
  constructor(message = "Flow token is no longer valid") {
    super(message);
    this.name = "FlowTokenNoLongerValidError";
    this.errorMsg = message;
  }
}

/**
 * Thrown when the inbound request signature fails authentication. Maps to
 * HTTP 432. Signature validation itself lives upstream of this module; this
 * type exists so the dispatch glue can surface the 432 mapping uniformly.
 */
export class FlowSignatureError extends Error {
  constructor(message = "Flow request signature authentication failed") {
    super(message);
    this.name = "FlowSignatureError";
  }
}

/**
 * Thrown when the injected CryptoProvider lacks a capability the data-channel
 * runtime requires. This is a server-side misconfiguration (maps to HTTP 500),
 * distinct from a malformed inbound payload (421).
 */
export class FlowCryptoUnavailableError extends Error {
  constructor(capability: string) {
    super(`CryptoProvider does not implement required capability: ${capability}`);
    this.name = "FlowCryptoUnavailableError";
  }
}

// ── base64 helpers (strict, fail-closed) ─────────────────────────────────────

function decodeBase64Field(value: unknown, _fieldName: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new FlowRequestDecryptionError();
  }
  // Cap the encoded length so a hostile body cannot drive a huge decode. base64
  // expands by ~4/3, so the decoded ceiling bounds the encoded length too.
  if (value.length > FLOW_DATA_CHANNEL_MAX_BYTES * 2) {
    throw new FlowRequestDecryptionError();
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch (cause) {
    throw new FlowRequestDecryptionError(cause);
  }
  if (binary.length === 0 || binary.length > FLOW_DATA_CHANNEL_MAX_BYTES) {
    throw new FlowRequestDecryptionError();
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ── request normalisation ────────────────────────────────────────────────────

interface NormalisedEnvelope {
  readonly encryptedFlowData: string;
  readonly encryptedAesKey: string;
  readonly initialVector: string;
}

function readEnvelope(body: EncryptedFlowRequestInput | unknown): NormalisedEnvelope {
  if (!flowIsPlainObject(body)) {
    throw new FlowRequestDecryptionError();
  }
  const record = body as Record<string, unknown>;
  // Accept BOTH the snake_case wire keys and the camelCase public keys.
  const encryptedFlowData = record.encrypted_flow_data ?? record.encryptedFlowData;
  const encryptedAesKey = record.encrypted_aes_key ?? record.encryptedAesKey;
  const initialVector = record.initial_vector ?? record.initialVector;
  if (
    typeof encryptedFlowData !== "string" ||
    typeof encryptedAesKey !== "string" ||
    typeof initialVector !== "string"
  ) {
    throw new FlowRequestDecryptionError();
  }
  return { encryptedFlowData, encryptedAesKey, initialVector };
}

function parseDecryptedRequest(plaintext: Uint8Array): FlowRequest {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch (cause) {
    throw new FlowRequestDecryptionError(cause);
  }
  if (text.length === 0) {
    throw new FlowRequestDecryptionError();
  }
  let parsed: unknown;
  try {
    // __proto__/constructor/prototype guard: reject prototype-pollution keys at
    // parse time so they never reach a plain object the handler trusts.
    parsed = JSON.parse(text, (key, value) => {
      if (flowIsUnsafeObjectKey(key)) {
        throw new Error("unsafe object key in decrypted payload");
      }
      return value;
    });
  } catch (cause) {
    throw new FlowRequestDecryptionError(cause);
  }
  if (!flowIsPlainObject(parsed)) {
    throw new FlowRequestDecryptionError();
  }
  const record = parsed as Record<string, unknown>;

  const version = record.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new FlowRequestDecryptionError();
  }
  const action = record.action;
  if (typeof action !== "string" || !FLOW_REQUEST_ACTIONS.has(action)) {
    throw new FlowRequestDecryptionError();
  }

  const request: {
    version: string;
    action: FlowRequestAction;
    flowToken?: string;
    screen?: string;
    data?: Record<string, unknown>;
  } = { version, action: action as FlowRequestAction };

  const flowToken = record.flow_token ?? record.flowToken;
  if (flowToken !== undefined) {
    if (typeof flowToken !== "string") {
      throw new FlowRequestDecryptionError();
    }
    request.flowToken = flowToken;
  }

  const screen = record.screen;
  if (screen !== undefined && screen !== "") {
    if (typeof screen !== "string") {
      throw new FlowRequestDecryptionError();
    }
    request.screen = screen;
  }

  const data = record.data;
  if (data !== undefined) {
    if (!flowIsPlainObject(data)) {
      throw new FlowRequestDecryptionError();
    }
    if (Object.keys(data).length > 0) {
      request.data = data as Record<string, unknown>;
    }
  }

  return request as FlowRequest;
}

// ── decryptRequest ────────────────────────────────────────────────────────────

export interface DecryptedFlowRequest {
  readonly request: FlowRequest;
  readonly aesKey: Uint8Array;
  readonly iv: Uint8Array;
}

/**
 * Decrypt and parse an inbound encrypted Flow request (REFERENCE-76 §B.2).
 *
 * Steps:
 *   1. base64-decode `encrypted_flow_data`, `encrypted_aes_key`, `initial_vector`.
 *   2. `aesKey = crypto.rsaOaepDecrypt(privateKey, encryptedAesKey)`.
 *   3. `plaintext = crypto.aesGcmDecrypt(aesKey, iv, encryptedFlowData)` — the
 *      16-byte GCM tag is the LAST 16 bytes of `encryptedFlowData` and is split
 *      off internally by the provider, so the FULL ciphertext+tag is passed.
 *   4. JSON.parse the UTF-8 plaintext and map to a camelCase FlowRequest.
 *
 * Returns the parsed request plus the AES key and IV (needed to encrypt the
 * matching response). On ANY failure throws {@link FlowRequestDecryptionError}
 * (→ HTTP 421); a missing provider capability throws
 * {@link FlowCryptoUnavailableError} (→ HTTP 500). Never throws a host error.
 */
export async function decryptRequest(
  crypto: CryptoProvider,
  body: EncryptedFlowRequestInput | unknown,
  privateKey: JsonWebKey | Uint8Array,
  password?: string
): Promise<DecryptedFlowRequest> {
  void password; // Reserved: encrypted private keys are not yet supported.
  if (typeof crypto.rsaOaepDecrypt !== "function") {
    throw new FlowCryptoUnavailableError("rsaOaepDecrypt");
  }
  if (typeof crypto.aesGcmDecrypt !== "function") {
    throw new FlowCryptoUnavailableError("aesGcmDecrypt");
  }

  const envelope = readEnvelope(body);
  const encryptedFlowData = decodeBase64Field(envelope.encryptedFlowData, "encrypted_flow_data");
  const encryptedAesKey = decodeBase64Field(envelope.encryptedAesKey, "encrypted_aes_key");
  const iv = decodeBase64Field(envelope.initialVector, "initial_vector");

  let aesKey: Uint8Array;
  try {
    aesKey = await crypto.rsaOaepDecrypt(privateKey, encryptedAesKey);
  } catch (cause) {
    throw new FlowRequestDecryptionError(cause);
  }

  let plaintext: Uint8Array;
  try {
    // Pass the FULL ciphertext+tag; the provider splits the trailing 16-byte tag.
    plaintext = await crypto.aesGcmDecrypt(aesKey, iv, encryptedFlowData);
  } catch (cause) {
    throw new FlowRequestDecryptionError(cause);
  }

  const request = parseDecryptedRequest(plaintext);
  return { request, aesKey, iv };
}

// ── encryptResponse ───────────────────────────────────────────────────────────

/**
 * Encrypt a Flow response object for the HTTP body (REFERENCE-76 §B.3).
 *
 * Steps:
 *   1. `flippedIv = iv` with every byte XOR 0xFF (bitwise NOT).
 *   2. `{ ciphertext, authTag } = crypto.aesGcmEncrypt(aesKey, flippedIv, utf8(JSON.stringify(response)))`.
 *   3. Return `base64( ciphertext ++ authTag )` — ciphertext FOLLOWED BY the
 *      16-byte tag, then base64. This raw string is the `text/plain` HTTP body.
 */
export async function encryptResponse(
  crypto: CryptoProvider,
  response: FlowResponsePayload,
  aesKey: Uint8Array,
  iv: Uint8Array
): Promise<string> {
  if (typeof crypto.aesGcmEncrypt !== "function") {
    throw new FlowCryptoUnavailableError("aesGcmEncrypt");
  }
  const flippedIv = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i += 1) {
    flippedIv[i] = (iv[i] as number) ^ 0xff;
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(response));
  const { ciphertext, authTag } = await crypto.aesGcmEncrypt(aesKey, flippedIv, plaintext);
  return encodeBase64(concatBytes(ciphertext, authTag));
}

// ── dispatch helpers ───────────────────────────────────────────────────────────

/**
 * True if the decrypted request's `data` signals a client-reported error, i.e.
 * it carries any of `error`, `error_message`, or `error_key` (REFERENCE-76 §B.4).
 */
export function flowRequestHasError(request: FlowRequest): boolean {
  const data = request.data;
  if (data === undefined) return false;
  return (
    Object.prototype.hasOwnProperty.call(data, "error") ||
    Object.prototype.hasOwnProperty.call(data, "error_message") ||
    Object.prototype.hasOwnProperty.call(data, "error_key")
  );
}

/** The fixed ping acknowledgement payload (REFERENCE-76 §B.5). */
export function buildFlowPingResponse(): FlowResponsePayload {
  return { data: { status: "active" } };
}

/** The error-acknowledgement payload (REFERENCE-76 §B.6). */
export function buildFlowErrorAckResponse(request: FlowRequest): FlowResponsePayload {
  const out: FlowResponsePayload = { data: { acknowledged: true } };
  if (request.version !== undefined) {
    out.version = request.version;
  }
  return out;
}

// ── handleFlowRequest (the pure dispatch glue) ──────────────────────────────────

export type FlowRequestHandler = (
  request: FlowRequest
) => FlowResponsePayload | Promise<FlowResponsePayload>;

export interface HandleFlowRequestOptions {
  /** The parsed JSON request body (snake_case wire or camelCase). */
  readonly rawBody: EncryptedFlowRequestInput | unknown;
  /** RSA private key (PEM string bytes or JWK) used to unwrap the AES key. */
  readonly privateKey: JsonWebKey | Uint8Array;
  /** The injected crypto provider (slice C). */
  readonly crypto: CryptoProvider;
  /** User callback invoked for normal (non-ping, non-error-ack) requests. */
  readonly handler: FlowRequestHandler;
  /** When true, has_error requests are auto-acknowledged (§B.6). Default false. */
  readonly acknowledgeErrors?: boolean;
  /** Reserved: passphrase for an encrypted private key. */
  readonly password?: string;
}

export interface FlowEndpointResult {
  readonly statusCode: number;
  /**
   * The HTTP response body. When `encrypted` is true this is the base64
   * ciphertext+tag string; otherwise it is a plain status/error string.
   */
  readonly body: string;
  /** Whether `body` is an encrypted Flow response (true) or a plain text body. */
  readonly encrypted: boolean;
}

/**
 * Framework-agnostic Flow endpoint dispatch (REFERENCE-76 §B.5/§B.6/§B.8).
 *
 * Decrypts the request, routes it (ping → active, has_error+ack → acknowledged,
 * else → user handler), encrypts the response, and returns `{ statusCode, body,
 * encrypted }`. NEVER throws: every failure is mapped to a status code —
 *   - decrypt failure  → 421 "Decryption failed" (plain)
 *   - FlowTokenNoLongerValid → 427 `{ "error_msg": ... }` (plain)
 *   - signature failure → 432 (plain)
 *   - unhandled error   → 500 (plain)
 *
 * The actual @wats/http wiring is a thin shell that calls this and writes the
 * returned status/body.
 */
export async function handleFlowRequest(
  options: HandleFlowRequestOptions
): Promise<FlowEndpointResult> {
  const { rawBody, privateKey, crypto, handler, acknowledgeErrors, password } = options;

  let decrypted: DecryptedFlowRequest;
  try {
    decrypted = await decryptRequest(crypto, rawBody, privateKey, password);
  } catch (err) {
    if (err instanceof FlowRequestDecryptionError) {
      return { statusCode: FLOW_ENDPOINT_STATUS.decryptionFailure, body: "Decryption failed", encrypted: false };
    }
    if (err instanceof FlowSignatureError) {
      return { statusCode: FLOW_ENDPOINT_STATUS.signatureFailure, body: "Signature authentication failed", encrypted: false };
    }
    // FlowCryptoUnavailableError and anything unexpected → server error.
    return { statusCode: FLOW_ENDPOINT_STATUS.serverError, body: "Internal Server Error", encrypted: false };
  }

  const { request, aesKey, iv } = decrypted;

  // Resolve the plaintext response payload for the matched route.
  let payload: FlowResponsePayload;
  try {
    if (request.action === "ping") {
      payload = buildFlowPingResponse();
    } else if (acknowledgeErrors === true && flowRequestHasError(request)) {
      payload = buildFlowErrorAckResponse(request);
    } else {
      payload = await handler(request);
    }
  } catch (err) {
    if (err instanceof FlowTokenNoLongerValidError) {
      return {
        statusCode: FLOW_ENDPOINT_STATUS.flowTokenInvalid,
        body: JSON.stringify({ error_msg: err.errorMsg }),
        encrypted: false
      };
    }
    if (err instanceof FlowSignatureError) {
      return { statusCode: FLOW_ENDPOINT_STATUS.signatureFailure, body: "Signature authentication failed", encrypted: false };
    }
    return { statusCode: FLOW_ENDPOINT_STATUS.serverError, body: "Internal Server Error", encrypted: false };
  }

  // Encrypt the response. A failure here is a server-side fault → 500.
  try {
    const body = await encryptResponse(crypto, payload, aesKey, iv);
    return { statusCode: 200, body, encrypted: true };
  } catch {
    return { statusCode: FLOW_ENDPOINT_STATUS.serverError, body: "Internal Server Error", encrypted: false };
  }
}
