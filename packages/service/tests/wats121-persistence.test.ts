import { afterEach, describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import type { MessageRecord, MessageRecordInput, OutboxItem } from "@wats/persistence";
import { createWatsServiceApp, type WatsServiceConfig } from "../src/index";

type MemoryStore = {
  readonly backend: "sqlite";
  events: Set<string>;
  requests: Map<string, { requestHash: string; responseJson: string }>;
  migrate(): Promise<{ currentVersion: number; appliedMigrations: readonly string[]; alreadyCurrent: boolean }>;
  health(): Promise<{ ok: boolean; backend: "sqlite"; currentVersion: number; redactedLocation: string }>;
  recordWebhookEvent(input: { eventKey: string; eventHash: string; receivedAt: string }): Promise<"recorded" | "duplicate">;
  getServiceRequest(input: { idempotencyKey: string; requestHash: string }): Promise<null | "conflict" | { responseJson: string }>;
  recordServiceRequest(input: { idempotencyKey: string; requestHash: string; responseJson: string; createdAt: string }): Promise<void>;
  enqueueOutboxItem(input: { id: string; payloadHash: string; createdAt: string; nextAttemptAt?: string | null }): Promise<"enqueued" | "duplicate">;
  claimOutboxItems(input: { now: string; limit: number }): Promise<readonly OutboxItem[]>;
  markOutboxItemFailed(input: { id: string; leaseId: number; nextAttemptAt: string; updatedAt: string }): Promise<void>;
  markOutboxItemSucceeded(input: { id: string; leaseId: number; updatedAt: string }): Promise<void>;
  recordMessage(input: MessageRecordInput): Promise<void>;
  appendMessageStatus(input: { waMessageId: string; status: string; timestamp: string }): Promise<void>;
  getMessage(input: { waMessageId: string }): Promise<MessageRecord | null>;
  listMessages(input: { limit: number; beforeRowId?: string }): Promise<{ items: readonly MessageRecord[]; nextCursor: string | null }>;
  getLatestInboundMessageAt(input: { phone: string }): Promise<string | null>;
  countOutboxPending(): Promise<number>;
  close(): Promise<void>;
};

function memoryStore(): MemoryStore {
  return {
    backend: "sqlite",
    events: new Set<string>(),
    requests: new Map<string, { requestHash: string; responseJson: string }>(),
    async migrate() { return { currentVersion: 1, appliedMigrations: [], alreadyCurrent: true }; },
    async health() { return { ok: true, backend: "sqlite", currentVersion: 1, redactedLocation: "[REDACTED_SQLITE_DATABASE]" }; },
    async recordWebhookEvent(input) {
      if (this.events.has(input.eventKey)) return "duplicate";
      this.events.add(input.eventKey);
      return "recorded";
    },
    async getServiceRequest(input) {
      const existing = this.requests.get(input.idempotencyKey);
      if (existing === undefined) return null;
      if (existing.requestHash !== input.requestHash) return "conflict";
      return { responseJson: existing.responseJson };
    },
    async recordServiceRequest(input) {
      if (!this.requests.has(input.idempotencyKey)) {
        this.requests.set(input.idempotencyKey, { requestHash: input.requestHash, responseJson: input.responseJson });
      }
    },
    async enqueueOutboxItem() { return "enqueued"; },
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
}

type MockRequest = { method: string; url: string; headers: Headers; body?: unknown };

function createLocalMockTransport(responseBody: unknown) {
  const requests: MockRequest[] = [];
  return {
    requests,
    transport: {
      async request(req: MockRequest) {
        requests.push(req);
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
    }
  };
}

function profile(): WatsProfileConfig {
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
    }
  };
}

function config(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  const mock = createLocalMockTransport({ messages: [{ id: "wamid.TEST" }] });
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

function authed(body: unknown, idempotencyKey?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: "Bearer service-bearer",
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function signature(secret: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${bytesToHex(new Uint8Array(digest))}`;
}

function webhookEnvelope(messageId = "wamid.WEBHOOK"): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789012345",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "15551234567" },
          messages: [{ from: "15550001111", id: messageId, timestamp: "1", type: "text", text: { body: "secret message text" } }]
        }
      }]
    }]
  };
}

describe("WATS-121 optional service persistence", () => {
  test("duplicate signed webhooks dispatch once when persistence is injected", async () => {
    const persistence = memoryStore();
    const body = JSON.stringify(webhookEnvelope());
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config(),
      persistence,
      whatsapp: { dispatch: (update: unknown) => { dispatches.push(update); } } as never
    });

    const signedHeader = await signature("app-secret", body);
    const request = () => new Request("https://service.test/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signedHeader
      },
      body
    });

    const first = await app.fetch(request());
    const second = await app.fetch(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(dispatches.length).toBe(1);
    expect(await second.json()).toEqual({ status: "ok", received: 1, dispatched: 0, skipped: 1 });
  });

  test("service request idempotency replays matching response and rejects conflicting body", async () => {
    const persistence = memoryStore();
    const mock = createLocalMockTransport({ messages: [{ id: "wamid.IDEMPOTENT" }] });
    const app = createWatsServiceApp({ ...config({ transport: mock.transport }), persistence });

    const first = await app.fetch(new Request("https://service.test/api/messages/text", authed({
      to: "15550001111",
      text: "hello"
    }, "local-send-1")));
    const replay = await app.fetch(new Request("https://service.test/api/messages/text", authed({
      to: "15550001111",
      text: "hello"
    }, "local-send-1")));
    const conflict = await app.fetch(new Request("https://service.test/api/messages/text", authed({
      to: "15550001111",
      text: "changed"
    }, "local-send-1")));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(await replay.json()).toEqual({ messages: [{ id: "wamid.IDEMPOTENT" }] });
    expect(mock.requests.length).toBe(1);
    const conflictText = await conflict.text();
    expect(conflictText).not.toContain("changed");
    expect(conflictText).not.toContain("service-bearer");
  });

  test("service behavior remains unchanged when persistence is omitted", async () => {
    const mock = createLocalMockTransport({ messages: [{ id: "wamid.NO_STORE" }] });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const first = await app.fetch(new Request("https://service.test/api/messages/text", authed({ to: "15550001111", text: "hello" }, "same-key")));
    const second = await app.fetch(new Request("https://service.test/api/messages/text", authed({ to: "15550001111", text: "hello" }, "same-key")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mock.requests.length).toBe(2);
  });
});
