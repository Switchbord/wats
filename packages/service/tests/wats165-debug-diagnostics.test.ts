// WATS-165 — TELEMETRY-D: redacted /debug/diagnostics support snapshot endpoint.
//
// A bounded, redacted diagnostics endpoint for local operators and support
// bundles. Governed by the WATS-161 telemetry taxonomy:
//   - opt-in and protected (bearer token) with the same existence-hiding
//     posture as /status and /metrics: 404 on missing/bad token, 405 on method
//     mismatch when authenticated;
//   - redacted: no tokens, app secrets, verify tokens, phone numbers, WABA
//     ids, config file paths, env var values, raw error messages, stack
//     traces, raw webhook bodies, message text, WAMIDs, heap/profile dumps;
//   - bounded: capped array lengths, capped string lengths, fixed schema so a
//     noisy process cannot emit an unbounded support bundle;
//   - clearly not a pprof/heap endpoint — returns JSON facts only.
//
// Covered fields: service, version, serviceMode, graphApiVersion, runtime,
// route table with template-stable route keys, feature flags, persistence
// health summary, metric family keys, recent error class counts.

import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createMockTransport } from "@wats/graph/testing";
import type { MessageRecord, MessageRecordInput, OutboxItem } from "@wats/persistence";
import {
  createWatsServiceApp,
  createWatsServiceOpenApiDocument,
  type WatsServiceConfig
} from "../src/index";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    async countOutboxPending(): Promise<number> { return 0; },
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

function diagnosticsReq(method = "GET", headers?: Record<string, string>): Request {
  return new Request("https://svc.test/debug/diagnostics", { method, headers });
}

function authedDiagnosticsReq(method = "GET"): Request {
  return diagnosticsReq(method, { authorization: `Bearer ${SECRETS.serviceBearerToken}` });
}

