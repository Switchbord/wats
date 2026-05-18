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
    expect(req.url).toContain("/root/v25.0/15551234567/messages");
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


  test("POST /messages accepts media composer bodies and sends SDK-built Graph payloads", async () => {
    const cases: Array<{
      readonly label: string;
      readonly input: Record<string, unknown>;
      readonly expected: Record<string, unknown>;
    }> = [
      {
        label: "image media id",
        input: { type: "image", to: "15550001111", mediaId: "media-image", caption: "hello", replyToMessageId: "wamid.PARENT" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "image",
          image: { id: "media-image", caption: "hello" },
          context: { message_id: "wamid.PARENT" }
        }
      },
      {
        label: "video link",
        input: { type: "video", to: "15550001111", link: "https://cdn.example/video.mp4", caption: "watch" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "video",
          video: { link: "https://cdn.example/video.mp4", caption: "watch" }
        }
      },
      {
        label: "audio media id",
        input: { type: "audio", to: "15550001111", mediaId: "media-audio" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "audio",
          audio: { id: "media-audio" }
        }
      },
      {
        label: "document link",
        input: { type: "document", to: "15550001111", link: "https://cdn.example/doc.pdf", caption: "read", filename: "doc.pdf" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "document",
          document: { link: "https://cdn.example/doc.pdf", caption: "read", filename: "doc.pdf" }
        }
      },
      {
        label: "sticker media id",
        input: { type: "sticker", to: "15550001111", mediaId: "media-sticker" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "sticker",
          sticker: { id: "media-sticker" }
        }
      }
    ];

    for (const testCase of cases) {
      const mock = createMockTransport({
        defaultResponse: { status: 200, body: { messages: [{ id: `wamid.${testCase.label}` }] } }
      });
      const app = createWatsServiceApp(config({ transport: mock.transport }));

      const res = await app.fetch(new Request("https://service.test/api/messages", authed(testCase.input)));

      expect(res.status, testCase.label).toBe(200);
      expect(mock.requests.length, testCase.label).toBe(1);
      const req = mock.requests[0]!;
      expect(req.method, testCase.label).toBe("POST");
      expect(req.url, testCase.label).toContain("/root/v25.0/15551234567/messages");
      expect(req.headers.get("authorization"), testCase.label).toBe("Bearer graph-access-token");
      expect(req.headers.get("authorization"), testCase.label).not.toBe("Bearer service-bearer");
      expect(JSON.parse(String(req.body)), testCase.label).toEqual(testCase.expected);
    }
  });

  test("POST /messages media bodies fail closed for auth, validation, and secret redaction", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.MEDIA" }] } }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));
    const valid = { type: "image", to: "15550001111", mediaId: "media-image" };

    const unauthorized = await app.fetch(new Request("https://service.test/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid)
    }));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.text()).not.toContain("service-bearer");
    expect(mock.requests.length).toBe(0);

    const invalidBodies: unknown[] = [
      { type: "image", to: "15550001111" },
      { type: "image", to: "15550001111", mediaId: "media-image", link: "https://cdn.example/image.jpg" },
      { type: "audio", to: "15550001111", mediaId: "media-audio", caption: "not allowed" },
      { type: "sticker", to: "15550001111", mediaId: "media-sticker", filename: "nope.webp" },
      { type: "document", to: "15550001111", link: "file:///tmp/secret.pdf" },
      { type: "interactive", to: "15550001111" }
    ];

    for (const body of invalidBodies) {
      const res = await app.fetch(new Request("https://service.test/api/messages", authed(body)));
      expect(res.status, JSON.stringify(body)).toBe(400);
      const text = await res.text();
      expect(text).not.toContain("graph-access-token");
      expect(text).not.toContain("service-bearer");
    }
    expect(mock.requests.length).toBe(0);
  });


  test("POST /messages accepts location and reaction composer bodies", async () => {
    const cases: Array<{
      readonly label: string;
      readonly input: Record<string, unknown>;
      readonly expected: Record<string, unknown>;
    }> = [
      {
        label: "location",
        input: { type: "location", to: "15550001111", latitude: 37.422, longitude: -122.084, name: "HQ", address: "1600 Amphitheatre", replyToMessageId: "wamid.PARENT" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "location",
          location: { latitude: 37.422, longitude: -122.084, name: "HQ", address: "1600 Amphitheatre" },
          context: { message_id: "wamid.PARENT" }
        }
      },
      {
        label: "reaction",
        input: { type: "reaction", to: "15550001111", messageId: "wamid.TARGET", emoji: "👍" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "reaction",
          reaction: { message_id: "wamid.TARGET", emoji: "👍" }
        }
      },
      {
        label: "remove reaction",
        input: { type: "removeReaction", to: "15550001111", messageId: "wamid.TARGET" },
        expected: {
          messaging_product: "whatsapp",
          to: "15550001111",
          type: "reaction",
          reaction: { message_id: "wamid.TARGET", emoji: "" }
        }
      }
    ];

    for (const testCase of cases) {
      const mock = createMockTransport({
        defaultResponse: { status: 200, body: { messages: [{ id: `wamid.${testCase.label}` }] } }
      });
      const app = createWatsServiceApp(config({ transport: mock.transport }));

      const res = await app.fetch(new Request("https://service.test/api/messages", authed(testCase.input)));

      expect(res.status, testCase.label).toBe(200);
      expect(mock.requests.length, testCase.label).toBe(1);
      const req = mock.requests[0]!;
      expect(req.method, testCase.label).toBe("POST");
      expect(req.url, testCase.label).toContain("/root/v25.0/15551234567/messages");
      expect(req.headers.get("authorization"), testCase.label).toBe("Bearer graph-access-token");
      expect(req.headers.get("authorization"), testCase.label).not.toBe("Bearer service-bearer");
      expect(JSON.parse(String(req.body)), testCase.label).toEqual(testCase.expected);
    }
  });

  test("POST /messages location and reaction bodies fail closed", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NOPE" }] } }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));
    const invalidBodies: unknown[] = [
      { type: "location", to: "15550001111", latitude: Number.NaN, longitude: 2 },
      { type: "location", to: "15550001111", latitude: 91, longitude: 2 },
      { type: "location", to: "15550001111", latitude: 1, longitude: -181 },
      { type: "location", to: "15550001111", latitude: 1, longitude: 2, name: "" },
      { type: "location", to: "15550001111", latitude: 1, longitude: 2, extra: "not allowed" },
      { type: "reaction", to: "15550001111", messageId: "", emoji: "👍" },
      { type: "reaction", to: "15550001111", messageId: "wamid.TARGET", emoji: "" },
      { type: "reaction", to: "15550001111", messageId: "wamid.TARGET", emoji: "👍", extra: "not allowed" },
      { type: "removeReaction", to: "15550001111" },
      { type: "removeReaction", to: "15550001111", messageId: "wamid.TARGET", emoji: "👍" },
      { type: "removeReaction", to: "15550001111", messageId: "wamid.TARGET", extra: "not allowed" }
    ];

    for (const body of invalidBodies) {
      const res = await app.fetch(new Request("https://service.test/api/messages", authed(body)));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.text()).not.toContain("service-bearer");
    }
    expect(mock.requests.length).toBe(0);
  });


  test("POST /messages accepts contacts composer bodies", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.CONTACTS" }] } }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));
    const input = {
      type: "contacts",
      to: "15550001111",
      contacts: [{
        name: { formattedName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace" },
        phones: [{ phone: "+15550002222", type: "CELL" }],
        emails: [{ email: "ada@example.test", type: "WORK" }],
        urls: [{ url: "https://example.test/ada", type: "WORK" }],
        org: { company: "Analytical Engines", title: "Programmer" },
        birthday: "1815-12-10"
      }],
      replyToMessageId: "wamid.PARENT"
    };

    const res = await app.fetch(new Request("https://service.test/api/messages", authed(input)));

    expect(res.status).toBe(200);
    expect(mock.requests.length).toBe(1);
    const req = mock.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/root/v25.0/15551234567/messages");
    expect(req.headers.get("authorization")).toBe("Bearer graph-access-token");
    expect(req.headers.get("authorization")).not.toBe("Bearer service-bearer");
    expect(JSON.parse(String(req.body))).toEqual({
      messaging_product: "whatsapp",
      to: "15550001111",
      type: "contacts",
      contacts: [{
        name: { formatted_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace" },
        phones: [{ phone: "+15550002222", type: "CELL" }],
        emails: [{ email: "ada@example.test", type: "WORK" }],
        urls: [{ url: "https://example.test/ada", type: "WORK" }],
        org: { company: "Analytical Engines", title: "Programmer" },
        birthday: "1815-12-10"
      }],
      context: { message_id: "wamid.PARENT" }
    });
  });

  test("POST /messages contacts bodies fail closed", async () => {
    const mock = createMockTransport({
      defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NOPE" }] } }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));
    const invalidBodies: unknown[] = [
      { type: "contacts", to: "15550001111" },
      { type: "contacts", to: "15550001111", contacts: [] },
      { type: "contacts", to: "15550001111", contacts: [{ name: {} }] },
      { type: "contacts", to: "15550001111", contacts: [{ name: { formattedName: "Ada" }, phones: [{ type: "CELL" }] }] },
      { type: "contacts", to: "15550001111", contacts: [{ name: { formattedName: "Ada" }, urls: [{ url: "file:///tmp/a" }] }] },
      { type: "contacts", to: "15550001111", contacts: [{ name: { formattedName: "Ada" } }], extra: "not allowed" }
    ];

    for (const body of invalidBodies) {
      const res = await app.fetch(new Request("https://service.test/api/messages", authed(body)));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.text()).not.toContain("service-bearer");
    }
    expect(mock.requests.length).toBe(0);
  });


  test("POST /messages accepts basic interactive composer bodies", async () => {
    const cases: Array<{
      readonly label: string;
      readonly input: Record<string, unknown>;
      readonly expectedInteractive: Record<string, unknown>;
    }> = [
      {
        label: "buttons",
        input: { type: "interactiveButtons", to: "15550001111", bodyText: "Choose", buttons: [{ id: "yes", title: "Yes" }], headerText: "Header", footerText: "Footer", replyToMessageId: "wamid.PARENT" },
        expectedInteractive: {
          type: "button",
          body: { text: "Choose" },
          action: { buttons: [{ type: "reply", reply: { id: "yes", title: "Yes" } }] },
          header: { type: "text", text: "Header" },
          footer: { text: "Footer" }
        }
      },
      {
        label: "list",
        input: { type: "interactiveList", to: "15550001111", bodyText: "Pick", buttonText: "Open", sections: [{ title: "A", rows: [{ id: "row-1", title: "Row 1", description: "First" }] }] },
        expectedInteractive: {
          type: "list",
          body: { text: "Pick" },
          action: { button: "Open", sections: [{ rows: [{ id: "row-1", title: "Row 1", description: "First" }], title: "A" }] }
        }
      },
      {
        label: "cta url",
        input: { type: "interactiveCtaUrl", to: "15550001111", bodyText: "Visit", displayText: "Open", url: "https://example.test/offer" },
        expectedInteractive: {
          type: "cta_url",
          body: { text: "Visit" },
          action: { name: "cta_url", parameters: { display_text: "Open", url: "https://example.test/offer" } }
        }
      }
    ];

    for (const testCase of cases) {
      const mock = createMockTransport({ defaultResponse: { status: 200, body: { messages: [{ id: `wamid.${testCase.label}` }] } } });
      const app = createWatsServiceApp(config({ transport: mock.transport }));
      const res = await app.fetch(new Request("https://service.test/api/messages", authed(testCase.input)));
      expect(res.status, testCase.label).toBe(200);
      expect(mock.requests.length, testCase.label).toBe(1);
      const body = JSON.parse(String(mock.requests[0]!.body));
      expect(body.messaging_product, testCase.label).toBe("whatsapp");
      expect(body.to, testCase.label).toBe("15550001111");
      expect(body.type, testCase.label).toBe("interactive");
      expect(body.interactive, testCase.label).toEqual(testCase.expectedInteractive);
      expect(mock.requests[0]!.headers.get("authorization"), testCase.label).toBe("Bearer graph-access-token");
      expect(mock.requests[0]!.headers.get("authorization"), testCase.label).not.toBe("Bearer service-bearer");
    }
  });

  test("POST /messages basic interactive bodies fail closed", async () => {
    const mock = createMockTransport({ defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NOPE" }] } } });
    const app = createWatsServiceApp(config({ transport: mock.transport }));
    const invalidBodies: unknown[] = [
      { type: "interactiveButtons", to: "15550001111", bodyText: "Choose", buttons: [] },
      { type: "interactiveButtons", to: "15550001111", bodyText: "Choose", buttons: [{ id: "yes" }] },
      { type: "interactiveButtons", to: "15550001111", bodyText: "Choose", buttons: [{ id: "yes", title: "Yes" }], extra: "not allowed" },
      { type: "interactiveList", to: "15550001111", bodyText: "Pick", buttonText: "Open", sections: [] },
      { type: "interactiveList", to: "15550001111", bodyText: "Pick", buttonText: "Open", sections: [{ rows: [] }] },
      { type: "interactiveCtaUrl", to: "15550001111", bodyText: "Visit", displayText: "Open", url: "file:///tmp/a" },
      { type: "interactiveCtaUrl", to: "15550001111", bodyText: "Visit", displayText: "Open", url: "https://example.test", extra: "not allowed" }
    ];

    for (const body of invalidBodies) {
      const res = await app.fetch(new Request("https://service.test/api/messages", authed(body)));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.text()).not.toContain("service-bearer");
    }
    expect(mock.requests.length).toBe(0);
  });


  test("POST /messages accepts commerce interactive composer bodies", async () => {
    const cases: Array<{
      readonly label: string;
      readonly input: Record<string, unknown>;
      readonly expectedInteractive: Record<string, unknown>;
    }> = [
      {
        label: "product",
        input: { type: "interactiveProduct", to: "15550001111", catalogId: "catalog-1", productRetailerId: "sku-1", bodyText: "One product", footerText: "Footer", replyToMessageId: "wamid.PARENT" },
        expectedInteractive: { type: "product", action: { catalog_id: "catalog-1", product_retailer_id: "sku-1" }, body: { text: "One product" }, footer: { text: "Footer" } }
      },
      {
        label: "products",
        input: { type: "interactiveProducts", to: "15550001111", catalogId: "catalog-1", headerText: "Products", bodyText: "Pick", sections: [{ title: "Set", productItems: [{ productRetailerId: "sku-1" }] }] },
        expectedInteractive: { type: "product_list", header: { type: "text", text: "Products" }, body: { text: "Pick" }, action: { catalog_id: "catalog-1", sections: [{ title: "Set", product_items: [{ product_retailer_id: "sku-1" }] }] } }
      },
      {
        label: "catalog",
        input: { type: "interactiveCatalog", to: "15550001111", bodyText: "Browse", thumbnailProductRetailerId: "sku-thumb" },
        expectedInteractive: { type: "catalog_message", body: { text: "Browse" }, action: { name: "catalog_message", parameters: { thumbnail_product_retailer_id: "sku-thumb" } } }
      },
      {
        label: "location request",
        input: { type: "interactiveLocationRequest", to: "15550001111", bodyText: "Share your location" },
        expectedInteractive: { type: "location_request_message", body: { text: "Share your location" }, action: { name: "send_location" } }
      }
    ];

    for (const testCase of cases) {
      const mock = createMockTransport({ defaultResponse: { status: 200, body: { messages: [{ id: `wamid.${testCase.label}` }] } } });
      const app = createWatsServiceApp(config({ transport: mock.transport }));
      const res = await app.fetch(new Request("https://service.test/api/messages", authed(testCase.input)));
      expect(res.status, testCase.label).toBe(200);
      expect(mock.requests.length, testCase.label).toBe(1);
      const body = JSON.parse(String(mock.requests[0]!.body));
      expect(body.messaging_product, testCase.label).toBe("whatsapp");
      expect(body.to, testCase.label).toBe("15550001111");
      expect(body.type, testCase.label).toBe("interactive");
      expect(body.interactive, testCase.label).toEqual(testCase.expectedInteractive);
      expect(mock.requests[0]!.headers.get("authorization"), testCase.label).toBe("Bearer graph-access-token");
      expect(mock.requests[0]!.headers.get("authorization"), testCase.label).not.toBe("Bearer service-bearer");
    }
  });

  test("POST /messages commerce interactive bodies fail closed", async () => {
    const mock = createMockTransport({ defaultResponse: { status: 200, body: { messages: [{ id: "wamid.NOPE" }] } } });
    const app = createWatsServiceApp(config({ transport: mock.transport }));
    const invalidBodies: unknown[] = [
      { type: "interactiveProduct", to: "15550001111", catalogId: "catalog-1" },
      { type: "interactiveProduct", to: "15550001111", catalogId: "catalog-1", productRetailerId: "sku-1", extra: "not allowed" },
      { type: "interactiveProducts", to: "15550001111", catalogId: "catalog-1", headerText: "Products", bodyText: "Pick", sections: [] },
      { type: "interactiveProducts", to: "15550001111", catalogId: "catalog-1", headerText: "Products", bodyText: "Pick", sections: [{ title: "Set", productItems: [] }] },
      { type: "interactiveCatalog", to: "15550001111" },
      { type: "interactiveCatalog", to: "15550001111", bodyText: "Browse", extra: "not allowed" },
      { type: "interactiveLocationRequest", to: "15550001111", bodyText: "" },
      { type: "interactiveLocationRequest", to: "15550001111", bodyText: "Share", extra: "not allowed" }
    ];

    for (const body of invalidBodies) {
      const res = await app.fetch(new Request("https://service.test/api/messages", authed(body)));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.text()).not.toContain("service-bearer");
    }
    expect(mock.requests.length).toBe(0);
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
