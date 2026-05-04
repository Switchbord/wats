// WATS-37 media runtime parity.
//
// Ships runtime upload/download/delete/decrypt/upload-session primitives over
// GraphClient + Transport with finite resource caps and typed media errors.

import type { GraphClient } from "../client";
import { createGraphApiError, GraphNetworkError } from "../errors";
import type { TransportResponse } from "../transport";

export type MediaOperation =
  | "upload"
  | "download"
  | "delete"
  | "download_bytes"
  | "decrypt_encrypted"
  | "create_upload_session"
  | "upload_file_to_session"
  | "get_upload_session";

export type MediaNotImplementedCode = "not_implemented";

export class MediaNotImplementedError extends Error {
  readonly code: MediaNotImplementedCode;
  readonly operation: MediaOperation;
  readonly linearIssue: string;

  constructor(operation: MediaOperation, linearIssue: string) {
    super(
      `Media ${operation} is not implemented. ` +
        `Track implementation via Linear issue ${linearIssue}.`
    );
    this.name = "MediaNotImplementedError";
    this.code = "not_implemented";
    this.operation = operation;
    this.linearIssue = linearIssue;
  }
}

export type MediaValidationErrorCode =
  | "invalid_client"
  | "invalid_params"
  | "invalid_options"
  | "invalid_url"
  | "invalid_phone_number_id"
  | "invalid_media_id"
  | "invalid_app_id"
  | "invalid_upload_session_id"
  | "invalid_upload_body"
  | "invalid_file"
  | "invalid_file_name"
  | "invalid_file_length"
  | "invalid_media_type"
  | "invalid_file_type"
  | "unsupported_media_type"
  | "invalid_messaging_product"
  | "upload_too_large"
  | "download_too_large"
  | "invalid_file_offset"
  | "invalid_content_length"
  | "invalid_response";

export class MediaValidationError extends Error {
  readonly code: MediaValidationErrorCode;

  constructor(code: MediaValidationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "MediaValidationError";
    this.code = code;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
  }
}

export type MediaCryptoErrorCode =
  | "invalid_bundle"
  | "invalid_base64"
  | "invalid_key_length"
  | "invalid_ciphertext"
  | "invalid_padding"
  | "decrypt_failed"
  | "unsupported_crypto";

export class MediaCryptoError extends Error {
  readonly code: MediaCryptoErrorCode;

  constructor(code: MediaCryptoErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "MediaCryptoError";
    this.code = code;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
  }
}

export type MediaIntegrityErrorCode =
  | "sha256_mismatch"
  | "encrypted_hash_mismatch"
  | "hmac_mismatch"
  | "plaintext_hash_mismatch";

export class MediaIntegrityError extends Error {
  readonly code: MediaIntegrityErrorCode;

  constructor(code: MediaIntegrityErrorCode, message: string) {
    super(message);
    this.name = "MediaIntegrityError";
    this.code = code;
  }
}

export const DEFAULT_MAX_MEDIA_UPLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_MEDIA_UPLOAD_BYTES = DEFAULT_MAX_MEDIA_UPLOAD_BYTES;
export const DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_MEDIA_DOWNLOAD_BYTES = DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES;
export const DEFAULT_MAX_UPLOAD_SESSION_BYTES = 64 * 1024 * 1024;
export const MAX_UPLOAD_SESSION_BYTES = DEFAULT_MAX_UPLOAD_SESSION_BYTES;

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get as
  | ((this: Uint8Array) => ArrayBufferLike)
  | undefined;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get as
  | ((this: Uint8Array) => number)
  | undefined;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get as
  | ((this: Uint8Array) => number)
  | undefined;

export interface MediaUploadBody {
  readonly file: Blob | ArrayBuffer | Uint8Array;
  readonly type: string;
  readonly messagingProduct: "whatsapp";
}

