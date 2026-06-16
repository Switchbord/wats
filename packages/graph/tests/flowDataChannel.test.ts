// WATS-76 slice B — behavioral tests for the Flow encrypted data-channel runtime.
//
// Every test drives a REAL encrypt→decrypt round-trip using an in-test RSA-OAEP
// keypair (generated per-suite via SubtleCrypto; no checked-in secrets) and the
// real createCryptoProvider() — never a mock. Coverage:
//   - decryptRequest recovers the camelCase FlowRequest from a Meta-shape body
//     (snake_case wire keys); flow_token→flowToken, ""→no screen, {}→no data.
//   - encryptResponse → decrypt-back round-trip (the response IV is the request
//     IV XOR 0xFF, body = base64(ciphertext+tag)).
//   - handleFlowRequest dispatch: ping → {data:{status:active}}, error-ack,
//     normal handler, and close/complete payloads.
//   - the malformed-payload → FlowRequestDecryptionError → 421 matrix (missing
//     fields, bad base64, truncated GCM, wrong key, non-JSON, prototype keys).
//   - 427 (FlowTokenNoLongerValid) and 500 (unhandled) status mapping.
//   - the adversarial battery: typed error never a host throw; no key/iv/
//     plaintext echoed in the 421 body; __proto__ guard on parsed JSON.

import { describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@wats/crypto";
import type { CryptoProvider } from "@wats/crypto";
import {
  FLOW_ENDPOINT_STATUS,
  FlowCryptoUnavailableError,
  FlowRequestDecryptionError,
  FlowTokenNoLongerValidError,
  buildFlowCloseResponse,
  buildFlowScreenResponse,
  decryptRequest,
  encryptResponse,
  flowRequestHasError,
  handleFlowRequest
} from "../src/endpoints/flows/index.js";
import type { FlowRequest, FlowResponsePayload } from "../src/endpoints/flows/index.js";

const TEXT = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const x of bytes) binary += String.fromCharCode(x);
  return btoa(binary);
}

function b64decode(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// ── Per-suite test harness: one throwaway RSA keypair + AES key. ─────────────

interface Harness {
  crypto: CryptoProvider;
  privateKeyJwk: JsonWebKey;
  aesKey: Uint8Array;
  // Build a Meta-shape encrypted request body for an arbitrary plaintext object.
  encryptRequest: (plaintext: unknown, ivByte?: number) => Promise<{
    encrypted_flow_data: string;
    encrypted_aes_key: string;
    initial_vector: string;
    iv: Uint8Array;
  }>;
  publicEncrypt: (aesKey: Uint8Array) => Promise<Uint8Array>;
}

async function makeHarness(): Promise<Harness> {
  const subtle = globalThis.crypto.subtle;
  const pair = (await subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt"]
  )) as CryptoKeyPair;
  const privateKeyJwk = (await subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const crypto = await createCryptoProvider();
  const aesKey = new Uint8Array(16);
  globalThis.crypto.getRandomValues(aesKey);

  const publicEncrypt = async (key: Uint8Array): Promise<Uint8Array> => {
    // Copy into a view explicitly backed by a (non-shared) ArrayBuffer so the arg
    // satisfies BufferSource under @types/bun strict typing.
    const buf = new ArrayBuffer(key.byteLength);
    new Uint8Array(buf).set(key);
    return new Uint8Array(await subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, buf));
  };

  const encryptRequest = async (plaintext: unknown, ivByte = 0x42) => {
    const iv = new Uint8Array(12).fill(ivByte);
    const data = TEXT.encode(JSON.stringify(plaintext));
    const { ciphertext, authTag } = await crypto.aesGcmEncrypt!(aesKey, iv, data);
    const encryptedAesKey = await publicEncrypt(aesKey);
    return {
      // The Flow scheme appends the 16-byte tag AFTER the ciphertext.
      encrypted_flow_data: b64(concat(ciphertext, authTag)),
      encrypted_aes_key: b64(encryptedAesKey),
      initial_vector: b64(iv),
      iv
    };
  };

  return { crypto, privateKeyJwk, aesKey, encryptRequest, publicEncrypt };
}

