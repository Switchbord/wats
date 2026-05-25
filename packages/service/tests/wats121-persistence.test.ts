import { afterEach, describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createCryptoProvider } from "@wats/crypto";
import { createMockTransport } from "@wats/graph/testing";
import { createSqlitePersistence, type PersistenceStore } from "@wats/persistence";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createWatsServiceApp, type WatsServiceConfig } from "@wats/service";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats121-service-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

async function sqliteStore(): Promise<PersistenceStore> {
  const store = await createSqlitePersistence({ filename: tempDb() });
  await store.migrate();
  return store;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
  const mock = createMockTransport({
    defaultResponse: { status: 200, body: { messages: [{ id: "wamid.TEST" }] } }
  });
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
  const provider = await createCryptoProvider();
  return `sha256=${bytesToHex(await provider.hmacSha256(secret, body))}`;
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
    const persistence = await sqliteStore();
    const body = JSON.stringify(webhookEnvelope());
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp(config({
      persistence,
      whatsapp: { dispatch: (update: unknown) => { dispatches.push(update); } } as never
    } as Partial<WatsServiceConfig>));

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
    await persistence.close();
  });

  test("service request idempotency replays matching response and rejects conflicting body", async () => {
    const persistence = await sqliteStore();
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.IDEMPOTENT" }] } }
    });
    const app = createWatsServiceApp(config({ persistence, transport: mock.transport } as Partial<WatsServiceConfig>));

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
    await persistence.close();
  });

  test("service behavior remains unchanged when persistence is omitted", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NO_STORE" }] } }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const first = await app.fetch(new Request("https://service.test/api/messages/text", authed({ to: "15550001111", text: "hello" }, "same-key")));
    const second = await app.fetch(new Request("https://service.test/api/messages/text", authed({ to: "15550001111", text: "hello" }, "same-key")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mock.requests.length).toBe(2);
  });
});
