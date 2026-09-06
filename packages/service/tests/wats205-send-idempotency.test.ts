// WATS-205 RED: atomic durable keyed sends (R01/R02), template operation (G03),
// OpenAPI 3.1 nullable cleanup + AJV 2020 actual-response validation (R09).
//
// These tests assert the NEW contract described in the WATS-205 brief. They
// FAIL against the current implementation because:
//   - The current send handlers use getServiceRequest/recordServiceRequest
//     (read-then-write), which is not atomic — concurrent identical keys
//     both reach Graph (the race the parent repro confirmed).
//   - There is no claim-before-send / pending-409 / conflict-409 / replay-200
//     state machine wired to claimServiceRequest/completeServiceRequest.
//   - Completion failure after Graph success does not emit
//     x-wats-persistence:degraded.
//   - A legacy store missing claimServiceRequest/completeServiceRequest does
//     not return 503 for keyed sends — it silently falls back to the old
//     non-atomic path.
//   - The /api/messages route does not accept a camelCase `type: "template"`
//     composer body.
//   - The generated OpenAPI document still uses `nullable: true` (OpenAPI 3.0
//     syntax) instead of explicit `type: ["string", "null"]` unions (3.1).
//   - No AJV 2020 validator checks that actual service responses conform to the
//     generated OpenAPI schemas.
//
// Scope ledger (what this feature does NOT include):
//   - Ingress/webhook idempotency corrections (separate slice, parent-owned).
//   - Public docs reference page (parent-owned).
//   - CHANGELOG / version bump (parent-owned).
//   - Dependency changes (parent-owned).
//   - The private serviceRequests.ts helper is created at GREEN time; RED
//     exercises the public service app surface only.

import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createMockTransport } from "@wats/graph/testing";
import { createSqlitePersistence } from "@wats/persistence";
import {
  createWatsServiceApp,
  createWatsServiceOpenApiDocument,
  type WatsServiceConfig
} from "@wats/service";
import type { PersistenceStore } from "@wats/persistence";
import type { Transport, TransportRequest, TransportResponse } from "@wats/graph";
import Ajv2020 from "ajv/dist/2020.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Build a deeply nested object N levels deep (for depth-bound canonicalization).
function nestedObject(depth: number): unknown {
  let v: unknown = "leaf";
  for (let i = 0; i < depth; i++) v = { child: v };
  return v;
}

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

const SECRETS = {
  accessToken: "graph-access-token",
  webhookVerifyToken: "verify-token",
  webhookAppSecret: "app-secret",
  serviceBearerToken: "service-bearer"
};

function mockConfig(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  const mock = createMockTransport({
    defaultResponse: {
      status: 200,
      body: { messaging_product: "whatsapp", messages: [{ id: "wamid.TEST" }] }
    }
  });
  return {
    profile: profile(),
    secrets: SECRETS,
    transport: mock.transport,
    ...overrides
  };
}

function textRequest(body: unknown, idempotencyKey?: string, token = "service-bearer"): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
  if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
  return new Request("https://service.test/api/messages/text", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function messageRequest(body: unknown, idempotencyKey?: string, token = "service-bearer"): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
  if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
  return new Request("https://service.test/api/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

/**
 * A transport that lets the caller inject failures (throw / 5xx) on the Nth
 * request. Used to simulate network errors and 5xx after a claim is placed.
 */
function scriptedTransport(scripts: Array<(req: TransportRequest) => TransportResponse | Error>): {
  transport: Transport;
  requestCount: () => number;
} {
  let count = 0;
  const transport: Transport = {
    async request(req: TransportRequest): Promise<TransportResponse> {
      const idx = count;
      count += 1;
      const script = scripts[idx] ?? scripts[scripts.length - 1]!;
      const result = script(req);
      if (result instanceof Error) throw result;
      return result;
    }
  };
  return { transport, requestCount: () => count };
}

function mockResponse(status: number, body: unknown): TransportResponse {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); }
    }),
    async arrayBuffer() { return bytes.buffer; },
    async text() { return text; },
    async json<T>() { return JSON.parse(text) as T; }
  };
}