// ── decryptRequest: happy path + field normalisation ─────────────────────────

describe("decryptRequest — recovers a camelCase FlowRequest from a Meta-shape body", () => {
  test("maps flow_token→flowToken, keeps version/action/screen/data", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({
      version: "3.0",
      action: "data_exchange",
      flow_token: "tok-123",
      screen: "WELCOME",
      data: { picked: "blue", count: 2 }
    });

    const { request, aesKey, iv } = await decryptRequest(h.crypto, body, h.privateKeyJwk);

    expect(request.version).toBe("3.0");
    expect(request.action).toBe("data_exchange");
    expect(request.flowToken).toBe("tok-123");
    expect(request.screen).toBe("WELCOME");
    expect(request.data).toEqual({ picked: "blue", count: 2 });
    // The returned AES key + IV are exactly the ones used for the request.
    expect(bytesToHex(aesKey)).toBe(bytesToHex(h.aesKey));
    expect(bytesToHex(iv)).toBe(bytesToHex(body.iv));
  });

  test('"" screen → undefined; {} data → undefined; INIT uppercase preserved', async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({
      version: "3.0",
      action: "INIT",
      flow_token: "abc",
      screen: "",
      data: {}
    });
    const { request } = await decryptRequest(h.crypto, body, h.privateKeyJwk);
    expect(request.action).toBe("INIT");
    expect(request.screen).toBeUndefined();
    expect(request.data).toBeUndefined();
  });

  test("accepts already-camelCase envelope keys too", async () => {
    const h = await makeHarness();
    const wire = await h.encryptRequest({ version: "3.0", action: "ping" });
    const camel = {
      encryptedFlowData: wire.encrypted_flow_data,
      encryptedAesKey: wire.encrypted_aes_key,
      initialVector: wire.initial_vector
    };
    const { request } = await decryptRequest(h.crypto, camel, h.privateKeyJwk);
    expect(request.action).toBe("ping");
  });
});

// ── encryptResponse → decrypt-back round-trip ─────────────────────────────────

describe("encryptResponse — round-trips back to the original object", () => {
  test("response IV is request IV XOR 0xFF; body is base64(ciphertext+tag)", async () => {
    const h = await makeHarness();
    const req = await h.encryptRequest({ version: "3.0", action: "data_exchange" });
    const { aesKey, iv } = await decryptRequest(h.crypto, req, h.privateKeyJwk);

    const response: FlowResponsePayload = buildFlowScreenResponse({
      screen: "NEXT",
      data: { ok: true },
      flowToken: "tok-9"
    }) as unknown as FlowResponsePayload;

    const encoded = await encryptResponse(h.crypto, response, aesKey, iv);
    expect(typeof encoded).toBe("string");

    // Decrypt it back the way a client would: IV = request IV XOR 0xFF.
    const flippedIv = new Uint8Array(iv.length);
    for (let i = 0; i < iv.length; i += 1) flippedIv[i] = (iv[i] as number) ^ 0xff;
    const recovered = await h.crypto.aesGcmDecrypt!(aesKey, flippedIv, b64decode(encoded));
    expect(JSON.parse(new TextDecoder().decode(recovered))).toEqual(
      response as Record<string, unknown>
    );
  });
});

// ── handleFlowRequest dispatch ────────────────────────────────────────────────

async function decryptResult(
  h: Harness,
  aesKey: Uint8Array,
  iv: Uint8Array,
  encodedBody: string
): Promise<Record<string, unknown>> {
  const flippedIv = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i += 1) flippedIv[i] = (iv[i] as number) ^ 0xff;
  const plain = await h.crypto.aesGcmDecrypt!(aesKey, flippedIv, b64decode(encodedBody));
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
}

