// WATS-163 — TELEMETRY-B: redacted /status operator endpoint.
//
// A GET /status endpoint that reports what this WATS service instance is
// doing without leaking secrets. Governed by the WATS-161 telemetry taxonomy:
//   - opt-in and protected (bearer token), telemetry endpoints diverge from
//     the 401 message-route posture and return 404 on missing/bad token to
//     avoid leaking endpoint existence;
//   - redacted: no tokens, app secrets, verify tokens, phone numbers, WABA
//     ids, config file paths, stack traces, raw webhook bodies, message text;
//   - separate from liveness/readiness — /healthz and /readyz are unchanged.
//
// Safe fields only: package version, uptime, Graph API version, service mode,
// templated route inventory, persistence adapter health summary, feature flags.

import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import type { MessageRecord, MessageRecordInput, OutboxItem } from "@wats/persistence";
import { createWatsServiceApp, type WatsServiceConfig } from "../src/index";

function memoryStore() {
  return {
    backend: "sqlite" as const,
    async migrate() { return { currentVersion: 1, appliedMigrations: [], alreadyCurrent: true }; },
    async health() { return { ok: true, backend: "sqlite" as const, currentVersion: 1, redactedLocation: "[REDACTED_SQLITE_DATABASE]" }; },
    async recordWebhookEvent() { return "recorded" as const; },
    async getServiceRequest() { return null; },
    async recordServiceRequest() {},
    async enqueueOutboxItem() { return "enqueued" as const; },
    async claimOutboxItems(): Promise<readonly OutboxItem[]> { return []; },
    async markOutboxItemFailed() {},
    async markOutboxItemSucceeded() {},
    async recordMessage(_input: MessageRecordInput) {},
    async appendMessageStatus() {},
    async getMessage(): Promise<MessageRecord | null> { return null; },
    async listMessages() { return { items: [] as readonly MessageRecord[], nextCursor: null }; },
    async getLatestInboundMessageAt(): Promise<string | null> { return null; },
    async close() {}
  };
}

function createLocalMockTransport(responseBody: unknown) {
  return {
    async request() {
      const text = JSON.stringify(responseBody);
      return {
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: null,
        async arrayBuffer() { return new TextEncoder().encode(text).buffer; },
        async text() { return text; },
        async json<T = unknown>() { return responseBody as T; }
      };
    }
  };
}

const PHONE_NUMBER_ID = "15551234567";
const WABA_ID = "123456789012345";

function profile(): WatsProfileConfig {
  return {
    graph: { apiVersion: "v25.0", baseUrl: "https://graph.test/root/" },
    whatsapp: { wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID },
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
    }
  };
}

const SECRETS = {
  accessToken: "graph-access-token-SECRET",
  webhookVerifyToken: "verify-token-SECRET",
  webhookAppSecret: "app-secret-SECRET",
  serviceBearerToken: "service-bearer-SECRET"
};

function config(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  return {
    profile: profile(),
    secrets: SECRETS,
    transport: createLocalMockTransport({ messages: [{ id: "wamid.TEST" }] }),
    ...overrides
  };
}

function statusReq(headers?: Record<string, string>): Request {
  return new Request("https://svc.test/status", { method: "GET", headers });
}

function authedStatusReq(): Request {
  return statusReq({ authorization: `Bearer ${SECRETS.serviceBearerToken}` });
}

