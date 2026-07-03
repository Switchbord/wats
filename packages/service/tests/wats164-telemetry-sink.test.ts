// WATS-164 — TELEMETRY-C: OpenTelemetry-compatible telemetry hook seams.
//
// Exposes a TelemetrySink interface so apps can bridge WATS telemetry into
// OpenTelemetry JS (or any backend) without WATS taking a hard @opentelemetry/*
// runtime dependency. The internal /metrics registry is fed through the same
// seam so Prometheus exposition and user sinks receive consistent data.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createCryptoProvider } from "@wats/crypto";
import { createMockTransport } from "@wats/graph/testing";
import type { MessageRecord, MessageRecordInput, OutboxItem } from "@wats/persistence";
import {
  createWatsServiceApp,
  type WatsServiceConfig,
  CapturingTelemetrySink,
  NOOP_TELEMETRY_SINK,
  OTEL_ATTR,
  type TelemetrySink
} from "../src/index";
import type { WatsProfileConfig } from "@wats/config";

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
    async close() {}
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
  const mock = createMockTransport({
    defaultResponse: { status: 200, body: { messaging_product: "whatsapp", messages: [{ id: "wamid.TEST" }] } }
  });
  return {
    profile: profile(),
    secrets: SECRETS,
    transport: mock.transport,
    persistence: memoryStore() as unknown as never,
    ...overrides
  };
}

async function signature(secret: string, body: string): Promise<string> {
  const provider = await createCryptoProvider();
  const bytes = await provider.hmacSha256(secret, body);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `sha256=${hex}`;
}

function sendAuthedPost(body: unknown): Request {
  return new Request("https://svc.test/api/messages/text", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRETS.serviceBearerToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function authedGet(path: string): Request {
  return new Request(`https://svc.test${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${SECRETS.serviceBearerToken}` }
  });
}