describe("handleFlowRequest — ping / error-ack / normal / close dispatch", () => {
  test("ping → encrypted { data: { status: active } }, 200", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({ version: "3.0", action: "ping" });
    const handler = () => {
      throw new Error("handler must not be called for ping");
    };
    const res = await handleFlowRequest({
      rawBody: body,
      privateKey: h.privateKeyJwk,
      crypto: h.crypto,
      handler
    });
    expect(res.statusCode).toBe(200);
    expect(res.encrypted).toBe(true);
    const decoded = await decryptResult(h, h.aesKey, body.iv, res.body);
    expect(decoded).toEqual({ data: { status: "active" } });
  });

  test("error-ack (acknowledgeErrors) → { version, data: { acknowledged: true } }, 200", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({
      version: "3.0",
      action: "data_exchange",
      data: { error_message: "boom", error_key: "E1" }
    });
    let handlerCalled = false;
    const res = await handleFlowRequest({
      rawBody: body,
      privateKey: h.privateKeyJwk,
      crypto: h.crypto,
      acknowledgeErrors: true,
      handler: () => {
        handlerCalled = true;
        return {};
      }
    });
    expect(handlerCalled).toBe(false);
    expect(res.statusCode).toBe(200);
    const decoded = await decryptResult(h, h.aesKey, body.iv, res.body);
    expect(decoded).toEqual({ version: "3.0", data: { acknowledged: true } });
  });

  test("has_error WITHOUT acknowledgeErrors still routes to the user handler", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({
      version: "3.0",
      action: "data_exchange",
      data: { error: "x" }
    });
    let seen = false;
    const res = await handleFlowRequest({
      rawBody: body,
      privateKey: h.privateKeyJwk,
      crypto: h.crypto,
      handler: (req: FlowRequest) => {
        seen = true;
        expect(flowRequestHasError(req)).toBe(true);
        return buildFlowScreenResponse({ screen: "RETRY" }) as unknown as FlowResponsePayload;
      }
    });
    expect(seen).toBe(true);
    expect(res.statusCode).toBe(200);
    const decoded = await decryptResult(h, h.aesKey, body.iv, res.body);
    expect(decoded).toEqual({ screen: "RETRY" });
  });

  test("normal handler response is encrypted and round-trips", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({
      version: "3.0",
      action: "navigate",
      flow_token: "tok",
      screen: "ONE"
    });
    const res = await handleFlowRequest({
      rawBody: body,
      privateKey: h.privateKeyJwk,
      crypto: h.crypto,
      handler: (req: FlowRequest) =>
        buildFlowScreenResponse({
          screen: "TWO",
          data: { from: req.screen }
        }) as unknown as FlowResponsePayload
    });
    expect(res.statusCode).toBe(200);
    const decoded = await decryptResult(h, h.aesKey, body.iv, res.body);
    expect(decoded).toEqual({ screen: "TWO", data: { from: "ONE" } });
  });

  test("close/complete response payload round-trips", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({ version: "3.0", action: "data_exchange" });
    const res = await handleFlowRequest({
      rawBody: body,
      privateKey: h.privateKeyJwk,
      crypto: h.crypto,
      handler: () =>
        buildFlowCloseResponse({
          flowToken: "done",
          data: { extension_message_response: { params: { flow_token: "done", ok: 1 } } }
        }) as unknown as FlowResponsePayload
    });
    expect(res.statusCode).toBe(200);
    const decoded = await decryptResult(h, h.aesKey, body.iv, res.body);
    expect(decoded.close_flow).toBe(true);
    expect(decoded.flow_token).toBe("done");
  });
});

// ── 427 / 500 status mapping ──────────────────────────────────────────────────

