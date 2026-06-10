// WATS-130 — service error transparency (WS1 of the reality-contact program).
//
// Covers the deltas on top of the 0.3.11 sanitized-diagnostics slice:
//   R1.2 status mapping: rate-limit class -> 503 (+ Retry-After when Meta
//        supplied one); auth class and everything else stay 502.
//   R1.3 warn-level log line with sanitized { metaCode, metaSubcode,
//        fbtraceId } so container logs are diagnostic on their own.
//   R1.4 redaction contract: tokens, full E.164 numbers, and Meta's
//        free-form message text never appear in response body or log line.
//   A1.2 hostile error objects (throwing getters) fail closed to the static
//        envelope instead of crashing the handler.

import { afterEach, describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import { createMockTransport } from "@wats/graph/testing";
import { GraphApiError } from "@wats/graph";
import {
  createWatsServiceApp,
  type WatsServiceConfig
} from "@wats/service";

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
    defaultResponse: { status: 200, body: { messages: [{ id: "wamid.OK" }] } }
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

function sendText(app: { fetch(request: Request): Promise<Response> }): Promise<Response> {
  return app.fetch(new Request("https://service.test/api/messages/text", {
    method: "POST",
    headers: {
      authorization: "Bearer service-bearer",
      "content-type": "application/json"
    },
    body: JSON.stringify({ to: "15550001111", text: "hello" })
  }));
}

const originalWarn = console.warn;
let warnLines: string[] = [];

function captureWarn(): void {
  warnLines = [];
  console.warn = (...args: unknown[]) => {
    warnLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
}

afterEach(() => {
  console.warn = originalWarn;
});

describe("WATS-130 graph failure status mapping", () => {
  test("rate-limit class Meta error maps to 503 with Retry-After echoed from Meta", async () => {
    const mock = createMockTransport({
      defaultResponse: {
        status: 429,
        headers: { "retry-after": "27" },
        body: {
          error: {
            message: "(#130429) Rate limit hit",
            code: 130429,
            type: "OAuthException",
            fbtrace_id: "TRACE-RL-1"
          }
        }
      }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await sendText(app);

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("27");
    expect(await res.json()).toEqual({
      error: {
        code: "graph_request_failed",
        message: "Graph request failed.",
        metaCode: 130429,
        metaType: "OAuthException",
        fbtraceId: "TRACE-RL-1"
      }
    });
  });

  test("rate-limit class without a Meta Retry-After maps to 503 without the header", async () => {
    const mock = createMockTransport({
      defaultResponse: {
        status: 400,
        body: {
          error: {
            message: "(#131048) Spam rate limit hit",
            code: 131048,
            fbtrace_id: "TRACE-RL-2"
          }
        }
      }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await sendText(app);

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
    const body = (await res.json()) as { error: { metaCode?: number } };
    expect(body.error.metaCode).toBe(131048);
  });

  test("auth-class Meta error (190) stays 502 with metaCode present", async () => {
    const mock = createMockTransport({
      defaultResponse: {
        status: 401,
        body: {
          error: {
            message: "Invalid OAuth access token.",
            code: 190,
            type: "OAuthException",
            fbtrace_id: "TRACE-AUTH"
          }
        }
      }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await sendText(app);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { metaCode?: number } };
    expect(body.error.metaCode).toBe(190);
  });

  test("campaign failure 131030 stays 502 and is operator-diagnosable from the body", async () => {
    const mock = createMockTransport({
      defaultResponse: {
        status: 400,
        body: {
          error: {
            message: "(#131030) Recipient phone number not in allowed list",
            code: 131030,
            error_subcode: 2494073,
            type: "OAuthException",
            fbtrace_id: "TRACE-131030"
          }
        }
      }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await sendText(app);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(body.error.metaCode).toBe(131030);
    expect(body.error.metaSubcode).toBe(2494073);
    expect(body.error.fbtraceId).toBe("TRACE-131030");
  });
});

describe("WATS-130 graph failure warn logging", () => {
  test("graph failure emits one warn-level JSON line with sanitized Meta diagnostics", async () => {
    captureWarn();
    const mock = createMockTransport({
      defaultResponse: {
        status: 400,
        body: {
          error: {
            message: "(#131030) Recipient phone number +15550001111 not in allowed list",
            code: 131030,
            error_subcode: 2494073,
            fbtrace_id: "TRACE-LOG"
          }
        }
      }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    await sendText(app);

    expect(warnLines.length).toBe(1);
    const parsed = JSON.parse(warnLines[0] ?? "") as Record<string, unknown>;
    expect(parsed.event).toBe("wats.graph.failure");
    expect(parsed.metaCode).toBe(131030);
    expect(parsed.metaSubcode).toBe(2494073);
    expect(parsed.fbtraceId).toBe("TRACE-LOG");
    expect(typeof parsed.at).toBe("string");
  });

  test("redaction contract: token, full E.164, and Meta message text appear in neither body nor log", async () => {
    captureWarn();
    const mock = createMockTransport({
      defaultResponse: {
        status: 400,
        body: {
          error: {
            message: "Bearer graph-access-token failed sending to +15550001111: secret message text",
            code: 131030,
            fbtrace_id: "TRACE-REDACT"
          }
        }
      }
    });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await sendText(app);

    const bodyText = await res.text();
    const logText = warnLines.join("\n");
    for (const surface of [bodyText, logText]) {
      expect(surface).not.toContain("graph-access-token");
      expect(surface).not.toContain("+15550001111");
      expect(surface).not.toContain("secret message text");
    }
    expect(logText).toContain("TRACE-REDACT");
  });
});

describe("WATS-130 hostile error objects fail closed", () => {
  test("throwing getters on a GraphApiError impostor do not crash the handler", async () => {
    captureWarn();
    const impostor = Object.create(GraphApiError.prototype) as Error;
    Object.defineProperty(impostor, "code", {
      get() { throw new Error("poisoned code getter"); }
    });
    Object.defineProperty(impostor, "errorSubcode", {
      get() { throw new Error("poisoned subcode getter"); }
    });
    Object.defineProperty(impostor, "type", {
      get() { throw new Error("poisoned type getter"); }
    });
    Object.defineProperty(impostor, "fbtraceId", {
      get() { throw new Error("poisoned fbtrace getter"); }
    });
    Object.defineProperty(impostor, "message", {
      get() { throw new Error("poisoned message getter"); }
    });
    const mock = createMockTransport({ fail: impostor as Error });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await sendText(app);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: {
        code: "graph_request_failed",
        message: "Graph request failed."
      }
    });
  });

  test("non-numeric/oversized diagnostic fields are dropped, not forwarded", async () => {
    const impostor = Object.create(GraphApiError.prototype) as Error & Record<string, unknown>;
    Object.defineProperty(impostor, "message", { value: "boom" });
    impostor.code = "131030";            // wrong type: string
    impostor.errorSubcode = Number.NaN;  // not finite
    impostor.type = "x".repeat(10_000);  // oversize
    impostor.fbtraceId = 12345;          // wrong type: number
    const mock = createMockTransport({ fail: impostor as Error });
    const app = createWatsServiceApp(config({ transport: mock.transport }));

    const res = await sendText(app);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: {
        code: "graph_request_failed",
        message: "Graph request failed."
      }
    });
  });
});
