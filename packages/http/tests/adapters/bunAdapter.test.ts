// F-12 RED — Bun adapter integration test. Uses Bun.serve to bind a
// real port, sends an HTTP request via `fetch()`, asserts the round-
// trip. Skipped in environments that lack `Bun.serve`.

import { describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@wats/crypto";
import { createBunWebhookServer, createWebhookAdapter } from "@wats/http";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

async function signBody(secret: string, body: string): Promise<string> {
  const provider = await createCryptoProvider();
  const digest = await provider.hmacSha256(secret, body);
  return `sha256=${bytesToHex(digest)}`;
}

function makeFacade() {
  const dispatches: unknown[] = [];
  return {
    dispatches,
    async dispatch(update: unknown) {
      dispatches.push(update);
    }
  };
}

function makeEnvelope() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "555" },
              messages: [
                {
                  from: "15550001",
                  id: "wamid.BUN",
                  timestamp: "1",
                  type: "text",
                  text: { body: "hi" }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

const hasBunServe = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

describe.if(hasBunServe)("F-12 createBunWebhookServer", () => {
  test("GET verify round-trip returns 200 + challenge body", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const server = createBunWebhookServer(adapter, { port: 0 });
    try {
      const url = `http://${server.hostname}:${server.port}/?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
        VERIFY_TOKEN
      )}&hub.challenge=okay`;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("okay");
    } finally {
      server.stop(true);
    }
  });

  test("POST with valid signature dispatches and returns 200", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const server = createBunWebhookServer(adapter, { port: 0 });
    try {
      const body = JSON.stringify(makeEnvelope());
      const signature = await signBody(APP_SECRET, body);
      const res = await fetch(`http://${server.hostname}:${server.port}/`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature
        },
        body
      });
      expect(res.status).toBe(200);
      expect(facade.dispatches.length).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("POST with invalid signature returns 401", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const server = createBunWebhookServer(adapter, { port: 0 });
    try {
      const body = JSON.stringify(makeEnvelope());
      const res = await fetch(`http://${server.hostname}:${server.port}/`, {
        method: "POST",
        headers: {
          "x-hub-signature-256":
            "sha256=0000000000000000000000000000000000000000000000000000000000000000"
        },
        body
      });
      expect(res.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });

  test("stop() terminates the server cleanly", () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const server = createBunWebhookServer(adapter, { port: 0 });
    expect(typeof server.stop).toBe("function");
    server.stop(true);
  });
});
