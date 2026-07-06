// Outbox metrics: gauge support in MetricsRegistry, the outbox_depth gauge and
// outbox_processed_total counter, and the createOutboxMetricsReporter wiring
// helper that translates an OutboxWorkerTickReport into registry state.
//
// The gauge is registry-only: the TelemetrySink seam exposes
// incrementCounter/recordHistogram (and optional recordSpan/recordEvent) but no
// setGauge, so outbox_depth is observable through /metrics and not forwarded to
// user-owned OTel bridges. outbox_processed_total flows through the same
// counter path as every other counter.

import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createMockTransport } from "@wats/graph/testing";
import type { MessageRecord, MessageRecordInput, OutboxItem } from "@wats/persistence";
import {
  createMetricsRegistry,
  createOutboxMetricsReporter,
  createWatsServiceApp,
  type WatsServiceConfig
} from "../src/index";

const PHONE_NUMBER_ID = "15551234567";
const WABA_ID = "123456789012345";
const BEARER = "service-bearer-SECRET";

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

function config(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  const mock = createMockTransport({
    defaultResponse: { status: 200, body: { messaging_product: "whatsapp", messages: [{ id: "wamid.TEST" }] } }
  });
  return {
    profile: profile(),
    secrets: {
      accessToken: "graph-access-token-SECRET",
      webhookVerifyToken: "verify-token-SECRET",
      webhookAppSecret: "app-secret-SECRET",
      serviceBearerToken: BEARER
    },
    transport: mock.transport,
    ...overrides
  };
}

function metricsReq(): Request {
  return new Request("https://svc.test/metrics", {
    method: "GET",
    headers: { authorization: `Bearer ${BEARER}` }
  });
}

describe("MetricsRegistry gauge support", () => {
  test("declareGauge + setGauge render in Prometheus exposition format", () => {
    const registry = createMetricsRegistry();
    // outbox_depth is declared by createMetricsRegistry already; set a value.
    registry.setGauge("outbox_depth", 7, { adapter: "sqlite", state: "pending" });
    const text = registry.render();
    expect(text).toContain("# HELP outbox_depth");
    expect(text).toContain("# TYPE outbox_depth gauge");
    expect(text).toContain('outbox_depth{adapter="sqlite",state="pending"} 7');
  });

  test("setGauge on an undeclared name throws", () => {
    const registry = createMetricsRegistry();
    expect(() => registry.setGauge("not_declared", 1, {})).toThrow(/not_declared/);
  });

  test("setGauge rejects non-finite and negative values", () => {
    const registry = createMetricsRegistry();
    expect(() => registry.setGauge("outbox_depth", Number.NaN, { adapter: "sqlite", state: "pending" })).toThrow();
    expect(() => registry.setGauge("outbox_depth", Number.POSITIVE_INFINITY, { adapter: "sqlite", state: "pending" })).toThrow();
    expect(() => registry.setGauge("outbox_depth", -1, { adapter: "sqlite", state: "pending" })).toThrow();
  });

  test("setGauge with an undeclared label key throws", () => {
    const registry = createMetricsRegistry();
    expect(() => registry.setGauge("outbox_depth", 1, { adapter: "sqlite", state: "pending", bogus: "x" })).toThrow();
    expect(() => registry.setGauge("outbox_depth", 1, { adapter: "sqlite" })).toThrow();
  });

  test("a later setGauge on the same label set overwrites the previous value", () => {
    const registry = createMetricsRegistry();
    registry.setGauge("outbox_depth", 5, { adapter: "sqlite", state: "pending" });
    registry.setGauge("outbox_depth", 11, { adapter: "sqlite", state: "pending" });
    const text = registry.render();
    expect(text).toContain('outbox_depth{adapter="sqlite",state="pending"} 11');
    expect(text).not.toContain('outbox_depth{adapter="sqlite",state="pending"} 5');
  });

  test("gauge families appear in families()", () => {
    const registry = createMetricsRegistry();
    expect(registry.families()).toContain("outbox_depth");
    expect(registry.families()).toContain("outbox_processed_total");
  });
});

describe("createOutboxMetricsReporter", () => {
  test("translates a tick report into registry state visible from /metrics", async () => {
    const registry = createMetricsRegistry();
    const app = createWatsServiceApp(config({ metricsRegistry: registry }));
    const reporter = createOutboxMetricsReporter(registry, { adapter: "sqlite" });

    reporter.onReport({ processed: 5, succeeded: 3, failed: 2, pending: 7 });

    const text = await (await app.fetch(metricsReq())).text();
    expect(text).toContain('outbox_depth{adapter="sqlite",state="pending"} 7');
    expect(text).toMatch(/outbox_processed_total\{outcome="success"\}\s+3/u);
    expect(text).toMatch(/outbox_processed_total\{outcome="error"\}\s+2/u);
  });

  test("accumulates counts across multiple ticks", async () => {
    const registry = createMetricsRegistry();
    const app = createWatsServiceApp(config({ metricsRegistry: registry }));
    const reporter = createOutboxMetricsReporter(registry, { adapter: "postgres" });

    reporter.onReport({ processed: 1, succeeded: 1, failed: 0, pending: 2 });
    reporter.onReport({ processed: 3, succeeded: 2, failed: 1, pending: 5 });

    const text = await (await app.fetch(metricsReq())).text();
    expect(text).toMatch(/outbox_processed_total\{outcome="success"\}\s+3/u);
    expect(text).toMatch(/outbox_processed_total\{outcome="error"\}\s+1/u);
    expect(text).toContain('outbox_depth{adapter="postgres",state="pending"} 5');
  });

  test("clamps an unknown adapter to unknown", async () => {
    const registry = createMetricsRegistry();
    const app = createWatsServiceApp(config({ metricsRegistry: registry }));
    const reporter = createOutboxMetricsReporter(registry, { adapter: "redis" });

    reporter.onReport({ processed: 1, succeeded: 1, failed: 0, pending: 1 });

    const text = await (await app.fetch(metricsReq())).text();
    expect(text).toContain('outbox_depth{adapter="unknown",state="pending"} 1');
  });

  test("rejects a non-registry argument", () => {
    expect(() => createOutboxMetricsReporter(null as never, { adapter: "sqlite" })).toThrow();
    expect(() => createOutboxMetricsReporter({} as never, { adapter: "sqlite" })).toThrow();
  });

  test("rejects a missing or invalid adapter option", () => {
    const registry = createMetricsRegistry();
    expect(() => createOutboxMetricsReporter(registry, {} as never)).toThrow();
    expect(() => createOutboxMetricsReporter(registry, { adapter: 5 } as never)).toThrow();
  });

  test("the returned shape is compatible with startOutboxWorker options", () => {
    const registry = createMetricsRegistry();
    const reporter = createOutboxMetricsReporter(registry, { adapter: "sqlite" });
    expect(typeof reporter.onReport).toBe("function");
    // onError is optional; when absent the consumer can still spread the reporter
    // into StartOutboxWorkerOptions (onError?: ...).
    if (reporter.onError !== undefined) {
      expect(typeof reporter.onError).toBe("function");
    }
  });
});
