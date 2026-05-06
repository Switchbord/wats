import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@switchbord/config";
import {
  createWatsServiceApp,
  createWatsServiceOpenApiDocument,
  WatsServiceError,
  type WatsServiceConfig,
  type WatsServiceOpenApiOptions
} from "@switchbord/service";
import { createMockTransport } from "@switchbord/graph/testing";

function profile(overrides: Partial<WatsProfileConfig> = {}): WatsProfileConfig {
  return {
    graph: { apiVersion: "v21.0", baseUrl: "https://graph.test/root/" },
    whatsapp: { wabaId: "123456789012345", phoneNumberId: "15551234567" },
    auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
    webhook: {
      path: "/webhooks/whatsapp",
      verifyToken: { env: "WATS_WEBHOOK_VERIFY_TOKEN" },
      appSecret: { env: "WATS_WEBHOOK_APP_SECRET" },
      maxBodyBytes: 1_048_576
    },
    service: {
      host: "127.0.0.1",
      port: 8787,
      apiPrefix: "/api",
      bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
    },
    ...overrides
  };
}

function config(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  const mock = createMockTransport({
    defaultResponse: {
      status: 200,
      body: { messaging_product: "whatsapp", messages: [{ id: "wamid.TEST" }] }
    }
  });
  return {
    profile: profile(),
    secrets: {
      accessToken: "graph-access-token",
      webhookVerifyToken: "verify-token",
      webhookAppSecret: "app-secret",
      serviceBearerToken: "service-bearer"
    },
    transport: mock.transport,
    ...overrides
  };
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  expect(typeof value, label).toBe("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as Record<string, unknown>;
}

function operation(doc: unknown, path: string, method: string): Record<string, unknown> {
  const root = jsonRecord(doc, "openapi document");
  const paths = jsonRecord(root.paths, "paths");
  const item = jsonRecord(paths[path], `path ${path}`);
  return jsonRecord(item[method], `${method.toUpperCase()} ${path}`);
}

function hasBearerSecurity(op: Record<string, unknown>): boolean {
  const security = op.security;
  return Array.isArray(security) && security.some((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    return Array.isArray((entry as Record<string, unknown>).serviceBearerAuth);
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return jsonRecord(await response.json(), "response JSON");
}

describe("WATS-35 OpenAPI document generator", () => {
  test("exports a public generator with OpenAPI 3.1 metadata, servers, route paths, schemas, and service bearer scheme", () => {
    expect(typeof createWatsServiceOpenApiDocument).toBe("function");
    const options: WatsServiceOpenApiOptions = { serverUrl: "https://service.test" };
    const doc = createWatsServiceOpenApiDocument(profile(), options);

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("WATS Service API");
    expect(doc.info.version).toBe("0.2.0");
    expect(doc.servers).toEqual([{ url: "https://service.test" }]);

    expect(Object.keys(doc.paths).sort()).toEqual([
      "/api/messages",
      "/api/messages/text",
      "/healthz",
      "/openapi.json",
      "/readyz",
      "/webhooks/whatsapp"
    ]);

    expect(doc.components.securitySchemes.serviceBearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "opaque"
    });
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining([
      "BasicInteractiveMessageBody",
      "ErrorEnvelope",
      "GenericTextMessageBody",
      "GraphResponsePassthrough",
      "HealthResponse",
      "ContactsMessageBody",
      "LocationMessageBody",
      "MediaMessageBody",
      "ReactionMessageBody",
      "ReadyResponse",
      "SupportedMessageBody",
      "TextMessageBody"
    ]));
    const genericMessagesOperation = operation(doc, "/api/messages", "post");
    const requestBody = jsonRecord(genericMessagesOperation.requestBody, "POST /messages requestBody");
    const content = jsonRecord(requestBody.content, "POST /messages content");
    const json = jsonRecord(content["application/json"], "POST /messages application/json");
    expect(json.schema).toEqual({ "$ref": "#/components/schemas/SupportedMessageBody" });
    expect(doc.components.schemas.SupportedMessageBody.oneOf).toEqual([
      { "$ref": "#/components/schemas/GenericTextMessageBody" },
      { "$ref": "#/components/schemas/MediaMessageBody" },
      { "$ref": "#/components/schemas/LocationMessageBody" },
      { "$ref": "#/components/schemas/ContactsMessageBody" },
      { "$ref": "#/components/schemas/ReactionMessageBody" },
      { "$ref": "#/components/schemas/BasicInteractiveMessageBody" }
    ]);
    const mediaSchema = jsonRecord(doc.components.schemas.MediaMessageBody, "MediaMessageBody schema");
    const mediaProperties = jsonRecord(mediaSchema.properties, "MediaMessageBody properties");
    expect(mediaProperties.type).toEqual({
      type: "string",
      enum: ["image", "video", "audio", "document", "sticker"]
    });
    expect(mediaSchema.oneOf).toEqual([
      { required: ["mediaId"], not: { required: ["link"] } },
      { required: ["link"], not: { required: ["mediaId"] } }
    ]);
    const locationSchema = jsonRecord(doc.components.schemas.LocationMessageBody, "LocationMessageBody schema");
    expect(locationSchema.required).toEqual(["type", "to", "latitude", "longitude"]);
    const contactsSchema = jsonRecord(doc.components.schemas.ContactsMessageBody, "ContactsMessageBody schema");
    expect(contactsSchema.required).toEqual(["type", "to", "contacts"]);
    const reactionSchema = jsonRecord(doc.components.schemas.ReactionMessageBody, "ReactionMessageBody schema");
    expect(Array.isArray(reactionSchema.oneOf)).toBe(true);
    const interactiveSchema = jsonRecord(doc.components.schemas.BasicInteractiveMessageBody, "BasicInteractiveMessageBody schema");
    expect(Array.isArray(interactiveSchema.oneOf)).toBe(true);
  });

  test("marks only service message routes with bearer security", () => {
    const doc = createWatsServiceOpenApiDocument(profile());

    expect(hasBearerSecurity(operation(doc, "/api/messages/text", "post"))).toBe(true);
    expect(hasBearerSecurity(operation(doc, "/api/messages", "post"))).toBe(true);

    expect(hasBearerSecurity(operation(doc, "/healthz", "get"))).toBe(false);
    expect(hasBearerSecurity(operation(doc, "/readyz", "get"))).toBe(false);
    expect(hasBearerSecurity(operation(doc, "/webhooks/whatsapp", "get"))).toBe(false);
    expect(hasBearerSecurity(operation(doc, "/webhooks/whatsapp", "post"))).toBe(false);
    expect(hasBearerSecurity(operation(doc, "/openapi.json", "get"))).toBe(false);
  });

  test("does not leak raw secrets or config env-var secret references in generated JSON", () => {
    const doc = createWatsServiceOpenApiDocument(profile());
    const serialized = JSON.stringify(doc);

    for (const forbidden of [
      "graph-access-token",
      "service-bearer",
      "app-secret",
      "verify-token",
      "WATS_ACCESS_TOKEN",
      "WATS_WEBHOOK_VERIFY_TOKEN",
      "WATS_WEBHOOK_APP_SECRET",
      "WATS_SERVICE_BEARER_TOKEN"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("reflects custom safe webhook path, apiPrefix, and server URL without query/hash injection", () => {
    const custom = profile({
      webhook: { ...profile().webhook, path: "/hooks/custom" },
      service: { ...profile().service, apiPrefix: "/v1/internal" }
    });
    const doc = createWatsServiceOpenApiDocument(custom, { serverUrl: "https://service.example/base?ignored=1#fragment" });

    expect(Object.keys(doc.paths).sort()).toEqual([
      "/healthz",
      "/hooks/custom",
      "/openapi.json",
      "/readyz",
      "/v1/internal/messages",
      "/v1/internal/messages/text"
    ]);
    expect(doc.servers).toEqual([{ url: "https://service.example/base" }]);
  });

  test("rejects malformed profile paths and OpenAPI option shapes with WatsServiceError", () => {
    const unsafePaths = [
      "webhook",
      "/",
      "/../secret",
      "/%2e%2e/secret",
      "/hook?x=1",
      "/hook#frag",
      "/hook\\evil",
      "/hook\u0000bad",
      "",
      "   "
    ];

    for (const unsafe of unsafePaths) {
      expect(() =>
        createWatsServiceOpenApiDocument(profile({ webhook: { ...profile().webhook, path: unsafe } }))
      ).toThrow(WatsServiceError);
      expect(() =>
        createWatsServiceOpenApiDocument(profile({ service: { ...profile().service, apiPrefix: unsafe } }))
      ).toThrow(WatsServiceError);
    }

    const optionCases: unknown[] = [
      null,
      "https://service.test",
      { serverUrl: "" },
      { serverUrl: "   " },
      { serverUrl: "notaurl" },
      { serverUrl: "https://service.test/has\\backslash" },
      { serverUrl: "javascript:alert(1)" }
    ];

    for (const options of optionCases) {
      expect(() => createWatsServiceOpenApiDocument(profile(), options as WatsServiceOpenApiOptions)).toThrow(WatsServiceError);
    }
  });

  test("rejects profile path collisions with reserved service and message routes", () => {
    const reservedWebhookPaths = [
      "/healthz",
      "/readyz",
      "/openapi.json",
      "/api/messages",
      "/api/messages/text"
    ];

    for (const path of reservedWebhookPaths) {
      expect(() =>
        createWatsServiceOpenApiDocument(profile({ webhook: { ...profile().webhook, path } }))
      ).toThrow(WatsServiceError);
      expect(() => createWatsServiceApp(config({ profile: profile({ webhook: { ...profile().webhook, path } }) }))).toThrow(WatsServiceError);
    }

    const collidingPrefixes = ["/healthz", "/readyz", "/openapi.json", "/webhooks/whatsapp"];
    for (const apiPrefix of collidingPrefixes) {
      expect(() =>
        createWatsServiceOpenApiDocument(profile({ service: { ...profile().service, apiPrefix } }))
      ).toThrow(WatsServiceError);
      expect(() => createWatsServiceApp(config({ profile: profile({ service: { ...profile().service, apiPrefix } }) }))).toThrow(WatsServiceError);
    }
  });
});

describe("WATS-35 /openapi.json service route", () => {
  test("serves the generated OpenAPI JSON without service bearer auth", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/openapi.json"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const doc = await responseJson(res);
    expect(doc.openapi).toBe("3.1.0");
    expect(JSON.stringify(doc)).not.toContain("service-bearer");
  });

  test("returns 405 with Allow GET for OpenAPI method mismatch", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/openapi.json", { method: "POST" }));

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(await responseJson(res)).toEqual({
      error: { code: "method_not_allowed", message: "Method not allowed." }
    });
  });
});
