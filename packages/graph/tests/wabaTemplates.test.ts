// WATS-39 RED — credential-free WABA message-template parity.
//
// These behavioral tests describe the public Graph/template surface before
// implementation. RED intentionally imports only public symbols from ../src
// and exercises MockTransport, typed validation errors, component builders,
// parameter-count validation, endpoint body/query paths, and safe-json hazards.

import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphClient,
  GraphRequestValidationError,
  TemplateParamCountMismatchError,
  WABAClient,
  buildTemplateBodyComponent,
  buildTemplateButtonComponent,
  buildTemplateFooterComponent,
  buildTemplateHeaderComponent,
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplate,
  listMessageTemplates,
  updateMessageTemplate,
  validateTemplateParameterCounts,
  type TemplateComponent,
  type TemplateDetails,
  type TemplateListResponse,
  type TemplateMutationResponse
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(
  responses: MockTransportResponseSpec[] | MockTransportResponseSpec
) {
  const handle = createMockTransport(
    Array.isArray(responses)
      ? { responses }
      : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

type MockBody = string | Uint8Array | object | null;

function ok(body: MockBody = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): unknown {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

describe("WATS-39 message template endpoint callables", () => {

  test("WATS-65 root and template subpath exports keep identical callables after module split", async () => {
    const root = await import("../src");
    const templates = await import("../src/endpoints/templates");
    expect(templates.listMessageTemplates).toBe(root.listMessageTemplates);
    expect(templates.getMessageTemplate).toBe(root.getMessageTemplate);
    expect(templates.createMessageTemplate).toBe(root.createMessageTemplate);
    expect(templates.updateMessageTemplate).toBe(root.updateMessageTemplate);
    expect(templates.deleteMessageTemplate).toBe(root.deleteMessageTemplate);
    expect(templates.buildCreateMessageTemplateBody).toBe(root.buildCreateMessageTemplateBody);
    expect(templates.buildUpdateMessageTemplateBody).toBe(root.buildUpdateMessageTemplateBody);
    expect(templates.buildTemplateHeaderComponent).toBe(root.buildTemplateHeaderComponent);
    expect(templates.buildTemplateBodyComponent).toBe(root.buildTemplateBodyComponent);
    expect(templates.buildTemplateFooterComponent).toBe(root.buildTemplateFooterComponent);
    expect(templates.buildTemplateButtonComponent).toBe(root.buildTemplateButtonComponent);
    expect(templates.validateTemplateParameterCounts).toBe(root.validateTemplateParameterCounts);
  });

  test("listMessageTemplates GETs /{wabaId}/message_templates with camelCase query mapped to Graph names", async () => {
    const { client, handle } = clientWith(ok({ data: [{ id: "tpl1", name: "hello_world" }] }));
    const res: TemplateListResponse = await listMessageTemplates(client, {
      wabaId: "999",
      fields: "id,name,status",
      status: "APPROVED",
      category: "UTILITY",
      language: "en_US",
      name: "hello_world",
      content: "hello",
      nameOrContent: "world",
      qualityScore: "GREEN",
      limit: "25",
      after: "CURSOR"
    });
    expect(res.data?.[0]?.id).toBe("tpl1");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/999/message_templates?fields=id%2Cname%2Cstatus&status=APPROVED&category=UTILITY&language=en_US&name=hello_world&content=hello&name_or_content=world&quality_score=GREEN&limit=25&after=CURSOR"
    );
  });

  test("getMessageTemplate GETs /{templateId} with optional fields", async () => {
    const { client, handle } = clientWith(ok({ id: "tpl1", name: "hello_world", status: "APPROVED" }));
    const res: TemplateDetails = await getMessageTemplate(client, {
      templateId: "tpl1",
      fields: "id,name,status,components"
    });
    expect(res.id).toBe("tpl1");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/tpl1?fields=id%2Cname%2Cstatus%2Ccomponents"
    );
  });

  test("createMessageTemplate POSTs sanitized JSON body with component helpers", async () => {
    const { client, handle } = clientWith(ok({ id: "tpl1", success: true }));
    const res: TemplateMutationResponse = await createMessageTemplate(
      client,
      { wabaId: "999" },
      {
        name: "order_ready",
        language: "en_US",
        category: "UTILITY",
        parameterFormat: "POSITIONAL",
        messageSendTtlSeconds: 3600,
        components: [
          buildTemplateHeaderComponent({ format: "TEXT", text: "Order {{1}}" }),
          buildTemplateBodyComponent({ text: "Hi {{1}}, your order is ready." }),
          buildTemplateFooterComponent({ text: "Reply STOP to opt out" }),
          buildTemplateButtonComponent({ buttons: [{ type: "QUICK_REPLY", text: "Thanks" }] })
        ]
      }
    );
    expect(res.success).toBe(true);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/999/message_templates");
    expect(handle.requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "order_ready",
      language: "en_US",
      category: "UTILITY",
      parameter_format: "POSITIONAL",
      message_send_ttl_seconds: 3600,
      components: [
        { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
        { type: "BODY", text: "Hi {{1}}, your order is ready." },
        { type: "FOOTER", text: "Reply STOP to opt out" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Thanks" }] }
      ]
    });
  });

  test("updateMessageTemplate POSTs /{templateId} update body and omits undefined", async () => {
    const { client, handle } = clientWith(ok({ success: true }));
    await updateMessageTemplate(
      client,
      { templateId: "tpl1" },
      {
        category: "MARKETING",
        components: [buildTemplateBodyComponent({ text: "Sale {{code}}" })],
        parameterFormat: "NAMED",
        messageSendTtlSeconds: 600
      }
    );
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/tpl1");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      category: "MARKETING",
      components: [{ type: "BODY", text: "Sale {{code}}" }],
      parameter_format: "NAMED",
      message_send_ttl_seconds: 600
    });
  });

  test("deleteMessageTemplate DELETEs by name and maps camelCase templateId to hsm_id", async () => {
    const { client, handle } = clientWith(ok({ success: true }));
    await deleteMessageTemplate(client, {
      wabaId: "999",
      name: "order_ready",
      templateId: "tpl1"
    });
    expect(handle.requests[0]?.method).toBe("DELETE");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/999/message_templates?name=order_ready&hsm_id=tpl1"
    );
  });

  test("callables reject unsafe path/query values with GraphRequestValidationError", async () => {
    const { client } = clientWith(ok());
    await expect(listMessageTemplates(client, { wabaId: "../evil" })).rejects.toThrow(GraphRequestValidationError);
    await expect(getMessageTemplate(client, { templateId: "tpl\n1" })).rejects.toThrow(GraphRequestValidationError);
    await expect(deleteMessageTemplate(client, { wabaId: "999", name: "bad\nname" })).rejects.toThrow(GraphRequestValidationError);
  });

  test("direct create/update callables reject accessor-backed params with typed errors", async () => {
    const { client } = clientWith(ok());
    const createParams = {} as Record<string, unknown>;
    Object.defineProperty(createParams, "wabaId", { get() { throw new TypeError("wabaId getter should not run"); } });
    await expect(createMessageTemplate(client, createParams as never, {
      name: "n",
      language: "en_US",
      category: "UTILITY",
      components: [buildTemplateBodyComponent({ text: "Hi" })]
    })).rejects.toThrow(GraphRequestValidationError);

    const updateParams = {} as Record<string, unknown>;
    Object.defineProperty(updateParams, "templateId", { get() { throw new TypeError("templateId getter should not run"); } });
    await expect(updateMessageTemplate(client, updateParams as never, { category: "UTILITY" })).rejects.toThrow(GraphRequestValidationError);
  });
});

