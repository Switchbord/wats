// F-12 RED — Fetch adapter coverage.
//
// The fetch adapter accepts a WHATWG Request and returns a
// Promise<Response>. Directly testable without socket binding —
// CRITICAL for Cloudflare Workers / Deno / edge runtimes.

import { describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@switchbord/crypto";
import {
  createFetchWebhookHandler,
  createWebhookAdapter
} from "@switchbord/http";

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

interface MockFacade {
  readonly dispatches: unknown[];
  dispatch(update: unknown): Promise<void>;
}

function makeFacade(): MockFacade {
  const dispatches: unknown[] = [];
  return {
    dispatches,
    async dispatch(update: unknown) {
      dispatches.push(update);
    }
  };
}

function makeEnvelope(): object {
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
                  id: "wamid.FETCH",
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

function buildAdapter() {
  const facade = makeFacade();
  const adapter = createWebhookAdapter({
    verifyToken: VERIFY_TOKEN,
    appSecret: APP_SECRET,
    whatsapp: facade
  });
  return { adapter, facade, handler: createFetchWebhookHandler(adapter) };
}

describe("F-12 createFetchWebhookHandler", () => {
  test("returns a function that takes a Request and returns a Response", () => {
    const { handler } = buildAdapter();
    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(1);
  });

  test("GET verify flow echoes challenge with 200", async () => {
    const { handler } = buildAdapter();
    const url = `https://wats.test/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      VERIFY_TOKEN
    )}&hub.challenge=hello`;
    const res = await handler(new Request(url, { method: "GET" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("GET with wrong token returns 401", async () => {
    const { handler } = buildAdapter();
    const url = `https://wats.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=hello`;
    const res = await handler(new Request(url, { method: "GET" }));
    expect(res.status).toBe(401);
  });

  test("POST with valid signature returns 200 + dispatches", async () => {
    const { handler, facade } = buildAdapter();
    const body = JSON.stringify(makeEnvelope());
    const signature = await signBody(APP_SECRET, body);
    const res = await handler(
      new Request("https://wats.test/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature
        },
        body
      })
    );
    expect(res.status).toBe(200);
    expect(facade.dispatches.length).toBe(1);
  });

  test("POST with invalid signature returns 401", async () => {
    const { handler } = buildAdapter();
    const body = JSON.stringify(makeEnvelope());
    const res = await handler(
      new Request("https://wats.test/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256":
            "sha256=0000000000000000000000000000000000000000000000000000000000000000"
        },
        body
      })
    );
    expect(res.status).toBe(401);
  });

  test("POST with malformed JSON returns 400", async () => {
    const { handler } = buildAdapter();
    const body = "{bad json";
    const signature = await signBody(APP_SECRET, body);
    const res = await handler(
      new Request("https://wats.test/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body
      })
    );
    expect(res.status).toBe(400);
  });

  test("PUT returns 405 with Allow header", async () => {
    const { handler } = buildAdapter();
    const res = await handler(
      new Request("https://wats.test/webhook", { method: "PUT" })
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBeTruthy();
  });

  test("POST over maxBodyBytes returns 413", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      maxBodyBytes: 10
    });
    const handler = createFetchWebhookHandler(adapter);
    const body = "x".repeat(1000);
    const signature = await signBody(APP_SECRET, body);
    const res = await handler(
      new Request("https://wats.test/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body
      })
    );
    expect(res.status).toBe(413);
  });

  test("sibling-class: rejects null adapter at construction", () => {
    let caught: unknown;
    try {
      // @ts-expect-error null adapter
      createFetchWebhookHandler(null);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof Error).toBe(true);
  });
});

// ---- F-12 remediation (WATS-29) — read-time body-size cap --------
//
// BLOCKER: The fetch adapter calls request.arrayBuffer() up-front,
// buffering the entire body before the adapter core's maxBodyBytes
// check. The remediation:
//   (1) if Content-Length > maxBodyBytes, 413 WITHOUT reading body
//   (2) if streaming (no Content-Length), read with a reader() loop
//       that tracks total and aborts when it exceeds the cap

describe("F-12 remediation — Fetch adapter enforces body-size cap at read time", () => {
  test("Content-Length > maxBodyBytes → 413 WITHOUT reading body", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      maxBodyBytes: 16
    });
    const handler = createFetchWebhookHandler(adapter);

    // Construct a mock Request object. Do NOT use real Request —
    // we want to observe that arrayBuffer() is never called.
    let arrayBufferCalled = 0;
    const headers = new Headers({
      "content-type": "application/json",
      "content-length": "1000",
      "x-hub-signature-256": "sha256=" + "a".repeat(64)
    });
    const mockRequest = {
      method: "POST",
      url: "https://wats.test/webhook",
      headers,
      arrayBuffer() {
        arrayBufferCalled += 1;
        return Promise.resolve(new ArrayBuffer(1000));
      },
      get body() {
        // Also counts as a read. Returning null forces the wrapper
        // to fall through to arrayBuffer() if it's not content-length
        // aware.
        return null;
      }
    } as unknown as Request;

    const response = await handler(mockRequest);
    expect(response.status).toBe(413);
    expect(arrayBufferCalled).toBe(0);
    expect(facade.dispatches.length).toBe(0);
  });

  test("streaming body exceeding cap during read aborts with 413", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade,
      maxBodyBytes: 16
    });
    const handler = createFetchWebhookHandler(adapter);

    // No Content-Length header → handler must consult .body stream
    // reader and abort mid-stream when total > cap.
    let cancelCalled = 0;
    let arrayBufferCalled = 0;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 10) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(10)); // 10 bytes each
      },
      cancel() {
        cancelCalled += 1;
      }
    });

    const headers = new Headers({
      "content-type": "application/json",
      "x-hub-signature-256": "sha256=" + "a".repeat(64)
    });
    const mockRequest = {
      method: "POST",
      url: "https://wats.test/webhook",
      headers,
      body: stream,
      arrayBuffer() {
        arrayBufferCalled += 1;
        return Promise.resolve(new ArrayBuffer(0));
      }
    } as unknown as Request;

    const response = await handler(mockRequest);
    expect(response.status).toBe(413);
    // Must use the streaming reader path, not arrayBuffer().
    expect(arrayBufferCalled).toBe(0);
    // Reader must be cancelled once the cap is exceeded.
    expect(cancelCalled).toBeGreaterThan(0);
    expect(facade.dispatches.length).toBe(0);
  });
});
