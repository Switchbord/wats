import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import type { OutboxItem } from "@wats/persistence";
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
  recordMessage(input: StoredMessage): Promise<void>;
  appendMessageStatus(input: { waMessageId: string; status: string; timestamp: string }): Promise<void>;
  getMessage(input: { waMessageId: string }): Promise<StoredMessage | null>;
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
    async migrate() { return { currentVersion: 3, appliedMigrations: [], alreadyCurrent: true }; },
    async health() { return { ok: true, backend: "sqlite", currentVersion: 3, redactedLocation: "[REDACTED_SQLITE_DATABASE]" }; },
    async recordWebhookEvent() { return "recorded"; },
    async getServiceRequest() { return null; },
    async recordServiceRequest() {},
    async enqueueOutboxItem() { return "enqueued"; },
    async claimOutboxItems() { return []; },
    async markOutboxItemFailed() {},
    async markOutboxItemSucceeded() {},
    async recordMessage(input) {
      this.messages.set(input.waMessageId, input);
    },
    async appendMessageStatus(input) {
      const existing = this.messages.get(input.waMessageId);
      if (existing !== undefined) {
        this.messages.set(input.waMessageId, { ...existing, status: input.status, updatedAt: input.timestamp });
      }
    },
    async getMessage(input) {
      const existing = this.messages.get(input.waMessageId);
      return existing ?? null;
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

function authedGet(): RequestInit {
  return {
    method: "GET",
    headers: { authorization: "Bearer service-bearer" }
  };
}

function authedPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { authorization: "Bearer service-bearer", "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

describe("WATS-122 message projection service routes", () => {
  test("GET /api/messages lists outbound messages after a successful text send", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const send = await app.fetch(new Request("https://service.test/api/messages/text", authedPost({
      to: "15550001111",
      text: "hello"
    })));
    expect(send.status).toBe(200);

    const list = await app.fetch(new Request("https://service.test/api/messages", authedGet()));
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.items.length).toBe(1);
    expect(listBody.items[0].waMessageId).toBe("wamid.TEST");
    expect(listBody.items[0].direction).toBe("outbound");
    expect(listBody.items[0].status).toBe("sent");
    expect(listBody.items[0].type).toBe("text");
    expect(listBody.items[0].toPhone).toBe("15550001111");
    expect(listBody.items[0].graphMessageId).toBe("wamid.TEST");
    expect(listBody.nextCursor).toBeNull();
  });

  test("GET /api/messages/{id} returns the single record", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    await app.fetch(new Request("https://service.test/api/messages/text", authedPost({
      to: "15550001111",
      text: "hello"
    })));

    const single = await app.fetch(new Request("https://service.test/api/messages/wamid.TEST", authedGet()));
    expect(single.status).toBe(200);
    const record = await single.json();
    expect(record.waMessageId).toBe("wamid.TEST");
    expect(record.direction).toBe("outbound");
    expect(record.status).toBe("sent");
  });

  test("GET /api/messages/unknown returns 404 not_found", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/messages/wamid.UNKNOWN", authedGet()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  test("GET /api/messages without bearer returns 401", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/messages"));
    expect(res.status).toBe(401);
  });

  test("GET /api/messages without persistence injected returns 503 persistence_not_configured", async () => {
    const app = createWatsServiceApp(config());

    const res = await app.fetch(new Request("https://service.test/api/messages", authedGet()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_not_configured");
  });

  test("projection failure does not break the send response", async () => {
    const persistence = memoryStore();
    persistence.recordMessage = async () => { throw new Error("projection failure"); };
    const app = createWatsServiceApp({ ...config(), persistence });

    const send = await app.fetch(new Request("https://service.test/api/messages/text", authedPost({
      to: "15550001111",
      text: "hello"
    })));
    expect(send.status).toBe(200);
    const sendBody = await send.json();
    expect(sendBody).toEqual({ messages: [{ id: "wamid.TEST" }] });
  });

  test("GET /api/messages honors the limit query parameter", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    for (let i = 0; i < 3; i += 1) {
      const mock = createLocalMockTransport({ messages: [{ id: `wamid.${i}` }] });
      const sendApp = createWatsServiceApp({ ...config({ transport: mock.transport }), persistence });
      await sendApp.fetch(new Request("https://service.test/api/messages/text", authedPost({
        to: "15550001111",
        text: `hello ${i}`
      })));
    }

    const list = await app.fetch(new Request("https://service.test/api/messages?limit=2", authedGet()));
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.items.length).toBe(2);
    expect(listBody.nextCursor).not.toBeNull();
  });

  test("non-GET methods on /api/messages are rejected with 405", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/messages", {
      method: "DELETE",
      headers: { authorization: "Bearer service-bearer" }
    }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
  });

  test("GET /api/messages/{id} with an unsafe id returns 400", async () => {
    const persistence = memoryStore();
    const app = createWatsServiceApp({ ...config(), persistence });

    const res = await app.fetch(new Request("https://service.test/api/messages/bad%0Aid", authedGet()));
    expect(res.status).toBe(400);
  });
});

describe("WATS-122 message projection OpenAPI document", () => {
  test("includes both GET message paths with service bearer security", () => {
    const doc = createWatsServiceOpenApiDocument(profile(), { serverUrl: "https://service.test" });
    const messagesPath = doc.paths["/api/messages"];
    expect(messagesPath).toBeDefined();
    expect(messagesPath.get).toBeDefined();
    expect(messagesPath.post).toBeDefined();
    const messageIdPath = doc.paths["/api/messages/{messageId}"];
    expect(messageIdPath).toBeDefined();
    expect(messageIdPath.get).toBeDefined();

    const hasBearer = (op: Record<string, unknown>): boolean => Array.isArray(op.security)
      && op.security.some((entry) => typeof entry === "object" && entry !== null && Array.isArray((entry as Record<string, unknown>).serviceBearerAuth));
    expect(hasBearer(messagesPath.get as Record<string, unknown>)).toBe(true);
    expect(hasBearer(messageIdPath.get as Record<string, unknown>)).toBe(true);

    expect(doc.components.schemas.MessageRecord).toBeDefined();
    expect(doc.components.schemas.MessageListResponse).toBeDefined();
  });
});
