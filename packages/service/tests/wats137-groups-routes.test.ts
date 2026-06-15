import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createMockTransport } from "@wats/graph/testing";
import {
  createWatsServiceApp,
  createWatsServiceOpenApiDocument,
  type WatsServiceConfig,
  WatsServiceError
} from "@wats/service";

function profile(overrides: Partial<WatsProfileConfig> = {}): WatsProfileConfig {
  return {
    graph: { apiVersion: "v25.0", baseUrl: "https://graph.test/root/" },
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
    defaultResponse: { status: 200, body: { request_id: "grp-request-1" } }
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

function authed(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      authorization: "Bearer service-bearer",
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined)
    }
  };
}

function body(req: { readonly body?: BodyInit | null }): unknown {
  return JSON.parse(String(req.body));
}

describe("WATS-137 opt-in group service routes", () => {
  test("group routes are absent by default and present only when explicitly enabled", async () => {
    const disabled = createWatsServiceApp(config());
    const disabledRes = await disabled.fetch(new Request("https://service.test/api/groups", authed({ method: "GET" })));
    expect(disabledRes.status).toBe(404);

    const mock = createMockTransport({ defaultResponse: { status: 200, body: { data: { groups: [] } } } });
    const enabled = createWatsServiceApp(config({ transport: mock.transport, enableGroupRoutes: true }));
    const enabledRes = await enabled.fetch(new Request("https://service.test/api/groups?limit=2&after=cursor-1", authed({ method: "GET" })));

    expect(enabledRes.status).toBe(200);
    expect(mock.requests.length).toBe(1);
    expect(mock.requests[0]!.method).toBe("GET");
    expect(mock.requests[0]!.url).toBe("https://graph.test/root/v25.0/15551234567/groups?limit=2&after=cursor-1");
  });

  test("group routes require service bearer auth and never leak bearer or Graph tokens", async () => {
    const mock = createMockTransport({ defaultResponse: { status: 200, body: { request_id: "nope" } } });
    const app = createWatsServiceApp(config({ transport: mock.transport, enableGroupRoutes: true }));

    const cases = [
      undefined,
      "Bearer wrong",
      "Basic service-bearer",
      "service-bearer"
    ];
    for (const authorization of cases) {
      const res = await app.fetch(new Request("https://service.test/api/groups", {
        method: "POST",
        headers: authorization === undefined ? { "content-type": "application/json" } : { authorization, "content-type": "application/json" },
        body: JSON.stringify({ subject: "Release crew" })
      }));
      expect(res.status, authorization ?? "missing").toBe(401);
      const text = await res.text();
      expect(text).not.toContain("service-bearer");
      expect(text).not.toContain("graph-access-token");
    }
    expect(mock.requests.length).toBe(0);
  });

  test("creates, reads, updates, deletes, invite-links, participants, and join-requests with exact Graph methods", async () => {
    const mock = createMockTransport({ defaultResponse: { status: 200, body: { request_id: "grp-request-1" } } });
    const app = createWatsServiceApp(config({ transport: mock.transport, enableGroupRoutes: true }));
    const calls: Array<[string, string, unknown?]> = [
      ["POST", "/api/groups", { subject: "Release crew", description: "Launch room", joinApprovalMode: "approval_required" }],
      ["GET", "/api/groups/grp-123?fields=subject,participants"],
      ["POST", "/api/groups/grp-123", { subject: "Renamed" }],
      ["DELETE", "/api/groups/grp-123"],
      ["GET", "/api/groups/grp-123/invite-link"],
      ["POST", "/api/groups/grp-123/invite-link"],
      ["DELETE", "/api/groups/grp-123/participants", { waIds: ["15550001111"] }],
      ["GET", "/api/groups/grp-123/join-requests?limit=3&after=cursor-2"],
      ["POST", "/api/groups/grp-123/join-requests", { joinRequestIds: ["jr-1"] }],
      ["DELETE", "/api/groups/grp-123/join-requests", { joinRequestIds: ["jr-2"] }]
    ];

    for (const [method, path, payload] of calls) {
      const res = await app.fetch(new Request(`https://service.test${path}`, authed({
        method,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
      })));
      expect(res.status, `${method} ${path}`).toBe(200);
    }

    expect(mock.requests.map((req) => [req.method, new URL(req.url).pathname + new URL(req.url).search])).toEqual([
      ["POST", "/root/v25.0/15551234567/groups"],
      ["GET", "/root/v25.0/grp-123?fields=subject%2Cparticipants"],
      ["POST", "/root/v25.0/grp-123"],
      ["DELETE", "/root/v25.0/grp-123"],
      ["GET", "/root/v25.0/grp-123/invite_link"],
      ["POST", "/root/v25.0/grp-123/invite_link"],
      ["DELETE", "/root/v25.0/grp-123/participants"],
      ["GET", "/root/v25.0/grp-123/join_requests?limit=3&after=cursor-2"],
      ["POST", "/root/v25.0/grp-123/join_requests"],
      ["DELETE", "/root/v25.0/grp-123/join_requests"]
    ]);
    expect(body(mock.requests[0]!)).toEqual({ messaging_product: "whatsapp", subject: "Release crew", description: "Launch room", join_approval_mode: "approval_required" });
    expect(body(mock.requests[5]!)).toEqual({ messaging_product: "whatsapp" });
    expect(body(mock.requests[6]!)).toEqual({ messaging_product: "whatsapp", action: "remove", participants: [{ wa_id: "15550001111" }] });
    expect(body(mock.requests[8]!)).toEqual({ messaging_product: "whatsapp", action: "approve", join_requests: [{ join_request_id: "jr-1" }] });
    expect(body(mock.requests[9]!)).toEqual({ messaging_product: "whatsapp", action: "reject", join_requests: [{ join_request_id: "jr-2" }] });
  });

  test("group route malformed JSON and invalid bodies fail closed without transport or secret leakage", async () => {
    const mock = createMockTransport({ defaultResponse: { status: 200, body: { request_id: "nope" } } });
    const app = createWatsServiceApp(config({ transport: mock.transport, enableGroupRoutes: true }));
    const badRequests: Request[] = [
      new Request("https://service.test/api/groups", authed({ method: "POST", body: "{" })),
      new Request("https://service.test/api/groups", authed({ method: "POST", body: JSON.stringify({ subject: "" }) })),
      new Request("https://service.test/api/groups/grp-123/participants", authed({ method: "DELETE", body: JSON.stringify({ waIds: [] }) })),
      new Request("https://service.test/api/groups/grp-123/join-requests", authed({ method: "POST", body: JSON.stringify({ joinRequestIds: [] }) }))
    ];

    for (const req of badRequests) {
      const res = await app.fetch(req);
      expect(res.status, req.url).toBe(400);
      const text = await res.text();
      expect(text).not.toContain("service-bearer");
      expect(text).not.toContain("graph-access-token");
    }
    expect(mock.requests.length).toBe(0);
  });

  test("POST /messages accepts group sends and pin bodies only when group routes are enabled", async () => {
    const disabledMock = createMockTransport({ defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NOPE" }] } } });
    const disabled = createWatsServiceApp(config({ transport: disabledMock.transport }));
    const disabledMessage = await disabled.fetch(new Request("https://service.test/api/messages", authed({
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "group", to: "grp-123", type: "text", text: { body: "hello group" } })
    })));
    const disabledPin = await disabled.fetch(new Request("https://service.test/api/messages", authed({
      method: "POST",
      body: JSON.stringify({ type: "pin", to: "grp-123", pinType: "pin", messageId: "wamid.TARGET", expirationDays: 7 })
    })));
    expect(disabledMessage.status).toBe(400);
    expect(disabledPin.status).toBe(400);
    expect(disabledMock.requests.length).toBe(0);

    const mock = createMockTransport({ defaultResponse: { status: 200, body: { messages: [{ id: "wamid.GROUP" }] } } });
    const app = createWatsServiceApp(config({ transport: mock.transport, enableGroupRoutes: true }));

    const message = await app.fetch(new Request("https://service.test/api/messages", authed({
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "group", to: "grp-123", type: "text", text: { body: "hello group" } })
    })));
    expect(message.status).toBe(200);

    const pin = await app.fetch(new Request("https://service.test/api/messages", authed({
      method: "POST",
      body: JSON.stringify({ type: "pin", to: "grp-123", pinType: "pin", messageId: "wamid.TARGET", expirationDays: 7 })
    })));
    expect(pin.status).toBe(200);

    expect(body(mock.requests[0]!)).toEqual({ messaging_product: "whatsapp", recipient_type: "group", to: "grp-123", type: "text", text: { body: "hello group" } });
    expect(body(mock.requests[1]!)).toEqual({ messaging_product: "whatsapp", recipient_type: "group", to: "grp-123", type: "pin", pin: { type: "pin", message_id: "wamid.TARGET", expiration_days: 7 } });
  });

  test("rejects WATS-137 route collisions only when group routes are enabled", () => {
    const colliding = profile({ webhook: { ...profile().webhook, path: "/api/groups" } });
    expect(() => createWatsServiceOpenApiDocument(colliding)).not.toThrow();
    expect(() => createWatsServiceApp(config({ profile: colliding }))).not.toThrow();

    expect(() => createWatsServiceOpenApiDocument(colliding, { enableGroupRoutes: true })).toThrow(WatsServiceError);
    expect(() => createWatsServiceApp(config({ profile: colliding, enableGroupRoutes: true }))).toThrow(WatsServiceError);
  });

  test("malformed encoded group route params fail closed without throwing host errors", async () => {
    const app = createWatsServiceApp(config({ enableGroupRoutes: true }));
    const res = await app.fetch(new Request("https://service.test/api/groups/%E0%A4%A/join-requests", authed({ method: "GET" })));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("URIError");
  });

  test("OpenAPI advertises group routes only when enabled and marks them bearer-protected", () => {
    const disabled = createWatsServiceOpenApiDocument(profile());
    expect(disabled.paths["/api/groups"]).toBeUndefined();

    const enabled = createWatsServiceOpenApiDocument(profile(), { enableGroupRoutes: true });
    for (const path of [
      "/api/groups",
      "/api/groups/{groupId}",
      "/api/groups/{groupId}/invite-link",
      "/api/groups/{groupId}/participants",
      "/api/groups/{groupId}/join-requests"
    ]) {
      expect(enabled.paths[path], path).toBeDefined();
      const methods = Object.values(enabled.paths[path]!);
      expect(methods.every((op) => Array.isArray((op as { security?: unknown }).security))).toBe(true);
    }
    // The OpenAPI document types component schemas loosely (JSON-schema index),
    // so drill into the known ErrorEnvelope shape through a typed view.
    const schemas = enabled.components.schemas as Record<string, {
      properties: { error: { properties: { metaCode: { description: string } } } };
    }>;
    expect(schemas.ErrorEnvelope.properties.error.properties.metaCode.description).toContain("Sanitized Meta Graph error code");
  });
});
