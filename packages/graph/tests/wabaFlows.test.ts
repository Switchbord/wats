// WATS-40 RED — credential-free WhatsApp Flows parity.
//
// Behavioral tests for Flow Graph endpoint callables, WABAClient scoped
// methods, Flow JSON validation, data-exchange response builders, public
// exports, and adversarial malformed JavaScript inputs. Tests use only
// MockTransport and synthetic payloads; no live Meta credentials.

import { describe, expect, test } from "bun:test";
import {
  FlowDeletingError,
  FlowPublishingError,
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRequestValidationError,
  WABAClient,
  buildFlowCloseResponse,
  buildFlowErrorResponse,
  buildFlowJson,
  buildFlowScreenResponse,
  createFlow,
  deleteFlow,
  deprecateFlow,
  getFlow,
  getFlowAssets,
  listFlows,
  publishFlow,
  updateFlowJson,
  updateFlowMetadata,
  validateFlowJson,
  type FlowDetails,
  type FlowListResponse,
  type FlowMutationResponse
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

type MockBody = string | Uint8Array | object | null;

function ok(body: MockBody = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): unknown {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

function minimalFlowJson(extra: Record<string, unknown> = {}) {
  return {
    version: "7.0",
    screens: [
      {
        id: "WELCOME",
        title: "Welcome",
        terminal: true,
        layout: {
          type: "SingleColumnLayout",
          children: [{ type: "TextHeading", text: "Hello" }]
        }
      }
    ],
    ...extra
  };
}

describe("WATS-40 Flow endpoint callables", () => {
  test("listFlows GETs /{wabaId}/flows with pywa-oriented query mapping", async () => {
    const { client, handle } = clientWith(ok({ data: [{ id: "flow1", name: "signup" }] }));
    const res: FlowListResponse = await listFlows(client, {
      wabaId: "999",
      fields: "id,name,status,categories",
      status: "PUBLISHED",
      name: "signup",
      invalidatePreview: "true",
      phoneNumberId: "555",
      limit: "10",
      after: "CURSOR"
    });
    expect(res.data?.[0]?.id).toBe("flow1");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/999/flows?fields=id%2Cname%2Cstatus%2Ccategories&status=PUBLISHED&name=signup&invalidate_preview=true&phone_number_id=555&limit=10&after=CURSOR"
    );
  });

  test("getFlow GETs /{flowId} with optional fields/invalidate preview/phone number", async () => {
    const { client, handle } = clientWith(ok({ id: "flow1", name: "signup", status: "DRAFT" }));
    const res: FlowDetails = await getFlow(client, {
      flowId: "flow1",
      fields: "id,name,status,validation_errors",
      invalidatePreview: "true",
      phoneNumberId: "555"
    });
    expect(res.id).toBe("flow1");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/flow1?fields=id%2Cname%2Cstatus%2Cvalidation_errors&invalidate_preview=true&phone_number_id=555"
    );
  });

  test("createFlow POSTs sanitized JSON body and maps camelCase to Graph fields", async () => {
    const rawFlowJson = minimalFlowJson();
    const { client, handle } = clientWith(ok({ id: "flow1", success: true }));
    const res: FlowMutationResponse = await createFlow(
      client,
      { wabaId: "999" },
      {
        name: "signup_flow",
        categories: ["SIGN_UP", "CONTACT_US"],
        cloneFlowId: "template_flow",
        endpointUri: "https://flows.example.test/data-exchange",
        flowJson: rawFlowJson,
        publish: false
      }
    );
    expect(res.success).toBe(true);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/999/flows");
    expect(handle.requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "signup_flow",
      categories: ["SIGN_UP", "CONTACT_US"],
      clone_flow_id: "template_flow",
      endpoint_uri: "https://flows.example.test/data-exchange",
      flow_json: rawFlowJson,
      publish: false
    });
    (rawFlowJson.screens[0] as Record<string, unknown>).id = "MUTATED";
    expect((parseBody(handle.requests[0]?.body) as { flow_json: { screens: Array<{ id: string }> } }).flow_json.screens[0]?.id).toBe("WELCOME");
  });

  test("updateFlowMetadata POSTs /{flowId} and omits undefined metadata fields", async () => {
    const { client, handle } = clientWith(ok({ success: true }));
    await updateFlowMetadata(client, { flowId: "flow1" }, {
      name: "renamed_flow",
      categories: ["APPOINTMENT_BOOKING"],
      endpointUri: "https://flows.example.test/v2",
      applicationId: "app123",
      unused: undefined
    } as never);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/flow1");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "renamed_flow",
      categories: ["APPOINTMENT_BOOKING"],
      endpoint_uri: "https://flows.example.test/v2",
      application_id: "app123"
    });
  });

  test("updateFlowJson POSTs /{flowId}/assets with stable Flow JSON asset descriptor", async () => {
    const flowJson = minimalFlowJson();
    const { client, handle } = clientWith(ok({ success: true }));
    await updateFlowJson(client, { flowId: "flow1" }, { flowJson });
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/flow1/assets");
    expect(handle.requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "flow.json",
      asset_type: "FLOW_JSON",
      file: JSON.stringify(flowJson)
    });
  });

  test("publish/delete/deprecate/assets call the expected Flow management paths", async () => {
    const { client, handle } = clientWith([
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ data: [{ name: "flow.json", asset_type: "FLOW_JSON" }] })
    ]);
    await publishFlow(client, { flowId: "flow1" });
    await deleteFlow(client, { flowId: "flow1" });
    await deprecateFlow(client, { flowId: "flow1" });
    await getFlowAssets(client, { flowId: "flow1", fields: "name,asset_type", limit: "25", after: "NEXT" });
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/flow1/publish",
      "DELETE https://graph.facebook.com/v25.0/flow1",
      "POST https://graph.facebook.com/v25.0/flow1/deprecate",
      "GET https://graph.facebook.com/v25.0/flow1/assets?fields=name%2Casset_type&limit=25&after=NEXT"
    ]);
  });

  test("Graph Flow error codes preserve seeded pywa subclass taxonomy", async () => {
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: { error: { message: "publish failed", code: 139002, type: "OAuthException" } }
    });
    let thrown: unknown;
    try {
      await publishFlow(client, { flowId: "flow1" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FlowPublishingError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(FlowDeletingError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
  });
});