describe("WATS-163 redacted /status operator endpoint", () => {
  test("authorized GET /status returns 200 with the safe operator schema", async () => {
    const app = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never }));
    const res = await app.fetch(authedStatusReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;

    // Safe operator fields.
    expect(typeof body.version).toBe("string");
    expect(body.service).toBe("wats");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.uptimeSeconds as number).toBeGreaterThanOrEqual(0);
    expect(body.graphApiVersion).toBe("v25.0");
    expect(typeof body.serviceMode).toBe("string");
    expect(Array.isArray(body.routes)).toBe(true);
    expect(isRecord(body.featureFlags)).toBe(true);
    // Persistence health summary (already-redacted shape).
    expect(isRecord(body.persistence)).toBe(true);
    const persistence = body.persistence as Record<string, unknown>;
    expect(persistence.ok).toBe(true);
    expect(persistence.backend).toBe("sqlite");
    expect(typeof persistence.currentVersion).toBe("number");
  });

  test("route inventory is templated, never raw ids", async () => {
    const app = createWatsServiceApp(config({ enableGroupRoutes: true }));
    const res = await app.fetch(authedStatusReq());
    const body = (await res.json()) as { routes: string[] };
    const routes = body.routes;
    // Must contain templated forms, not raw path ids.
    expect(routes.some((r) => r.includes(":id") || r.includes(":groupId"))).toBe(true);
    for (const route of routes) {
      // No bare numeric/opaque id segment leaked into the inventory.
      expect(route).not.toMatch(/\/\d{5,}/u);
      expect(route).not.toContain(WABA_ID);
      expect(route).not.toContain(PHONE_NUMBER_ID);
    }
  });

  test("/status payload never leaks secrets, ids, paths, or PII", async () => {
    const app = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never }));
    const res = await app.fetch(authedStatusReq());
    const text = await res.text();
    // No secret material.
    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("SECRET");
    // No WhatsApp identifiers.
    expect(text).not.toContain(WABA_ID);
    expect(text).not.toContain(PHONE_NUMBER_ID);
    // No env-secret ref names or config paths.
    expect(text).not.toContain("WATS_ACCESS_TOKEN");
    expect(text).not.toContain("WATS_SERVICE_BEARER_TOKEN");
    expect(text).not.toContain("graph.test");
    // No stack-trace or raw error shape.
    expect(text).not.toMatch(/at \w+ \(/u);
  });

  test("missing token returns 404 (telemetry hides existence), not 401", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(statusReq());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("not_found");
  });

  test("wrong token returns 404 with a body byte-identical to the catch-all 404", async () => {
    const app = createWatsServiceApp(config());
    const statusRes = await app.fetch(statusReq({ authorization: "Bearer wrong-token" }));
    const catchAllRes = await app.fetch(new Request("https://svc.test/no-such-route", { method: "GET" }));
    expect(statusRes.status).toBe(404);
    expect(catchAllRes.status).toBe(404);
    expect(await statusRes.text()).toBe(await catchAllRes.text());
  });

  test("non-GET /status is rejected after auth without leaking existence to anonymous callers", async () => {
    const app = createWatsServiceApp(config());
    // Anonymous POST must still 404 (no existence leak).
    const anon = await app.fetch(new Request("https://svc.test/status", { method: "POST" }));
    expect(anon.status).toBe(404);
  });

  test("/healthz and /readyz behavior is unchanged", async () => {
    const app = createWatsServiceApp(config());
    const health = await app.fetch(new Request("https://svc.test/healthz"));
    const ready = await app.fetch(new Request("https://svc.test/readyz"));
    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "wats" });
    expect(await ready.json()).toEqual({ ok: true, service: "wats" });
    // Health/readiness must NOT require auth (unlike /status).
    expect(health.headers.get("content-type")).toContain("application/json");
  });

  test("/status is published in the OpenAPI document behind bearer security", async () => {
    const app = createWatsServiceApp(config());
    const doc = (await (await app.fetch(new Request("https://svc.test/openapi.json"))).json()) as {
      paths: Record<string, { get?: { security?: unknown; responses?: Record<string, unknown> } }>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toContain("/status");
    const statusGet = doc.paths["/status"].get;
    expect(statusGet?.security).toEqual([{ serviceBearerAuth: [] }]);
    // 404 (existence-hiding) is documented; 401 is intentionally absent.
    expect(Object.keys(statusGet?.responses ?? {})).toContain("404");
    expect(Object.keys(statusGet?.responses ?? {})).not.toContain("401");
    expect(doc.components.schemas.StatusResponse).toBeDefined();
  });

  test("serviceMode and featureFlags reflect persistence and group-route configuration", async () => {
    const withGroups = createWatsServiceApp(config({ enableGroupRoutes: true, persistence: memoryStore() as unknown as never }));
    const body = (await (await withGroups.fetch(authedStatusReq())).json()) as {
      featureFlags: Record<string, unknown>;
      persistence: unknown;
    };
    expect(body.featureFlags.groupRoutes).toBe(true);
    expect(body.featureFlags.persistence).toBe(true);

    const minimal = createWatsServiceApp(config());
    const minimalBody = (await (await minimal.fetch(authedStatusReq())).json()) as {
      featureFlags: Record<string, unknown>;
      persistence: unknown;
    };
    expect(minimalBody.featureFlags.groupRoutes).toBe(false);
    expect(minimalBody.featureFlags.persistence).toBe(false);
    // No persistence => persistence summary is null, not a fabricated health record.
    expect(minimalBody.persistence).toBeNull();
  });

  test("persistence health failure yields a redacted unhealthy summary, never an error body", async () => {
    // health() rejects.
    const rejecting = { ...memoryStore(), async health() { throw new Error("connect ECONNREFUSED /var/run/wats.sock trace"); } };
    const rejectingApp = createWatsServiceApp(config({ persistence: rejecting as unknown as never }));
    const rejectingRes = await rejectingApp.fetch(authedStatusReq());
    expect(rejectingRes.status).toBe(200);
    const rejectingText = await rejectingRes.text();
    expect(rejectingText).not.toContain("ECONNREFUSED");
    expect(rejectingText).not.toContain("/var/run");
    const rejectingBody = (await (await rejectingApp.fetch(authedStatusReq())).json()) as { persistence: Record<string, unknown> };
    expect(rejectingBody.persistence.ok).toBe(false);
    expect(rejectingBody.persistence.backend).toBe("unknown");
    expect(rejectingBody.persistence.redactedLocation).toBe("[REDACTED]");

    // health() throws synchronously.
    const throwing = { ...memoryStore(), health() { throw new Error("boom"); } };
    const throwingRes = await createWatsServiceApp(config({ persistence: throwing as unknown as never })).fetch(authedStatusReq());
    expect(throwingRes.status).toBe(200);
    const throwingBody = (await throwingRes.json()) as { persistence: Record<string, unknown> };
    expect(throwingBody.persistence.ok).toBe(false);
  });

  test("a non-conforming adapter cannot leak a real path via redactedLocation", async () => {
    // A custom adapter returns a filesystem path where a redacted token is expected.
    const leaky = {
      ...memoryStore(),
      async health() {
        return { ok: true, backend: "sqlite" as const, currentVersion: 1, redactedLocation: "/home/operator/secret/wats.db" };
      }
    };
    const app = createWatsServiceApp(config({ persistence: leaky as unknown as never }));
    const text = await (await app.fetch(authedStatusReq())).text();
    expect(text).not.toContain("/home/operator");
    expect(text).not.toContain("secret/wats.db");
    const body = (await (await app.fetch(authedStatusReq())).json()) as { persistence: Record<string, unknown> };
    // Clamped to the safe token because it was not already in [REDACTED...] form.
    expect(body.persistence.redactedLocation).toBe("[REDACTED]");
  });

  test("404 for /status is byte-identical to the catch-all across the auth-failure matrix", async () => {
    const app = createWatsServiceApp(config());
    const catchAll = await app.fetch(new Request("https://svc.test/no-such-route", { method: "GET" }));
    const catchAllText = await catchAll.text();
    const catchAllType = catchAll.headers.get("content-type");

    const cases: RequestInit[] = [
      { method: "GET" }, // missing header
      { method: "GET", headers: { authorization: "Bearer" } }, // malformed (no token)
      { method: "GET", headers: { authorization: "Basic abc" } }, // wrong scheme
      { method: "GET", headers: { authorization: "Bearer wrong-token" } }, // wrong token
      { method: "POST" }, // anonymous non-GET
      { method: "HEAD" },
      { method: "OPTIONS" }
    ];
    for (const init of cases) {
      const res = await app.fetch(new Request("https://svc.test/status", init));
      expect(res.status, `status for ${JSON.stringify(init)}`).toBe(404);
      // HEAD responses carry no body by spec; compare body only for non-HEAD.
      if ((init.method ?? "GET") !== "HEAD") {
        expect(await res.text(), `body for ${JSON.stringify(init)}`).toBe(catchAllText);
      }
      expect(res.headers.get("content-type"), `content-type for ${JSON.stringify(init)}`).toBe(catchAllType);
    }
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
