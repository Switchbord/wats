// @wats/crypto — typed error hierarchy + shared input-validation helpers.
//
// These errors are the public taxonomy for validation failures across
// both adapters. Adapters MUST throw / reject with one of the subclasses
// below and MUST NOT leak raw TypeError / RangeError from underlying
// runtime primitives.

import type { CryptoValidationErrorShape } from "./provider.js";

export type CryptoErrorCode = CryptoValidationErrorShape["code"];

interface CryptoProviderErrorOptions {
  readonly cause?: unknown;
}

export class CryptoProviderError extends Error {
  readonly code: CryptoErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: CryptoErrorCode,
    message: string,
    options?: CryptoProviderErrorOptions
  ) {
    super(message);
    this.name = "CryptoProviderError";
    this.code = code;
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}

export class InvalidKeyError extends CryptoProviderError {
  constructor(message: string, options?: CryptoProviderErrorOptions) {
    super("invalid_key", message, options);
    this.name = "InvalidKeyError";
  }
}

export class InvalidBodyError extends CryptoProviderError {
  constructor(message: string, options?: CryptoProviderErrorOptions) {
    super("invalid_body", message, options);
    this.name = "InvalidBodyError";
  }
}

export class InvalidLengthError extends CryptoProviderError {
  constructor(message: string, options?: CryptoProviderErrorOptions) {
    super("invalid_length", message, options);
    this.name = "InvalidLengthError";
  }
}

export class UnsupportedCapabilityError extends CryptoProviderError {
  constructor(message: string, options?: CryptoProviderErrorOptions) {
    super("unsupported_capability", message, options);
    this.name = "UnsupportedCapabilityError";
  }
}

// Validation helpers shared by both adapters. `assertValidKey` and
// `assertValidBody` both accept `Uint8Array | string`; the Uint8Array
// side must be non-empty (empty keys are rejected per the battery; empty
// bodies are accepted because HMAC over an empty message is a legitimate
// operation, so `assertValidBody` permits zero-length byte arrays and
// empty strings).

export function assertValidKey(
  key: unknown
): asserts key is Uint8Array | string {
  if (typeof key === "string") {
    if (key.length === 0) {
      throw new InvalidKeyError("key must be a non-empty string");
    }
    return;
  }
  if (key instanceof Uint8Array) {
    if (key.byteLength === 0) {
      throw new InvalidKeyError("key must be a non-empty Uint8Array");
    }
    return;
  }
  throw new InvalidKeyError(
    `key must be Uint8Array or non-empty string; got ${describeType(key)}`
  );
}

export function assertValidBody(
  body: unknown
): asserts body is Uint8Array | string {
  if (typeof body === "string") {
    return;
  }
  if (body instanceof Uint8Array) {
    return;
  }
  throw new InvalidBodyError(
    `body must be Uint8Array or string; got ${describeType(body)}`
  );
}

export function assertUint8Array(
  value: unknown,
  label: string
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new CryptoProviderError(
      "invalid_body",
      `${label} must be a Uint8Array; got ${describeType(value)}`
    );
  }
}

export function assertFiniteLength(
  n: unknown,
  min: number,
  max: number
): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new InvalidLengthError(
      `byteLength must be a finite integer; got ${describeType(n)}`
    );
  }
  if (n < min || n > max) {
    throw new InvalidLengthError(
      `byteLength must be in [${min}, ${max}]; got ${n}`
    );
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Uint8Array) return "Uint8Array";
  return typeof value;
}

// --- AES-GCM shared validation -------------------------------------------
//
// The GCM auth tag is always 16 bytes (128-bit) for the Flow scheme. Both
// adapters share these helpers so their public contracts stay identical:
// AES-128-GCM vs AES-256-GCM is selected purely by key byte length.

export const GCM_TAG_LENGTH = 16;

// Reasonable upper bound on the GCM IV/nonce so a hostile caller can't pass a
// pathological buffer; 12-byte (96-bit) nonces are standard, 16-byte nonces are
// used by the Flow scheme, and Node/WebCrypto both accept these.
const MAX_GCM_IV_BYTES = 256;

/**
 * Validate an AES-GCM key and return its strength in bits (128 or 256).
 * Throws InvalidKeyError for anything other than a 16- or 32-byte Uint8Array.
 */
export function assertAesGcmKey(key: unknown): 128 | 256 {
  if (!(key instanceof Uint8Array)) {
    throw new InvalidKeyError(
      `AES-GCM key must be a Uint8Array; got ${describeType(key)}`
    );
  }
  if (key.byteLength === 16) return 128;
  if (key.byteLength === 32) return 256;
  throw new InvalidKeyError(
    `AES-GCM key must be 16 bytes (AES-128) or 32 bytes (AES-256); got ${key.byteLength}`
  );
}

/**
 * Validate an AES-GCM IV/nonce. Throws InvalidLengthError for a non-Uint8Array,
 * an empty IV, or an absurdly large IV.
 */
export function assertGcmIv(iv: unknown): asserts iv is Uint8Array {
  if (!(iv instanceof Uint8Array)) {
    throw new InvalidLengthError(
      `AES-GCM iv must be a Uint8Array; got ${describeType(iv)}`
    );
  }
  if (iv.byteLength === 0) {
    throw new InvalidLengthError("AES-GCM iv must be non-empty");
  }
  if (iv.byteLength > MAX_GCM_IV_BYTES) {
    throw new InvalidLengthError(
      `AES-GCM iv must be at most ${MAX_GCM_IV_BYTES} bytes; got ${iv.byteLength}`
    );
  }
}

/**
 * Validate optional AES-GCM AAD. Throws InvalidBodyError if present but not a
 * Uint8Array.
 */
export function assertOptionalAad(aad: unknown): asserts aad is Uint8Array | undefined {
  if (aad === undefined) return;
  if (!(aad instanceof Uint8Array)) {
    throw new InvalidBodyError(
      `AES-GCM aad must be a Uint8Array when provided; got ${describeType(aad)}`
    );
  }
}
