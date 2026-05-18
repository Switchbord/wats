// @wats/http — webhook signature validation built on the @wats/crypto
// CryptoProvider seam. This module intentionally contains ZERO static
// `node:*` imports and ZERO references to the Node-only `Buffer` global.
// All cryptographic primitives flow through the injected CryptoProvider
// so the package remains importable on Edge runtimes (Vercel Edge,
// Cloudflare Workers, Deno).

import {
  UnsupportedCapabilityError,
  createCryptoProvider,
  type CryptoProvider
} from "@wats/crypto";

export type SignatureValidationErrorCode =
  | "invalid_app_secret"
  | "invalid_raw_body"
  | "missing_signature"
  | "invalid_signature_format"
  | "signature_mismatch"
  | "crypto_provider_unavailable";

export interface SignatureValidationError {
  code: SignatureValidationErrorCode;
  message: string;
}

export type SignatureValidationResult =
  | { ok: true }
  | { ok: false; error: SignatureValidationError };

export interface ValidateWebhookSignatureInput {
  appSecret: string;
  rawBody: string | Uint8Array | ArrayBuffer | ArrayBufferView;
  signatureHeader: string | null | undefined;
  /**
   * Optional CryptoProvider injection. Defaults to createCryptoProvider()
   * (auto-detected Node/Bun-vs-WebCrypto adapter). Inject a specific
   * provider in tests or to pin an adapter on a given runtime.
   */
  crypto?: CryptoProvider;
}

const SIGNATURE_PREFIX = "sha256=";
const SIGNATURE_HEADER_PATTERN = /^sha256=[a-f0-9]{64}$/;
const HEX_PAIR_PATTERN = /^[0-9a-f]{2}$/;

/**
 * Test-only override hook for the default CryptoProvider factory. When
 * set to a non-null factory, validateWebhookSignature calls it instead
 * of `createCryptoProvider()` whenever `input.crypto` is omitted. This
 * exists so tests can simulate the pathological Edge-runtime case in
 * which both adapters fail capability detection — otherwise the failure
 * path is unreachable from inside a fully-capable Bun/Node test runner.
 *
 * UNDERSCORE PREFIX = NOT PUBLIC API. Do not call this outside tests.
 */
type DefaultCryptoProviderFactory = () => Promise<CryptoProvider>;
let defaultCryptoProviderFactoryOverride: DefaultCryptoProviderFactory | null =
  null;

export function _setDefaultCryptoProviderFactory(
  factory: DefaultCryptoProviderFactory | null
): void {
  defaultCryptoProviderFactoryOverride = factory;
}

async function acquireDefaultCryptoProvider(): Promise<
  | { ok: true; provider: CryptoProvider }
  | { ok: false; error: SignatureValidationError }
> {
  const factory: DefaultCryptoProviderFactory =
    defaultCryptoProviderFactoryOverride ?? createCryptoProvider;
  try {
    const provider = await factory();
    return { ok: true, provider };
  } catch (err) {
    if (err instanceof UnsupportedCapabilityError) {
      return {
        ok: false,
        error: {
          code: "crypto_provider_unavailable",
          message:
            "no CryptoProvider available in this runtime; provide input.crypto explicitly"
        }
      };
    }
    throw err;
  }
}

/**
 * Discriminator for the rawBody type guard. Accepts:
 *   - string
 *   - Uint8Array (most common for body-as-bytes)
 *   - ArrayBuffer
 *   - ArrayBufferView (DataView, typed arrays, Buffer-on-Node/Bun which
 *     implements the ArrayBufferView interface).
 * Rejects everything else (null, undefined, number, boolean, plain
 * object, array, symbol, function).
 *
 * Also rejects typed-array / DataView wrappers whose underlying buffer
 * is a SharedArrayBuffer: such a buffer may be mutated concurrently
 * from another worker thread mid-HMAC (a classic TOCTOU window against
 * signature verification). Callers must copy into a private ArrayBuffer
 * before invoking the verifier.
 */
function isAcceptableRawBody(
  value: unknown
): value is string | Uint8Array | ArrayBuffer | ArrayBufferView {
  if (typeof value === "string") return true;
  if (value instanceof Uint8Array) {
    return !isSharedArrayBufferBacked(value);
  }
  if (value instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(value)) {
    return !isSharedArrayBufferBacked(value);
  }
  return false;
}

/**
 * True when `value` is a typed-array / DataView whose `.buffer` is a
 * SharedArrayBuffer. Guarded by a typeof check so runtimes that do not
 * expose SharedArrayBuffer at all (some locked-down Edge runtimes)
 * don't crash on the instanceof test.
 */
function isSharedArrayBufferBacked(value: ArrayBufferView): boolean {
  if (typeof SharedArrayBuffer === "undefined") return false;
  // `.buffer` is typed as ArrayBufferLike; a SharedArrayBuffer assigns
  // through because the declared type union includes both.
  return (value.buffer as unknown) instanceof SharedArrayBuffer;
}