export interface MediaUploadOptions {
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface MediaUploadResponse {
  readonly id: string;
}

export interface MediaDownloadOptions {
  readonly mediaId: string;
  readonly signal?: AbortSignal;
}

export interface MediaDownloadResponse {
  readonly url: string;
  readonly mimeType: string;
  readonly sha256: string;
  readonly fileSize: number;
  readonly messagingProduct: "whatsapp";
}

export interface MediaDeleteOptions {
  readonly mediaId: string;
  readonly signal?: AbortSignal;
}

export interface MediaDeleteResponse {
  readonly success: boolean;
}

export interface MediaDownloadBytesOptions {
  readonly url: string;
  readonly expectedSha256?: string;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface MediaDownloadBytesResponse {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly contentType?: string;
}

export interface EncryptedMediaBundle {
  readonly url: string;
  readonly encryptionKey: string;
  readonly hmacKey: string;
  readonly iv: string;
  readonly sha256: string;
  readonly sha256Enc: string;
}

export interface CreateUploadSessionParams {
  readonly appId: string;
  readonly fileName: string;
  readonly fileLength: number;
  readonly fileType: string;
}

export interface UploadSessionOptions {
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface CreateUploadSessionResponse {
  readonly id: string;
}

export interface UploadFileToSessionParams {
  readonly uploadSessionId: string;
  readonly file: Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;
  readonly fileOffset?: number;
  readonly contentLength?: number;
}

export interface UploadFileToSessionResponse {
  readonly h: string;
}

export interface GetUploadSessionParams {
  readonly uploadSessionId: string;
  readonly signal?: AbortSignal;
}

export interface GetUploadSessionResponse {
  readonly id: string;
  readonly fileOffset: number;
}

export const MEDIA_LINEAR_ISSUE_UPLOAD = "WATS-37";
export const MEDIA_LINEAR_ISSUE_DOWNLOAD = "WATS-37";
export const MEDIA_LINEAR_ISSUE_DELETE = "WATS-37";
export const MEDIA_LINEAR_ISSUE_DECRYPT = "WATS-37";

const MAX_PATH_DECODE_ROUNDS = 5;
const SAFE_ID_REGEXP = /^[A-Za-z0-9_-]+$/;
const PHONE_NUMBER_ID_REGEXP = /^\d+$/;
const BOUNDARY_REGEXP = /^[A-Za-z0-9_.-]+$/;

const SUPPORTED_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "audio/aac",
  "audio/amr",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "video/3gpp",
  "video/mp4"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findCauseByName(error: unknown, name: string): unknown {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (isRecord(current) && !seen.has(current)) {
    if (current.name === name) return current;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function decodePathLike(value: string, code: MediaValidationErrorCode, label: string): string {
  let current = value;
  assertSafeDecodedPathValue(current, code, label);
  for (let round = 0; round < MAX_PATH_DECODE_ROUNDS; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch (cause) {
      throw new MediaValidationError(
        code,
        `Invalid media ${label}: malformed percent-encoding is not allowed.`,
        cause
      );
    }
    assertSafeDecodedPathValue(decoded, code, label);
    if (decoded === current) return decoded;
    current = decoded;
  }
  throw new MediaValidationError(
    code,
    `Invalid media ${label}: excessive nested percent-encoding is not allowed.`
  );
}

function assertSafeDecodedPathValue(
  value: string,
  code: MediaValidationErrorCode,
  label: string
): void {
  if (value.length === 0 || value.trim().length === 0) {
    throw new MediaValidationError(
      code,
      `Invalid media ${label}: value must be a non-empty string.`
    );
  }
  if (hasControlChar(value)) {
    throw new MediaValidationError(
      code,
      `Invalid media ${label}: control characters are not allowed.`
    );
  }
  if (value === "." || value === ".." || value.includes("..")) {
    throw new MediaValidationError(
      code,
      `Invalid media ${label}: dot-segments are not allowed.`
    );
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new MediaValidationError(
      code,
      `Invalid media ${label}: path separators are not allowed.`
    );
  }
  if (value.includes("?") || value.includes("#") || value.includes("://") || value.includes(":")) {
    throw new MediaValidationError(
      code,
      `Invalid media ${label}: URL markers are not allowed.`
    );
  }
}

function validatePhoneNumberId(value: unknown): string {
  if (typeof value !== "string") {
    throw new MediaValidationError(
      "invalid_phone_number_id",
      "Invalid media phoneNumberId: value must be a string."
    );
  }
  const decoded = decodePathLike(value, "invalid_phone_number_id", "phoneNumberId");
  if (!PHONE_NUMBER_ID_REGEXP.test(decoded)) {
    throw new MediaValidationError(
      "invalid_phone_number_id",
      "Invalid media phoneNumberId: value must contain digits only."
    );
  }
  return decoded;
}

function validateMediaId(value: unknown): string {
  if (typeof value !== "string") {
    throw new MediaValidationError(
      "invalid_media_id",
      "Invalid mediaId: value must be a string."
    );
  }
  const decoded = decodePathLike(value, "invalid_media_id", "mediaId");
  if (!SAFE_ID_REGEXP.test(decoded)) {
    throw new MediaValidationError(
      "invalid_media_id",
      "Invalid mediaId: value must contain only letters, digits, '_' or '-'."
    );
  }
  return decoded;
}

function assertClient(client: GraphClient): void {
  if (
    !isRecord(client) ||
    typeof (client as { request?: unknown }).request !== "function" ||
    typeof (client as { requestRaw?: unknown }).requestRaw !== "function"
  ) {
    throw new MediaValidationError(
      "invalid_client",
      "Invalid media client: expected a GraphClient-like object with request() and requestRaw()."
    );
  }
}

function validateSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.aborted !== "boolean" ||
    typeof (value as { addEventListener?: unknown }).addEventListener !==
      "function" ||
    typeof (value as { removeEventListener?: unknown }).removeEventListener !==
      "function"
  ) {
    throw new MediaValidationError(
      "invalid_options",
      "Invalid media options: signal must be an AbortSignal-like object."
    );
  }
  return value as unknown as AbortSignal;
}

function validatePositiveSafeInteger(
  value: unknown,
  code: MediaValidationErrorCode,
  label: string,
  max?: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !Number.isFinite(value) ||
    (max !== undefined && value > max)
  ) {
    throw new MediaValidationError(
      code,
      `Invalid ${label}: expected a positive safe integer${max !== undefined ? ` <= ${max}` : ""}.`
    );
  }
  return value;
}

function validateNonNegativeSafeInteger(
  value: unknown,
  code: MediaValidationErrorCode,
  label: string,
  max?: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isFinite(value) ||
    (max !== undefined && value > max)
  ) {
    throw new MediaValidationError(
      code,
      `Invalid ${label}: expected a non-negative safe integer${max !== undefined ? ` <= ${max}` : ""}.`
    );
  }
  return value;
}

function validateMaxBytes(options: unknown): number {
  if (options === undefined) return DEFAULT_MAX_MEDIA_UPLOAD_BYTES;
  if (!isRecord(options)) {
    throw new MediaValidationError(
      "invalid_options",
      "Invalid media upload options: expected an object."
    );
  }
  validateSignal(options.signal);
  const maxBytes = options.maxBytes;
  if (maxBytes === undefined) return DEFAULT_MAX_MEDIA_UPLOAD_BYTES;
  return validatePositiveSafeInteger(
    maxBytes,
    "invalid_options",
    "media upload options maxBytes",
    MAX_MEDIA_UPLOAD_BYTES
  );
}

function validateDownloadMaxBytes(options: unknown): number {
  if (options === undefined) return DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES;
  if (!isRecord(options)) {
    throw new MediaValidationError(
      "invalid_options",
      "Invalid media download options: expected an object."
    );
  }
  validateSignal(options.signal);
  const maxBytes = options.maxBytes;
  if (maxBytes === undefined) return DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES;
  return validatePositiveSafeInteger(
    maxBytes,
    "invalid_options",
    "media download options maxBytes",
    MAX_MEDIA_DOWNLOAD_BYTES
  );
}

function validateSessionMaxBytes(options: unknown): number {
  if (options === undefined) return DEFAULT_MAX_UPLOAD_SESSION_BYTES;
  if (!isRecord(options)) {
    throw new MediaValidationError(
      "invalid_options",
      "Invalid media upload session options: expected an object."
    );
  }
  validateSignal(options.signal);
  const maxBytes = options.maxBytes;
  if (maxBytes === undefined) return DEFAULT_MAX_UPLOAD_SESSION_BYTES;
  return validatePositiveSafeInteger(
    maxBytes,
    "invalid_options",
    "media upload session options maxBytes",
    MAX_UPLOAD_SESSION_BYTES
  );
}

function validateUploadOptions(options: unknown): { maxBytes: number; signal?: AbortSignal } {
  if (options !== undefined && !isRecord(options)) {
    throw new MediaValidationError(
      "invalid_options",
      "Invalid media upload options: expected an object."
    );
  }
  const maxBytes = validateMaxBytes(options);
  const signal = isRecord(options) ? validateSignal(options.signal) : undefined;
  return signal === undefined ? { maxBytes } : { maxBytes, signal };
}

function validateUploadBody(body: unknown): MediaUploadBody {
  if (!isRecord(body)) {
    throw new MediaValidationError(
      "invalid_upload_body",
      "Invalid media upload body: expected an object."
    );
  }
  const type = validateMediaType(body.type);
  if (body.messagingProduct !== "whatsapp") {
    throw new MediaValidationError(
      "invalid_messaging_product",
      'Invalid media upload body: messagingProduct must be exactly "whatsapp".'
    );
  }
  validateFileShape(body.file);
  return {
    file: body.file as Blob | ArrayBuffer | Uint8Array,
    type,
    messagingProduct: "whatsapp"
  };
}

function validateMediaType(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new MediaValidationError(
      "invalid_media_type",
      "Invalid media type: value must be a non-empty string."
    );
  }
  if (hasControlChar(value)) {
    throw new MediaValidationError(
      "invalid_media_type",
      "Invalid media type: control characters are not allowed."
    );
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
    throw new MediaValidationError(
      "unsupported_media_type",
      "Unsupported media type: parameters and malformed MIME types are not accepted."
    );
  }
  if (!SUPPORTED_MEDIA_TYPES.has(normalized)) {
    throw new MediaValidationError(
      "unsupported_media_type",
      `Unsupported media type: ${normalized}.`
    );
  }
  return normalized;
}

