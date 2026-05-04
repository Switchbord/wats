// F-4 Transport contract tests.
//
// Covers createFetchTransport (happy path + error mapping + interceptor chain)
// and createMockTransport (recording, FIFO queue, default response, fail path,
// onRequest spy, exhaustion).

import { describe, expect, test } from "bun:test";
import { GraphNetworkError } from "../src/errors";
import { createFetchTransport } from "../src/createFetchTransport";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";
import type {
  Transport,
  TransportRequest,
  TransportResponse,
  TransportInterceptor
} from "../src/transport";

function buildRequest(overrides: Partial<TransportRequest> = {}): TransportRequest {
  const headers = new Headers({ authorization: "Bearer test" });
  return {
    method: "GET",
    url: "https://graph.facebook.com/v20.0/me",
    headers,
    body: null,
    ...overrides
  };
}

describe("createFetchTransport", () => {
  test("invokes the injected fetch with method, url, headers, body, signal", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const transport = createFetchTransport({ fetch: fakeFetch });
    const controller = new AbortController();

    const response = await transport.request(buildRequest(), { signal: controller.signal });

    expect(response.status).toBe(200);
    expect(calls.length).toBe(1);
    const first = calls[0];
    expect(first).toBeDefined();
    expect(first?.url).toBe("https://graph.facebook.com/v20.0/me");
    expect(first?.init.method).toBe("GET");
    const h = new Headers(first?.init.headers);
    expect(h.get("authorization")).toBe("Bearer test");
    expect(first?.init.signal).toBe(controller.signal);
  });

  test("maps fetch-level errors to GraphNetworkError", async () => {
    const fakeFetch: typeof globalThis.fetch = async () => {
      throw new TypeError("socket hang up");
    };
    const transport = createFetchTransport({ fetch: fakeFetch });

    let thrown: unknown;
    try {
      await transport.request(buildRequest());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphNetworkError);
    expect((thrown as GraphNetworkError).cause).toBeInstanceOf(TypeError);
  });

  test("runs onRequest interceptors in array order and lets them rewrite the request", async () => {
    const observed: string[] = [];
    const interceptors: TransportInterceptor[] = [
      {
        onRequest: (req) => {
          observed.push("A");
          const headers = new Headers(req.headers);
          headers.set("x-trace", "1");
          return { ...req, headers };
        }
      },
      {
        onRequest: (req) => {
          observed.push("B");
          expect(req.headers.get("x-trace")).toBe("1");
          const headers = new Headers(req.headers);
          headers.set("x-trace", `${headers.get("x-trace")}-2`);
          return { ...req, headers };
        }
      }
    ];

    let seenHeader: string | null = null;
    const fakeFetch: typeof globalThis.fetch = async (_input, init) => {
      seenHeader = new Headers(init?.headers).get("x-trace");
      return new Response(null, { status: 204 });
    };

    const transport = createFetchTransport({ fetch: fakeFetch, interceptors });
    const response = await transport.request(buildRequest());
    expect(response.status).toBe(204);
    expect(observed).toEqual(["A", "B"]);
    expect(seenHeader).toBe("1-2");
  });

  test("runs onResponse interceptors in array order", async () => {
    const observed: string[] = [];
    const interceptors: TransportInterceptor[] = [
      {
        onResponse: (_req, res) => {
          observed.push("A");
          return res;
        }
      },
      {
        onResponse: (_req, res) => {
          observed.push("B");
          return res;
        }
      }
    ];

    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const transport = createFetchTransport({ fetch: fakeFetch, interceptors });
    await transport.request(buildRequest());
    expect(observed).toEqual(["A", "B"]);
  });

  test("uses globalThis.fetch by default", async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    (globalThis as { fetch: typeof globalThis.fetch }).fetch = (async (
      input: RequestInfo | URL
    ) => {
      calls.push(String(input));
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof globalThis.fetch;
    try {
      const transport = createFetchTransport();
      await transport.request(buildRequest());
      expect(calls.length).toBe(1);
    } finally {
      (globalThis as { fetch: typeof globalThis.fetch }).fetch = original;
    }
  });
});

