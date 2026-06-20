import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient,
  WABAClient,
  createPhoneNumber,
  deregisterPhoneNumber,
  registerPhoneNumber,
  requestVerificationCode,
  setTwoStepVerificationPin,
  verifyPhoneNumber,
  type CreatePhoneNumberResponse,
  type DeregisterPhoneNumberResponse,
  type RegisterPhoneNumberResponse,
  type RequestVerificationCodeResponse,
  type SetTwoStepVerificationPinResponse,
  type VerifyPhoneNumberResponse
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

function ok(body: object = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

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
  "%252f"
] as const;

describe("WATS-155 phone registration wire shapes", () => {
  test("all six endpoints build exact method/url/body/query shapes", async () => {
    const { client, handle } = clientWith([
      ok({ id: "pn-new" }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true })
    ]);

    const created: CreatePhoneNumberResponse = await createPhoneNumber(client, {
      wabaId: "WABA-1",
      countryCode: "1",
      phoneNumber: "5551234567",
      verifiedName: "Acme"
    });
    const code: RequestVerificationCodeResponse = await requestVerificationCode(client, {
      phoneNumberId: "pn-1",
      codeMethod: "SMS",
      language: "en"
    });
    const verified: VerifyPhoneNumberResponse = await verifyPhoneNumber(client, {
      phoneNumberId: "pn-1",
      code: "123456"
    });
    const registered: RegisterPhoneNumberResponse = await registerPhoneNumber(client, {
      phoneNumberId: "pn-1",
      pin: "123456"
    });
    const registeredRegion: RegisterPhoneNumberResponse = await registerPhoneNumber(client, {
      phoneNumberId: "pn-1",
      pin: "123456",
      dataLocalizationRegion: "US"
    });
    const deregistered: DeregisterPhoneNumberResponse = await deregisterPhoneNumber(client, {
      phoneNumberId: "pn-1"
    });
    const pinSet: SetTwoStepVerificationPinResponse = await setTwoStepVerificationPin(client, {
      phoneNumberId: "pn-1",
      pin: "123456"
    });

    expect(created.id).toBe("pn-new");
    expect(code.success).toBe(true);
    expect(verified.success).toBe(true);
    expect(registered.success).toBe(true);
    expect(registeredRegion.success).toBe(true);
    expect(deregistered.success).toBe(true);
    expect(pinSet.success).toBe(true);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/WABA-1/phone_numbers",
      "POST https://graph.facebook.com/v25.0/pn-1/request_code?code_method=SMS&language=en",
      "POST https://graph.facebook.com/v25.0/pn-1/verify_code?code=123456",
      "POST https://graph.facebook.com/v25.0/pn-1/register",
      "POST https://graph.facebook.com/v25.0/pn-1/register",
      "POST https://graph.facebook.com/v25.0/pn-1/deregister",
      "POST https://graph.facebook.com/v25.0/pn-1"
    ]);

    expect(parseBody(handle.requests[0]?.body)).toEqual({
      country_code: "1",
      phone_number: "5551234567",
      verified_name: "Acme"
    });
    // request_code: no body
    expect(handle.requests[1]?.body).toBeFalsy();
    // verify_code: no body
    expect(handle.requests[2]?.body).toBeFalsy();
    expect(parseBody(handle.requests[3]?.body)).toEqual({
      messaging_product: "whatsapp",
      pin: "123456"
    });
    expect(parseBody(handle.requests[4]?.body)).toEqual({
      messaging_product: "whatsapp",
      pin: "123456",
      data_localization_region: "US"
    });
    // deregister: no body
    expect(handle.requests[5]?.body).toBeFalsy();
    expect(parseBody(handle.requests[6]?.body)).toEqual({
      two_step_verification: { pin: "123456" }
    });
  });
});