/**
 * A legacy PersistenceStore that has getServiceRequest/recordServiceRequest
 * but LACKS claimServiceRequest/completeServiceRequest. Keyed sends against
 * this store must return 503 (no atomic capability), not silently fall back
 * to the non-atomic read-then-write path.
 */
function legacyStore(): PersistenceStore {
  const records = new Map<string, { requestHash: string; responseJson: string }>();
  const store = {
    backend: "legacy" as const,
    async migrate() { return { applied: [], currentVersion: 0, fromVersion: 0 }; },
    async health() { return { ok: true, backend: "legacy", currentVersion: 0, redactedLocation: "[REDACTED]" }; },
    async recordWebhookEvent() { return "recorded" as const; },
    async getServiceRequest(input: { idempotencyKey: string; requestHash: string }) {
      const r = records.get(input.idempotencyKey);
      if (r === undefined) return null;
      if (r.requestHash !== input.requestHash) return "conflict";
      return Object.freeze({ responseJson: r.responseJson });
    },
    async recordServiceRequest(input: { idempotencyKey: string; requestHash: string; responseJson: string; createdAt: string }) {
      records.set(input.idempotencyKey, { requestHash: input.requestHash, responseJson: input.responseJson });
    },
    async enqueueOutboxItem() { return "enqueued" as const; },
    async claimOutboxItems() { return []; },
    async markOutboxItemFailed() {},
    async markOutboxItemSucceeded() {},
    async recordMessage() {},
    async appendMessageStatus() {},
    async getMessage() { return null; },
    async listMessages() { return { items: [], nextCursor: null }; },
    async getLatestInboundMessageAt() { return null; },
    async countOutboxPending() { return 0; },
    async close() {}
  };
  return store as unknown as PersistenceStore;
}

// ---------------------------------------------------------------------------
// R01/R02: Atomic durable keyed sends
// ---------------------------------------------------------------------------

