// WATS-175c PART 1 — inbound message projection.
//
// When persistence is configured and a webhook dispatch normalizes to a
// `message` update, the service records an inbound projection row mirroring
// recordOutboundProjection: direction "inbound", status "received",
// waMessageId from the update's message.id, fromPhone from message.from,
// type from message.type, and createdAt/updatedAt = now. Persistence failure
// must NEVER break the webhook ACK (200), matching the outbound projection's
// failure-isolation contract. Non-message updates and the no-persistence path
// do not project.

import { describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@wats/crypto";
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
    async getMessage(input) {
      return this.messages.get(input.waMessageId) ?? null;
    },
    async getLatestInboundMessageAt(input) {
      let latest: string | null = null;
      for (const row of this.messages.values()) {
        if (row.direction !== "inbound") continue;
        if (row.fromPhone !== input.phone) continue;
        if (latest === null || row.createdAt.localeCompare(latest) > 0) latest = row.createdAt;
      }
      return latest;
    },
    async listMessages(input) {
      const all = Array.from(this.messages.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      let filtered = all;
      if (input.beforeRowId !== undefined) {
        const idx = all.findIndex((m) => m.rowId === input.beforeRowId);
        filtered = idx >= 0 ? all.slice(idx + 1) : [];
      }
      const items = filtered.slice(0, input.limit);
      const nextCursor = items.length === input.limit && filtered.length > items.length
        ? items[items.length - 1]!.rowId
        : null;
      return { items, nextCursor };
    },
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

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function signature(secret: string, body: string): Promise<string> {
  const provider = await createCryptoProvider();
  return `sha256=${bytesToHex(await provider.hmacSha256(secret, body))}`;
}

function inboundTextEnvelope(from: string, id: string): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789012345",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "15551234567" },
          messages: [{ from, id, timestamp: "1", type: "text", text: { body: "hi" } }]
        }
      }]
    }]
  };
}

function inboundStatusEnvelope(id: string): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789012345",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "15551234567" },
          statuses: [{ id, status: "delivered", timestamp: "1", recipient_id: "15550001111" }]
        }
      }]
    }]
  };
}

async function postWebhook(app: ReturnType<typeof createWatsServiceApp>, envelope: unknown): Promise<Response> {
  const body = JSON.stringify(envelope);
  return app.fetch(new Request("https://service.test/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": await signature("app-secret", body)
    },
    body
  }));
}

describe("WATS-175c inbound message projection", () => {
  test("a message-kind webhook projects an inbound row", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await postWebhook(app, inboundTextEnvelope("15550001111", "wamid.IN.1"));
    expect(res.status).toBe(200);

    const stored = persistence.messages.get("wamid.IN.1");
    expect(stored).toBeDefined();
    expect(stored!.direction).toBe("inbound");
    expect(stored!.fromPhone).toBe("15550001111");
    expect(stored!.toPhone).toBeNull();
    expect(stored!.type).toBe("text");
    expect(stored!.status).toBe("received");
    expect(stored!.graphMessageId).toBeNull();
    expect(stored!.createdAt).toBe(stored!.updatedAt);
  });

  test("persistence throw does not break the 200 ACK", async () => {
    const persistence = memoryStore();
    persistence.recordMessage = async () => { throw new Error("projection failure"); };
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await postWebhook(app, inboundTextEnvelope("15550001111", "wamid.IN.2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", received: 1, dispatched: 1, skipped: 0 });
  });

  test("no persistence configured = no projection and no throw", async () => {
    const app = createWatsServiceApp(config());
    const res = await postWebhook(app, inboundTextEnvelope("15550001111", "wamid.IN.3"));
    expect(res.status).toBe(200);
  });

  test("a status-kind webhook does not project a row", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await postWebhook(app, inboundStatusEnvelope("wamid.STATUS.1"));
    expect(res.status).toBe(200);
    expect(persistence.messages.size).toBe(0);
  });
});
