// WATS-175c PART 2 — GET /api/conversations/:phone/window.
//
// Authed route that returns the 24-hour customer-service-window state for a
// phone number, computed from the injected persistence store. Mirrors the
// existence-hiding posture of /metrics: a missing/mismatched bearer token
// returns a 404 byte-identical to the catch-all. Requires persistence (503
// persistence_not_configured when absent, matching /api/messages). The phone
// path param is validated strictly (optional leading +, 1..15 digits).

import { describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@wats/crypto";
import type { WatsProfileConfig } from "@wats/config";
import type { MessageRecordInput, OutboxItem } from "@wats/persistence";
import {
  createWatsServiceApp,
  createWatsServiceOpenApiDocument,
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
    async getMessage(input) { return this.messages.get(input.waMessageId) ?? null; },
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
      const items = all.slice(0, input.limit);
      const nextCursor = items.length === input.limit && all.length > items.length ? items[items.length - 1]!.rowId : null;
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

async function postInboundWebhook(app: ReturnType<typeof createWatsServiceApp>, from: string, id: string): Promise<void> {
  const envelope = {
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
  const body = JSON.stringify(envelope);
  await app.fetch(new Request("https://service.test/webhooks/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": await signature("app-secret", body) },
    body
  }));
}

function authedGet(token = "service-bearer"): RequestInit {
  return { method: "GET", headers: { authorization: `Bearer ${token}` } };
}

describe("WATS-175c GET /api/conversations/:phone/window", () => {
  test("open window after a recent inbound message", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });
    await postInboundWebhook(app, "15550001111", "wamid.WIN.1");

    const res = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", authedGet()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.open).toBe(true);
    expect(body.lastInboundAt).not.toBeNull();
    expect(body.expiresAt).not.toBeNull();
    expect(body.remainingMs).toBeGreaterThan(0);
  });

  test("closed window when no inbound message exists", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", authedGet()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.open).toBe(false);
    expect(body.lastInboundAt).toBeNull();
    expect(body.expiresAt).toBeNull();
    expect(body.remainingMs).toBe(0);
  });

  test("no persistence configured returns 503 persistence_not_configured", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", authedGet()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_not_configured");
  });

  test("bad phone path param returns 400", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });
    const res = await app.fetch(new Request("https://service.test/api/conversations/not-a-phone/window", authedGet()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("malformed_path");
  });

  test("wrong bearer token returns 404 byte-identical to the catch-all", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const wrong = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", authedGet("wrong-token")));
    expect(wrong.status).toBe(404);
    const catchAll = await app.fetch(new Request("https://service.test/no/such/route"));
    expect(catchAll.status).toBe(404);
    expect(await wrong.text()).toBe(await catchAll.text());
  });

  test("non-GET method with valid token returns 405", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });
    const res = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", {
      method: "POST",
      headers: { authorization: "Bearer service-bearer" }
    }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});

describe("WATS-175c conversation-window OpenAPI document", () => {
  test("includes GET /api/conversations/{phone}/window with service bearer security", () => {
    const doc = createWatsServiceOpenApiDocument(profile(), { serverUrl: "https://service.test" });
    const path = doc.paths["/api/conversations/{phone}/window"];
    expect(path).toBeDefined();
    expect(path.get).toBeDefined();
    const hasBearer = (op: Record<string, unknown>): boolean => Array.isArray(op.security)
      && op.security.some((entry) => typeof entry === "object" && entry !== null && Array.isArray((entry as Record<string, unknown>).serviceBearerAuth));
    expect(hasBearer(path.get as Record<string, unknown>)).toBe(true);
    expect(doc.components.schemas.ConversationWindowState).toBeDefined();
  });
});