describe("WATS-155 scoped client id injection", () => {
  test("WABAClient.createPhoneNumber injects bound wabaId and ignores caller override", async () => {
    const { client, handle } = clientWith([ok({ id: "pn-new" })]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });

    await waba.createPhoneNumber({
      wabaId: "OVERRIDE",
      countryCode: "1",
      phoneNumber: "5551234567",
      verifiedName: "Acme"
    } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/BOUND-WABA/phone_numbers"
    ]);
  });

  test("PhoneNumberClient injects bound phoneNumberId for the five phone-scoped endpoints", async () => {
    const { client, handle } = clientWith([
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true })
    ]);
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PN" });

    await phone.requestVerificationCode({ phoneNumberId: "OVERRIDE", codeMethod: "SMS", language: "en" } as never);
    await phone.verifyPhoneNumber({ phoneNumberId: "OVERRIDE", code: "123456" } as never);
    await phone.registerPhoneNumber({ phoneNumberId: "OVERRIDE", pin: "123456" } as never);
    await phone.deregisterPhoneNumber({ phoneNumberId: "OVERRIDE" } as never);
    await phone.setTwoStepVerificationPin({ phoneNumberId: "OVERRIDE", pin: "123456" } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/BOUND-PN/request_code?code_method=SMS&language=en",
      "POST https://graph.facebook.com/v25.0/BOUND-PN/verify_code?code=123456",
      "POST https://graph.facebook.com/v25.0/BOUND-PN/register",
      "POST https://graph.facebook.com/v25.0/BOUND-PN/deregister",
      "POST https://graph.facebook.com/v25.0/BOUND-PN"
    ]);
  });
});