describe("WATS-39 WABAClient template methods", () => {
  test("scoped methods inject the bound wabaId and match direct endpoint paths", async () => {
    const { client, handle } = clientWith([
      ok({ data: [] }),
      ok({ data: [] }),
      ok({ id: "tpl1", success: true }),
      ok({ success: true }),
      ok({ success: true })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "999" });
    await waba.listMessageTemplates({ status: "APPROVED" });
    await waba.listMessageTemplates({ wabaId: "OVERRIDE", status: "PENDING" } as never);
    await waba.createMessageTemplate({
      name: "hello_world",
      language: "en_US",
      category: "UTILITY",
      components: [buildTemplateBodyComponent({ text: "Hello" })]
    });
    await waba.deleteMessageTemplate({ name: "hello_world", templateId: "tpl1" });
    await waba.deleteMessageTemplate({ wabaId: "OVERRIDE", name: "override", templateId: "tpl2" } as never);
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/999/message_templates?status=APPROVED",
      "GET https://graph.facebook.com/v25.0/999/message_templates?status=PENDING",
      "POST https://graph.facebook.com/v25.0/999/message_templates",
      "DELETE https://graph.facebook.com/v25.0/999/message_templates?name=hello_world&hsm_id=tpl1",
      "DELETE https://graph.facebook.com/v25.0/999/message_templates?name=override&hsm_id=tpl2"
    ]);
  });

  test("WABAClient get/update template use templateId path scope", async () => {
    const { client, handle } = clientWith([ok({ id: "tpl1" }), ok({ success: true })]);
    const waba = new WABAClient({ graphClient: client, wabaId: "999" });
    await waba.getMessageTemplate({ templateId: "tpl1", fields: "id,name" });
    await waba.updateMessageTemplate({
      templateId: "tpl1",
      category: "UTILITY"
    });
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/tpl1?fields=id%2Cname");
    expect(handle.requests[1]?.url).toBe("https://graph.facebook.com/v25.0/tpl1");
  });

  test("WABAClient methods reject accessor-backed params before spread/destructuring", async () => {
    const { client } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "999" });
    await expect(waba.updateMessageTemplate(null as never)).rejects.toThrow(GraphRequestValidationError);

    const updateAccessor = {} as Record<string, unknown>;
    Object.defineProperty(updateAccessor, "templateId", { get() { throw new Error("templateId getter should not run"); } });
    await expect(waba.updateMessageTemplate(updateAccessor as never)).rejects.toThrow(GraphRequestValidationError);

    const listAccessor = {} as Record<string, unknown>;
    Object.defineProperty(listAccessor, "status", { enumerable: true, get() { throw new Error("status getter should not run"); } });
    await expect(waba.listMessageTemplates(listAccessor as never)).rejects.toThrow(GraphRequestValidationError);

    const deleteAccessor = { name: "order_ready" } as Record<string, unknown>;
    Object.defineProperty(deleteAccessor, "templateId", { enumerable: true, get() { throw new Error("templateId getter should not run"); } });
    await expect(waba.deleteMessageTemplate(deleteAccessor as never)).rejects.toThrow(GraphRequestValidationError);
  });
});

