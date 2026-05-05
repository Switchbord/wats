import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  _setDefaultCryptoProviderFactory,
  validateWebhookSignature
} from "../src/signature";
import { UnsupportedCapabilityError } from "@switchbord/crypto";

describe("C1 webhook signature validation", () => {
  const appSecret = "app-secret";
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
  const invalidAppSecretError = {
    code: "invalid_app_secret",
    message: "App secret must be a non-empty string."
  } as const;

  function buildHeader(body: string): string {
    const digest = createHmac("sha256", appSecret).update(body).digest("hex");
    return `sha256=${digest}`;
  }

  test("returns ok for valid x-hub-signature-256 header", async () => {
    const result = await validateWebhookSignature({
      appSecret,
      rawBody,
      signatureHeader: buildHeader(rawBody)
    });

    expect(result).toEqual({ ok: true });
  });

  test("rejects missing signature header", async () => {
    const result = await validateWebhookSignature({
      appSecret,
      rawBody,
      signatureHeader: undefined
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_signature",
        message: "Missing X-Hub-Signature-256 header."
      }
    });
  });

  test("rejects empty app secret", async () => {
    const result = await validateWebhookSignature({
      appSecret: "",
      rawBody,
      signatureHeader: buildHeader(rawBody)
    });

    expect(result).toEqual({
      ok: false,
      error: invalidAppSecretError
    });
  });

  test("rejects whitespace-only app secret", async () => {
    const result = await validateWebhookSignature({
      appSecret: "   ",
      rawBody,
      signatureHeader: buildHeader(rawBody)
    });

    expect(result).toEqual({
      ok: false,
      error: invalidAppSecretError
    });
  });

  test("returns typed invalid_app_secret for undefined/non-string app secret without throwing", async () => {
    const malformedInputs = [
      { appSecret: undefined as unknown as string },
      { appSecret: 123 as unknown as string }
    ];

    for (const malformedInput of malformedInputs) {
      let thrown: unknown;
      let result: Awaited<ReturnType<typeof validateWebhookSignature>> | undefined;

      try {
        result = await validateWebhookSignature({
          ...malformedInput,
          rawBody,
          signatureHeader: buildHeader(rawBody)
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeUndefined();
      expect(result).toEqual({
        ok: false,
        error: invalidAppSecretError
      });
    }
  });

  test("rejects malformed signature header", async () => {
    const result = await validateWebhookSignature({
      appSecret,
      rawBody,
      signatureHeader: "sha1=abcd"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_signature_format",
        message: "X-Hub-Signature-256 must have format 'sha256=<64 lowercase hex chars>'."
      }
    });
  });

  test("rejects invalid signature digest", async () => {
    const result = await validateWebhookSignature({
      appSecret,
      rawBody,
      signatureHeader: "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "signature_mismatch",
        message: "X-Hub-Signature-256 does not match payload digest."
      }
    });
  });

  test("accepts ArrayBufferView payloads", async () => {
    const rawBodyBytes = new TextEncoder().encode(rawBody);

    const result = await validateWebhookSignature({
      appSecret,
      rawBody: rawBodyBytes,
      signatureHeader: buildHeader(rawBody)
    });

    expect(result).toEqual({ ok: true });
  });
});