describe("WATS-40 WABAClient Flow methods", () => {
  test("scoped list/create inject bound wabaId while flow-id methods use their explicit flowId", async () => {
    const { client, handle } = clientWith([
      ok({ data: [] }),
      ok({ data: [] }),
      ok({ id: "flow1", success: true }),
      ok({ id: "flow1" }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ data: [] })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "999" });
    await waba.listFlows({ status: "DRAFT" });
    await waba.listFlows({ wabaId: "OVERRIDE", status: "PUBLISHED" } as never);
    await waba.createFlow({ name: "signup_flow", categories: ["SIGN_UP"], flowJson: minimalFlowJson() });
    await waba.getFlow({ flowId: "flow1", fields: "id,name" });
    await waba.updateFlowMetadata({ flowId: "flow1", name: "renamed" });
    await waba.updateFlowJson({ flowId: "flow1", flowJson: minimalFlowJson() });
    await waba.publishFlow({ flowId: "flow1" });
    await waba.deprecateFlow({ flowId: "flow1" });
    await waba.getFlowAssets({ flowId: "flow1" });
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/999/flows?status=DRAFT",
      "GET https://graph.facebook.com/v25.0/999/flows?status=PUBLISHED",
      "POST https://graph.facebook.com/v25.0/999/flows",
      "GET https://graph.facebook.com/v25.0/flow1?fields=id%2Cname",
      "POST https://graph.facebook.com/v25.0/flow1",
      "POST https://graph.facebook.com/v25.0/flow1/assets",
      "POST https://graph.facebook.com/v25.0/flow1/publish",
      "POST https://graph.facebook.com/v25.0/flow1/deprecate",
      "GET https://graph.facebook.com/v25.0/flow1/assets"
    ]);
  });

  test("WABAClient Flow methods reject accessor-backed params before spread/destructuring", async () => {
    const { client } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "999" });
    const listAccessor = {} as Record<string, unknown>;
    Object.defineProperty(listAccessor, "status", { enumerable: true, get() { throw new Error("status getter should not run"); } });
    await expect(waba.listFlows(listAccessor as never)).rejects.toThrow(GraphRequestValidationError);

    const updateAccessor = {} as Record<string, unknown>;
    Object.defineProperty(updateAccessor, "flowId", { enumerable: true, get() { throw new Error("flowId getter should not run"); } });
    await expect(waba.updateFlowMetadata(updateAccessor as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(waba.updateFlowJson(updateAccessor as never)).rejects.toThrow(GraphRequestValidationError);
  });

  test("WATS-61 Flow split params reject symbol keys and proxy traps before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "999" });
    const symbolKey = Symbol("hidden-flow-param");
    await expect(waba.getFlow({ flowId: "flow1", [symbolKey]: "hidden" } as never)).rejects.toThrow(GraphRequestValidationError);

    const proxyParams = new Proxy({}, {
      ownKeys() {
        return ["flowId"];
      },
      getOwnPropertyDescriptor() {
        throw new Error("flow params descriptor trap should be wrapped");
      }
    });

    let thrown: unknown;
    try {
      await waba.updateFlowMetadata(proxyParams as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect((thrown as GraphRequestValidationError).cause).toBeInstanceOf(Error);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-40 Flow JSON and data-exchange helpers", () => {
  test("buildFlowJson returns a plain cloned Flow JSON object and validateFlowJson accepts it", () => {
    const raw = minimalFlowJson();
    const built = buildFlowJson(raw);
    validateFlowJson(built);
    (raw.screens[0] as Record<string, unknown>).title = "mutated";
    expect(built).toEqual(minimalFlowJson());
  });

  test("Flow JSON caps accept at-limit screens/components and reject over-limit", () => {
    const screens = Array.from({ length: 50 }, (_, screenIndex) => ({
      id: `SCREEN_${screenIndex}`,
      title: `Screen ${screenIndex}`,
      layout: {
        type: "SingleColumnLayout",
        children: Array.from({ length: 20 }, (_, childIndex) => ({ type: "TextBody", text: `C${screenIndex}_${childIndex}` }))
      }
    }));
    expect(() => buildFlowJson({ version: "7.0", screens })).not.toThrow();
    expect(() => buildFlowJson({ version: "7.0", screens: [...screens, { id: "TOO_MANY" }] })).toThrow(GraphRequestValidationError);

    const tooManyComponents = [{ id: "TOO_MANY", layout: { type: "SingleColumnLayout", children: Array.from({ length: 1001 }, (_, i) => ({ type: "TextBody", text: `C${i}` })) } }];
    expect(() => buildFlowJson({ version: "7.0", screens: tooManyComponents })).toThrow(GraphRequestValidationError);
  });

  test("Flow JSON validator rejects malformed JSON hazards with GraphRequestValidationError", () => {
    for (const bad of [null, undefined, "x", 42, [], () => undefined, Symbol("x")]) {
      expect(() => buildFlowJson(bad as never)).toThrow(GraphRequestValidationError);
    }
    expect(() => buildFlowJson({ version: "7.0", screens: [] })).toThrow(GraphRequestValidationError);
    expect(() => buildFlowJson({ version: "7.0", screens: [{ id: "bad\n" }] })).toThrow(GraphRequestValidationError);
    const multibyteOverByteCap = {
      version: "7.0",
      screens: [
        {
          id: "S",
          layout: {
            type: "SingleColumnLayout",
            children: Array.from({ length: 4 }, (_, i) => ({ type: "TextBody", text: `${i}:${"€".repeat(12_000)}` }))
          }
        }
      ]
    };
    expect(JSON.stringify(multibyteOverByteCap).length).toBeLessThan(131_072);
    expect(new TextEncoder().encode(JSON.stringify(multibyteOverByteCap)).byteLength).toBeGreaterThan(131_072);
    expect(() => buildFlowJson(multibyteOverByteCap)).toThrow(GraphRequestValidationError);
    expect(() => buildFlowJson({ version: "7.0", screens: [{ id: "S", value: Number.NaN }] })).toThrow(GraphRequestValidationError);
    expect(() => buildFlowJson({ version: "7.0", screens: [{ id: "S", fn: () => undefined }] })).toThrow(GraphRequestValidationError);

    const sparse: unknown[] = [];
    sparse[1] = { id: "S" };
    expect(() => buildFlowJson({ version: "7.0", screens: sparse })).toThrow(GraphRequestValidationError);

    const withAccessor = { version: "7.0" } as Record<string, unknown>;
    Object.defineProperty(withAccessor, "screens", { get() { throw new Error("getter should not run"); } });
    expect(() => buildFlowJson(withAccessor)).toThrow(GraphRequestValidationError);

    const withToJson = { version: "7.0", screens: [{ id: "S" }], toJSON() { return {}; } };
    expect(() => buildFlowJson(withToJson)).toThrow(GraphRequestValidationError);

    expect(() => buildFlowJson({
      version: "7.0",
      screens: [{ id: "S", layout: { type: "SingleColumnLayout", children: [{ type: "TextBody", __proto__: { polluted: true } }] } }]
    })).toThrow(GraphRequestValidationError);
    const parsedProto = JSON.parse('{"version":"7.0","screens":[{"id":"S","layout":{"type":"SingleColumnLayout","children":[{"type":"TextBody","__proto__":{"polluted":true}}]}}]}');
    expect(() => buildFlowJson(parsedProto)).toThrow(GraphRequestValidationError);

    class CustomFlow { version = "7.0"; screens = [{ id: "S" }]; }
    expect(() => buildFlowJson(new CustomFlow() as never)).toThrow(GraphRequestValidationError);

    const cyclic: Record<string, unknown> = { version: "7.0", screens: [{ id: "S" }] };
    cyclic.self = cyclic;
    expect(() => buildFlowJson(cyclic)).toThrow(GraphRequestValidationError);
  });

  test("Flow data-exchange helpers build screen/error/close responses and clone data", () => {
    const data = { user: { name: "Ada" } };
    const screen = buildFlowScreenResponse({ screen: "DETAILS", data, flowToken: "token123" });
    const close = buildFlowCloseResponse({ flowToken: "token123", data: { complete: true } });
    const error = buildFlowErrorResponse({ error: "validation_failed", errorMessage: "Pick a date" });
    (data.user as Record<string, unknown>).name = "mutated";
    expect(screen).toEqual({ screen: "DETAILS", data: { user: { name: "Ada" } }, flow_token: "token123" });
    expect(close).toEqual({ close_flow: true, flow_token: "token123", data: { complete: true } });
    expect(error).toEqual({ error: "validation_failed", error_message: "Pick a date" });
  });

  test("Flow data-exchange helpers reject malformed screen/data/token inputs", () => {
    expect(() => buildFlowScreenResponse({ screen: "" })).toThrow(GraphRequestValidationError);
    expect(() => buildFlowScreenResponse({ screen: "bad\n" })).toThrow(GraphRequestValidationError);
    expect(() => buildFlowScreenResponse({ screen: "DETAILS", flowToken: "bad\u0000" })).toThrow(GraphRequestValidationError);
    expect(() => buildFlowErrorResponse({ error: "" })).toThrow(GraphRequestValidationError);
    const withToJson = { toJSON() { return {}; } };
    expect(() => buildFlowCloseResponse({ data: withToJson })).toThrow(GraphRequestValidationError);
  });
});

describe("WATS-40 Flow adversarial endpoint validation", () => {
  test("path/query/header values reject null/empty/whitespace/control/slashes with typed errors", async () => {
    const { client } = clientWith(ok());
    await expect(listFlows(client, null as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(listFlows(client, { wabaId: "" })).rejects.toThrow(GraphRequestValidationError);
    await expect(listFlows(client, { wabaId: "   " })).rejects.toThrow(GraphRequestValidationError);
    await expect(listFlows(client, { wabaId: "../evil" })).rejects.toThrow(GraphRequestValidationError);
    await expect(getFlow(client, { flowId: "flow\n1" })).rejects.toThrow(GraphRequestValidationError);
    await expect(getFlow(client, { flowId: "flow1", fields: "bad\rfields" })).rejects.toThrow(GraphRequestValidationError);
    await expect(publishFlow(client, { flowId: 42 as never })).rejects.toThrow(GraphRequestValidationError);
    await expect(publishFlow(client, { flowId: "flow1" }, undefined, { headers: { authorization: "Bearer evil" } })).rejects.toThrow(GraphRequestValidationError);
  });

  test("direct Flow callables reject accessor-backed params without invoking getters", async () => {
    const { client } = clientWith(ok());
    const createParams = {} as Record<string, unknown>;
    Object.defineProperty(createParams, "wabaId", { enumerable: true, get() { throw new TypeError("wabaId getter should not run"); } });
    await expect(createFlow(client, createParams as never, { name: "n", categories: ["SIGN_UP"], flowJson: minimalFlowJson() })).rejects.toThrow(GraphRequestValidationError);

    const flowParams = {} as Record<string, unknown>;
    Object.defineProperty(flowParams, "flowId", { enumerable: true, get() { throw new TypeError("flowId getter should not run"); } });
    await expect(updateFlowJson(client, flowParams as never, { flowJson: minimalFlowJson() })).rejects.toThrow(GraphRequestValidationError);
  });

  test("Flow create/update bodies reject bad arrays, JSON-like hazards, invalid URLs, and oversized strings", async () => {
    const { client } = clientWith(ok());
    await expect(createFlow(client, { wabaId: "999" }, null as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(createFlow(client, { wabaId: "999" }, { name: "", categories: ["SIGN_UP"], flowJson: minimalFlowJson() })).rejects.toThrow(GraphRequestValidationError);
    await expect(createFlow(client, { wabaId: "999" }, { name: "n", categories: [], flowJson: minimalFlowJson() })).rejects.toThrow(GraphRequestValidationError);
    await expect(createFlow(client, { wabaId: "999" }, { name: "n", categories: ["SIGN_UP", "CONTACT_US", "APPOINTMENT_BOOKING", "LEAD_GENERATION", "OTHER", "TOO_MANY"], flowJson: minimalFlowJson() })).rejects.toThrow(GraphRequestValidationError);
    await expect(createFlow(client, { wabaId: "999" }, { name: "n", categories: ["SIGN_UP"], endpointUri: " javascript:alert(1)", flowJson: minimalFlowJson() })).rejects.toThrow(GraphRequestValidationError);
    await expect(updateFlowMetadata(client, { flowId: "flow1" }, { endpointUri: "ftp://example.test" })).rejects.toThrow(GraphRequestValidationError);

    const categories = ["SIGN_UP"] as unknown[];
    Object.defineProperty(categories, "map", { value: () => { throw new Error("map should not run"); } });
    await expect(createFlow(client, { wabaId: "999" }, { name: "n", categories: categories as never, flowJson: minimalFlowJson() })).rejects.toThrow(GraphRequestValidationError);

    const oversizedText = "x".repeat(16_385);
    await expect(createFlow(client, { wabaId: "999" }, { name: "n", categories: ["SIGN_UP"], flowJson: minimalFlowJson({ text: oversizedText }) })).rejects.toThrow(GraphRequestValidationError);
  });

  test("Flow body mapping rejects unknown accessor fields without invoking getters", async () => {
    const { client } = clientWith(ok());
    const createBody = { name: "n", categories: ["SIGN_UP"], flowJson: minimalFlowJson() } as Record<string, unknown>;
    Object.defineProperty(createBody, "unknown", { enumerable: true, get() { throw new TypeError("unknown getter should not run"); } });
    await expect(createFlow(client, { wabaId: "999" }, createBody as never)).rejects.toThrow(GraphRequestValidationError);

    const updateBody = { name: "renamed" } as Record<string, unknown>;
    Object.defineProperty(updateBody, "unknown", { enumerable: true, get() { throw new TypeError("unknown getter should not run"); } });
    await expect(updateFlowMetadata(client, { flowId: "flow1" }, updateBody as never)).rejects.toThrow(GraphRequestValidationError);

    await expect(createFlow(client, { wabaId: "999" }, { name: "n", categories: ["SIGN_UP"], flowJson: minimalFlowJson(), constructor: { polluted: true } } as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(updateFlowMetadata(client, { flowId: "flow1" }, { name: "renamed", prototype: { polluted: true } } as never)).rejects.toThrow(GraphRequestValidationError);
  });
});