describe("WATS-205 R01/R02 atomic durable keyed sends", () => {
  test("concurrent identical idempotency key sends to Graph exactly once", async () => {
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    // A counting transport that lets every request through (no barrier)
    // but records the count. Under the atomic claim state machine, only
    // the claim winner reaches Graph; the concurrent loser gets 409 pending
    // before the transport is ever called.
    // The transport yields to the event loop (setTimeout 0) to simulate
    // real network I/O timing so the second concurrent request's claim
    // runs while the first is still in-flight (awaiting the transport).
    let graphCalls = 0;
    const transport: Transport = {
      async request(_req: TransportRequest): Promise<TransportResponse> {
        graphCalls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return mockResponse(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.ATOMICTEST" }] });
      }
    };
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport,
      persistence: store
    });
    const body = { to: "15550001111", text: "concurrent" };
    const key = "concurrent-atomic-key";

    // Fire two requests concurrently.
    const [r1, r2] = await Promise.all([
      app.fetch(textRequest(body, key)),
      app.fetch(textRequest(body, key))
    ]);
    const [s1, s2] = [r1.status, r2.status];
    await store.close();

    // Exactly one request reached Graph.
    expect(graphCalls).toBe(1);
    // One response is 200 (the claim winner), the other is 409 pending.
    const statuses = [s1, s2].sort();
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);
    // The 409 body must carry the idempotency_pending code (not a generic error).
    const pending = s1 === 409 ? r1 : r2;
    const pendingBody = await json(pending) as { error: { code: string } };
    expect(pendingBody.error.code).toBe("idempotency_pending");
  });

  test("sequential replay of a completed key returns 200 with the stored response and no Graph call", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.REPLAY" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });
    const body = { to: "15550001111", text: "first" };
    const key = "replay-key";

    const first = await app.fetch(textRequest(body, key));
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ messages: [{ id: "wamid.REPLAY" }] });
    expect(mock.requests.length).toBe(1);

    // Replay with the same key + same body → 200, same response, NO new Graph call.
    const replay = await app.fetch(textRequest(body, key));
    expect(replay.status).toBe(200);
    expect(await json(replay)).toEqual({ messages: [{ id: "wamid.REPLAY" }] });
    expect(mock.requests.length).toBe(1);
    await store.close();
  });

  test("same idempotency key with a different body returns 409 conflict", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.CONFLICT" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });
    const key = "conflict-key";
    const first = await app.fetch(textRequest({ to: "15550001111", text: "alpha" }, key));
    expect(first.status).toBe(200);

    const second = await app.fetch(textRequest({ to: "15550001111", text: "beta" }, key));
    expect(second.status).toBe(409);
    const secondBody = await json(second) as { error: { code: string } };
    expect(secondBody.error.code).toBe("idempotency_conflict");
    // Only the first request reached Graph.
    expect(mock.requests.length).toBe(1);
    await store.close();
  });

  test("completion failure after Graph success returns 200 with x-wats-persistence:degraded", async () => {
    // The store completes the claim successfully on the first send, but we
    // simulate a completion failure by closing the store mid-flight. The
    // send must still return the genuine 200 Graph result, but with a
    // static x-wats-persistence:degraded header so the caller knows the
    // response was not durably recorded.
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.DEGRADED" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    // Close the store so completion throws — but the claim already succeeded.
    // (The claim happens before the Graph call; completion happens after.)
    // To test the completion-failure path we need the store open for the
    // claim but failing for completion. We use a wrapper that delegates
    // claim normally but throws on completeServiceRequest.
    const realClaim = store.claimServiceRequest!.bind(store);
    const failingStore: PersistenceStore = new Proxy(store, {
      get(target, prop) {
        if (prop === "completeServiceRequest") {
          return async () => { throw new Error("simulated completion disk failure"); };
        }
        const val = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    }) as unknown as PersistenceStore;
    // Keep a reference to the real claim so the proxy still works.
    void realClaim;

    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: failingStore
    });
    const res = await app.fetch(textRequest({ to: "15550001111", text: "degraded" }, "degraded-key"));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ messages: [{ id: "wamid.DEGRADED" }] });
    // The genuine result is returned, but the static degraded header is set.
    expect(res.headers.get("x-wats-persistence")).toBe("degraded");
    await store.close();
  });

  test("durable pending blocks repeat (claimed-but-not-completed → 409 pending on retry)", async () => {
    // A claim that was placed but never completed (crash between claim and
    // complete) must block retries indefinitely — no blind resend, no
    // timeout-based release.
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.PENDING" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });

    // Use a transport that throws on the first Graph call (network error
    // after the claim was placed). The claim persists; the retry must see
    // 409 pending, not re-send to Graph.
    const { transport, requestCount } = scriptedTransport([
      () => new Error("network failure after claim")
    ]);
    const appWithFailingTransport = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport,
      persistence: store
    });
    const body = { to: "15550001111", text: "pending-test" };
    const key = "pending-key";

    // First send: claim succeeds, Graph throws. The response is a 5xx (not 200).
    const first = await appWithFailingTransport.fetch(textRequest(body, key));
    expect(first.status).toBeGreaterThanOrEqual(500);
    expect(requestCount()).toBe(1);

    // Retry with the same key + same body → 409 pending (the claim is still
    // held; no blind resend).
    const retry = await appWithFailingTransport.fetch(textRequest(body, key));
    expect(retry.status).toBe(409);
    const retryBody = await json(retry) as { error: { code: string } };
    expect(retryBody.error.code).toBe("idempotency_pending");
    // No second Graph call.
    expect(requestCount()).toBe(1);
    await store.close();
  });

  test("legacy store without claim/complete returns 503 for keyed sends", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.LEGACY" }] } }
    });
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: legacyStore()
    });
    // Keyed send against a store that lacks atomic claim capability → 503.
    const res = await app.fetch(textRequest({ to: "15550001111", text: "legacy" }, "legacy-key"));
    expect(res.status).toBe(503);
    const body = await json(res) as { error: { code: string } };
    expect(body.error.code).toBe("persistence_not_atomic");
  });

  test("unkeyed send preserves stateless behavior (no persistence interaction)", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.UNKEYED" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });
    // No idempotency-key header → normal stateless send, no claim/complete.
    const res = await app.fetch(textRequest({ to: "15550001111", text: "unkeyed" }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ messages: [{ id: "wamid.UNKEYED" }] });
    expect(mock.requests.length).toBe(1);
    // No degraded header on a clean unkeyed send.
    expect(res.headers.get("x-wats-persistence")).toBeNull();
    await store.close();
  });

  test("no automatic release of ambiguous claim on network/5xx (pending persists)", async () => {
    // After a network failure (claim placed, Graph threw), a subsequent
    // send with a DIFFERENT body but the SAME key must still return 409
    // (conflict or pending), never a fresh claim. The ambiguous claim is
    // never auto-released.
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const { transport, requestCount } = scriptedTransport([
      () => new Error("network failure"),
      () => mockResponse(200, { messages: [{ id: "wamid.SECOND" }] })
    ]);
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport,
      persistence: store
    });
    const key = "ambiguous-key";
    // First send: claim + network failure.
    const first = await app.fetch(textRequest({ to: "15550001111", text: "alpha" }, key));
    expect(first.status).toBeGreaterThanOrEqual(500);
    expect(requestCount()).toBe(1);

    // Retry with a DIFFERENT body, same key → must NOT claim again.
    // The existing claim has a different hash → conflict (409), not pending.
    const retry = await app.fetch(textRequest({ to: "15550001111", text: "beta" }, key));
    expect(retry.status).toBe(409);
    expect(requestCount()).toBe(1);
    await store.close();
  });

  test("claim that throws (store exception) returns 503 persistence_unavailable, not a crash", async () => {
    // The claim call must not escape app.fetch as an unhandled rejection.
    // A store that throws during claimServiceRequest maps to a controlled
    // 503 persistence_unavailable with a metrics error tick — never a
    // TypeError crash or a blind send.
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.THROWCLAIM" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    // Close the store so claimServiceRequest throws store_closed.
    await store.close();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });
    const res = await app.fetch(textRequest({ to: "15550001111", text: "throw-claim" }, "throw-claim-key"));
    expect(res.status).toBe(503);
    const body = await json(res) as { error: { code: string } };
    expect(body.error.code).toBe("persistence_unavailable");
    // No Graph call was made — the claim failed before the send.
    expect(mock.requests.length).toBe(0);
  });

  test("null/malformed claim result returns 503, not 200 empty or TypeError", async () => {
    // A store returning null or a malformed object from claimServiceRequest
    // must NOT be treated as a replay (which would access .responseJson and
    // crash or return an empty 200). It maps to 503 persistence_unavailable.
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NULLCLAIM" }] } }
    });
    const malformedStore: PersistenceStore = {
      backend: "sqlite" as const,
      async migrate() { return { currentVersion: 1, appliedMigrations: [], alreadyCurrent: true }; },
      async health() { return { ok: true, backend: "sqlite" as const, currentVersion: 1, redactedLocation: "[R]" }; },
      async recordWebhookEvent() { return "recorded" as const; },
      async getServiceRequest() { return null; },
      async recordServiceRequest() {},
      // Returns null — malformed (not a valid claim result).
      async claimServiceRequest() { return null as never; },
      async completeServiceRequest() {},
      async enqueueOutboxItem() { return "enqueued" as const; },
      async claimOutboxItems() { return []; },
      async markOutboxItemFailed() {},
      async markOutboxItemSucceeded() {},
      async recordMessage() {},
      async appendMessageStatus() {},
      async getMessage() { return null; },
      async listMessages() { return { items: [], nextCursor: null }; },
      async getLatestInboundMessageAt() { return null; },
      async countOutboxPending() { return 0; },
      async close() {}
    } as unknown as PersistenceStore;
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: malformedStore
    });
    const res = await app.fetch(textRequest({ to: "15550001111", text: "null-claim" }, "null-claim-key"));
    expect(res.status).toBe(503);
    const body = await json(res) as { error: { code: string } };
    expect(body.error.code).toBe("persistence_unavailable");
    expect(mock.requests.length).toBe(0);
  });

  test("extra ignored parsed deep field does not affect hash (outgoing payload hashed)", async () => {
    // The hash is computed over the canonical OUTGOING payload, not the parsed
    // request. An extra deeply-nested field in the request body that does not
    // affect the outgoing Graph payload must not change the idempotency hash
    // — two sends with the same logical payload but different irrelevant
    // request fields must conflict/replay, not be treated as different.
    // This also proves deepSortJson does not RangeError on deep untrusted input
    // (the outgoing payload is flat; only the parsed request is deep).
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.EXTRA" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });
    const key = "extra-field-key";
    // First send: plain body.
    const first = await app.fetch(textRequest({ to: "15550001111", text: "same" }, key));
    expect(first.status).toBe(200);
    expect(mock.requests.length).toBe(1);

    // Second send: same key, same text, but with a deeply-nested extra field
    // that the text handler ignores. The outgoing payload is identical
    // (messaging_product/to/type/text), so the hash matches → replay 200,
    // not conflict 409, and no second Graph call.
    const deepExtra = { to: "15550001111", text: "same", junk: nestedObject(200) };
    const second = await app.fetch(textRequest(deepExtra, key));
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual({ messages: [{ id: "wamid.EXTRA" }] });
    expect(mock.requests.length).toBe(1);
    await store.close();
  });

  test("completion on a non-atomic store returns 200 with x-wats-persistence:degraded", async () => {
    // A store that implements claim but NOT complete is not atomic. The claim
    // returns 'not_atomic' → 503. But if a store claims to support claim yet
    // complete is missing at completion time, the completion returns false
    // (degraded), not true. Here we verify the degraded path: a store whose
    // completeServiceRequest throws after a successful send still returns
    // 200 with the degraded header (the existing completion-failure test
    // covers this via Proxy; this test confirms the helper's contract:
    // missing capability => false/degraded).
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NONATOMICCOMPLETE" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    // Proxy that removes completeServiceRequest so isAtomicClaimStore is false
    // at completion time — but claim already succeeded. This simulates a
    // store that had claim at claim time but lost complete by completion.
    // Since isAtomicClaimStore is checked fresh each call, removing the method
    // makes completeKeyedSend return false => degraded.
    const realClaim = store.claimServiceRequest!.bind(store);
    const realComplete = store.completeServiceRequest!.bind(store);
    let claimDone = false;
    const partialStore: PersistenceStore = new Proxy(store, {
      get(target, prop) {
        if (prop === "claimServiceRequest") {
          return async (input: { idempotencyKey: string; requestHash: string; createdAt: string }) => {
            claimDone = true;
            return realClaim(input);
          };
        }
        if (prop === "completeServiceRequest") {
          // After claim, delete so isAtomicClaimStore is false at completion.
          return claimDone ? undefined : realComplete;
        }
        const val = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    }) as unknown as PersistenceStore;
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: partialStore
    });
    const res = await app.fetch(textRequest({ to: "15550001111", text: "nonatomic" }, "nonatomic-complete-key"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-wats-persistence")).toBe("degraded");
    expect(await json(res)).toEqual({ messages: [{ id: "wamid.NONATOMICCOMPLETE" }] });
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// G03: Template operation
// ---------------------------------------------------------------------------

describe("WATS-205 G03 template operation", () => {
  test("POST /messages with type:template sends a template via the SDK builder", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.TEMPLATE" }] } }
    });
    const app = createWatsServiceApp(mockConfig({ transport: mock.transport }));

    const res = await app.fetch(messageRequest({
      type: "template",
      to: "15550001111",
      name: "order_confirmation",
      languageCode: "en_US",
      components: [{ type: "body", parameters: [{ type: "text", text: "Order #123" }] }]
    }));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ messages: [{ id: "wamid.TEMPLATE" }] });
    expect(mock.requests.length).toBe(1);
    const req = mock.requests[0]!;
    const sentBody = JSON.parse(String(req.body));
    // The SDK builder produces a messaging_product/template structure.
    expect(sentBody.messaging_product).toBe("whatsapp");
    expect(sentBody.type).toBe("template");
    expect(sentBody.to).toBe("15550001111");
    expect(sentBody.template.name).toBe("order_confirmation");
    expect(sentBody.template.language.code).toBe("en_US");
    expect(sentBody.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Order #123" }] }
    ]);
  });

  test("template send with idempotency key has the same atomic guarantees", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.TMPL-IDEM" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });
    const body = {
      type: "template",
      to: "15550001111",
      name: "order_confirmation",
      languageCode: "en_US"
    };
    const key = "template-idem-key";

    const first = await app.fetch(messageRequest(body, key));
    expect(first.status).toBe(200);
    expect(mock.requests.length).toBe(1);

    // Replay → 200, no new Graph call.
    const replay = await app.fetch(messageRequest(body, key));
    expect(replay.status).toBe(200);
    expect(await json(replay)).toEqual({ messages: [{ id: "wamid.TMPL-IDEM" }] });
    expect(mock.requests.length).toBe(1);
    await store.close();
  });

  test("template send rejects missing name or languageCode with 400", async () => {
    const app = createWatsServiceApp(mockConfig());
    const missingName = await app.fetch(messageRequest({
      type: "template",
      to: "15550001111",
      languageCode: "en_US"
    }));
    expect(missingName.status).toBe(400);

    const missingLang = await app.fetch(messageRequest({
      type: "template",
      to: "15550001111",
      name: "order_confirmation"
    }));
    expect(missingLang.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// R09: OpenAPI 3.1 — nullable cleanup + AJV 2020 actual-response validation
// ---------------------------------------------------------------------------

describe("WATS-205 R09 OpenAPI 3.1 nullable cleanup and AJV 2020 validation", () => {
  test("generated OpenAPI document uses no nullable:true (3.0 syntax)", () => {
    const doc = createWatsServiceOpenApiDocument(profile());
    const serialized = JSON.stringify(doc);
    // OpenAPI 3.1 removed `nullable`. All nullable fields must use
    // type: ["string", "null"] or anyOf with null.
    expect(serialized).not.toContain("nullable");
  });

  test("nullable fields use explicit null unions (type arrays or anyOf)", () => {
    const doc = createWatsServiceOpenApiDocument(profile());
    const schemas = doc.components!.schemas as Record<string, unknown>;
    const messageRecord = schemas.MessageRecord as { properties: Record<string, unknown> };
    // fromPhone / toPhone / graphMessageId were nullable: true; now they
    // must be type: ["string", "null"].
    const fromPhone = messageRecord.properties.fromPhone as { type?: unknown };
    expect(Array.isArray(fromPhone.type)).toBe(true);
    expect(fromPhone.type).toContain("string");
    expect(fromPhone.type).toContain("null");

    const messageList = schemas.MessageListResponse as { properties: Record<string, unknown> };
    const nextCursor = messageList.properties.nextCursor as { type?: unknown };
    expect(Array.isArray(nextCursor.type)).toBe(true);
    expect(nextCursor.type).toContain("null");

    const windowState = schemas.ConversationWindowState as { properties: Record<string, unknown> };
    const lastInboundAt = windowState.properties.lastInboundAt as { type?: unknown };
    expect(Array.isArray(lastInboundAt.type)).toBe(true);
    expect(lastInboundAt.type).toContain("null");
  });

  test("the generated OpenAPI document is a valid OpenAPI 3.1 schema under AJV 2020", () => {
    // The document itself must be structurally valid. We validate it as a
    // JSON Schema document using AJV 2020 (the OpenAPI 3.1 dialect).
    const doc = createWatsServiceOpenApiDocument(profile(), { serverUrl: "https://service.test" });
    // Every named schema under components.schemas must compile under AJV 2020.
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const schemas = doc.components!.schemas as Record<string, Record<string, unknown>>;
    // Register all schemas first so cross-schema $ref resolves (correct AJV usage).
    for (const [name, schema] of Object.entries(schemas)) {
      ajv.addSchema(schema, `#/components/schemas/${name}`);
    }
    for (const [name] of Object.entries(schemas)) {
      const validator = ajv.getSchema(`#/components/schemas/${name}`);
      expect(validator, `schema ${name} should compile`).toBeDefined();
    }
  });

  test("AJV 2020 validates actual service responses against generated schemas", async () => {
    // Construct the app, generate the OpenAPI doc, and validate real
    // responses against the schemas the doc declares. This catches the
    // class of bug where the doc says "non-null" but the code returns null
    // (or vice versa).
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.AJV" }] } }
    });
    const store = await createSqlitePersistence({ filename: ":memory:" });
    await store.migrate();
    const app = createWatsServiceApp({
      profile: profile(),
      secrets: SECRETS,
      transport: mock.transport,
      persistence: store
    });
    const doc = createWatsServiceOpenApiDocument(profile(), { serverUrl: "https://service.test" });
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    // Register all schemas so cross-schema $ref resolves during compile.
    const allSchemas = doc.components!.schemas as Record<string, Record<string, unknown>>;
    for (const [name, schema] of Object.entries(allSchemas)) {
      ajv.addSchema(schema, `#/components/schemas/${name}`);
    }

    // /healthz → HealthResponse
    const healthz = await app.fetch(new Request("https://service.test/healthz"));
    expect(healthz.status).toBe(200);
    const healthzBody = await healthz.json();
    const healthzValidator = ajv.getSchema("#/components/schemas/HealthResponse")!;
    expect(healthzValidator(healthzBody), "healthz body validates against HealthResponse").toBe(true);

    // /readyz → ReadyResponse
    const readyz = await app.fetch(new Request("https://service.test/readyz"));
    const readyzBody = await readyz.json();
    const readyzValidator = ajv.getSchema("#/components/schemas/ReadyResponse")!;
    expect(readyzValidator(readyzBody), "readyz body validates against ReadyResponse").toBe(true);

    // POST /api/messages/text → GraphResponsePassthrough
    const sendRes = await app.fetch(textRequest({ to: "15550001111", text: "ajv validate" }));
    expect(sendRes.status).toBe(200);
    const sendBody = await sendRes.json();
    const passthroughValidator = ajv.getSchema("#/components/schemas/GraphResponsePassthrough")!;
    expect(passthroughValidator(sendBody), "send body validates against GraphResponsePassthrough").toBe(true);

    // GET /api/messages (list) → MessageListResponse. The nextCursor field
    // must accept null (the OpenAPI doc must declare a null union, and the
    // actual response must validate against it).
    const listRes = await app.fetch(new Request("https://service.test/api/messages", {
      headers: { authorization: "Bearer service-bearer" }
    }));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const listValidator = ajv.getSchema("#/components/schemas/MessageListResponse")!;
    expect(listValidator(listBody), "list body validates against MessageListResponse (nextCursor null OK)").toBe(true);
    await store.close();
  });
});