describe("handleFlowRequest — handler error → status mapping", () => {
  test("FlowTokenNoLongerValidError → 427 plain { error_msg } body", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({ version: "3.0", action: "data_exchange" });
    const res = await handleFlowRequest({
      rawBody: body,
      privateKey: h.privateKeyJwk,
      crypto: h.crypto,
      handler: () => {
        throw new FlowTokenNoLongerValidError("expired");
      }
    });
    expect(res.statusCode).toBe(FLOW_ENDPOINT_STATUS.flowTokenInvalid);
    expect(res.encrypted).toBe(false);
    expect(JSON.parse(res.body)).toEqual({ error_msg: "expired" });
  });

  test("unhandled handler throw → 500 plain body (never a host throw)", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({ version: "3.0", action: "data_exchange" });
    let res: Awaited<ReturnType<typeof handleFlowRequest>> | undefined;
    await expect(
      (async () => {
        res = await handleFlowRequest({
          rawBody: body,
          privateKey: h.privateKeyJwk,
          crypto: h.crypto,
          handler: () => {
            throw new TypeError("kaboom");
          }
        });
      })()
    ).resolves.toBeUndefined();
    expect(res?.statusCode).toBe(FLOW_ENDPOINT_STATUS.serverError);
    expect(res?.encrypted).toBe(false);
  });
});

// ── malformed-payload → typed error → 421 matrix ──────────────────────────────