describe("WATS-39 template component builders", () => {
  test("header/body/footer/buttons helpers emit Graph component shapes", () => {
    expect(buildTemplateHeaderComponent({ format: "TEXT", text: "Hi {{1}}" })).toEqual({
      type: "HEADER",
      format: "TEXT",
      text: "Hi {{1}}"
    });
    expect(buildTemplateHeaderComponent({ format: "IMAGE", example: { headerHandle: ["abc"] } })).toEqual({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["abc"] }
    });
    expect(buildTemplateHeaderComponent({ format: "LOCATION" })).toEqual({ type: "HEADER", format: "LOCATION" });
    expect(buildTemplateBodyComponent({ text: "Hello {{name}}", example: { bodyText: [["Ada"]] } })).toEqual({
      type: "BODY",
      text: "Hello {{name}}",
      example: { body_text: [["Ada"]] }
    });
    expect(buildTemplateFooterComponent({ text: "Footer" })).toEqual({ type: "FOOTER", text: "Footer" });
    expect(buildTemplateButtonComponent({
      buttons: [
        { type: "QUICK_REPLY", text: "Yes" },
        { type: "URL", text: "Open", url: "https://example.com/{{1}}" },
        { type: "PHONE_NUMBER", text: "Call", phoneNumber: "+15551234567" },
        { type: "COPY_CODE", example: "SAVE20" },
        { type: "CATALOG", text: "Browse" },
        { type: "FLOW", text: "Start", flowId: "flow123", flowAction: "navigate", navigateScreen: "WELCOME" }
      ]
    })).toEqual({
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Yes" },
        { type: "URL", text: "Open", url: "https://example.com/{{1}}" },
        { type: "PHONE_NUMBER", text: "Call", phone_number: "+15551234567" },
        { type: "COPY_CODE", example: "SAVE20" },
        { type: "CATALOG", text: "Browse" },
        { type: "FLOW", text: "Start", flow_id: "flow123", flow_action: "navigate", navigate_screen: "WELCOME" }
      ]
    });
  });

  test("component builders reject malformed runtime inputs with GraphRequestValidationError", () => {
    for (const bad of [null, undefined, "x", [], 42]) {
      expect(() => buildTemplateBodyComponent(bad as never)).toThrow(GraphRequestValidationError);
    }
    expect(() => buildTemplateBodyComponent({ text: "" })).toThrow(GraphRequestValidationError);
    expect(() => buildTemplateHeaderComponent({ format: "TEXT" })).toThrow(GraphRequestValidationError);
    expect(() => buildTemplateHeaderComponent({ format: "TEXT", text: "   " })).toThrow(GraphRequestValidationError);
    expect(() => buildTemplateButtonComponent({ buttons: [] })).toThrow(GraphRequestValidationError);
  });

  test("component and button array bounds reject over-limit and accept at-limit", () => {
    const buttons = Array.from({ length: 10 }, (_, i) => ({ type: "QUICK_REPLY" as const, text: `B${i}` }));
    expect(buildTemplateButtonComponent({ buttons }).buttons.length).toBe(10);
    expect(() => buildTemplateButtonComponent({ buttons: [...buttons, { type: "QUICK_REPLY", text: "too-many" }] })).toThrow(GraphRequestValidationError);

    const components = Array.from({ length: 20 }, (_, i) => buildTemplateBodyComponent({ text: `B${i}` }));
    const { client: atLimitClient } = clientWith(ok());
    expect(() => createMessageTemplate(atLimitClient, { wabaId: "999" }, { name: "n", language: "en_US", category: "UTILITY", components })).not.toThrow();
    const { client: overLimitClient } = clientWith(ok());
    expect(() => createMessageTemplate(overLimitClient, { wabaId: "999" }, { name: "n", language: "en_US", category: "UTILITY", components: [...components, buildTemplateBodyComponent({ text: "too" })] })).toThrow(GraphRequestValidationError);
  });

  test("safe pass-through components are cloned and JSON hazards are rejected", () => {
    const raw: TemplateComponent = { type: "BODY", text: "Safe" } as TemplateComponent;
    const body = buildTemplateBodyComponent(raw);
    (raw as Record<string, unknown>).text = "mutated";
    expect(body).toEqual({ type: "BODY", text: "Safe" });

    const sparse: unknown[] = [];
    sparse[1] = { type: "BODY", text: "x" };
    expect(() => createMessageTemplate(clientWith(ok()).client, { wabaId: "999" }, { name: "n", language: "en_US", category: "UTILITY", components: sparse as never })).toThrow(GraphRequestValidationError);

    const withAccessor = { type: "BODY" } as Record<string, unknown>;
    Object.defineProperty(withAccessor, "text", { get() { throw new Error("getter should not run"); } });
    expect(() => buildTemplateBodyComponent(withAccessor as never)).toThrow(GraphRequestValidationError);

    const withToJson = { type: "BODY", text: "x", toJSON() { return {}; } };
    expect(() => buildTemplateBodyComponent(withToJson as never)).toThrow(GraphRequestValidationError);

    class Custom { type = "BODY"; text = "x"; }
    expect(() => buildTemplateBodyComponent(new Custom() as never)).toThrow(GraphRequestValidationError);
  });
});

