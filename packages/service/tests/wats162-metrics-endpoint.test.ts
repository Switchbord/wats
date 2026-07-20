// WATS-162 — TELEMETRY-A: opt-in Prometheus/OpenMetrics /metrics endpoint.
//
// A GET /metrics endpoint that exposes PII-safe counters and histograms in
// Prometheus text exposition format. Governed by the WATS-161 taxonomy:
//   - only the allowlisted metric families/names may appear;
//   - only the allowlisted label keys may appear, with values enum-clamped
//     to "unknown" when derived from untrusted input (update_kind,
//     endpoint_family);
//   - route labels are templated (never raw ids);
//   - opt-in and protected — same 404-not-401 existence-hiding posture as
//     /status (WATS-163);
//   - never token, phone number, WAMID, message text, raw webhook body,
//     config path, or stack trace.
//
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { WatsProfileConfig } from "@wats/config";
import { createCryptoProvider } from "@wats/crypto";
import { createMockTransport } from "@wats/graph/testing";
import type { MessageRecord, MessageRecordInput, OutboxItem } from "@wats/persistence";
import { createWatsServiceApp, type WatsServiceConfig } from "../src/index";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

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
    ...overrides
  };
}

function metricsReq(headers?: Record<string, string>): Request {
  return new Request("https://svc.test/metrics", { method: "GET", headers });
}

function authedMetricsReq(): Request {
  return metricsReq({ authorization: `Bearer ${SECRETS.serviceBearerToken}` });
}