function getIntrinsicUint8ArrayBuffer(value: Uint8Array): ArrayBufferLike {
  const buffer = TYPED_ARRAY_BUFFER_GETTER?.call(value);
  if (buffer === undefined) {
    throw new MediaValidationError("invalid_file", "Invalid media file: could not read intrinsic Uint8Array buffer.");
  }
  return buffer;
}

function getIntrinsicUint8ArrayByteLength(value: Uint8Array): number {
  const byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value);
  if (byteLength === undefined) {
    throw new MediaValidationError("invalid_file", "Invalid media file: could not read intrinsic Uint8Array byteLength.");
  }
  return byteLength;
}

function getIntrinsicUint8ArrayByteOffset(value: Uint8Array): number {
  const byteOffset = TYPED_ARRAY_BYTE_OFFSET_GETTER?.call(value);
  if (byteOffset === undefined) {
    throw new MediaValidationError("invalid_file", "Invalid media file: could not read intrinsic Uint8Array byteOffset.");
  }
  return byteOffset;
}

function isSharedArrayBufferBacked(value: Uint8Array): boolean {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    getIntrinsicUint8ArrayBuffer(value) instanceof SharedArrayBuffer
  );
}

function normalizeUint8ArrayChunk(value: Uint8Array): Uint8Array {
  if (isSharedArrayBufferBacked(value)) {
    throw new MediaValidationError(
      "invalid_file",
      "Invalid media file: SharedArrayBuffer-backed Uint8Array is not supported."
    );
  }
  const byteLength = getIntrinsicUint8ArrayByteLength(value);
  const byteOffset = getIntrinsicUint8ArrayByteOffset(value);
  const buffer = getIntrinsicUint8ArrayBuffer(value);
  return new Uint8Array(buffer, byteOffset, byteLength).slice();
}