describe("WATS-39 validateTemplateParameterCounts", () => {
  const definition = {
    parameterFormat: "POSITIONAL" as const,
    components: [
      buildTemplateHeaderComponent({ format: "TEXT", text: "Order {{1}}" }),
      buildTemplateBodyComponent({ text: "Hi {{1}}, code {{2}}" })
    ]
  };

  test("passes when positional placeholder counts match send-time components", () => {
    expect(() =>
      validateTemplateParameterCounts(definition, [
        { type: "header", parameters: [{ type: "text", text: "123" }] },
        { type: "body", parameters: [{ type: "text", text: "Ada" }, { type: "text", text: "XYZ" }] }
      ])
    ).not.toThrow();
  });

  test("passes when named placeholder names match send-time named parameters", () => {
    expect(() =>
      validateTemplateParameterCounts(
        {
          parameterFormat: "NAMED",
          components: [buildTemplateBodyComponent({ text: "Hi {{name}}, code {{code}}" })]
        },
        [{ type: "body", parameters: [{ type: "text", parameter_name: "code", text: "A" }, { type: "text", parameter_name: "name", text: "B" }] }]
      )
    ).not.toThrow();
  });

  test("mismatches throw TemplateParamCountMismatchError, not raw TypeError", () => {
    let thrown: unknown;
    try {
      validateTemplateParameterCounts(definition, [
        { type: "body", parameters: [{ type: "text", text: "only-one" }] }
      ]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TemplateParamCountMismatchError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  test("malformed validation inputs throw typed validation errors", () => {
    expect(() => validateTemplateParameterCounts(null as never, [])).toThrow(GraphRequestValidationError);
    expect(() => validateTemplateParameterCounts({ components: [] }, null as never)).toThrow(GraphRequestValidationError);
    expect(() => validateTemplateParameterCounts({ components: [buildTemplateBodyComponent({ text: "Hi {{1}}" })] }, [{ type: "body", parameters: new Array(1) as never }])).toThrow(GraphRequestValidationError);
  });

  test("accessor-backed parameter validation inputs are rejected with typed errors", () => {
    const defComponent = { type: "BODY" } as Record<string, unknown>;
    Object.defineProperty(defComponent, "text", { get() { throw new Error("getter should not run"); } });
    expect(() => validateTemplateParameterCounts({ components: [defComponent as never] }, [])).toThrow(GraphRequestValidationError);

    const parameter = { type: "text" } as Record<string, unknown>;
    Object.defineProperty(parameter, "parameter_name", { get() { throw new Error("parameter getter should not run"); } });
    expect(() => validateTemplateParameterCounts(
      { parameterFormat: "NAMED", components: [buildTemplateBodyComponent({ text: "Hi {{name}}" })] },
      [{ type: "body", parameters: [parameter as never] }]
    )).toThrow(GraphRequestValidationError);
  });
});