describe("createMockTransport", () => {
  test("records every request verbatim (method, url, headers, body)", async () => {
    const handle = createMockTransport({
      responses: [{ status: 200, body: { ok: true } }]
    });

    const headers = new Headers();
    headers.set("authorization", "Bearer xyz");
    headers.set("content-type", "application/json");
    await handle.transport.request({
      method: "POST",
      url: "https://example.test/v20.0/123/messages",
      headers,
      body: JSON.stringify({ hello: "world" })
    });

    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec).toBeDefined();
    expect(rec?.method).toBe("POST");
    expect(rec?.url).toBe("https://example.test/v20.0/123/messages");
    expect(rec?.headers.get("authorization")).toBe("Bearer xyz");
    expect(rec?.headers.get("content-type")).toBe("application/json");
    expect(rec?.body).toBe(JSON.stringify({ hello: "world" }));
  });

  test("returns queued responses FIFO", async () => {
    const handle = createMockTransport({
      responses: [
        { status: 200, body: { n: 1 } },
        { status: 201, body: { n: 2 } }
      ]
    });

    const r1 = await handle.transport.request(buildRequest());
    const r2 = await handle.transport.request(buildRequest());
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(201);
    expect(((await r1.json()) as { n: number }).n).toBe(1);
    expect(((await r2.json()) as { n: number }).n).toBe(2);
  });

  test("uses defaultResponse once queue is exhausted", async () => {
    const handle = createMockTransport({
      responses: [{ status: 200, body: { first: true } }],
      defaultResponse: { status: 418, body: { teapot: true } }
    });

    await handle.transport.request(buildRequest());
    const r2 = await handle.transport.request(buildRequest());
    expect(r2.status).toBe(418);
  });

  test("invokes onRequest spy for every request", async () => {
    const seen: TransportRequest[] = [];
    const handle = createMockTransport({
      defaultResponse: { status: 200, body: {} },
      onRequest: (req) => {
        seen.push(req);
      }
    });
    await handle.transport.request(buildRequest());
    await handle.transport.request(buildRequest({ method: "POST" }));
    expect(seen.length).toBe(2);
    expect(seen[1]?.method).toBe("POST");
  });

  test("throws a descriptive error when queue is exhausted and no default configured", async () => {
    const handle = createMockTransport({});
    let thrown: unknown;
    try {
      await handle.transport.request(buildRequest());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message.toLowerCase()).toContain("mock");
  });

  test("throws configured fail error", async () => {
    const err = new Error("simulated");
    const handle = createMockTransport({ fail: err });
    await expect(handle.transport.request(buildRequest())).rejects.toBe(err);
  });

  test("failAfter defers failure until the Nth request", async () => {
    const handle = createMockTransport({
      responses: [
        { status: 200, body: { ok: 1 } },
        { status: 200, body: { ok: 2 } }
      ],
      fail: new Error("past threshold"),
      failAfter: 2
    });
    await handle.transport.request(buildRequest());
    await handle.transport.request(buildRequest());
    await expect(handle.transport.request(buildRequest())).rejects.toThrow("past threshold");
  });

  test("respond(...) pushes into the queue mid-test; reset() clears state", async () => {
    const handle = createMockTransport({});
    handle.respond({ status: 200, body: { pushed: true } });
    const r1 = await handle.transport.request(buildRequest());
    expect(((await r1.json()) as { pushed: boolean }).pushed).toBe(true);

    handle.respond({ status: 201, body: {} });
    handle.reset();
    // After reset, queue and recorded requests are empty. Next call has
    // nothing to dispatch so throws, but the request IS still recorded
    // (MockTransport records every dispatched request verbatim).
    await expect(handle.transport.request(buildRequest())).rejects.toThrow();
    expect(handle.requests.length).toBe(1);
    handle.reset();
    expect(handle.requests.length).toBe(0);
  });

  test("function-form response spec is invoked per-request", async () => {
    const spec: MockTransportResponseSpec = (req) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { echoedMethod: req.method }
    });
    const handle = createMockTransport({ defaultResponse: spec });
    const res = await handle.transport.request(buildRequest({ method: "PATCH" }));
    expect(((await res.json()) as { echoedMethod: string }).echoedMethod).toBe("PATCH");
  });

  test("implements Transport contract", async () => {
    const handle = createMockTransport({ defaultResponse: { status: 204 } });
    const t: Transport = handle.transport;
    const res: TransportResponse = await t.request(buildRequest());
    expect(res.status).toBe(204);
  });

  test("records ReadableStream body by reference (no coercion)", async () => {
    const handle = createMockTransport({
      defaultResponse: { status: 204 }
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 9, 9]));
        controller.close();
      }
    });
    await handle.transport.request(buildRequest({ method: "POST", body: stream }));
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]?.body).toBe(stream);
  });

  test("requests array is a defensive shallow copy (external mutation does not corrupt state)", async () => {
    const handle = createMockTransport({
      defaultResponse: { status: 204 }
    });
    await handle.transport.request(buildRequest());
    const snapshot = handle.requests;
    // Attempt external mutation on the read value: must not corrupt internal state.
    let mutationThrew = false;
    try {
      (snapshot as TransportRequest[]).push(buildRequest());
    } catch {
      mutationThrew = true;
    }
    // Either the array is frozen (throws in strict mode) OR it's a copy.
    // In both cases, handle.requests must re-read length 1 from internal state.
    expect(mutationThrew || handle.requests.length === 1).toBe(true);
    expect(handle.requests.length).toBe(1);
  });
});