describe("WATS-165 redacted /debug/diagnostics support snapshot", () => {
  test("authorized GET /debug/diagnostics returns 200 JSON with the safe diagnostics schema", async () => {
    const app = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never }));
    const res = await app.fetch(authedDiagnosticsReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.service).toBe("wats");
    expect(typeof body.version).toBe("string");
    expect(body.graphApiVersion).toBe("v25.0");
    expect(typeof body.serviceMode).toBe("string");
    expect(typeof body.runtime).toBe("string");
    expect(body.runtime).toMatch(/^\w+$/u);

    expect(Array.isArray(body.routes)).toBe(true);
    expect(isRecord(body.featureFlags)).toBe(true);
    expect(body.featureFlags).toHaveProperty("persistence");
    expect(body.featureFlags).toHaveProperty("groupRoutes");

    expect(isRecord(body.persistence)).toBe(true);
    const persistence = body.persistence as Record<string, unknown>;
    expect(persistence.ok).toBe(true);
    expect(persistence.backend).toBe("sqlite");

    expect(Array.isArray(body.metricFamilies)).toBe(true);
    expect((body.metricFamilies as unknown[]).length).toBeGreaterThan(0);

    expect(isRecord(body.recentErrors)).toBe(true);
  });

  test("missing or wrong bearer token returns 404, byte-identical to the catch-all", async () => {
    const app = createWatsServiceApp(config());
    const missingRes = await app.fetch(diagnosticsReq("GET"));
    const knownRes = await app.fetch(new Request("https://svc.test/unknown-route"));

    expect(missingRes.status).toBe(404);
    expect(knownRes.status).toBe(404);
    const missingText = await missingRes.text();
    const knownText = await knownRes.text();
    expect(missingText).toBe(knownText);

    const wrongRes = await app.fetch(diagnosticsReq("GET", { authorization: "Bearer WRONG" }));
    expect(wrongRes.status).toBe(404);
    expect(await wrongRes.text()).toBe(missingText);
  });

  test("wrong HTTP method with valid auth returns 405", async () => {
    const app = createWatsServiceApp(config());
    const postRes = await app.fetch(authedDiagnosticsReq("POST"));
    expect(postRes.status).toBe(405);
    expect(postRes.headers.get("allow")).toBe("GET");
  });

  test("the response never leaks tokens, secrets, ids, env values, raw paths, or error stack traces", async () => {
    // Drive an error-class into the ledger first by making a Graph call fail.
    const { transport: failTransport } = createMockTransport({
      fail: new Error("Some upstream GraphApiError with a secret token in it")
    });
    const errorApp = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never, transport: failTransport }));

    await errorApp.fetch(new Request("https://svc.test/api/messages/text", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRETS.serviceBearerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ to: "15550000000", text: "test message body" })
    }));

    const res = await errorApp.fetch(authedDiagnosticsReq());
    const raw = await res.text();
    const body = JSON.parse(raw) as Record<string, unknown>;

    expect(raw).not.toContain(SECRETS.accessToken);
    expect(raw).not.toContain(SECRETS.webhookAppSecret);
    expect(raw).not.toContain(SECRETS.webhookVerifyToken);
    expect(raw).not.toContain(SECRETS.serviceBearerToken);
    expect(raw).not.toContain(WABA_ID);
    expect(raw).not.toContain(PHONE_NUMBER_ID);
    expect(raw).not.toContain("/run/secrets/");
    expect(raw).not.toContain("Users/");
    expect(raw).not.toContain("wamid.");
    expect(raw).not.toContain("15550000000");
    expect(raw).not.toContain("test message body");
    expect(raw).not.toContain("Some upstream");
    expect(raw).not.toContain("stack");

    // The recentErrors map should contain error class names only, with counts.
    const errs = body.recentErrors as Record<string, number>;
    expect(Object.keys(errs).every((k) => typeof k === "string" && typeof errs[k] === "number")).toBe(true);
  });

  test("diagnostics payload uses template-stable route keys (no raw ids) and respects caps", async () => {
    const app = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never, enableGroupRoutes: true }));
    const res = await app.fetch(authedDiagnosticsReq());
    const body = (await res.json()) as Record<string, unknown>;
    const routes = body.routes as Record<string, unknown>[];

    // Route inventory is acceptable in either shape, but must not contain
    // raw identifiers inserted by traffic.
    expect(routes.length).toBeGreaterThan(0);
    const routeText = JSON.stringify(routes);
    expect(routeText).not.toContain(WABA_ID);
    expect(routeText).not.toContain(PHONE_NUMBER_ID);
    expect(routes.length).toBeLessThanOrEqual(50);
  });

  test("recent error ledger is capped and counts by error class only", () => {
    // Direct unit test of the bounded ledger: drive 15 distinct error classes
    // and one very long class name, then verify the cap and truncation.
    const { ErrorLedger } = require("../src/index") as { ErrorLedger: typeof import("../src/index").ErrorLedger };
    const ledger = new ErrorLedger();

    class GraphDemoError0 extends Error {}
    class GraphDemoError1 extends Error {}
    class GraphDemoError2 extends Error {}
    class GraphDemoError3 extends Error {}
    class GraphDemoError4 extends Error {}
    class GraphDemoError5 extends Error {}
    class GraphDemoError6 extends Error {}
    class GraphDemoError7 extends Error {}
    class GraphDemoError8 extends Error {}
    class GraphDemoError9 extends Error {}
    class GraphDemoError10 extends Error {}
    class GraphDemoError11 extends Error {}
    class GraphDemoError12 extends Error {}
    class GraphDemoError13 extends Error {}
    class VeryLongErrorName extends Error {}
    Object.defineProperty(VeryLongErrorName, "name", { value: `A${"a".repeat(90)}` });

    const classes = [
      GraphDemoError0,
      GraphDemoError1,
      GraphDemoError2,
      GraphDemoError3,
      GraphDemoError4,
      GraphDemoError5,
      GraphDemoError6,
      GraphDemoError7,
      GraphDemoError8,
      GraphDemoError9,
      GraphDemoError10,
      GraphDemoError11,
      GraphDemoError12,
      GraphDemoError13,
      VeryLongErrorName
    ];

    for (const Err of classes) {
      ledger.record(new Err());
    }

    const errors = ledger.snapshot();

    // MAX_ERROR_CLASSES = 10
    expect(Object.keys(errors).length).toBe(10);
    for (const [key, value] of Object.entries(errors)) {
      expect(typeof key).toBe("string");
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(key.length).toBeLessThanOrEqual(83); // 80 + "..."
    }

    // The newest class has a very long name; verify it was truncated.
    const newLongKey = Object.keys(errors).find((k) => k.startsWith("A"));
    expect(newLongKey).toBeDefined();
    const longKey = newLongKey as string;
    expect(longKey.endsWith("...")).toBe(true);
    expect(longKey.length).toBe(83);

    // The oldest classes (GraphDemoError0..GraphDemoError4) should have been
    // evicted because the cap keeps only the 10 most recently recorded keys.
    expect(errors).not.toHaveProperty("GraphDemoError0");
    expect(errors).not.toHaveProperty("GraphDemoError4");
    expect(errors).toHaveProperty("GraphDemoError5");
    expect(errors).toHaveProperty("GraphDemoError13");

    ledger.record(new GraphDemoError0());
    expect(ledger.snapshot()).toHaveProperty("GraphDemoError0");
  });

  test("config shape is summarized without exposing secret env var values or names", async () => {
    const app = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never }));
    const res = await app.fetch(authedDiagnosticsReq());
    const body = (await res.json()) as Record<string, unknown>;

    expect(isRecord(body.configShape)).toBe(true);
    const shape = body.configShape as Record<string, unknown>;
    expect(isRecord(shape.auth)).toBe(true);
    const auth = shape.auth as Record<string, unknown>;
    expect(auth.accessToken).not.toBe(SECRETS.accessToken);
    expect(auth.accessToken).toBe("[REDACTED]");

    expect(isRecord(shape.webhook)).toBe(true);
    const webhook = shape.webhook as Record<string, unknown>;
    expect(webhook.verifyToken).toBe("[REDACTED]");
    expect(webhook.appSecret).toBe("[REDACTED]");
    expect(webhook.verifyToken).not.toBe(SECRETS.webhookVerifyToken);
    expect(webhook.appSecret).not.toBe(SECRETS.webhookAppSecret);

    const serialized = JSON.stringify(shape);
    expect(serialized).not.toContain("env:");
    expect(serialized).not.toContain("WATS_");
    expect(serialized).not.toContain(SECRETS.serviceBearerToken);
    expect(serialized).not.toContain(SECRETS.webhookVerifyToken);
    expect(serialized).not.toContain(SECRETS.webhookAppSecret);
    expect(serialized).not.toContain(SECRETS.accessToken);
  });

  test("persistence backend is clamped to the known allowlist", async () => {
    const leakyStore = {
      ...memoryStore(),
      backend: "sqlite /var/secrets/wats.db" as const,
      async health() {
        return { ok: true, backend: "sqlite /var/secrets/wats.db" as const, currentVersion: 1, redactedLocation: "[REDACTED_SQLITE_DATABASE]" };
      }
    };
    const app = createWatsServiceApp(config({ persistence: leakyStore as unknown as never }));
    const res = await app.fetch(authedDiagnosticsReq());
    const body = (await res.json()) as Record<string, unknown>;
    expect(isRecord(body.persistence)).toBe(true);
    const persistence = body.persistence as Record<string, unknown>;
    expect(persistence.backend).toBe("unknown");
    expect(JSON.stringify(persistence)).not.toContain("/var/secrets");
    expect(persistence.redactedLocation).toBe("[REDACTED_SQLITE_DATABASE]");
  });

  test("persistence backend allowlist accepts in-tree sqlite and postgres values", async () => {
    const sqliteApp = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never }));
    const sqliteBody = ((await (await sqliteApp.fetch(authedDiagnosticsReq())).json()) as Record<string, unknown>);
    expect((sqliteBody.persistence as Record<string, unknown>).backend).toBe("sqlite");

    const postgresStore = { ...memoryStore(), backend: "postgres" as const, async health() { return { ok: true, backend: "postgres" as const, currentVersion: 1, redactedLocation: "[REDACTED_POSTGRES_DSN]" }; } };
    const pgApp = createWatsServiceApp(config({ persistence: postgresStore as unknown as never }));
    const pgBody = ((await (await pgApp.fetch(authedDiagnosticsReq())).json()) as Record<string, unknown>);
    expect((pgBody.persistence as Record<string, unknown>).backend).toBe("postgres");
  });

  test("OpenAPI document includes /debug/diagnostics with bearer security", () => {
    const doc = createWatsServiceOpenApiDocument(profile());
    const paths = doc.paths as Record<string, unknown>;
    expect(paths).toHaveProperty("/debug/diagnostics");
    const operation = (paths["/debug/diagnostics"] as Record<string, unknown>).get as Record<string, unknown>;
    expect(operation.security).toEqual([{ serviceBearerAuth: [] }]);
  });
});