function validateFileShape(value: unknown): void {
  if (value instanceof Blob) return;
  if (value instanceof ArrayBuffer) return;
  if (value instanceof Uint8Array) {
    if (isSharedArrayBufferBacked(value)) {
      throw new MediaValidationError(
        "invalid_file",
        "Invalid media file: SharedArrayBuffer-backed Uint8Array is not supported."
      );
    }
    return;
  }
  throw new MediaValidationError(
    "invalid_file",
    "Invalid media file: supported file bodies are Blob, ArrayBuffer, and Uint8Array only."
  );
}

function assertSizeAtMost(size: number, maxBytes: number): void {
  if (!Number.isInteger(size) || size < 0) {
    throw new MediaValidationError(
      "invalid_file",
      "Invalid media file: byte length must be a non-negative integer."
    );
  }
  if (size > maxBytes) {
    throw new MediaValidationError(
      "upload_too_large",
      `Media upload body exceeds maxBytes (${size} > ${maxBytes}).`
    );
  }
}

async function normalizeFileBytes(file: Blob | ArrayBuffer | Uint8Array, maxBytes: number): Promise<Uint8Array> {
  try {
    if (file instanceof Blob) {
      assertSizeAtMost(file.size, maxBytes);
      const bytes = new Uint8Array(await file.arrayBuffer());
      assertSizeAtMost(bytes.byteLength, maxBytes);
      return bytes;
    }
    if (file instanceof ArrayBuffer) {
      assertSizeAtMost(file.byteLength, maxBytes);
      return new Uint8Array(file).slice();
    }
    if (file instanceof Uint8Array) {
      const bytes = normalizeUint8ArrayChunk(file);
      assertSizeAtMost(bytes.byteLength, maxBytes);
      return bytes;
    }
  } catch (cause) {
    if (cause instanceof MediaValidationError) throw cause;
    throw new MediaValidationError(
      "invalid_file",
      "Invalid media file: could not read bytes.",
      cause
    );
  }
  throw new MediaValidationError(
    "invalid_file",
    "Invalid media file: supported file bodies are Blob, ArrayBuffer, and Uint8Array only."
  );
}

function encodeAscii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const cryptoLike = globalThis.crypto;
  if (cryptoLike === undefined || typeof cryptoLike.getRandomValues !== "function") {
    throw new MediaValidationError(
      "invalid_upload_body",
      "Cannot generate multipart boundary: crypto.getRandomValues is unavailable."
    );
  }
  cryptoLike.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createMultipartBoundary(): string {
  const boundary = `wats_media_${randomHex(16)}`;
  if (!BOUNDARY_REGEXP.test(boundary)) {
    throw new MediaValidationError(
      "invalid_upload_body",
      "Generated multipart boundary contained unsafe characters."
    );
  }
  return boundary;
}

async function buildMultipartBody(body: MediaUploadBody, maxBytes: number): Promise<{ bytes: Uint8Array; boundary: string }> {
  const fileBytes = await normalizeFileBytes(body.file, maxBytes);
  const boundary = createMultipartBoundary();
  const parts = [
    encodeAscii(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="messaging_product"\r\n\r\n' +
        'whatsapp\r\n' +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="type"\r\n\r\n' +
        `${body.type}\r\n` +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="media"\r\n' +
        `Content-Type: ${body.type}\r\n\r\n`
    ),
    fileBytes,
    encodeAscii(`\r\n--${boundary}--\r\n`)
  ];
  return { bytes: concatUint8Arrays(parts), boundary };
}

function validateUploadResponse(value: unknown): MediaUploadResponse {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new MediaValidationError(
      "invalid_response",
      "Invalid media upload response: expected { id: string }."
    );
  }
  return { id: value.id };
}

function asNonEmptyString(
  value: unknown,
  code: MediaValidationErrorCode,
  label: string
): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new MediaValidationError(code, `Invalid media response: ${label} must be a non-empty string.`);
  }
  return value;
}

function parseFileSize(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || !Number.isFinite(parsed)) {
    throw new MediaValidationError(
      "invalid_response",
      "Invalid media response: file_size must parse to a non-negative integer."
    );
  }
  return parsed;
}

function validateDownloadResponse(value: unknown): MediaDownloadResponse {
  if (!isRecord(value)) {
    throw new MediaValidationError(
      "invalid_response",
      "Invalid media metadata response: expected an object."
    );
  }
  const messagingProduct = value.messaging_product ?? value.messagingProduct;
  if (messagingProduct !== "whatsapp") {
    throw new MediaValidationError(
      "invalid_response",
      'Invalid media metadata response: messaging_product must be "whatsapp".'
    );
  }
  return {
    messagingProduct: "whatsapp",
    url: asNonEmptyString(value.url, "invalid_response", "url"),
    mimeType: asNonEmptyString(value.mime_type ?? value.mimeType, "invalid_response", "mime_type"),
    sha256: asNonEmptyString(value.sha256, "invalid_response", "sha256"),
    fileSize: parseFileSize(value.file_size ?? value.fileSize)
  };
}

function validateDeleteResponse(value: unknown): MediaDeleteResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new MediaValidationError(
      "invalid_response",
      "Invalid media delete response: expected { success: boolean }."
    );
  }
  return { success: value.success };
}

function validateUploadParams(params: unknown): { phoneNumberId: string } {
  if (!isRecord(params)) {
    throw new MediaValidationError(
      "invalid_params",
      "Invalid media upload params: expected an object."
    );
  }
  return { phoneNumberId: validatePhoneNumberId(params.phoneNumberId) };
}

