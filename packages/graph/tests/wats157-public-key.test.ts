// WATS-157A — public key get/set admin helpers (whatsapp_business_encryption).
//
// Behavioral tests for the WATS-157 Slice A surface. The setter matches
// pywa's proven form-encoded wire contract; the getter response shape is
// UNVERIFIED live and typed tolerantly. Tests use MockTransport only.

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient,
  getBusinessPublicKey,
  setBusinessPublicKey,
  type BusinessPublicKeyResponse,
  type BusinessPublicKeyUpdateResponse
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec) {
  const handle = createMockTransport(
    Array.isArray(responses) ? { responses } : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function ok(body: object = { id: "ok" }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

// A realistic-looking RSA-2048 PUBLIC key PEM. This is a PUBLIC key (not a
// secret) — safe to embed. The base64 body is dummy content; validation only
// checks armor markers, length, and absence of NUL/CR.
const PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0R3Oxi+dummy/DUMMYBASE64BODY",
  "Xy7nQw9kZpM3vL2hT8aF1cB5eJ0rU6sW4mNqP7dGtHbKaCfYoEiVxRzL1mOpD3jN5tS8uW",
  "-----END PUBLIC KEY-----"
].join("\n");

const unsafePathValues = [
  null,
  undefined,
  "",
  "   ",
  123,
  {},
  [],
  "bad\r",
  "bad\n",
  "bad\u0000",
  "bad\u007f",
  ".",
  "..",
  "a/b",
  "a\\b",
  "a?b",
  "a#b",
  "%2e%2e",
  "%252e%252e",
  "%2f",
  "%252f",
  "%5c",
  "%255c",
  "%250a",
  "%25250a",
  "%25252525252525252561"
] as const;

describe("WATS-157A public key get/set", () => {
  test("direct GET builds the exact URL and parses business_public_key", async () => {
    const { client, handle } = clientWith([
      ok({ business_public_key: PEM, id: "pn-1" })
    ]);

    const res: BusinessPublicKeyResponse = await getBusinessPublicKey(client, {
      phoneNumberId: "pn-1",
      fields: ["about", "address"]
    });

    expect(res.business_public_key).toBe(PEM);
    expect(res.id).toBe("pn-1");
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/pn-1/whatsapp_business_encryption?fields=about%2Caddress"
    ]);
  });

  test("direct GET omits the fields query param when not provided", async () => {
    const { client, handle } = clientWith([ok({ business_public_key: PEM })]);
    await getBusinessPublicKey(client, { phoneNumberId: "pn-1" });
    expect(handle.requests.map((r) => r.url)).toEqual([
      "https://graph.facebook.com/v25.0/pn-1/whatsapp_business_encryption"
    ]);
  });

  test("direct SET POSTs a form-encoded business_public_key body with the form content-type", async () => {
    const { client, handle } = clientWith([ok({ success: true })]);

    const res: BusinessPublicKeyUpdateResponse = await setBusinessPublicKey(client, {
      phoneNumberId: "pn-1",
      businessPublicKey: PEM
    });

    expect(res.success).toBe(true);
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/pn-1/whatsapp_business_encryption"
    ]);

    const req = handle.requests[0]!;
    // The body is a URLSearchParams instance (passed through by the client).
    expect(req.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const bodyString = String(req.body);
    expect(bodyString.startsWith("business_public_key=")).toBe(true);
    // Round-trip the form-encoded body and confirm the PEM survives verbatim.
    const decoded = new URLSearchParams(bodyString).get("business_public_key");
    expect(decoded).toBe(PEM);
  });

  test("scoped PhoneNumberClient.getBusinessPublicKey / setBusinessPublicKey inject the bound phoneNumberId and ignore caller overrides", async () => {
    const { client, handle } = clientWith([
      ok({ business_public_key: PEM }),
      ok({ success: true })
    ]);
    const phone = new PhoneNumberClient({
      graphClient: client,
      phoneNumberId: "BOUND-PHONE"
    });

    await phone.getBusinessPublicKey({
      phoneNumberId: "OVERRIDE",
      fields: ["about"]
    } as never);
    await phone.setBusinessPublicKey({
      phoneNumberId: "OVERRIDE",
      businessPublicKey: PEM
    } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/BOUND-PHONE/whatsapp_business_encryption?fields=about",
      "POST https://graph.facebook.com/v25.0/BOUND-PHONE/whatsapp_business_encryption"
    ]);

    const setBody = new URLSearchParams(String(handle.requests[1]!.body)).get(
      "business_public_key"
    );
    expect(setBody).toBe(PEM);
  });

  test("phoneNumberId unsafe values are rejected before transport (GET + SET)", async () => {
    const { client, handle } = clientWith(ok({ success: true }));

    for (const bad of unsafePathValues) {
      await expect(
        getBusinessPublicKey(client, {
          phoneNumberId: bad as never,
          fields: ["about"]
        } as never)
      ).rejects.toThrow(GraphRequestValidationError);
      await expect(
        setBusinessPublicKey(client, {
          phoneNumberId: bad as never,
          businessPublicKey: PEM
        } as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("businessPublicKey validation rejects empty, non-string, missing armor, oversize, NUL, and CR before transport", async () => {
    const { client, handle } = clientWith(ok({ success: true }));

    const missingBegin = PEM.replace(
      "-----BEGIN PUBLIC KEY-----",
      "-----BEGIN CERTIFICATE-----"
    );
    const missingEnd = PEM.replace(
      "-----END PUBLIC KEY-----",
      "-----END CERTIFICATE-----"
    );
    const oversize =
      "-----BEGIN PUBLIC KEY-----\n" +
      "A".repeat(4096 + 10) +
      "\n-----END PUBLIC KEY-----";

    const badValues: readonly unknown[] = [
      "",
      "   ",
      123,
      null,
      {},
      [],
      missingBegin,
      missingEnd,
      oversize,
      PEM + "\0",
      PEM.replace(/\n/g, "\r\n")
    ];

    for (const bad of badValues) {
      await expect(
        setBusinessPublicKey(client, {
          phoneNumberId: "pn-1",
          businessPublicKey: bad as never
        } as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }

    // Missing required businessPublicKey entirely.
    await expect(
      setBusinessPublicKey(client, {
        phoneNumberId: "pn-1"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });

  test("validation error messages never echo the caller-supplied PEM body", async () => {
    const { client } = clientWith(ok({ success: true }));
    const marker = "DUMMYBASE64BODY";

    for (const bad of [
      PEM.replace("-----BEGIN PUBLIC KEY-----", "-----BEGIN CERTIFICATE-----"),
      PEM.replace("-----END PUBLIC KEY-----", "-----END CERTIFICATE-----"),
      "-----BEGIN PUBLIC KEY-----\n" + "A".repeat(4096 + 10) + "\n-----END PUBLIC KEY-----"
    ]) {
      let thrown: unknown;
      try {
        await setBusinessPublicKey(client, {
          phoneNumberId: "pn-1",
          businessPublicKey: bad
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect((thrown as Error).message).not.toContain(marker);
    }
  });
});
