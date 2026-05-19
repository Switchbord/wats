import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient,
  buildTemplateButtonComponent,
  updatePhoneNumberSettings,
  type PhoneNumberSettingsUpdateResponse,
  type TemplateComponent
} from "../src";
import { createMockTransport, type MockTransportResponseSpec } from "../src/createMockTransport";

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec) {
  const handle = createMockTransport(Array.isArray(responses) ? { responses } : { defaultResponse: responses });
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

function parseBody(body: unknown): unknown {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

describe("WATS-93 authentication template one-tap / zero-tap compatibility", () => {
  test("OTP buttons nest supportedApps as Graph supported_apps package/signature records", () => {
    const component = buildTemplateButtonComponent({
      buttons: [
        {
          type: "OTP",
          otpType: "ZERO_TAP",
          text: "Autofill",
          supportedApps: [
            { packageName: "com.example.app", signatureHash: "abc123sig" },
            { packageName: "com.example.beta", signatureHash: "def456sig" }
          ]
        }
      ]
    });

    expect(component).toEqual({
      type: "BUTTONS",
      buttons: [
        {
          type: "OTP",
          otp_type: "ZERO_TAP",
          text: "Autofill",
          supported_apps: [
            { package_name: "com.example.app", signature_hash: "abc123sig" },
            { package_name: "com.example.beta", signature_hash: "def456sig" }
          ]
        }
      ]
    } satisfies TemplateComponent);
  });

  test("OTP buttons reject legacy flat package/signature fields and malformed supportedApps", () => {
    expect(() =>
      buildTemplateButtonComponent({
        buttons: [
          {
            type: "OTP",
            otpType: "ONE_TAP",
            packageName: "com.legacy.flat",
            signatureHash: "legacy"
          } as never
        ]
      })
    ).toThrow(GraphRequestValidationError);

    for (const bad of [undefined, [], [{ packageName: "", signatureHash: "sig" }], [{ packageName: "com.example", signatureHash: "" }]]) {
      expect(() =>
        buildTemplateButtonComponent({
          buttons: [{ type: "OTP", otpType: "ONE_TAP", supportedApps: bad as never }]
        })
      ).toThrow(GraphRequestValidationError);
    }
  });
});

describe("WATS-93 local-storage phone-number settings", () => {
  test("updatePhoneNumberSettings POSTs storage_configuration and omits data_localization_region", async () => {
    const { client, handle } = clientWith(ok({ success: true }));
    const result: PhoneNumberSettingsUpdateResponse = await updatePhoneNumberSettings(client, {
      phoneNumberId: "PN-1",
      storageConfiguration: { status: "ENABLED" }
    });

    expect(result.success).toBe(true);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/PN-1/settings");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      storage_configuration: { status: "ENABLED" }
    });
    expect(JSON.stringify(parseBody(handle.requests[0]?.body))).not.toContain("data_localization_region");
  });

  test("PhoneNumberClient.updateSettings injects the bound phoneNumberId", async () => {
    const { client, handle } = clientWith(ok({ success: true }));
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PHONE" });
    await phone.updateSettings({ storageConfiguration: { status: "DISABLED" } });

    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/BOUND-PHONE/settings");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      storage_configuration: { status: "DISABLED" }
    });
  });

  test("updatePhoneNumberSettings rejects legacy dataLocalizationRegion and malformed storageConfiguration before transport", async () => {
    const { client, handle } = clientWith(ok());

    await expect(updatePhoneNumberSettings(client, {
      phoneNumberId: "PN-1",
      dataLocalizationRegion: "IN"
    } as never)).rejects.toThrow(GraphRequestValidationError);

    await expect(updatePhoneNumberSettings(client, {
      phoneNumberId: "PN-1",
      storageConfiguration: null
    } as never)).rejects.toThrow(GraphRequestValidationError);

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "storageConfiguration", {
      enumerable: true,
      get() { throw new Error("storageConfiguration getter should not run"); }
    });
    Object.defineProperty(accessor, "phoneNumberId", { value: "PN-1", enumerable: true });
    await expect(updatePhoneNumberSettings(client, accessor as never)).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });
});