function describeRawBody(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  // SAB-backed views need an extra-specific label so the caller can
  // distinguish the security-relevant rejection from a plain type
  // mismatch.
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    ArrayBuffer.isView(value) &&
    (value.buffer as unknown) instanceof SharedArrayBuffer
  ) {
    return "SharedArrayBuffer-backed view";
  }
  if (value instanceof Uint8Array) return "Uint8Array";
  return typeof value;
}

/**
 * Normalize an accepted body input to a Uint8Array view of its bytes,
 * preserving byteOffset/byteLength for ArrayBufferViews. Returns a
 * discriminated union so detached-buffer failures surface as typed
 * results rather than raw TypeErrors.
 */
function toBodyBytes(
  body: string | Uint8Array | ArrayBuffer | ArrayBufferView
):
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: SignatureValidationError } {
  if (typeof body === "string") {
    return { ok: true, bytes: new TextEncoder().encode(body) };
  }
  try {
    if (body instanceof Uint8Array) {
      // Touch .byteLength via the underlying buffer to trigger the
      // detached-buffer check proactively; new Uint8Array(detached)
      // below would throw, but a Uint8Array that was constructed
      // before detachment still holds a reference and only throws
      // when re-read. Wrap the access to surface the same typed
      // error path.
      return { ok: true, bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) };
    }
    if (body instanceof ArrayBuffer) {
      return { ok: true, bytes: new Uint8Array(body) };
    }
    // ArrayBufferView (DataView, typed array other than Uint8Array,
    // Buffer-on-Node/Bun): wrap the same memory without copying.
    return {
      ok: true,
      bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    };
  } catch (err) {
    // `new Uint8Array(ab)` on a detached ArrayBuffer throws
    // "TypeError: Buffer is already detached" (Bun/V8). Surface as a
    // typed invalid_raw_body result so the public contract stays
    // honest (no raw throws from a documented validator).
    return {
      ok: false,
      error: {
        code: "invalid_raw_body",
        message: `rawBody buffer is detached: ${describeError(err)}`
      }
    };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Convert a lowercase hex string (already validated by the header
 * regex) to the corresponding Uint8Array. Avoids Buffer entirely so
 * this file stays edge-portable.
 */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    // Defense-in-depth: header regex already constrains input, but an
    // invalid pair here would yield NaN; guard it explicitly.
    if (!HEX_PAIR_PATTERN.test(pair)) {
      // Signal via returning a zero-byte sentinel length-mismatch,
      // which the length-gated timingSafeEqual will reject.
      return new Uint8Array(0);
    }
    out[i] = parseInt(pair, 16);
  }
  return out;
}

export async function validateWebhookSignature(
  input: ValidateWebhookSignatureInput
): Promise<SignatureValidationResult> {
  if (typeof input.appSecret !== "string" || input.appSecret.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid_app_secret",
        message: "App secret must be a non-empty string."
      }
    };
  }

  if (!isAcceptableRawBody(input.rawBody)) {
    return {
      ok: false,
      error: {
        code: "invalid_raw_body",
        message: `rawBody must be string, Uint8Array, ArrayBuffer, or ArrayBufferView backed by a private ArrayBuffer; got ${describeRawBody(input.rawBody)}.`
      }
    };
  }

  if (typeof input.signatureHeader !== "string" || input.signatureHeader.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_signature",
        message: "Missing X-Hub-Signature-256 header."
      }
    };
  }

  if (!SIGNATURE_HEADER_PATTERN.test(input.signatureHeader)) {
    return {
      ok: false,
      error: {
        code: "invalid_signature_format",
        message: "X-Hub-Signature-256 must have format 'sha256=<64 lowercase hex chars>'."
      }
    };
  }

  let provider: CryptoProvider;
  if (input.crypto !== undefined) {
    provider = input.crypto;
  } else {
    const acquired = await acquireDefaultCryptoProvider();
    if (!acquired.ok) {
      return { ok: false, error: acquired.error };
    }
    provider = acquired.provider;
  }

  const bytesResult = toBodyBytes(input.rawBody);
  if (!bytesResult.ok) {
    return { ok: false, error: bytesResult.error };
  }
  const computed = await provider.hmacSha256(input.appSecret, bytesResult.bytes);

  const receivedHex = input.signatureHeader.slice(SIGNATURE_PREFIX.length);
  const receivedBytes = hexToBytes(receivedHex);

  // Length-gate BEFORE timingSafeEqual (providers that throw on length
  // mismatch stay well-behaved; providers that don't stay constant-time
  // on the branches that matter — both received from the attacker).
  if (computed.byteLength !== receivedBytes.byteLength
      || !provider.timingSafeEqual(computed, receivedBytes)) {
    return {
      ok: false,
      error: {
        code: "signature_mismatch",
        message: "X-Hub-Signature-256 does not match payload digest."
      }
    };
  }

  return { ok: true };
}
