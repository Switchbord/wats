import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  buildTemplateButtonComponent,
  buildTemplateBodyComponent,
  createMessageTemplate
} from "../src";
import { createMockTransport, type MockTransportResponseSpec } from "../src/createMockTransport";

function clientWith(response: MockTransportResponseSpec = { status: 200, headers: { "content-type": "application/json" }, body: { id: "tpl-auth", success: true } }) {
  const handle = createMockTransport({ defaultResponse: response });
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function parseBody(body: unknown): unknown {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

describe("WATS-75 authentication template DSL helpers", () => {
  test("OTP buttons map autofillText and zeroTapTermsAccepted to Graph wire fields", () => {
    expect(buildTemplateButtonComponent({
      buttons: [
        {
          type: "OTP",
          otpType: "ZERO_TAP",
          text: "Copy code",
          autofillText: "Autofill",
          zeroTapTermsAccepted: true,
          supportedApps: [
            { packageName: "com.example.app", signatureHash: "abc123sig" }
          ]
        }
      ]
    })).toEqual({
      type: "BUTTONS",
      buttons: [
        {
          type: "OTP",
          otp_type: "ZERO_TAP",
          text: "Copy code",
          autofill_text: "Autofill",
          zero_tap_terms_accepted: true,
          supported_apps: [
            { package_name: "com.example.app", signature_hash: "abc123sig" }
          ]
        }
      ]
    });
  });

  test("createMessageTemplate snapshots authentication body/footer/zero-tap button wire shape", async () => {
    const { client, handle } = clientWith();
    await createMessageTemplate(client, { wabaId: "999" }, {
      name: "login_zero_tap",
      language: "en_US",
      category: "AUTHENTICATION",
      components: [
        buildTemplateBodyComponent({ text: "{{1}} is your verification code." }),
        { type: "FOOTER", text: "This code expires in 10 minutes." },
        buildTemplateButtonComponent({
          buttons: [{
            type: "OTP",
            otpType: "ZERO_TAP",
            autofillText: "Autofill",
            zeroTapTermsAccepted: true,
            supportedApps: [{ packageName: "com.example.app", signatureHash: "abc123sig" }]
          }]
        })
      ]
    });

    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/999/message_templates");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "login_zero_tap",
      language: "en_US",
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", text: "{{1}} is your verification code." },
        { type: "FOOTER", text: "This code expires in 10 minutes." },
        {
          type: "BUTTONS",
          buttons: [{
            type: "OTP",
            otp_type: "ZERO_TAP",
            autofill_text: "Autofill",
            zero_tap_terms_accepted: true,
            supported_apps: [{ package_name: "com.example.app", signature_hash: "abc123sig" }]
          }]
        }
      ]
    });
  });

  test("OTP autofill and zero-tap options reject malformed values before transport", () => {
    expect(() => buildTemplateButtonComponent({
      buttons: [{ type: "OTP", otpType: "ONE_TAP", autofillText: "" }]
    })).toThrow(GraphRequestValidationError);

    expect(() => buildTemplateButtonComponent({
      buttons: [{ type: "OTP", otpType: "ZERO_TAP", zeroTapTermsAccepted: "yes" as never, supportedApps: [{ packageName: "com.example.app", signatureHash: "abc123sig" }] }]
    })).toThrow(GraphRequestValidationError);

    const accessor = { type: "OTP", otpType: "ZERO_TAP", supportedApps: [{ packageName: "com.example.app", signatureHash: "abc123sig" }] } as Record<string, unknown>;
    Object.defineProperty(accessor, "autofillText", {
      enumerable: true,
      get() { throw new Error("autofillText getter should not run"); }
    });
    expect(() => buildTemplateButtonComponent({ buttons: [accessor as never] })).toThrow(GraphRequestValidationError);
  });
});
