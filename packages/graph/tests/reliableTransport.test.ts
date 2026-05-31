import { describe, expect, test } from "bun:test";
import {
  createReliableTransport,
  DEFAULT_TRANSPORT_RETRY_POLICY,
  GraphNetworkError,
  type Transport,
  type TransportRequest,
  type TransportResponse
} from "../src";

function response(status: number, headers?: Record<string, string>): TransportResponse {
  return {
    status,
    headers: new Headers(headers),
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async <T = unknown>() => ({}) as T,
    text: async () => ""
  };
}

function responseWithBody(status: number, onCancel: () => void | Promise<void>): TransportResponse {
  return {
    status,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      cancel: onCancel
    }),
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async <T = unknown>() => ({}) as T,
    text: async () => ""
  };
}

function request(method: TransportRequest["method"] = "GET"): TransportRequest {
  return {
    method,
    url: "https://graph.facebook.com/v25.0/123/messages",
    headers: new Headers(),
    body: null
  };
}

describe("WATS-86 reliable transport decorator", () => {
  test("retries transient GET failures with bounded exponential full-jitter delays", async () => {
    const attempts: TransportRequest[] = [];
    const delays: number[] = [];
    const inner: Transport = {
      async request(req) {
        attempts.push(req);
        return attempts.length < 3 ? response(500) : response(200);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0.5,
      sleep: async (ms) => { delays.push(ms); }
    });

    const res = await transport.request(request("GET"));

    expect(res.status).toBe(200);
    expect(attempts.length).toBe(3);
    expect(delays).toEqual([50, 100]);
  });

  test("honors Retry-After for rate limits and caps by maxDelayMs", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        return attempts === 1
          ? response(429, { "retry-after": "10" })
          : response(200);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 1,
      baseDelayMs: 100,
      maxDelayMs: 1_500,
      sleep: async (ms) => { delays.push(ms); }
    });

    expect((await transport.request(request("GET"))).status).toBe(200);
    expect(delays).toEqual([1_500]);
  });

  test("does not retry non-idempotent POST failures by default", async () => {
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        return response(500);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 3,
      sleep: async () => { throw new Error("sleep should not be called"); }
    });

    expect((await transport.request(request("POST"))).status).toBe(500);
    expect(attempts).toBe(1);
  });

  test("retries rate-limited POST responses as the rate-limit exception", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        return attempts === 1 ? response(429) : response(200);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 1,
      baseDelayMs: 10,
      maxDelayMs: 10,
      random: () => 1,
      sleep: async (ms) => { delays.push(ms); }
    });

    expect((await transport.request(request("POST"))).status).toBe(200);
    expect(attempts).toBe(2);
    expect(delays).toEqual([10]);
  });

  test("does not retry POST network failures by default", async () => {
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        throw new GraphNetworkError("socket closed after upload");
      }
    };

    const transport = createReliableTransport(inner, { retries: 3 });

    await expect(transport.request(request("POST"))).rejects.toThrow("socket closed after upload");
    expect(attempts).toBe(1);
  });

  test("honors HTTP-date Retry-After values and ignores invalid negative values", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        if (attempts === 1) return response(429, { "retry-after": new Date(Date.now() + 5_000).toUTCString() });
        if (attempts === 2) return response(429, { "retry-after": "-1" });
        return response(200);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 2,
      baseDelayMs: 10,
      maxDelayMs: 1_000,
      random: () => 1,
      sleep: async (ms) => { delays.push(ms); }
    });

    expect((await transport.request(request("GET"))).status).toBe(200);
    expect(delays.length).toBe(2);
    expect(delays[0]).toBeGreaterThan(0);
    expect(delays[0]).toBeLessThanOrEqual(1_000);
    expect(delays[1]).toBe(20);
  });

  test("cancels discarded retry response bodies before sleeping", async () => {
    let cancelled = 0;
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        return attempts === 1
          ? responseWithBody(500, () => { cancelled += 1; })
          : response(200);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 1,
      sleep: async () => undefined,
      random: () => 0
    });

    expect((await transport.request(request("GET"))).status).toBe(200);
    expect(cancelled).toBe(1);
  });

  test("swallows async body-cancel failures while retrying", async () => {
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        return attempts === 1
          ? responseWithBody(500, async () => { throw new Error("cancel reject"); })
          : response(200);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 1,
      sleep: async () => undefined,
      random: () => 0
    });

    expect((await transport.request(request("GET"))).status).toBe(200);
    expect(attempts).toBe(2);
  });

  test("passes a per-attempt timeout signal to the inner transport", async () => {
    let sawSignal = false;
    const inner: Transport = {
      async request(_req, opts) {
        sawSignal = opts?.signal instanceof AbortSignal;
        return response(200);
      }
    };

    const transport = createReliableTransport(inner, { timeoutMs: 1 });

    expect((await transport.request(request("GET"))).status).toBe(200);
    expect(sawSignal).toBe(true);
  });

  test("aborts promptly while waiting between retries", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        return response(500);
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 3,
      sleep: async () => {
        controller.abort(new Error("aborted during backoff"));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    await expect(transport.request(request("GET"), { signal: controller.signal })).rejects.toThrow("aborted during backoff");
    expect(attempts).toBe(1);
  });

  test("never starts or retries caller-aborted requests", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller aborted"));
    let attempts = 0;
    const inner: Transport = {
      async request() {
        attempts += 1;
        throw new GraphNetworkError("network down");
      }
    };

    const transport = createReliableTransport(inner, {
      retries: 3,
      sleep: async () => { throw new Error("sleep should not be called"); }
    });

    await expect(transport.request(request("GET"), { signal: controller.signal })).rejects.toThrow("caller aborted");
    expect(attempts).toBe(0);
  });

  test("validates finite reliability options before the first request", async () => {
    const inner: Transport = { request: async () => response(200) };
    for (const options of [
      { retries: -1 },
      { retries: 0.5 },
      { baseDelayMs: Number.NaN },
      { maxDelayMs: Infinity },
      { timeoutMs: 0 },
      { random: "nope" }
    ]) {
      const transport = createReliableTransport(inner, options as never);
      await expect(transport.request(request("GET"))).rejects.toThrow("ReliableTransportOptions");
    }
  });

  test("rejects invalid random jitter output during retry", async () => {
    const inner: Transport = { request: async () => response(500) };
    const transport = createReliableTransport(inner, {
      retries: 1,
      random: () => 2,
      sleep: async () => { throw new Error("sleep should not be called"); }
    });

    await expect(transport.request(request("GET"))).rejects.toThrow("ReliableTransportOptions");
  });

  test("keeps the default retry policy stable for downstream callers", () => {
    expect(DEFAULT_TRANSPORT_RETRY_POLICY).toEqual({
      retries: 3,
      baseDelayMs: 200,
      maxDelayMs: 30_000
    });
  });
});