describe("WATS-164 OpenTelemetry-compatible telemetry sink", () => {
  test("default app works without a user sink and /metrics still populates", async () => {
    const app = createWatsServiceApp(config());
    await app.fetch(new Request("https://svc.test/healthz"));
    const res = await app.fetch(authedGet("/metrics"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("http_requests_total{");
    expect(text).toContain("http_request_duration_seconds_count{");
  });

  test("user sink receives counters and histograms with OTel attribute keys", async () => {
    const sink = new CapturingTelemetrySink();
    const app = createWatsServiceApp(config({ telemetrySink: sink }));

    await app.fetch(new Request("https://svc.test/healthz"));
    await app.fetch(sendAuthedPost({ to: PHONE_NUMBER_ID, text: "hello world" }));

    const httpCounters = sink.counters.filter((c) => c.name === "http_requests_total");
    expect(httpCounters.length).toBeGreaterThan(0);
    for (const c of httpCounters) {
      expect(c.attributes[OTEL_ATTR.httpRoute]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.httpMethod]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.httpStatusCode]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.httpStatusClass]).toBeDefined();
      expect(c.value).toBe(1);
    }

    const graphCounters = sink.counters.filter((c) => c.name === "graph_operations_total");
    expect(graphCounters.length).toBeGreaterThanOrEqual(1);
    for (const c of graphCounters) {
      expect(c.attributes[OTEL_ATTR.graphEndpointFamily]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.httpStatusCode]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.httpStatusClass]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.operationOutcome]).toBeDefined();
      expect(["success", "error"]).toContain(c.attributes[OTEL_ATTR.operationOutcome]);
    }

    const sendCounters = sink.counters.filter((c) => c.name === "send_outcomes_total");
    expect(sendCounters.length).toBeGreaterThanOrEqual(1);
    for (const c of sendCounters) {
      expect(c.attributes[OTEL_ATTR.graphEndpointFamily]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.operationOutcome]).toBeDefined();
    }

    const persistenceCounters = sink.counters.filter((c) => c.name === "persistence_operations_total");
    // Persistence is injected, so at least some write-side projection calls fire.
    expect(persistenceCounters.length).toBeGreaterThan(0);
    for (const c of persistenceCounters) {
      expect(c.attributes[OTEL_ATTR.persistenceAdapter]).toBe("sqlite");
      expect(c.attributes[OTEL_ATTR.operationOutcome]).toBeDefined();
    }

    expect(sink.histograms.length).toBeGreaterThan(0);
    for (const h of sink.histograms) {
      expect(h.name).toBe("http_request_duration_seconds");
      expect(Number.isFinite(h.valueSeconds)).toBe(true);
      expect(h.valueSeconds).toBeGreaterThanOrEqual(0);
      expect(h.attributes[OTEL_ATTR.httpRoute]).toBeDefined();
      expect(h.attributes[OTEL_ATTR.httpStatusClass]).toBeDefined();
    }
  });

  test("user sink attributes are sanitized (no PII, ids, secrets, or raw path ids)", async () => {
    const sink = new CapturingTelemetrySink();
    const app = createWatsServiceApp(config({ telemetrySink: sink }));

    await app.fetch(sendAuthedPost({ to: PHONE_NUMBER_ID, text: "hello world" }));

    const allAttributes = JSON.stringify([...sink.counters.map((c) => c.attributes), ...sink.histograms.map((h) => h.attributes)]);
    expect(allAttributes).not.toContain(PHONE_NUMBER_ID);
    expect(allAttributes).not.toContain("15551234567");
    expect(allAttributes).not.toContain("wamid");
    expect(allAttributes).not.toContain("hello world");
    expect(allAttributes).not.toContain(SECRETS.serviceBearerToken);
    expect(allAttributes).not.toContain(SECRETS.accessToken);
    expect(allAttributes).not.toContain("secret");

    const httpCounters = sink.counters.filter((c) => c.name === "http_requests_total");
    const apiRouteCounter = httpCounters.find((c) => c.attributes[OTEL_ATTR.httpRoute] === "/api/messages/text");
    expect(apiRouteCounter).toBeDefined();
  });

  test("webhook normalization is reported to the user sink", async () => {
    const sink = new CapturingTelemetrySink();
    const app = createWatsServiceApp(config({ telemetrySink: sink }));

    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: WABA_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            messages: [{
              from: PHONE_NUMBER_ID,
              id: "wamid.EVT01",
              timestamp: Date.now().toString(),
              type: "text",
              text: { body: "hello" }
            }]
          }
        }]
      }]
    });

    const res = await app.fetch(new Request("https://svc.test/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "x-hub-signature-256": await signature(SECRETS.webhookAppSecret, body),
        "content-type": "application/json"
      },
      body
    }));
    expect(res.status).toBe(200);

    const webhookCounters = sink.counters.filter((c) => c.name === "webhook_normalization_total");
    expect(webhookCounters.length).toBeGreaterThanOrEqual(1);
    for (const c of webhookCounters) {
      expect(c.attributes[OTEL_ATTR.webhookUpdateKind]).toBeDefined();
      expect(c.attributes[OTEL_ATTR.operationOutcome]).toBeDefined();
      expect(["message", "unknown"]).toContain(c.attributes[OTEL_ATTR.webhookUpdateKind]);
    }
  });

  test("optional recordSpan and recordEvent methods are not required on user sinks", async () => {
    const minimalSink = {
      counters: [] as Array<{ name: string; value: number; attributes: Record<string, unknown> }>,
      histograms: [] as Array<{ name: string; valueSeconds: number; attributes: Record<string, unknown> }>,
      incrementCounter(name: string, value: number, attributes: Record<string, unknown>) {
        this.counters.push({ name, value, attributes });
      },
      recordHistogram(name: string, valueSeconds: number, attributes: Record<string, unknown>) {
        this.histograms.push({ name, valueSeconds, attributes });
      }
    };
    const app = createWatsServiceApp(config({ telemetrySink: minimalSink }));
    await app.fetch(new Request("https://svc.test/healthz"));
    expect(minimalSink.counters.length).toBeGreaterThan(0);
  });

  test("package does not declare @opentelemetry dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    // @opentelemetry runtime deps are forbidden; peer/dev/build tooling is okay.
    const allDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {})
    ];
    const runtimeOpentelemetry = allDeps.filter((d) => d.startsWith("@opentelemetry/"));
    expect(runtimeOpentelemetry).toEqual([]);
  });

  test("NOOP_TELEMETRY_SINK swallows calls", () => {
    const sink = NOOP_TELEMETRY_SINK;
    expect(() => sink.incrementCounter("http_requests_total", 1, {})).not.toThrow();
    expect(() => sink.recordHistogram("http_request_duration_seconds", 0.01, {})).not.toThrow();
  });

  test("throwing user sink does not break the request", async () => {
    const throwingSink: TelemetrySink = {
      incrementCounter() { throw new Error("sink boom"); },
      recordHistogram() { throw new Error("sink boom histogram"); }
    };
    const app = createWatsServiceApp(config({ telemetrySink: throwingSink }));
    const res = await app.fetch(new Request("https://svc.test/healthz"));
    expect(res.status).toBe(200);
    const metrics = await (await app.fetch(authedGet("/metrics"))).text();
    expect(metrics).toContain("http_requests_total{");
  });
});