function validateDownloadOptions(options: unknown): { mediaId: string; signal?: AbortSignal } {
  if (!isRecord(options)) {
    throw new MediaValidationError(
      "invalid_options",
      "Invalid media download options: expected an object."
    );
  }
  const signal = validateSignal(options.signal);
  const mediaId = validateMediaId(options.mediaId);
  return signal === undefined ? { mediaId } : { mediaId, signal };
}

function validateDeleteOptions(options: unknown): { mediaId: string; signal?: AbortSignal } {
  if (!isRecord(options)) {
    throw new MediaValidationError(
      "invalid_params",
      "Invalid media delete params: expected an object."
    );
  }
  const signal = validateSignal(options.signal);
  const mediaId = validateMediaId(options.mediaId);
  return signal === undefined ? { mediaId } : { mediaId, signal };
}

function validateHttpUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new MediaValidationError(
      "invalid_url",
      "Invalid media URL: value must be a non-empty string."
    );
  }
  if (hasControlChar(value)) {
    throw new MediaValidationError(
      "invalid_url",
      "Invalid media URL: control characters are not allowed."
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new MediaValidationError("invalid_url", "Invalid media URL: malformed URL.", cause);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MediaValidationError(
      "invalid_url",
      "Invalid media URL: protocol must be http: or https:."
    );
  }
  return url.toString();
}

function validateBase64Digest(
  value: unknown,
  label: string,
  code: MediaCryptoErrorCode | "invalid_options" = "invalid_base64",
  expectedLength?: number
): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    if (code === "invalid_options") {
      throw new MediaValidationError("invalid_options", `Invalid ${label}: expected a non-empty base64 string.`);
    }
    throw new MediaCryptoError(code, `Invalid ${label}: expected a non-empty base64 string.`);
  }
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    if (out.byteLength === 0) throw new Error("empty");
    if (expectedLength !== undefined && out.byteLength !== expectedLength) {
      if (code === "invalid_options") {
        throw new MediaValidationError("invalid_options", `Invalid ${label}: expected ${expectedLength} decoded bytes.`);
      }
      throw new MediaCryptoError("invalid_key_length", `Invalid ${label}: expected ${expectedLength} decoded bytes.`);
    }
    return out;
  } catch (cause) {
    if (code === "invalid_options") {
      throw new MediaValidationError("invalid_options", `Invalid ${label}: malformed base64.`, cause);
    }
    throw new MediaCryptoError(code, `Invalid ${label}: malformed base64.`, cause);
  }
}

function validateDownloadBytesOptions(options: unknown): { url: string; expectedSha256?: Uint8Array; maxBytes: number; signal?: AbortSignal } {
  if (!isRecord(options)) {
    throw new MediaValidationError(
      "invalid_options",
      "Invalid media download bytes options: expected an object."
    );
  }
  const url = validateHttpUrl(options.url);
  const maxBytes = validateDownloadMaxBytes(options);
  const signal = validateSignal(options.signal);
  const expectedSha256 = options.expectedSha256 === undefined
    ? undefined
    : validateBase64Digest(options.expectedSha256, "expectedSha256", "invalid_options", 32);
  return {
    url,
    maxBytes,
    ...(signal !== undefined ? { signal } : {}),
    ...(expectedSha256 !== undefined ? { expectedSha256 } : {})
  };
}

function validateFileName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new MediaValidationError("invalid_file_name", "Invalid fileName: expected a non-empty string.");
  }
  if (hasControlChar(value) || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new MediaValidationError("invalid_file_name", "Invalid fileName: path/control characters are not allowed.");
  }
  const decoded = decodePathLike(value, "invalid_file_name", "fileName");
  return decoded;
}

function validateCreateUploadSessionParams(params: unknown, options?: UploadSessionOptions): { params: CreateUploadSessionParams; signal?: AbortSignal } {
  if (!isRecord(params)) {
    throw new MediaValidationError("invalid_params", "Invalid upload session params: expected an object.");
  }
  const maxBytes = validateSessionMaxBytes(options ?? params);
  const signal = validateSignal((options ?? params).signal);
  const appId = validatePhoneNumberId(params.appId);
  const fileName = validateFileName(params.fileName);
  const fileLength = validatePositiveSafeInteger(
    params.fileLength,
    "invalid_file_length",
    "fileLength",
    maxBytes
  );
  const fileType = validateMediaType(params.fileType);
  const out = { appId, fileName, fileLength, fileType };
  return signal === undefined ? { params: out } : { params: out, signal };
}

function validateUploadSessionId(value: unknown): string {
  if (typeof value !== "string") {
    throw new MediaValidationError(
      "invalid_upload_session_id",
      "Invalid uploadSessionId: value must be a string."
    );
  }
  const decoded = decodeUploadSessionPathLike(value);
  if (!/^[A-Za-z0-9_:-]+$/.test(decoded)) {
    throw new MediaValidationError(
      "invalid_upload_session_id",
      "Invalid uploadSessionId: value must contain only letters, digits, '_', '-' or ':'."
    );
  }
  return decoded;
}

function decodeUploadSessionPathLike(value: string): string {
  let current = value;
  assertSafeUploadSessionPathValue(current);
  for (let round = 0; round < MAX_PATH_DECODE_ROUNDS; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch (cause) {
      throw new MediaValidationError(
        "invalid_upload_session_id",
        "Invalid uploadSessionId: malformed percent-encoding is not allowed.",
        cause
      );
    }
    assertSafeUploadSessionPathValue(decoded);
    if (decoded === current) return decoded;
    current = decoded;
  }
  throw new MediaValidationError(
    "invalid_upload_session_id",
    "Invalid uploadSessionId: excessive nested percent-encoding is not allowed."
  );
}

