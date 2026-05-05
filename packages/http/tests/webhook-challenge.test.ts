import { afterEach, describe, expect, test } from "bun:test";
import {
  _setDefaultCryptoProviderFactory,
  verifyWebhookChallenge
} from "../src/webhookServer";
import { UnsupportedCapabilityError } from "@switchbord/crypto";

describe("C1 webhook challenge verification", () => {
  const invalidExpectedVerifyTokenError = {
    code: "invalid_expected_verify_token",
    status: 500,
    message: "Configured webhook verify token must be a non-empty string."
  } as const;

  test("returns challenge when mode and verify token are valid", async () => {
    const result = await verifyWebhookChallenge({
      mode: "subscribe",
      challenge: "abc123",
      verifyToken: "expected-token",
      expectedVerifyToken: "expected-token"
    });

    expect(result).toEqual({
      ok: true,
      challenge: "abc123"
    });
  });

  test("rejects unsupported challenge mode", async () => {
    const result = await verifyWebhookChallenge({
      mode: "unsubscribe",
      challenge: "abc123",
      verifyToken: "expected-token",
      expectedVerifyToken: "expected-token"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_mode",
        status: 403,
        message: "Webhook challenge mode must be 'subscribe'."
      }
    });
  });

  test("rejects verify token mismatches", async () => {
    const result = await verifyWebhookChallenge({
      mode: "subscribe",
      challenge: "abc123",
      verifyToken: "wrong-token",
      expectedVerifyToken: "expected-token"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_verify_token",
        status: 403,
        message: "Webhook verify token does not match configured token."
      }
    });
  });

  test("rejects verify token mismatches for same-length tokens", async () => {
    const result = await verifyWebhookChallenge({
      mode: "subscribe",
      challenge: "abc123",
      verifyToken: "expected-tokenx",
      expectedVerifyToken: "expected-tokeny"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_verify_token",
        status: 403,
        message: "Webhook verify token does not match configured token."
      }
    });
  });

  test("rejects missing configured expected verify token", async () => {
    const result = await verifyWebhookChallenge({
      mode: "subscribe",
      challenge: "abc123",
      verifyToken: "expected-token",
      expectedVerifyToken: ""
    });

    expect(result).toEqual({
      ok: false,
      error: invalidExpectedVerifyTokenError
    });
  });

  test("rejects whitespace-only configured expected verify token", async () => {
    const result = await verifyWebhookChallenge({
      mode: "subscribe",
      challenge: "abc123",
      verifyToken: "expected-token",
      expectedVerifyToken: "  "
    });

    expect(result).toEqual({
      ok: false,
      error: invalidExpectedVerifyTokenError
    });
  });

  test("rejects non-string configured expected verify token", async () => {
    const result = await verifyWebhookChallenge({
      mode: "subscribe",
      challenge: "abc123",
      verifyToken: "expected-token",
      expectedVerifyToken: 42 as unknown as string
    });

    expect(result).toEqual({
      ok: false,
      error: invalidExpectedVerifyTokenError
    });
  });

  test("rejects missing challenge values", async () => {
    const result = await verifyWebhookChallenge({
      mode: "subscribe",
      challenge: "",
      verifyToken: "expected-token",
      expectedVerifyToken: "expected-token"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_challenge",
        status: 400,
        message: "Webhook challenge must be a non-empty string."
      }
    });
  });
});

describe("F-3 remediation: verifyWebhookChallenge crypto_provider_unavailable", () => {
  afterEach(() => {
    _setDefaultCryptoProviderFactory(null);
  });

  test("returns typed crypto_provider_unavailable when the default factory throws UnsupportedCapabilityError", async () => {
    _setDefaultCryptoProviderFactory(async () => {
      throw new UnsupportedCapabilityError(
        "no usable CryptoProvider adapter found (test-injected)"
      );
    });

    let thrown: unknown;
    let result: Awaited<ReturnType<typeof verifyWebhookChallenge>> | undefined;
    try {
      result = await verifyWebhookChallenge({
        mode: "subscribe",
        challenge: "abc123",
        verifyToken: "expected-token",
        expectedVerifyToken: "expected-token"
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeUndefined();
    expect(result?.ok).toBe(false);
    if (result && result.ok === false) {
      expect(result.error.code).toBe("crypto_provider_unavailable");
      expect(result.error.status).toBe(500);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});
