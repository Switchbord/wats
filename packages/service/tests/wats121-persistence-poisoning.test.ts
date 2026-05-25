import { afterEach, describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createMockTransport } from "@wats/graph/testing";
import { createSqlitePersistence } from "@wats/persistence";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createWatsServiceApp, type WatsServiceConfig } from "../src/index";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats121-poison-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
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
    service: { host: "127.0.0.1", port: 8787, apiPrefix: "/api", bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" } }
  };
}

function config(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  const mock = createMockTransport({ defaultResponse: { status: 200, body: { messages: [{ id: "wamid.TEST" }] } } });
  return {
    profile: profile(),
    secrets: { accessToken: "graph-access-token", webhookVerifyToken: "verify-token", webhookAppSecret: "app-secret", serviceBearerToken: "service-bearer" },
    transport: mock.transport,
    ...overrides
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function signature(secret: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${bytesToHex(new Uint8Array(digest))}`;
}

function envelope(): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789012345",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "15551234567" },
          messages: [{ from: "15550001111", id: "wamid.POISON", timestamp: "1", type: "text", text: { body: "secret message text" } }]
        }
      }]
    }]
  };
}

describe("WATS-121 webhook persistence poisoning guard", () => {
  test("invalid signatures cannot poison dedupe before the first valid delivery", async () => {
    const persistence = await createSqlitePersistence({ filename: tempDb() });
    await persistence.migrate();
    const dispatches: unknown[] = [];
    const body = JSON.stringify(envelope());
    const app = createWatsServiceApp({
      ...config(),
      persistence,
      whatsapp: { dispatch: (update: unknown) => { dispatches.push(update); } } as never
    });

    const invalid = await app.fetch(new Request("https://service.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000" },
      body
    }));
    const valid = await app.fetch(new Request("https://service.test/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": await signature("app-secret", body) },
      body
    }));

    expect(invalid.status).toBe(401);
    expect(valid.status).toBe(200);
    expect(dispatches.length).toBe(1);
    await persistence.close();
  });
});
