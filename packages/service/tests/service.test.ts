import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createCryptoProvider } from "@wats/crypto";
import { createMockTransport } from "@wats/graph/testing";
import {
  createWatsServiceApp,
  WatsServiceError,
  type WatsServiceConfig
} from "@wats/service";

function profile(overrides: Partial<WatsProfileConfig> = {}): WatsProfileConfig {
  return {
    graph: { apiVersion: "v21.0", baseUrl: "https://graph.test/root/" },
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

function config(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  const mock = createMockTransport({
    defaultResponse: {
      status: 200,
      body: { messaging_product: "whatsapp", messages: [{ id: "wamid.TEST" }] }
    }
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

async function json(response: Response): Promise<unknown> {
  return response.json();
}

function authed(body: unknown, token = "service-bearer"): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
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

describe("WATS-34 service construction", () => {
  test("exports the public app factory and error class", () => {
    expect(typeof createWatsServiceApp).toBe("function");
    expect(new WatsServiceError("invalid_config").name).toBe("WatsServiceError");
    expect(new WatsServiceError("invalid_config").code).toBe("invalid_config");
  });

  test("rejects malformed runtime args without raw host errors or secret leakage", () => {
    const cases: Array<[string, unknown]> = [
      ["missing config", undefined],
      ["null config", null],
      ["missing profile", { ...config(), profile: undefined }],
      ["missing secrets", { ...config(), secrets: undefined }],
      ["blank access token", { ...config(), secrets: { ...config().secrets, accessToken: "   " } }],
      ["blank service bearer", { ...config(), secrets: { ...config().secrets, serviceBearerToken: "" } }]
    ];

    for (const [label, value] of cases) {
      let thrown: unknown;
      try {
        createWatsServiceApp(value as WatsServiceConfig);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, label).toBeInstanceOf(WatsServiceError);
      expect(thrown, label).not.toBeInstanceOf(TypeError);
      const message = String((thrown as Error).message);
      expect(message, label).not.toContain("graph-access-token");
      expect(message, label).not.toContain("service-bearer");
      expect(message, label).not.toContain("app-secret");
    }
  });

  test("rejects unsafe webhook paths and api prefixes if passed at runtime", () => {
    const unsafePaths = ["webhook", "/", "/../secret", "/%2e%2e/secret", "/hook?x=1", "/hook#frag", "/hook\\evil", "/hook\u0000bad"];
    for (const unsafe of unsafePaths) {
      expect(() =>
        createWatsServiceApp(config({ profile: profile({ webhook: { ...profile().webhook, path: unsafe } }) }))
      ).toThrow(WatsServiceError);
      expect(() =>
        createWatsServiceApp(config({ profile: profile({ service: { ...profile().service, apiPrefix: unsafe } }) }))
      ).toThrow(WatsServiceError);
    }
  });
});

describe("WATS-34 service routes", () => {
  test("healthz and readyz return JSON when constructed", async () => {
    const app = createWatsServiceApp(config());

    const health = await app.fetch(new Request("https://service.test/healthz"));
    expect(health.status).toBe(200);
    expect(await json(health)).toEqual({ ok: true, service: "wats" });

    const ready = await app.fetch(new Request("https://service.test/readyz"));
    expect(ready.status).toBe(200);
    expect(await json(ready)).toEqual({ ok: true, service: "wats" });
  });

  test("unknown route is 404 and disallowed method is 405 with Allow", async () => {
    const app = createWatsServiceApp(config());
    const missing = await app.fetch(new Request("https://service.test/nope"));
    expect(missing.status).toBe(404);

    const healthPost = await app.fetch(new Request("https://service.test/healthz", { method: "POST" }));
    expect(healthPost.status).toBe(405);
    expect(healthPost.headers.get("allow")).toBe("GET");

    const messagesGet = await app.fetch(new Request("https://service.test/api/messages/text"));
    expect(messagesGet.status).toBe(405);
    expect(messagesGet.headers.get("allow")).toBe("POST");
  });

  test("routes by exact pathname only; query strings do not bypass routing", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/api/messages/text?x=/healthz", authed({ to: "15550001111", text: "hi" })));
    expect(res.status).toBe(200);
  });
});

describe("WATS-34 service bearer auth and message APIs", () => {
  test("fails closed for missing, malformed, and wrong Authorization", async () => {
    const app = createWatsServiceApp(config());
    const body = { to: "15550001111", text: "hi" };
    for (const headers of [
      undefined,
      { authorization: "service-bearer", "content-type": "application/json" },
      { authorization: "Basic service-bearer", "content-type": "application/json" },
      { authorization: "Bearer wrong", "content-type": "application/json" }
    ]) {
      const res = await app.fetch(new Request("https://service.test/api/messages/text", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      }));
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain("service-bearer");
    }
  });

  test("returns 400 for malformed JSON, arrays, primitives, and invalid text-message bodies", async () => {
    const app = createWatsServiceApp(config());
    const badBodies: BodyInit[] = ["{", "[]", "null", JSON.stringify({ to: "15550001111" }), JSON.stringify({ to: "", text: "hi" }), JSON.stringify({ to: "15550001111", text: "" })];

    for (const body of badBodies) {
      const res = await app.fetch(new Request("https://service.test/api/messages/text", {
        method: "POST",
        headers: { authorization: "Bearer service-bearer", "content-type": "application/json" },
        body
      }));
      expect(res.status).toBe(400);
    }
  });

  test("POST /messages/text sends a text body through Graph using MockTransport only", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.TEXT" }] } }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await app.fetch(new Request("https://service.test/api/messages/text", authed({
      to: "15550001111",
      text: "hello",
      previewUrl: true
    })));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ messages: [{ id: "wamid.TEXT" }] });
    expect(mock.requests.length).toBe(1);
    const req = mock.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/root/v21.0/15551234567/messages");
    expect(req.headers.get("authorization")).toBe("Bearer graph-access-token");
    expect(req.headers.get("authorization")).not.toBe("Bearer service-bearer");
    expect(JSON.parse(String(req.body))).toEqual({
      messaging_product: "whatsapp",
      to: "15550001111",
      type: "text",
      text: { body: "hello", preview_url: true }
    });
  });

  test("POST /messages accepts generic supported message body passthrough", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.GENERIC" }] } }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));
    const body = {
      messaging_product: "whatsapp",
      to: "15550001111",
      type: "text",
      text: { body: "generic" }
    };

    const res = await app.fetch(new Request("https://service.test/api/messages", authed(body)));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ messages: [{ id: "wamid.GENERIC" }] });
    expect(JSON.parse(String(mock.requests[0]!.body))).toEqual(body);
  });
});

describe("WATS-34 webhook composition", () => {
  test("GET configured webhook.path delegates verify challenge to WebhookAdapter", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-ok"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("challenge-ok");
  });

  test("POST configured webhook.path delegates signed body to WebhookAdapter and facade dispatch", async () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "15551234567" },
            messages: [{ from: "15550001111", id: "wamid.WEBHOOK", timestamp: "1", type: "text", text: { body: "hi" } }]
          }
        }]
      }]
    };
    const body = JSON.stringify(envelope);
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp(config({
      whatsapp: { dispatch: (update: unknown) => { dispatches.push(update); } } as never
    }));

    const res = await app.fetch(new Request("https://service.test/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": await signature("app-secret", body)
      },
      body
    }));

    expect(res.status).toBe(200);
    expect(dispatches.length).toBe(1);
  });
});
