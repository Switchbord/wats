// @wats/http — webhook verify-challenge handler built on the
// @wats/crypto CryptoProvider seam. Zero static `node:*` imports and
// zero `Buffer` references — edge-portable.

import {
  UnsupportedCapabilityError,
  createCryptoProvider,
  type CryptoProvider
} from "@wats/crypto";

export type WebhookChallengeErrorCode =
  | "invalid_expected_verify_token"
  | "invalid_mode"
  | "invalid_verify_token"
  | "missing_challenge"
  | "crypto_provider_unavailable";

/**
 * Alias that matches the naming used in the public error-taxonomy
 * docs (docs/reference/errors.md). `WebhookChallengeErrorCode` is the
 * original union from F-3's initial landing; the alias is exported so
 * downstream consumers can pick either spelling.
 */
export type VerifyWebhookChallengeErrorCode = WebhookChallengeErrorCode;

export interface WebhookChallengeError {
  code: WebhookChallengeErrorCode;
  status: 400 | 403 | 500;
  message: string;
}

export type WebhookChallengeResult =
  | {
      ok: true;
      challenge: string;
    }
  | {
      ok: false;
      error: WebhookChallengeError;
    };

export interface VerifyWebhookChallengeInput {
  mode: string | null | undefined;
  challenge: string | null | undefined;
  verifyToken: string | null | undefined;
  expectedVerifyToken: string;
  /**
   * Optional CryptoProvider injection. Defaults to createCryptoProvider()
   * (auto-detected Node/Bun-vs-WebCrypto adapter).
   */
  crypto?: CryptoProvider;
}

/**
 * Test-only override hook for the default CryptoProvider factory. When
 * non-null, verifyWebhookChallenge calls this factory instead of
 * `createCryptoProvider()` whenever `input.crypto` is omitted. Exists
 * so tests can simulate the pathological Edge-runtime case in which
 * both adapters fail capability detection — otherwise that failure
 * path is unreachable from inside a fully-capable Bun/Node runner.
 *
 * UNDERSCORE PREFIX = NOT PUBLIC API.
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
  | { ok: false; error: WebhookChallengeError }
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
          status: 500,
          message:
            "no CryptoProvider available in this runtime; provide input.crypto explicitly"
        }
      };
    }
    throw err;
  }
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyTrimmedString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function safeCompareTokens(
  provider: CryptoProvider,
  expectedToken: string,
  receivedToken: string
): boolean {
  const expected = encodeUtf8(expectedToken);
  const received = encodeUtf8(receivedToken);
  // Length-gate preserves existing semantics: tokens of differing
  // lengths are rejected without consulting the constant-time compare
  // (both sides are attacker-influenced; the length-gate protects the
  // underlying primitive, not the secret).
  if (expected.byteLength !== received.byteLength) {
    return false;
  }
  return provider.timingSafeEqual(expected, received);
}

export async function verifyWebhookChallenge(
  input: VerifyWebhookChallengeInput
): Promise<WebhookChallengeResult> {
  if (!isNonEmptyTrimmedString(input.expectedVerifyToken)) {
    return {
      ok: false,
      error: {
        code: "invalid_expected_verify_token",
        status: 500,
        message: "Configured webhook verify token must be a non-empty string."
      }
    };
  }

  if (input.mode !== "subscribe") {
    return {
      ok: false,
      error: {
        code: "invalid_mode",
        status: 403,
        message: "Webhook challenge mode must be 'subscribe'."
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

  if (
    typeof input.verifyToken !== "string"
    || !safeCompareTokens(provider, input.expectedVerifyToken, input.verifyToken)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid_verify_token",
        status: 403,
        message: "Webhook verify token does not match configured token."
      }
    };
  }

  if (!isNonEmptyString(input.challenge)) {
    return {
      ok: false,
      error: {
        code: "missing_challenge",
        status: 400,
        message: "Webhook challenge must be a non-empty string."
      }
    };
  }

  return {
    ok: true,
    challenge: input.challenge
  };
}