function assertSafeUploadSessionPathValue(value: string): void {
  if (value.length === 0 || value.trim().length === 0) {
    throw new MediaValidationError("invalid_upload_session_id", "Invalid uploadSessionId: value must be a non-empty string.");
  }
  if (hasControlChar(value)) {
    throw new MediaValidationError("invalid_upload_session_id", "Invalid uploadSessionId: control characters are not allowed.");
  }
  if (value === "." || value === ".." || value.includes("..")) {
    throw new MediaValidationError("invalid_upload_session_id", "Invalid uploadSessionId: dot-segments are not allowed.");
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new MediaValidationError("invalid_upload_session_id", "Invalid uploadSessionId: path separators are not allowed.");
  }
  if (value.includes("?") || value.includes("#") || value.includes("://")) {
    throw new MediaValidationError("invalid_upload_session_id", "Invalid uploadSessionId: URL markers are not allowed.");
  }
}

function validateGetUploadSessionParams(params: unknown): { uploadSessionId: string; signal?: AbortSignal } {
  if (!isRecord(params)) {
    throw new MediaValidationError("invalid_params", "Invalid getUploadSession params: expected an object.");
  }
  const uploadSessionId = validateUploadSessionId(params.uploadSessionId);
  const signal = validateSignal(params.signal);
  return signal === undefined ? { uploadSessionId } : { uploadSessionId, signal };
}

function validateReadableStreamLike(value: unknown): value is ReadableStream<Uint8Array> {
  return isRecord(value) && typeof (value as { getReader?: unknown }).getReader === "function";
}

function validateUploadFileToSessionParams(params: unknown, options?: UploadSessionOptions): { uploadSessionId: string; file: Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>; fileOffset: number; contentLength?: number; signal?: AbortSignal; maxBytes: number; fileIsStream: boolean } {
  if (!isRecord(params)) {
    throw new MediaValidationError("invalid_params", "Invalid uploadFileToSession params: expected an object.");
  }
  const uploadSessionId = validateUploadSessionId(params.uploadSessionId);
  const maxBytes = validateSessionMaxBytes(options ?? params);
  const signal = validateSignal((options ?? params).signal);
  const fileOffset = params.fileOffset === undefined
    ? 0
    : validateNonNegativeSafeInteger(params.fileOffset, "invalid_file_offset", "fileOffset", maxBytes);
  const contentLength = params.contentLength === undefined
    ? undefined
    : validatePositiveSafeInteger(params.contentLength, "invalid_content_length", "contentLength", maxBytes);
  const file = params.file;
  let fileIsStream = false;
  if (file instanceof Blob || file instanceof ArrayBuffer || file instanceof Uint8Array) {
    validateFileShape(file);
  } else if (validateReadableStreamLike(file)) {
    fileIsStream = true;
    if (contentLength === undefined) {
      throw new MediaValidationError("invalid_content_length", "contentLength is required for ReadableStream uploads.");
    }
  } else {
    throw new MediaValidationError("invalid_file", "Invalid upload session file body.");
  }
  if (
    (file instanceof Blob && file.size > maxBytes) ||
    (file instanceof ArrayBuffer && file.byteLength > maxBytes) ||
    (file instanceof Uint8Array && getIntrinsicUint8ArrayByteLength(file) > maxBytes)
  ) {
    throw new MediaValidationError("upload_too_large", "Upload session file exceeds maxBytes.");
  }
  return {
    uploadSessionId,
    file: file as Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
    fileOffset,
    maxBytes,
    fileIsStream,
    ...(contentLength !== undefined ? { contentLength } : {}),
    ...(signal !== undefined ? { signal } : {})
  };
}

export async function uploadMedia(
  client: GraphClient,
  params: { phoneNumberId: string },
  body: MediaUploadBody,
  options?: MediaUploadOptions
): Promise<MediaUploadResponse> {
  assertClient(client);
  const validatedParams = validateUploadParams(params);
  const uploadOptions = validateUploadOptions(options);
  const validatedBody = validateUploadBody(body);
  const multipart = await buildMultipartBody(validatedBody, uploadOptions.maxBytes);
  const response = await client.request<unknown>({
    method: "POST",
    path: `/${validatedParams.phoneNumberId}/media`,
    body: multipart.bytes,
    headers: {
      "content-type": `multipart/form-data; boundary=${multipart.boundary}`
    },
    ...(uploadOptions.signal !== undefined ? { signal: uploadOptions.signal } : {})
  });
  return validateUploadResponse(response);
}

export async function downloadMedia(
  client: GraphClient,
  opts: MediaDownloadOptions
): Promise<MediaDownloadResponse> {
  assertClient(client);
  const validated = validateDownloadOptions(opts);
  const response = await client.request<unknown>({
    method: "GET",
    path: `/${validated.mediaId}`,
    ...(validated.signal !== undefined ? { signal: validated.signal } : {})
  });
  return validateDownloadResponse(response);
}