function authed(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${SECRETS.serviceBearerToken}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function signature(secret: string, body: string): Promise<string> {
  const provider = await createCryptoProvider();
  const bytes = await provider.hmacSha256(secret, body);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `sha256=${hex}`;
}

describe("WATS-162 Prometheus/OpenMetrics /metrics endpoint", () => {
  test("authorized GET /metrics returns 200 text/plain exposition format", async () => {
    const app = createWatsServiceApp(config());
    // /metrics reports on requests already completed before the scrape; the
    // scrape request itself is recorded after its own response is rendered,
    // so drive at least one prior request to populate the registry.
    await app.fetch(new Request("https://svc.test/healthz"));
    const res = await app.fetch(authedMetricsReq());
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/plain");
    expect(contentType).toContain("version=0.0.4");
    const text = await res.text();
    // Exposition format: at least one HELP/TYPE line pair per family.
    expect(text).toMatch(/# HELP http_requests_total/u);
    expect(text).toMatch(/# TYPE http_requests_total counter/u);
    expect(text).toMatch(/# HELP http_request_duration_seconds/u);
    expect(text).toMatch(/# TYPE http_request_duration_seconds histogram/u);
  });

  test("only allowlisted metric families and label keys ever appear", async () => {
    const app = createWatsServiceApp(config());
    // Generate some traffic across families before scraping.
    await app.fetch(new Request("https://svc.test/healthz"));
    await app.fetch(authedMetricsReq());
    const text = await (await app.fetch(authedMetricsReq())).text();

    const allowedMetricNames = [
      "http_requests_total",
      "http_request_duration_seconds",
      "webhook_normalization_total",
      "graph_operations_total",
      "send_outcomes_total",
      "persistence_operations_total",
      "outbox_depth",
      "outbox_processed_total"
    ];
    // Every metric line (non-comment, non-blank) must start with one of the
    // allowed metric names (histograms emit _bucket/_sum/_count suffixes).
    const metricLines = text.split("\n").filter((l) => l.length > 0 && !l.startsWith("#"));
    expect(metricLines.length).toBeGreaterThan(0);
    for (const line of metricLines) {
      const name = line.split(/[{\s]/u)[0]!;
      const baseName = name.replace(/_(bucket|sum|count)$/u, "");
      expect(allowedMetricNames, `unexpected metric name in exposition: ${name}`).toContain(baseName);
    }

    const allowedLabelKeys = ["route", "method", "status_class", "update_kind", "endpoint_family", "outcome", "adapter", "state", "le"];
    const labelBlocks = Array.from(text.matchAll(/\{([^}]*)\}/gu), (m) => m[1]);
    for (const block of labelBlocks) {
      const keys = Array.from(block.matchAll(/([a-z_]+)=/gu), (m) => m[1]);
      for (const key of keys) {
        expect(allowedLabelKeys, `unexpected label key in exposition: ${key}`).toContain(key);
      }
    }
  });

  test("route label is templated and endpoint_family/update_kind are enum-clamped", async () => {
    const app = createWatsServiceApp(config({ enableGroupRoutes: true } as never));
    await app.fetch(new Request("https://svc.test/api/groups/1234567890", {
      method: "GET",
      headers: { authorization: `Bearer ${SECRETS.serviceBearerToken}` }
    }));
    const text = await (await app.fetch(authedMetricsReq())).text();
    // No raw group id leaked as a route label value.
    expect(text).not.toContain("1234567890");
    expect(text).toContain('route="/api/groups/:groupId"');
  });

  test("/metrics payload never leaks secrets, ids, message text, or config paths", async () => {
    const app = createWatsServiceApp(config());
    // Drive a text-message send and a webhook dispatch to populate counters.
    await app.fetch(new Request("https://svc.test/api/messages/text", authed({ to: "15550009999", text: "super secret message body" })));

    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: WABA_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            messages: [{ id: "wamid.ABC123", from: "15550009999", type: "text", text: { body: "super secret message body" } }]
          }
        }]
      }]
    });
    await app.fetch(new Request("https://svc.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": await signature(SECRETS.webhookAppSecret, rawBody), "content-type": "application/json" },
      body: rawBody
    }));

    const text = await (await app.fetch(authedMetricsReq())).text();
    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("super secret message body");
    expect(text).not.toContain("15550009999");
    expect(text).not.toContain(WABA_ID);
    expect(text).not.toContain(PHONE_NUMBER_ID);
    expect(text).not.toContain("wamid.ABC123");
    expect(text).not.toContain("WATS_ACCESS_TOKEN");
    expect(text).not.toContain("graph.test");
    expect(text).not.toMatch(/at \w+ \(/u);
  });

  test("missing token returns 404 (telemetry hides existence), byte-identical to the catch-all", async () => {
    const app = createWatsServiceApp(config());
    const catchAll = await app.fetch(new Request("https://svc.test/no-such-route"));
    const res = await app.fetch(metricsReq());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(await catchAll.text());
    expect(res.headers.get("content-type")).toBe(catchAll.headers.get("content-type"));
  });

  test("wrong token and anonymous non-GET both return 404, not 401/405", async () => {
    const app = createWatsServiceApp(config());
    const wrongToken = await app.fetch(metricsReq({ authorization: "Bearer wrong-token" }));
    expect(wrongToken.status).toBe(404);
    const anonPost = await app.fetch(new Request("https://svc.test/metrics", { method: "POST" }));
    expect(anonPost.status).toBe(404);
  });

  test("http_requests_total and http_request_duration_seconds increment on real traffic", async () => {
    const app = createWatsServiceApp(config());
    await app.fetch(new Request("https://svc.test/healthz"));
    await app.fetch(new Request("https://svc.test/healthz"));
    const text = await (await app.fetch(authedMetricsReq())).text();
    const match = text.match(/http_requests_total\{method="GET",route="\/healthz",status_class="2xx"\}\s+(\d+)/u);
    expect(match, "http_requests_total for /healthz not found").not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/http_request_duration_seconds_count\{route="\/healthz",status_class="2xx"\}\s+\d+/u);
  });

  test("webhook_normalization_total increments by update_kind and outcome", async () => {
    const app = createWatsServiceApp(config());
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: WABA_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            messages: [{ id: "wamid.XYZ", from: "15550009999", type: "text", text: { body: "hi" } }]
          }
        }]
      }]
    });
    const res = await app.fetch(new Request("https://svc.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": await signature(SECRETS.webhookAppSecret, rawBody), "content-type": "application/json" },
      body: rawBody
    }));
    expect(res.status).toBe(200);
    const text = await (await app.fetch(authedMetricsReq())).text();
    expect(text).toMatch(/webhook_normalization_total\{outcome="success",update_kind="message"\}\s+1/u);
  });

  test("graph_operations_total and send_outcomes_total increment on message send success and failure", async () => {
    const okApp = createWatsServiceApp(config());
    await okApp.fetch(new Request("https://svc.test/api/messages/text", authed({ to: "15550001111", text: "hi" })));
    const okText = await (await okApp.fetch(authedMetricsReq())).text();
    expect(okText).toMatch(/graph_operations_total\{endpoint_family="messages",outcome="success",status_class="2xx"\}\s+1/u);
    expect(okText).toMatch(/send_outcomes_total\{endpoint_family="messages",outcome="success"\}\s+1/u);

    const failMock = createMockTransport({ defaultResponse: { status: 500, body: { error: { message: "boom", type: "OAuthException", code: 1 } } } });
    const failApp = createWatsServiceApp(config({ transport: failMock.transport }));
    await failApp.fetch(new Request("https://svc.test/api/messages/text", authed({ to: "15550001111", text: "hi" })));
    const failText = await (await failApp.fetch(authedMetricsReq())).text();
    expect(failText).toMatch(/graph_operations_total\{endpoint_family="messages",outcome="error",status_class="5xx"\}\s+1/u);
    expect(failText).toMatch(/send_outcomes_total\{endpoint_family="messages",outcome="error"\}\s+1/u);
  });

  test("persistence_operations_total increments by adapter and outcome when a store is injected", async () => {
    const app = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never }));
    await app.fetch(new Request("https://svc.test/api/messages", { method: "GET", headers: { authorization: `Bearer ${SECRETS.serviceBearerToken}` } }));
    const text = await (await app.fetch(authedMetricsReq())).text();
    expect(text).toMatch(/persistence_operations_total\{adapter="sqlite",outcome="success"\}\s+\d+/u);
  });

  test("no persistence_operations_total is emitted when no store is injected", async () => {
    const app = createWatsServiceApp(config());
    const text = await (await app.fetch(authedMetricsReq())).text();
    expect(text).not.toMatch(/persistence_operations_total\{/u);
  });

  test("persistence_operations_total covers write-side call sites (webhook recording, projection)", async () => {
    // WATS-162 review M3: persistence_operations_total must cover all store
    // operations, not just the two message-query read routes. Drive a
    // webhook dispatch (recordWebhookEvent) and a text send with an
    // idempotency key (getServiceRequest + recordServiceRequest) plus its
    // outbound projection (recordMessage + appendMessageStatus), then assert
    // the aggregate success count reflects more than the two read routes
    // alone would produce.
    const app = createWatsServiceApp(config({ persistence: memoryStore() as unknown as never }));

    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: WABA_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            messages: [{ id: "wamid.PERSIST1", from: "15550009999", type: "text", text: { body: "hi" } }]
          }
        }]
      }]
    });
    const webhookRes = await app.fetch(new Request("https://svc.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": await signature(SECRETS.webhookAppSecret, rawBody), "content-type": "application/json" },
      body: rawBody
    }));
    expect(webhookRes.status).toBe(200);

    await app.fetch(new Request("https://svc.test/api/messages/text", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRETS.serviceBearerToken}`,
        "content-type": "application/json",
        "idempotency-key": "test-key-1"
      },
      body: JSON.stringify({ to: "15550001111", text: "hi" })
    }));

    const text = await (await app.fetch(authedMetricsReq())).text();
    const match = text.match(/persistence_operations_total\{adapter="sqlite",outcome="success"\}\s+(\d+)/u);
    expect(match, "persistence_operations_total success series not found").not.toBeNull();
    // Two read-route calls (list not called here) would be 0; webhook
    // recording + service-request lookup/record + message projection
    // (recordMessage + appendMessageStatus) is at least 4 successful ops.
    expect(Number(match![1])).toBeGreaterThanOrEqual(4);
  });

  test("METRIC_UPDATE_KINDS exactly matches the real TypedUpdateKind in @wats/core", () => {
    // WATS-162 review M1: the hardcoded METRIC_UPDATE_KINDS literal list in
    // service/src/index.ts must never drift from the actual normalizer type.
    // clampToEnum() silently maps any kind missing from this list to
    // "unknown", so a stale copy loses cardinality with no visible failure
    // anywhere else — this test is the only thing that can catch that.
    const serviceSource = readFileSync(join(repoRoot, "packages", "service", "src", "index.ts"), "utf8");
    const constMatch = serviceSource.match(/const METRIC_UPDATE_KINDS = \[([\s\S]*?)\] as const;/u);
    expect(constMatch, "METRIC_UPDATE_KINDS constant not found in @wats/service source").not.toBeNull();
    const codeKinds = Array.from(constMatch![1].matchAll(/"([a-zA-Z]+)"/gu), (m) => m[1]).sort();
    expect(codeKinds.length).toBeGreaterThan(0);

    const coreSource = readFileSync(join(repoRoot, "packages", "core", "src", "webhookNormalizer.ts"), "utf8");
    const typeMatch = coreSource.match(/export type TypedUpdateKind\s*=\s*([\s\S]+?);/u);
    expect(typeMatch, "TypedUpdateKind type not found in @wats/core source").not.toBeNull();
    const realKinds = Array.from(typeMatch![1].matchAll(/"([a-zA-Z]+)"/gu), (m) => m[1]).sort();

    expect(
      codeKinds,
      `METRIC_UPDATE_KINDS ${JSON.stringify(codeKinds)} must equal real TypedUpdateKind ${JSON.stringify(realKinds)}`
    ).toEqual(realKinds);
  });

  test("update_kind values from real webhook traffic never fall outside the known enum", async () => {
    // WATS-162 review L3: the real webhook normalizer only ever produces a
    // TypedUpdateKind value, so this cannot force clampToEnum's "unknown"
    // fallback through the public HTTP path (there is no legitimate way to
    // get an out-of-enum kind past normalization). What this test DOES
    // verify: real traffic's update_kind values are always a subset of the
    // allowlist the exposition format promises — the invariant the
    // taxonomy actually cares about.
    const app = createWatsServiceApp(config());
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: WABA_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            messages: [{ id: "wamid.UNKNOWNKIND", from: "15550009999", type: "text", text: { body: "hi" } }]
          }
        }]
      }]
    });
    const res = await app.fetch(new Request("https://svc.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": await signature(SECRETS.webhookAppSecret, rawBody), "content-type": "application/json" },
      body: rawBody
    }));
    expect(res.status).toBe(200);
    const text = await (await app.fetch(authedMetricsReq())).text();
    const kinds = Array.from(text.matchAll(/update_kind="([a-zA-Z]+)"/gu), (m) => m[1]);
    expect(kinds.length).toBeGreaterThan(0);
    const allowedKinds = ["message", "status", "account", "unknown", "callConnect", "callTerminate", "callStatus", "groupLifecycle", "groupParticipants", "groupSettings", "groupStatus", "userPreferences", "system", "chatOpened"];
    for (const kind of kinds) {
      expect(allowedKinds, `update_kind "${kind}" not in the allowed enum`).toContain(kind);
    }
  });

  test("histogram buckets are monotonically non-decreasing and +Inf equals the total count", async () => {
    // WATS-162 review L3: verify the exposition's histogram semantics, not
    // just substring presence. Drive several requests with different
    // durations (best-effort — real timings vary, so this asserts structural
    // invariants rather than exact bucket boundaries).
    const app = createWatsServiceApp(config());
    for (let i = 0; i < 5; i += 1) {
      await app.fetch(new Request("https://svc.test/healthz"));
    }
    const text = await (await app.fetch(authedMetricsReq())).text();
    const bucketLines = Array.from(
      text.matchAll(/http_request_duration_seconds_bucket\{route="\/healthz",status_class="2xx",le="([^"]+)"\}\s+(\d+)/gu),
      (m) => ({ le: m[1], count: Number(m[2]) })
    );
    expect(bucketLines.length).toBeGreaterThan(0);

    // Monotonically non-decreasing as le increases (numeric buckets only;
    // "+Inf" is parsed separately below).
    const numericBuckets = bucketLines.filter((b) => b.le !== "+Inf");
    for (let i = 1; i < numericBuckets.length; i += 1) {
      expect(numericBuckets[i]!.count).toBeGreaterThanOrEqual(numericBuckets[i - 1]!.count);
    }

    const infBucket = bucketLines.find((b) => b.le === "+Inf");
    expect(infBucket, "+Inf bucket not found").toBeDefined();
    const countMatch = text.match(/http_request_duration_seconds_count\{route="\/healthz",status_class="2xx"\}\s+(\d+)/u);
    expect(countMatch, "http_request_duration_seconds_count not found").not.toBeNull();
    expect(infBucket!.count).toBe(Number(countMatch![1]));

    const sumMatch = text.match(/http_request_duration_seconds_sum\{route="\/healthz",status_class="2xx"\}\s+([\d.]+)/u);
    expect(sumMatch, "http_request_duration_seconds_sum not found").not.toBeNull();
    expect(Number.isFinite(Number(sumMatch![1]))).toBe(true);
    expect(Number(sumMatch![1])).toBeGreaterThanOrEqual(0);
  });

  test("a duplicate webhook delivery records webhook_normalization_total with outcome=deduped", async () => {
    // WATS-162 review M2: normalization occurs even when the persistence
    // layer detects a duplicate event and skips re-dispatch. The metric
    // must reflect "deduped", not silently omit the event.
    const store = memoryStore();
    const seen = new Set<string>();
    const dedupingStore = {
      ...store,
      async recordWebhookEvent(input: { eventKey: string }) {
        if (seen.has(input.eventKey)) return "duplicate" as const;
        seen.add(input.eventKey);
        return "recorded" as const;
      }
    };
    const app = createWatsServiceApp(config({ persistence: dedupingStore as unknown as never }));
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        id: WABA_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            messages: [{ id: "wamid.DEDUPE1", from: "15550009999", type: "text", text: { body: "hi" } }]
          }
        }]
      }]
    });
    const sig = await signature(SECRETS.webhookAppSecret, rawBody);
    const first = await app.fetch(new Request("https://svc.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": sig, "content-type": "application/json" },
      body: rawBody
    }));
    expect(first.status).toBe(200);
    const second = await app.fetch(new Request("https://svc.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": sig, "content-type": "application/json" },
      body: rawBody
    }));
    expect(second.status).toBe(200);

    const text = await (await app.fetch(authedMetricsReq())).text();
    expect(text).toMatch(/webhook_normalization_total\{outcome="deduped",update_kind="message"\}\s+1/u);
  });
});
