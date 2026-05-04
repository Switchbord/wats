// F-12 RED — Node adapter integration test. Dynamically imports
// node:http, binds a server on an ephemeral port, performs a real
// HTTP round-trip, then tears down.

import { describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@wats/crypto";
import { createNodeWebhookHandler, createWebhookAdapter } from "@wats/http";

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
                  id: "wamid.NODE",
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

interface HttpListenerServer {
  close(cb?: (err?: Error) => void): void;
  address(): { port: number } | string | null;
}

async function startServer(
  handler: (req: unknown, res: unknown) => Promise<void>
): Promise<{ port: number; close(): Promise<void> }> {
  const mod = (await import(
    /* @vite-ignore */ "node:http"
  )) as {
    createServer: (h: unknown) => HttpListenerServer & { listen: (port: number, host: string, cb: () => void) => void };
  };
  return await new Promise((resolve, reject) => {
    const server = mod.createServer((req, res) => {
      handler(req, res).catch((err: unknown) => {
        try {
          (res as { statusCode: number; end: (s?: string) => void }).statusCode =
            500;
          (res as { end: (s?: string) => void }).end(String(err));
        } catch {
          /* best effort */
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        resolve({
          port: (addr as { port: number }).port,
          close: () =>
            new Promise<void>((r) => {
              server.close(() => r());
            })
        });
      } else {
        reject(new Error("server.address() did not return an object"));
      }
    });
  });
}

describe("F-12 createNodeWebhookHandler", () => {
  test("GET verify round-trip returns 200 + challenge body", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const handler = createNodeWebhookHandler(adapter);
    const server = await startServer(
      handler as unknown as (req: unknown, res: unknown) => Promise<void>
    );
    try {
      const url = `http://127.0.0.1:${server.port}/?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
        VERIFY_TOKEN
      )}&hub.challenge=okay`;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("okay");
    } finally {
      await server.close();
    }
  });

  test("POST with valid signature dispatches and returns 200", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const handler = createNodeWebhookHandler(adapter);
    const server = await startServer(
      handler as unknown as (req: unknown, res: unknown) => Promise<void>
    );
    try {
      const body = JSON.stringify(makeEnvelope());
      const signature = await signBody(APP_SECRET, body);
      const res = await fetch(`http://127.0.0.1:${server.port}/`, {
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
      await server.close();
    }
  });

  test("POST with invalid signature returns 401", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const handler = createNodeWebhookHandler(adapter);
    const server = await startServer(
      handler as unknown as (req: unknown, res: unknown) => Promise<void>
    );
    try {
      const body = JSON.stringify(makeEnvelope());
      const res = await fetch(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        headers: {
          "x-hub-signature-256":
            "sha256=0000000000000000000000000000000000000000000000000000000000000000"
        },
        body
      });
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  test("PUT returns 405", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const handler = createNodeWebhookHandler(adapter);
    const server = await startServer(
      handler as unknown as (req: unknown, res: unknown) => Promise<void>
    );
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`, {
        method: "PUT"
      });
      expect(res.status).toBe(405);
    } finally {
      await server.close();
    }
  });

  test("returns a function of arity 2 (req, res)", () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const handler = createNodeWebhookHandler(adapter);
    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(2);
  });
});

// ---- F-12 remediation (WATS-29) — read-time body-size cap --------
//
// BLOCKER: Node adapter buffers the full incoming body in memory
// before the maxBodyBytes check fires inside the adapter core. A
// malicious sender can force unbounded memory use before the 413
// is returned. The remediation threads maxBodyBytes into the Node
// wrapper: readBody tracks `total`, calls `req.destroy(...)` when
// it exceeds the cap, and the wrapper short-circuits with a 413
// response without ever handing the oversized body to the core.

describe("F-12 remediation — Node adapter enforces body-size cap at read time", () => {
  test("oversized streamed body triggers req.destroy and returns 413", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      maxBodyBytes: 16
    });
    const handler = createNodeWebhookHandler(adapter);

    // Build a fake IncomingMessage that emits three chunks totaling
    // well over maxBodyBytes + 1. The wrapper MUST call req.destroy
    // and MUST respond 413 without routing the bytes through the
    // adapter core.
    let destroyCalled = 0;
    const dataListeners: Array<(chunk: unknown) => void> = [];
    const endListeners: Array<() => void> = [];
    const errorListeners: Array<(err: unknown) => void> = [];
    const req = {
      method: "POST",
      url: "/webhook",
      headers: {
        "x-hub-signature-256": "sha256=" + "a".repeat(64),
        host: "127.0.0.1"
      },
      on(event: string, listener: (arg?: unknown) => void) {
        if (event === "data") dataListeners.push(listener as (c: unknown) => void);
        else if (event === "end") endListeners.push(listener as () => void);
        else if (event === "error")
          errorListeners.push(listener as (e: unknown) => void);
        return req;
      },
      destroy(err?: unknown) {
        destroyCalled += 1;
        // Emulate node: after destroy, fire error listeners so the
        // readBody promise resolves to "aborted".
        for (const l of errorListeners) l(err);
      }
    };

    let statusCode = 0;
    const headerBag: Record<string, string> = {};
    let ended = false;
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headerBag[name] = value;
      },
      end() {
        ended = true;
      }
    };
    // Silence unused-warning — statusCode/headerBag exist to capture
    // assertion evidence even though we also read res.statusCode.
    void statusCode;
    void headerBag;

    // Start the handler and drive chunks concurrently.
    const done = handler(req as never, res as never);

    // Emit chunks greater than maxBodyBytes.
    const chunk = new Uint8Array(10); // 10 bytes
    // After 2 chunks (20 bytes) we've exceeded cap of 16.
    for (let i = 0; i < 5 && destroyCalled === 0; i += 1) {
      for (const l of dataListeners) l(chunk);
    }
    // If destroy was not wired, fire end to avoid hanging.
    if (destroyCalled === 0) {
      for (const l of endListeners) l();
    }

    await done;

    expect(destroyCalled).toBeGreaterThan(0);
    expect(res.statusCode).toBe(413);
    expect(ended).toBe(true);
    expect(facade.dispatches.length).toBe(0);
  });
});