export async function deleteMedia(
  client: GraphClient,
  params: MediaDeleteOptions
): Promise<MediaDeleteResponse> {
  assertClient(client);
  const validated = validateDeleteOptions(params);
  const response = await client.request<unknown>({
    method: "DELETE",
    path: `/${validated.mediaId}`,
    ...(validated.signal !== undefined ? { signal: validated.signal } : {})
  });
  return validateDeleteResponse(response);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto?.subtle?.digest("SHA-256", bytes.slice() as BufferSource);
  if (digest === undefined) {
    throw new MediaCryptoError("unsupported_crypto", "SubtleCrypto SHA-256 is unavailable.");
  }
  return new Uint8Array(digest);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function assertLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.byteLength !== expected) {
    throw new MediaCryptoError("invalid_key_length", `Invalid ${label}: expected ${expected} bytes.`);
  }
}

function validateEncryptedBundle(bundle: unknown): { encryptionKey: Uint8Array; hmacKey: Uint8Array; iv: Uint8Array; sha256: Uint8Array; sha256Enc: Uint8Array } {
  if (!isRecord(bundle)) throw new MediaCryptoError("invalid_bundle", "Encrypted media bundle must be an object.");
  const encryptionKey = validateBase64Digest(bundle.encryptionKey, "encryptionKey");
  const hmacKey = validateBase64Digest(bundle.hmacKey, "hmacKey");
  const iv = validateBase64Digest(bundle.iv, "iv");
  const plainHash = validateBase64Digest(bundle.sha256, "sha256");
  const encHash = validateBase64Digest(bundle.sha256Enc, "sha256Enc");
  assertLength(encryptionKey, 32, "encryptionKey");
  assertLength(hmacKey, 32, "hmacKey");
  assertLength(iv, 16, "iv");
  assertLength(plainHash, 32, "sha256");
  assertLength(encHash, 32, "sha256Enc");
  return { encryptionKey, hmacKey, iv, sha256: plainHash, sha256Enc: encHash };
}

function validateEncryptedBytes(encrypted: unknown): Uint8Array {
  if (!(encrypted instanceof Uint8Array) || encrypted.byteLength <= 10) {
    throw new MediaCryptoError("invalid_ciphertext", "Encrypted media bytes must be Uint8Array ciphertext plus 10-byte tag.");
  }
  const cipherLength = encrypted.byteLength - 10;
  if (cipherLength <= 0 || cipherLength % 16 !== 0) {
    throw new MediaCryptoError("invalid_ciphertext", "Encrypted media ciphertext must be non-empty and AES-block aligned.");
  }
  return encrypted.slice();
}

export async function decryptEncryptedMedia(
  bundle: EncryptedMediaBundle,
  encrypted: Uint8Array
): Promise<Uint8Array> {
  const b = validateEncryptedBundle(bundle);
  const file = validateEncryptedBytes(encrypted);
  const ciphertext = file.slice(0, file.byteLength - 10);
  const tag = file.slice(file.byteLength - 10);

  const actualEncryptedHash = await sha256(file);
  if (!timingSafeEqualBytes(actualEncryptedHash, b.sha256Enc)) {
    throw new MediaIntegrityError("encrypted_hash_mismatch", "Encrypted media SHA-256 verification failed.");
  }

  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new MediaCryptoError("unsupported_crypto", "SubtleCrypto is unavailable.");
  }
  const hmacKey = await subtle.importKey("raw", b.hmacKey.slice() as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await subtle.sign("HMAC", hmacKey, concatUint8Arrays([b.iv, ciphertext]).slice() as BufferSource));
  if (!timingSafeEqualBytes(mac.slice(0, 10), tag)) {
    throw new MediaIntegrityError("hmac_mismatch", "Encrypted media HMAC verification failed.");
  }

  let decryptedBytes: Uint8Array;
  try {
    const key = await subtle.importKey("raw", b.encryptionKey.slice() as BufferSource, { name: "AES-CBC" }, false, ["decrypt"]);
    const decrypted = await subtle.decrypt({ name: "AES-CBC", iv: b.iv.slice() as BufferSource }, key, ciphertext.slice() as BufferSource);
    decryptedBytes = new Uint8Array(decrypted);
  } catch (cause) {
    throw new MediaCryptoError("invalid_padding", "AES-CBC decrypt or PKCS#7 padding validation failed.", cause);
  }
  // WebCrypto AES-CBC returns plaintext after PKCS#7 validation/removal.
  // Do not unpad a second time: valid plaintext may itself be AES-block aligned.
  const plaintext = decryptedBytes;
  const actualPlainHash = await sha256(plaintext);
  if (!timingSafeEqualBytes(actualPlainHash, b.sha256)) {
    throw new MediaIntegrityError("plaintext_hash_mismatch", "Decrypted media SHA-256 verification failed.");
  }
  return plaintext;
}

function wrapUploadSessionStream(stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let total = 0;
  let done = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (cause) {
        done = true;
        try { reader.releaseLock(); } catch {}
        throw new MediaValidationError("invalid_file", "ReadableStream upload failed while reading.", cause);
      }
      if (result.done) {
        done = true;
        try { reader.releaseLock(); } catch {}
        controller.close();
        return;
      }
      if (!(result.value instanceof Uint8Array)) {
        done = true;
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
        throw new MediaValidationError("invalid_file", "ReadableStream upload yielded non-Uint8Array chunk.");
      }
      let chunk: Uint8Array;
      try {
        chunk = normalizeUint8ArrayChunk(result.value);
      } catch (cause) {
        done = true;
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
        if (cause instanceof MediaValidationError) throw cause;
        throw new MediaValidationError("invalid_file", "ReadableStream upload yielded invalid Uint8Array chunk.", cause);
      }
      total += chunk.byteLength;
      if (total > maxBytes) {
        done = true;
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
        throw new MediaValidationError("upload_too_large", "Upload session stream exceeds maxBytes.");
      }
      controller.enqueue(chunk);
    },
    async cancel(reason) {
      done = true;
      try { await reader.cancel(reason); } finally { try { reader.releaseLock(); } catch {} }
    }
  });
}