describe("decryptRequest — malformed payload → FlowRequestDecryptionError (→421)", () => {
  test("missing fields", async () => {
    const h = await makeHarness();
    for (const bad of [
      {},
      { encrypted_flow_data: "AA==" },
      { encrypted_aes_key: "AA==", initial_vector: "AA==" },
      null,
      "not-an-object",
      42,
      [],
      { encrypted_flow_data: 1, encrypted_aes_key: 2, initial_vector: 3 }
    ]) {
      await expect(
        decryptRequest(h.crypto, bad, h.privateKeyJwk)
      ).rejects.toBeInstanceOf(FlowRequestDecryptionError);
    }
  });

  test("bad base64 in any field", async () => {
    const h = await makeHarness();
    const ok = await h.encryptRequest({ version: "3.0", action: "ping" });
    const variants = [
      { ...ok, encrypted_flow_data: "!!!not base64!!!" },
      { ...ok, encrypted_aes_key: "@@@@" },
      { ...ok, initial_vector: "%%%%" },
      { ...ok, encrypted_flow_data: "" }
    ];
    for (const v of variants) {
      await expect(
        decryptRequest(h.crypto, v, h.privateKeyJwk)
      ).rejects.toBeInstanceOf(FlowRequestDecryptionError);
    }
  });

  test("truncated GCM ciphertext (tag corrupted)", async () => {
    const h = await makeHarness();
    const ok = await h.encryptRequest({ version: "3.0", action: "ping" });
    const raw = b64decode(ok.encrypted_flow_data);
    // Flip the last byte (part of the auth tag) → authentication failure.
    raw[raw.length - 1] ^= 0xff;
    const tampered = { ...ok, encrypted_flow_data: b64(raw) };
    await expect(
      decryptRequest(h.crypto, tampered, h.privateKeyJwk)
    ).rejects.toBeInstanceOf(FlowRequestDecryptionError);

    // Also: ciphertext shorter than the 16-byte tag.
    const tooShort = { ...ok, encrypted_flow_data: b64(new Uint8Array(4)) };
    await expect(
      decryptRequest(h.crypto, tooShort, h.privateKeyJwk)
    ).rejects.toBeInstanceOf(FlowRequestDecryptionError);
  });

  test("wrong RSA key cannot unwrap the AES key", async () => {
    const h = await makeHarness();
    const other = await makeHarness(); // different keypair
    const body = await h.encryptRequest({ version: "3.0", action: "ping" });
    await expect(
      decryptRequest(h.crypto, body, other.privateKeyJwk)
    ).rejects.toBeInstanceOf(FlowRequestDecryptionError);
  });

  test("decrypted plaintext is not valid JSON", async () => {
    const h = await makeHarness();
    // Encrypt a non-JSON plaintext under the real AES key.
    const iv = new Uint8Array(12).fill(9);
    const { ciphertext, authTag } = await h.crypto.aesGcmEncrypt!(
      h.aesKey,
      iv,
      TEXT.encode("this is not json {")
    );
    const body = {
      encrypted_flow_data: b64(concat(ciphertext, authTag)),
      encrypted_aes_key: b64(await h.publicEncrypt(h.aesKey)),
      initial_vector: b64(iv)
    };
    await expect(
      decryptRequest(h.crypto, body, h.privateKeyJwk)
    ).rejects.toBeInstanceOf(FlowRequestDecryptionError);
  });

  test("decrypted JSON missing/invalid version or action", async () => {
    const h = await makeHarness();
    for (const bad of [
      { action: "ping" }, // no version
      { version: "3.0" }, // no action
      { version: "3.0", action: "not_a_real_action" },
      { version: 3, action: "ping" },
      "a string payload",
      [1, 2, 3]
    ]) {
      const body = await h.encryptRequest(bad);
      await expect(
        decryptRequest(h.crypto, body, h.privateKeyJwk)
      ).rejects.toBeInstanceOf(FlowRequestDecryptionError);
    }
  });

  test("__proto__ / prototype-pollution keys in decrypted JSON are rejected", async () => {
    const h = await makeHarness();
    // Hand-craft a raw JSON string carrying a literal __proto__ key.
    const malicious = '{"version":"3.0","action":"ping","__proto__":{"polluted":true}}';
    const iv = new Uint8Array(12).fill(3);
    const { ciphertext, authTag } = await h.crypto.aesGcmEncrypt!(
      h.aesKey,
      iv,
      TEXT.encode(malicious)
    );
    const body = {
      encrypted_flow_data: b64(concat(ciphertext, authTag)),
      encrypted_aes_key: b64(await h.publicEncrypt(h.aesKey)),
      initial_vector: b64(iv)
    };
    await expect(
      decryptRequest(h.crypto, body, h.privateKeyJwk)
    ).rejects.toBeInstanceOf(FlowRequestDecryptionError);
    // And the global prototype was NOT polluted.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("handleFlowRequest maps a malformed body to 421 'Decryption failed' (plain, no secrets)", async () => {
    const h = await makeHarness();
    const res = await handleFlowRequest({
      rawBody: { encrypted_flow_data: "bad", encrypted_aes_key: "bad", initial_vector: "bad" },
      privateKey: h.privateKeyJwk,
      crypto: h.crypto,
      handler: () => ({})
    });
    expect(res.statusCode).toBe(FLOW_ENDPOINT_STATUS.decryptionFailure);
    expect(res.encrypted).toBe(false);
    expect(res.body).toBe("Decryption failed");
  });

  test("the 421 error body/message never echoes key, IV, or plaintext", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({
      version: "3.0",
      action: "data_exchange",
      data: { secret: "TOP-SECRET-PLAINTEXT-VALUE" }
    });
    // Corrupt the tag so decrypt fails AFTER we have key material in scope.
    const raw = b64decode(body.encrypted_flow_data);
    raw[raw.length - 1] ^= 0xff;
    let caught: unknown;
    try {
      await decryptRequest(h.crypto, { ...body, encrypted_flow_data: b64(raw) }, h.privateKeyJwk);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FlowRequestDecryptionError);
    const err = caught as FlowRequestDecryptionError;
    expect(err.message).toBe("Flow request could not be decrypted");
    expect(err.message).not.toContain("TOP-SECRET");
    expect(err.message).not.toContain(bytesToHex(h.aesKey));
    expect(err.message).not.toContain(b64(h.aesKey));
  });
});

// ── server-misconfiguration mapping ───────────────────────────────────────────

describe("handleFlowRequest — missing crypto capability → 500 (not 421)", () => {
  test("a provider without rsaOaepDecrypt yields a 500, not a host throw", async () => {
    const h = await makeHarness();
    const body = await h.encryptRequest({ version: "3.0", action: "ping" });
    const crippled = { ...h.crypto, rsaOaepDecrypt: undefined } as unknown as CryptoProvider;
    const res = await handleFlowRequest({
      rawBody: body,
      privateKey: h.privateKeyJwk,
      crypto: crippled,
      handler: () => ({})
    });
    expect(res.statusCode).toBe(FLOW_ENDPOINT_STATUS.serverError);
    // And the direct call surfaces the typed capability error.
    await expect(
      decryptRequest(crippled, body, h.privateKeyJwk)
    ).rejects.toBeInstanceOf(FlowCryptoUnavailableError);
  });
});