describe("WATS-155 validation rejects malformed inputs before transport", () => {
  test("createPhoneNumber rejects unsafe wabaId and bad countryCode/phoneNumber/verifiedName", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(createPhoneNumber(client, {
        wabaId: bad as never,
        countryCode: "1",
        phoneNumber: "5551234567",
        verifiedName: "Acme"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badCode of ["", "abc", "1234567", 123, "1/2"]) {
      await expect(createPhoneNumber(client, {
        wabaId: "WABA-1",
        countryCode: badCode as never,
        phoneNumber: "5551234567",
        verifiedName: "Acme"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badNumber of ["", "abc", "1234567890123456", 123]) {
      await expect(createPhoneNumber(client, {
        wabaId: "WABA-1",
        countryCode: "1",
        phoneNumber: badNumber as never,
        verifiedName: "Acme"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badName of ["", "x".repeat(129)]) {
      await expect(createPhoneNumber(client, {
        wabaId: "WABA-1",
        countryCode: "1",
        phoneNumber: "5551234567",
        verifiedName: badName as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("requestVerificationCode rejects unsafe phoneNumberId, bad codeMethod, bad language", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(requestVerificationCode(client, {
        phoneNumberId: bad as never,
        codeMethod: "SMS",
        language: "en"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badMethod of ["", "EMAIL", 123]) {
      await expect(requestVerificationCode(client, {
        phoneNumberId: "pn-1",
        codeMethod: badMethod as never,
        language: "en"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badLang of ["", "ENG", "e1", 123]) {
      await expect(requestVerificationCode(client, {
        phoneNumberId: "pn-1",
        codeMethod: "SMS",
        language: badLang as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("verifyPhoneNumber rejects unsafe phoneNumberId and bad code", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(verifyPhoneNumber(client, {
        phoneNumberId: bad as never,
        code: "123456"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badCode of ["", "abc", "123456789012345678901234567890123", 123]) {
      await expect(verifyPhoneNumber(client, {
        phoneNumberId: "pn-1",
        code: badCode as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("registerPhoneNumber rejects unsafe phoneNumberId, bad pin, bad dataLocalizationRegion", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(registerPhoneNumber(client, {
        phoneNumberId: bad as never,
        pin: "123456"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badPin of ["", "12345", "1234567", "abcdef", 123]) {
      await expect(registerPhoneNumber(client, {
        phoneNumberId: "pn-1",
        pin: badPin as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badRegion of ["US1", "USA", "12"]) {
      await expect(registerPhoneNumber(client, {
        phoneNumberId: "pn-1",
        pin: "123456",
        dataLocalizationRegion: badRegion as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("deregisterPhoneNumber rejects unsafe phoneNumberId", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(deregisterPhoneNumber(client, { phoneNumberId: bad as never })).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("setTwoStepVerificationPin rejects unsafe phoneNumberId and bad pin", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(setTwoStepVerificationPin(client, {
        phoneNumberId: bad as never,
        pin: "123456"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badPin of ["", "12345", "1234567", "abcdef", 123]) {
      await expect(setTwoStepVerificationPin(client, {
        phoneNumberId: "pn-1",
        pin: badPin as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("accessor-backed params are rejected before the getter runs", async () => {
    const { client, handle } = clientWith(ok());

    const accessorCreate = { wabaId: "WABA-1", countryCode: "1", phoneNumber: "5551234567", verifiedName: "Acme" } as Record<string, unknown>;
    Object.defineProperty(accessorCreate, "verifiedName", {
      enumerable: true,
      get() { throw new Error("verifiedName getter should not run"); }
    });
    await expect(createPhoneNumber(client, accessorCreate as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorCode = { phoneNumberId: "pn-1", codeMethod: "SMS", language: "en" } as Record<string, unknown>;
    Object.defineProperty(accessorCode, "language", {
      enumerable: true,
      get() { throw new Error("language getter should not run"); }
    });
    await expect(requestVerificationCode(client, accessorCode as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorVerify = { phoneNumberId: "pn-1", code: "123456" } as Record<string, unknown>;
    Object.defineProperty(accessorVerify, "code", {
      enumerable: true,
      get() { throw new Error("code getter should not run"); }
    });
    await expect(verifyPhoneNumber(client, accessorVerify as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorRegister = { phoneNumberId: "pn-1", pin: "123456" } as Record<string, unknown>;
    Object.defineProperty(accessorRegister, "pin", {
      enumerable: true,
      get() { throw new Error("pin getter should not run"); }
    });
    await expect(registerPhoneNumber(client, accessorRegister as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorPin = { phoneNumberId: "pn-1", pin: "123456" } as Record<string, unknown>;
    Object.defineProperty(accessorPin, "pin", {
      enumerable: true,
      get() { throw new Error("pin getter should not run"); }
    });
    await expect(setTwoStepVerificationPin(client, accessorPin as never)).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });

  test("opts.headers accessor rejection fires before transport", async () => {
    const { client, handle } = clientWith(ok());
    const accessorOpts = {} as Record<string, unknown>;
    Object.defineProperty(accessorOpts, "headers", {
      enumerable: true,
      get() { throw new Error("headers getter should not run"); }
    });
    await expect(requestVerificationCode(
      client,
      { phoneNumberId: "pn-1", codeMethod: "SMS", language: "en" },
      undefined,
      accessorOpts as never
    )).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-155 secret-leak guard", () => {
  test("verifyPhoneNumber never echoes the code in error messages", async () => {
    const { client } = clientWith(ok());

    // Malformed phoneNumberId with a valid-looking code: path id validates
    // first; the code value must not appear in the thrown message.
    let err: unknown;
    try {
      await verifyPhoneNumber(client, { phoneNumberId: "bad/id", code: "654321" });
    } catch (error) {
      err = error;
    }
    expect(err).toBeInstanceOf(GraphRequestValidationError);
    expect((err as Error).message).not.toContain("654321");

    // Invalid (non-digit) code: the code value must not appear in the
    // thrown message.
    let err2: unknown;
    try {
      await verifyPhoneNumber(client, { phoneNumberId: "pn-1", code: "secret99" });
    } catch (error) {
      err2 = error;
    }
    expect(err2).toBeInstanceOf(GraphRequestValidationError);
    expect((err2 as Error).message).not.toContain("secret99");
  });

  test("registerPhoneNumber never echoes the pin in error messages", async () => {
    const { client } = clientWith(ok());

    let err: unknown;
    try {
      await registerPhoneNumber(client, { phoneNumberId: "pn-1", pin: "pin1234" });
    } catch (error) {
      err = error;
    }
    expect(err).toBeInstanceOf(GraphRequestValidationError);
    expect((err as Error).message).not.toContain("pin1234");
  });

  test("setTwoStepVerificationPin never echoes the pin in error messages", async () => {
    const { client } = clientWith(ok());

    let err: unknown;
    try {
      await setTwoStepVerificationPin(client, { phoneNumberId: "pn-1", pin: "mysecret" });
    } catch (error) {
      err = error;
    }
    expect(err).toBeInstanceOf(GraphRequestValidationError);
    expect((err as Error).message).not.toContain("mysecret");
  });
});