async function readTransportBytes(response: TransportResponse, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new MediaValidationError("invalid_response", "Invalid media response content-length.");
    }
    if (parsed > maxBytes) throw new MediaValidationError("download_too_large", "Media download exceeds maxBytes.");
  }
  const stream = response.body;
  if (stream !== null && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (cause) {
          throw new MediaValidationError("invalid_response", "Media response stream failed while reading.", cause);
        }
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) {
          throw new MediaValidationError("invalid_response", "Media response stream yielded non-Uint8Array chunk.");
        }
        let chunk: Uint8Array;
        try {
          chunk = normalizeUint8ArrayChunk(result.value);
        } catch (cause) {
          if (cause instanceof MediaValidationError) {
            throw new MediaValidationError(cause.code, cause.message, cause);
          }
          throw new MediaValidationError("invalid_response", "Media response stream yielded invalid Uint8Array chunk.", cause);
        }
        total += chunk.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new MediaValidationError("download_too_large", "Media download exceeds maxBytes.");
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return concatUint8Arrays(chunks);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new MediaValidationError("download_too_large", "Media download exceeds maxBytes.");
  return bytes;
}

export async function downloadMediaBytes(
  client: GraphClient,
  opts: MediaDownloadBytesOptions
): Promise<MediaDownloadBytesResponse> {
  assertClient(client);
  const options = validateDownloadBytesOptions(opts);
  const res = await client.requestRaw({
    method: "GET",
    url: options.url,
    body: null,
    ...(options.signal !== undefined ? { signal: options.signal } : {})
  });
  if (res.status < 200 || res.status >= 300) {
    let payload: unknown;
    try { payload = await res.json(); } catch { payload = undefined; }
    const maybe = isRecord(payload) && isRecord(payload.error) ? payload.error as { message?: string; type?: string; code?: number } : undefined;
    throw createGraphApiError({ status: res.status, payload: maybe, fallbackMessage: `Graph API request failed with status ${res.status}` });
  }
  const bytes = await readTransportBytes(res, options.maxBytes);
  const actualHash = await sha256(bytes);
  if (options.expectedSha256 !== undefined && !timingSafeEqualBytes(actualHash, options.expectedSha256)) {
    throw new MediaIntegrityError("sha256_mismatch", "Downloaded media SHA-256 mismatch.");
  }
  return {
    bytes,
    sha256: bytesToBase64Local(actualHash),
    ...(res.headers.get("content-type") !== null ? { contentType: res.headers.get("content-type")! } : {})
  };
}

function bytesToBase64Local(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function createUploadSession(
  client: GraphClient,
  params: CreateUploadSessionParams,
  opts?: UploadSessionOptions
): Promise<CreateUploadSessionResponse> {
  assertClient(client);
  const validated = validateCreateUploadSessionParams(params, opts);
  const p = validated.params;
  const response = await client.request<unknown>({
    method: "POST",
    path: `/${p.appId}/uploads`,
    query: { file_name: p.fileName, file_length: p.fileLength, file_type: p.fileType },
    ...(validated.signal !== undefined ? { signal: validated.signal } : {})
  });
  return validateUploadResponse(response);
}

export async function uploadFileToSession(
  client: GraphClient,
  params: UploadFileToSessionParams,
  opts?: UploadSessionOptions
): Promise<UploadFileToSessionResponse> {
  assertClient(client);
  const p = validateUploadFileToSessionParams(params, opts);
  const body = p.fileIsStream
    ? wrapUploadSessionStream(p.file as ReadableStream<Uint8Array>, p.maxBytes)
    : p.file instanceof Uint8Array
      ? normalizeUint8ArrayChunk(p.file)
      : p.file;
  let response: unknown;
  try {
    response = await client.request<unknown>({
      method: "POST",
      path: `/${p.uploadSessionId}`,
      body,
      headers: {
        file_offset: String(p.fileOffset),
        ...(p.contentLength !== undefined ? { "content-length": String(p.contentLength) } : {})
      },
      ...(p.signal !== undefined ? { signal: p.signal } : {})
    });
  } catch (cause) {
    const streamError = p.fileIsStream ? findCauseByName(cause, "MediaValidationError") : undefined;
    if (streamError instanceof MediaValidationError) {
      throw streamError;
    }
    throw cause;
  }
  if (!isRecord(response) || typeof response.h !== "string" || response.h.length === 0) {
    throw new MediaValidationError("invalid_response", "Invalid upload session response: expected { h: string }.");
  }
  return { h: response.h };
}

export async function getUploadSession(
  client: GraphClient,
  params: GetUploadSessionParams
): Promise<GetUploadSessionResponse> {
  assertClient(client);
  const p = validateGetUploadSessionParams(params);
  const response = await client.request<unknown>({
    method: "GET",
    path: `/${p.uploadSessionId}`,
    ...(p.signal !== undefined ? { signal: p.signal } : {})
  });
  if (!isRecord(response) || typeof response.id !== "string" || response.id.length === 0) {
    throw new MediaValidationError("invalid_response", "Invalid upload session status response.");
  }
  return { id: response.id, fileOffset: parseFileSize(response.file_offset ?? response.fileOffset) };
}
