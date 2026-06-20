import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  createMessageTemplate
} from "../src";
import { createMockTransport, type MockTransportResponseSpec } from "../src/createMockTransport";

function clientWith(response: MockTransportResponseSpec = { status: 200, headers: { "content-type": "application/json" }, body: { id: "tpl-lib", success: true } }) {
  const handle = createMockTransport({ defaultResponse: response });
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function parseBody(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

describe("WATS-160D library template create fields", () => {
  test("createMessageTemplate maps camelCase library-template fields without components", async () => {
    const { client, handle } = clientWith();

    await createMessageTemplate(client, { wabaId: "999" }, {
      name: "payment_reminder_library",
      language: "en_US",
      category: "UTILITY",
      libraryTemplateName: "payment_reminder_1",
      libraryTemplateBodyInputs: [
        { name: "company_name", example: "Switchbord" },
        { name: "amount", example: "$42.00" }
      ],
      libraryTemplateButtonInputs: [
        { type: "URL", url: "https://example.com/pay" }
      ]
    });

    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/999/message_templates");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "payment_reminder_library",
      language: "en_US",
      category: "UTILITY",
      library_template_name: "payment_reminder_1",
      library_template_body_inputs: [
        { name: "company_name", example: "Switchbord" },
        { name: "amount", example: "$42.00" }
      ],
      library_template_button_inputs: [
        { type: "URL", url: "https://example.com/pay" }
      ]
    });
  });

  test("createMessageTemplate preserves existing snake_case library-template fields", async () => {
    const { client, handle } = clientWith();

    await createMessageTemplate(client, { wabaId: "999" }, {
      name: "library_snake",
      language: "en_US",
      category: "UTILITY",
      library_template_name: "payment_reminder_1",
      library_template_body_inputs: [{ name: "body_1", example: "value" }]
    });

    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "library_snake",
      language: "en_US",
      category: "UTILITY",
      library_template_name: "payment_reminder_1",
      library_template_body_inputs: [{ name: "body_1", example: "value" }]
    });
  });

  test("createMessageTemplate still requires components for non-library templates", async () => {
    const { client, handle } = clientWith();

    let thrown: unknown;
    try {
      await createMessageTemplate(client, { wabaId: "999" }, {
        name: "normal_missing_components",
        language: "en_US",
        category: "UTILITY"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect((thrown as Error).message).toContain("components must be provided unless libraryTemplateName is set");
    expect(handle.requests.length).toBe(0);
  });

  test("library-template inputs reject accessor-backed entries before transport", async () => {
    const { client, handle } = clientWith();
    const entry = { name: "body_1" } as Record<string, unknown>;
    Object.defineProperty(entry, "example", {
      enumerable: true,
      get() {
        throw new TypeError("example getter should not run");
      }
    });

    let thrown: unknown;
    try {
      await createMessageTemplate(client, { wabaId: "999" }, {
        name: "library_bad",
        language: "en_US",
        category: "UTILITY",
        libraryTemplateName: "payment_reminder_1",
        libraryTemplateBodyInputs: [entry]
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(handle.requests.length).toBe(0);
  });
});
