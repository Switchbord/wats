// WATS-189 — uniform 401 posture for /api/* operator routes.
//
// /api/* operator routes (messages, conversations/window) return 401
// unauthorized on a missing or invalid bearer token — dev-friendly and
// consistent with the sibling /api/messages routes. Telemetry endpoints
// (/metrics, /status, /debug/diagnostics) KEEP their deliberate 404
// catch-all so endpoint existence is hidden from unauthenticated callers.
// These tests pin both halves so neither posture regresses.

import { describe, expect, test } from "bun:test";
import type { WatsProfileConfig } from "@wats/config";
import {
  createWatsServiceApp,
  type WatsServiceConfig
} from "../src/index";

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

function bearerGet(token: string | null): RequestInit {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return { method: "GET", headers };
}

describe("WATS-189 /api/* uniform 401 auth posture", () => {
  test("conversations window: missing bearer returns 401 unauthorized", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", bearerGet(null)));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });

  test("conversations window: invalid bearer returns 401 unauthorized", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", bearerGet("wrong-token")));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
  });

  test("conversations window: malformed authorization header returns 401 unauthorized", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/api/conversations/15550001111/window", {
      method: "GET",
      headers: { authorization: "NotBearer abc" }
    }));
    expect(res.status).toBe(401);
  });
});

describe("WATS-189 telemetry 404 catch-all posture (pinned, must not regress)", () => {
  test("/metrics missing bearer returns 404", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/metrics"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  test("/metrics invalid bearer returns 404", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/metrics", bearerGet("wrong-token")));
    expect(res.status).toBe(404);
  });

  test("/status missing bearer returns 404", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/status"));
    expect(res.status).toBe(404);
  });

  test("/status invalid bearer returns 404", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/status", bearerGet("wrong-token")));
    expect(res.status).toBe(404);
  });

  test("/debug/diagnostics missing bearer returns 404", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/debug/diagnostics"));
    expect(res.status).toBe(404);
  });

  test("/debug/diagnostics invalid bearer returns 404", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/debug/diagnostics", bearerGet("wrong-token")));
    expect(res.status).toBe(404);
  });

  test("telemetry 404 body is byte-identical to the unknown-route catch-all", async () => {
    const app = createWatsServiceApp(config());
    const metrics = await app.fetch(new Request("https://service.test/metrics"));
    const catchAll = await app.fetch(new Request("https://service.test/no/such/route"));
    expect(metrics.status).toBe(404);
    expect(catchAll.status).toBe(404);
    expect(await metrics.text()).toBe(await catchAll.text());
  });
});
