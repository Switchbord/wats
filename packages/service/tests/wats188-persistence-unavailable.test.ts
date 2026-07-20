// WATS-188 — persistence store THROW must surface as 503 persistence_unavailable,
// not be misreported as 404 not_found (handleGetMessage) or 503
// persistence_not_configured (handleListMessages). The 404 not_found code is
// reserved for record === null. The 503 persistence_not_configured code is
// reserved for an undefined persistence store.

import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import type { MessageRecordInput, OutboxItem } from "@wats/persistence";
import {
  createWatsServiceApp,
  type WatsServiceConfig
} from "../src/index";

type StoredMessage = {
  rowId: string;
  waMessageId: string;
  direction: "inbound" | "outbound";
  fromPhone: string | null;
  toPhone: string | null;
  type: string;
  status: string;
  graphMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemoryStore = {
  readonly backend: "sqlite";
  messages: Map<string, StoredMessage>;
  recordMessage(input: MessageRecordInput): Promise<void>;
  appendMessageStatus(input: { waMessageId: string; status: string; timestamp: string }): Promise<void>;
  getMessage(input: { waMessageId: string }): Promise<StoredMessage | null>;
  getLatestInboundMessageAt(input: { phone: string }): Promise<string | null>;
  countOutboxPending(): Promise<number>;
  listMessages(input: { limit: number; beforeRowId?: string }): Promise<{ items: StoredMessage[]; nextCursor: string | null }>;
  migrate(): Promise<{ currentVersion: number; appliedMigrations: readonly string[]; alreadyCurrent: boolean }>;
  health(): Promise<{ ok: boolean; backend: "sqlite"; currentVersion: number; redactedLocation: string }>;
  recordWebhookEvent(): Promise<"recorded" | "duplicate">;
  getServiceRequest(): Promise<null>;
  recordServiceRequest(): Promise<void>;
  enqueueOutboxItem(): Promise<"enqueued" | "duplicate">;
  claimOutboxItems(): Promise<readonly OutboxItem[]>;
  markOutboxItemFailed(): Promise<void>;
  markOutboxItemSucceeded(): Promise<void>;
  close(): Promise<void>;
};

function memoryStore(): MemoryStore {
  return {
    backend: "sqlite",
    messages: new Map<string, StoredMessage>(),
    async migrate() { return { currentVersion: 4, appliedMigrations: [], alreadyCurrent: true }; },
    async health() { return { ok: true, backend: "sqlite", currentVersion: 4, redactedLocation: "[REDACTED_SQLITE_DATABASE]" }; },
    async recordWebhookEvent() { return "recorded"; },
    async getServiceRequest() { return null; },
    async recordServiceRequest() {},
    async enqueueOutboxItem() { return "enqueued"; },
    async claimOutboxItems() { return []; },
    async markOutboxItemFailed() {},
    async markOutboxItemSucceeded() {},
    async recordMessage(input) {
      this.messages.set(input.waMessageId, {
        ...input,
        fromPhone: input.fromPhone ?? null,
        toPhone: input.toPhone ?? null,
        graphMessageId: input.graphMessageId ?? null
      });
    },
    async appendMessageStatus() {},
    async getMessage(input) { return this.messages.get(input.waMessageId) ?? null; },
    async getLatestInboundMessageAt() { return null; },
    async countOutboxPending() { return 0; },
    async listMessages() { return { items: [], nextCursor: null }; },
    async close() {}
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
  return {
    profile: profile(),
    secrets: {
      accessToken: "graph-access-token",
      webhookVerifyToken: "verify-token",
      webhookAppSecret: "app-secret",
      serviceBearerToken: "service-bearer"
    },
    ...overrides
  };
}

function authedGet(): RequestInit {
  return { method: "GET", headers: { authorization: "Bearer service-bearer" } };
}

describe("WATS-188 persistence store throw surfaces 503 persistence_unavailable", () => {
  test("GET /api/messages/{messageId} returns 503 persistence_unavailable when the store throws", async () => {
    const persistence = memoryStore();
    persistence.getMessage = async () => { throw new Error("db connection lost"); };
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/messages/wamid.THROW", authedGet()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_unavailable");
    // The honest message must NOT claim the message is missing.
    expect(body.error.message).not.toContain("not found");
  });

  test("GET /api/messages/{messageId} returns 404 not_found only when record === null", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/messages/wamid.MISSING", authedGet()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  test("GET /api/messages/{messageId} returns 503 persistence_not_configured when no store is injected", async () => {
    const app = createWatsServiceApp(config());

    const res = await app.fetch(new Request("https://service.test/api/messages/wamid.X", authedGet()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_not_configured");
  });

  test("GET /api/messages (list) returns 503 persistence_unavailable when the store throws", async () => {
    const persistence = memoryStore();
    persistence.listMessages = async () => { throw new Error("db connection lost"); };
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/messages", authedGet()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_unavailable");
    expect(body.error.message).not.toContain("require a persistence store");
  });

  test("GET /api/messages (list) returns 503 persistence_not_configured when no store is injected", async () => {
    const app = createWatsServiceApp(config());

    const res = await app.fetch(new Request("https://service.test/api/messages", authedGet()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_not_configured");
  });
});