describe("F-3 rawBody type guard (invalid_raw_body)", () => {
  const appSecret = "app-secret";
  const body = JSON.stringify({ hello: "world" });

  function buildHeader(b: string): string {
    const digest = createHmac("sha256", appSecret).update(b).digest("hex");
    return `sha256=${digest}`;
  }

  const header = buildHeader(body);

  const invalidCases: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["plain object", { not: "a body" }],
    ["boolean", true],
    ["array of numbers", [1, 2, 3]],
    ["symbol", Symbol("x")],
    ["function", () => "body"]
  ];

  for (const [label, value] of invalidCases) {
    test(`rejects ${label} rawBody with invalid_raw_body (no throw)`, async () => {
      let thrown: unknown;
      let result: Awaited<ReturnType<typeof validateWebhookSignature>> | undefined;

      try {
        result = await validateWebhookSignature({
          appSecret,
          rawBody: value as never,
          signatureHeader: header
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeUndefined();
      expect(result?.ok).toBe(false);
      if (result && result.ok === false) {
        expect(result.error.code).toBe("invalid_raw_body");
        expect(typeof result.error.message).toBe("string");
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  }

  test("accepts empty string rawBody (empty body is legitimate)", async () => {
    const result = await validateWebhookSignature({
      appSecret,
      rawBody: "",
      signatureHeader: buildHeader("")
    });
    expect(result).toEqual({ ok: true });
  });

  test("accepts whitespace-only string rawBody", async () => {
    const ws = "   \n\t";
    const result = await validateWebhookSignature({
      appSecret,
      rawBody: ws,
      signatureHeader: buildHeader(ws)
    });
    expect(result).toEqual({ ok: true });
  });

  test("accepts ArrayBuffer rawBody", async () => {
    const bytes = new TextEncoder().encode(body);
    // Produce a standalone ArrayBuffer (copy so offset/length match full buffer).
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const result = await validateWebhookSignature({
      appSecret,
      rawBody: ab,
      signatureHeader: buildHeader(body)
    });
    expect(result).toEqual({ ok: true });
  });

  test("accepts DataView rawBody (ArrayBufferView)", async () => {
    const bytes = new TextEncoder().encode(body);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = await validateWebhookSignature({
      appSecret,
      rawBody: dv,
      signatureHeader: buildHeader(body)
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("F-3 remediation: SharedArrayBuffer-backed rawBody rejection", () => {
  const appSecret = "app-secret";
  const body = JSON.stringify({ hello: "world" });
  function buildHeader(b: string): string {
    const digest = createHmac("sha256", appSecret).update(b).digest("hex");
    return `sha256=${digest}`;
  }
  const header = buildHeader(body);
  const sabAvailable = typeof SharedArrayBuffer !== "undefined";

  test.skipIf(!sabAvailable)(
    "rejects Uint8Array whose backing buffer is a SharedArrayBuffer",
    async () => {
      const sab = new SharedArrayBuffer(16);
      const u8 = new Uint8Array(sab);
      let thrown: unknown;
      let result: Awaited<ReturnType<typeof validateWebhookSignature>> | undefined;
      try {
        result = await validateWebhookSignature({
          appSecret,
          rawBody: u8,
          signatureHeader: header
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeUndefined();
      expect(result?.ok).toBe(false);
      if (result && result.ok === false) {
        expect(result.error.code).toBe("invalid_raw_body");
        expect(result.error.message.toLowerCase()).toContain("sharedarraybuffer");
      }
    }
  );

  test.skipIf(!sabAvailable)(
    "rejects DataView whose backing buffer is a SharedArrayBuffer",
    async () => {
      const sab = new SharedArrayBuffer(16);
      const dv = new DataView(sab);
      let thrown: unknown;
      let result: Awaited<ReturnType<typeof validateWebhookSignature>> | undefined;
      try {
        result = await validateWebhookSignature({
          appSecret,
          rawBody: dv,
          signatureHeader: header
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeUndefined();
      expect(result?.ok).toBe(false);
      if (result && result.ok === false) {
        expect(result.error.code).toBe("invalid_raw_body");
        expect(result.error.message.toLowerCase()).toContain("sharedarraybuffer");
      }
    }
  );
});

describe("F-3 remediation: detached-buffer rawBody rejection", () => {
  const appSecret = "app-secret";
  const body = JSON.stringify({ hello: "world" });
  function buildHeader(b: string): string {
    const digest = createHmac("sha256", appSecret).update(b).digest("hex");
    return `sha256=${digest}`;
  }
  const header = buildHeader(body);

  function makeDetachedArrayBuffer(): ArrayBuffer {
    const ab = new ArrayBuffer(4);
    const mc = new MessageChannel();
    try {
      mc.port1.postMessage(ab, [ab]);
    } finally {
      mc.port1.close();
      mc.port2.close();
    }
    return ab;
  }

  test("rejects a detached ArrayBuffer with invalid_raw_body (no throw)", async () => {
    const ab = makeDetachedArrayBuffer();
    let thrown: unknown;
    let result: Awaited<ReturnType<typeof validateWebhookSignature>> | undefined;
    try {
      result = await validateWebhookSignature({
        appSecret,
        rawBody: ab,
        signatureHeader: header
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeUndefined();
    expect(result?.ok).toBe(false);
    if (result && result.ok === false) {
      expect(result.error.code).toBe("invalid_raw_body");
      expect(result.error.message.toLowerCase()).toContain("detached");
    }
  });

  test("rejects an ArrayBufferView wrapping a detached buffer with invalid_raw_body (no throw)", async () => {
    // Build a live view first, then detach the underlying buffer by
    // transferring it via postMessage. The Uint8Array wrapper now
    // references a detached buffer.
    const ab = new ArrayBuffer(8);
    const view = new Uint8Array(ab);
    const mc = new MessageChannel();
    try {
      mc.port1.postMessage(ab, [ab]);
    } finally {
      mc.port1.close();
      mc.port2.close();
    }
    let thrown: unknown;
    let result: Awaited<ReturnType<typeof validateWebhookSignature>> | undefined;
    try {
      result = await validateWebhookSignature({
        appSecret,
        rawBody: view,
        signatureHeader: header
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeUndefined();
    expect(result?.ok).toBe(false);
    if (result && result.ok === false) {
      expect(result.error.code).toBe("invalid_raw_body");
      expect(result.error.message.toLowerCase()).toContain("detached");
    }
  });
});

describe("F-3 remediation: crypto_provider_unavailable escape hatch", () => {
  const appSecret = "app-secret";
  const body = JSON.stringify({ hello: "world" });
  function buildHeader(b: string): string {
    const digest = createHmac("sha256", appSecret).update(b).digest("hex");
    return `sha256=${digest}`;
  }
  const header = buildHeader(body);

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
    let result: Awaited<ReturnType<typeof validateWebhookSignature>> | undefined;
    try {
      result = await validateWebhookSignature({
        appSecret,
        rawBody: body,
        signatureHeader: header
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeUndefined();
    expect(result?.ok).toBe(false);
    if (result && result.ok === false) {
      expect(result.error.code).toBe("crypto_provider_unavailable");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  test("explicit input.crypto bypasses the default factory and still succeeds when the factory is poisoned", async () => {
    _setDefaultCryptoProviderFactory(async () => {
      throw new UnsupportedCapabilityError("poisoned");
    });

    // Wire up a real provider via createCryptoProvider - but through the
    // input.crypto path which MUST NOT touch the default factory.
    const { createCryptoProvider } = await import("@switchbord/crypto");
    const provider = await createCryptoProvider();

    const result = await validateWebhookSignature({
      appSecret,
      rawBody: body,
      signatureHeader: header,
      crypto: provider
    });

    expect(result).toEqual({ ok: true });
  });
});
