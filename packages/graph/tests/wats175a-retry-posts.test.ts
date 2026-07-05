// WATS-175 slice A — opt-in idempotency-aware POST retry.
//
// Adversarial battery over the new `retryPosts` option on createReliableTransport.
// Every mode ("never" | "network-only" | "always") is crossed with the four
// outbound-failure shapes an ops tool actually meets: network error thrown
// BEFORE any response (socket reset mid-upload), 500 response, 429 response,
// and success-after-retry. Default ("never") must reproduce the pre-175
// behavior byte-for-byte.

import { describe, expect, test } from "bun:test";
import {
  createReliableTransport,
  GraphNetworkError,
  type Transport,
  type TransportRequest,
  type TransportResponse
} from "../src";

function resp(status: number, headers?: Record<string, string>): TransportResponse {
  return {
    status,
    headers: new Headers(headers),
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async <T = unknown>() => ({}) as T,
    text: async () => ""
  };
}

function postRequest(headers?: Record<string, string>): TransportRequest {
  return {
    method: "POST",
    url: "https://graph.facebook.com/v25.0/123/messages",
    headers: new Headers(headers),
    body: null
  };
}

// Sequenced mock: each attempt invokes fns[min(i, len-1)]. Attempts beyond the
// list keep reusing the last fn so a "never retry" path still resolves/throws
// deterministically rather than queue-exhausting.
function countingTransport(
  fns: Array<(req: TransportRequest) => TransportResponse | Promise<TransportResponse>>
): { transport: Transport; count: () => number } {
  let i = 0;
  let n = 0;
  return {
    transport: {
      async request(req: TransportRequest): Promise<TransportResponse> {
        n += 1;
        const fn = fns[Math.min(i, fns.length - 1)];
        i += 1;
        return fn(req);
      }
    },
    count: () => n
  };
}

const netErr = (): never => {
  throw new GraphNetworkError("socket reset before response");
};
const ok = (): TransportResponse => resp(200);
const r500 = (): TransportResponse => resp(500);
const r429 = (): TransportResponse => resp(429);

function opts(retryPosts: "never" | "network-only" | "always") {
  return {
    retries: 2,
    baseDelayMs: 1,
    maxDelayMs: 1,
    random: () => 0,
    sleep: async () => undefined,
    retryPosts
  };
}

describe("WATS-175 retryPosts", () => {
  describe("mode: never (default preserved)", () => {
    test("POST network error is not retried", async () => {
      const t = countingTransport([netErr, ok]);
      const rt = createReliableTransport(t.transport, opts("never"));
      await expect(rt.request(postRequest())).rejects.toThrow("socket reset before response");
      expect(t.count()).toBe(1);
    });

    test("POST 500 is not retried", async () => {
      const t = countingTransport([r500, ok]);
      const rt = createReliableTransport(t.transport, opts("never"));
      expect((await rt.request(postRequest())).status).toBe(500);
      expect(t.count()).toBe(1);
    });

    test("POST 429 is retried (pre-existing rate-limit exception)", async () => {
      const t = countingTransport([r429, ok]);
      const rt = createReliableTransport(t.transport, opts("never"));
      expect((await rt.request(postRequest())).status).toBe(200);
      expect(t.count()).toBe(2);
    });

    test("POST success-after-retry only happens for retried status codes", async () => {
      // 500 is not retried under "never" -> no success-after-retry path.
      const t = countingTransport([r500, ok]);
      const rt = createReliableTransport(t.transport, opts("never"));
      expect((await rt.request(postRequest())).status).toBe(500);
      expect(t.count()).toBe(1);
    });
  });

  describe("mode: network-only", () => {
    test("POST network error is retried when Idempotency-Key header is present", async () => {
      const t = countingTransport([netErr, ok]);
      const rt = createReliableTransport(t.transport, opts("network-only"));
      expect((await rt.request(postRequest({ "idempotency-key": "abc-123" }))).status).toBe(200);
      expect(t.count()).toBe(2);
    });

    test("POST network error is NOT retried without an Idempotency-Key header", async () => {
      const t = countingTransport([netErr, ok]);
      const rt = createReliableTransport(t.transport, opts("network-only"));
      await expect(rt.request(postRequest())).rejects.toThrow("socket reset before response");
      expect(t.count()).toBe(1);
    });

    test("POST 500 is NOT retried even with an Idempotency-Key header", async () => {
      const t = countingTransport([r500, ok]);
      const rt = createReliableTransport(t.transport, opts("network-only"));
      expect((await rt.request(postRequest({ "idempotency-key": "abc-123" }))).status).toBe(500);
      expect(t.count()).toBe(1);
    });

    test("POST 429 is retried (unchanged from default)", async () => {
      const t = countingTransport([r429, ok]);
      const rt = createReliableTransport(t.transport, opts("network-only"));
      expect((await rt.request(postRequest())).status).toBe(200);
      expect(t.count()).toBe(2);
    });

    test("Idempotency-Key header is matched case-insensitively", async () => {
      const t = countingTransport([netErr, ok]);
      const rt = createReliableTransport(t.transport, opts("network-only"));
      expect((await rt.request(postRequest({ "IDEMPOTENCY-KEY": "abc-123" }))).status).toBe(200);
      expect(t.count()).toBe(2);
    });
  });

  describe("mode: always", () => {
    test("POST 500 is retried (requires server-side idempotency)", async () => {
      const t = countingTransport([r500, ok]);
      const rt = createReliableTransport(t.transport, opts("always"));
      expect((await rt.request(postRequest())).status).toBe(200);
      expect(t.count()).toBe(2);
    });

    test("POST network error is retried when Idempotency-Key header is present", async () => {
      const t = countingTransport([netErr, ok]);
      const rt = createReliableTransport(t.transport, opts("always"));
      expect((await rt.request(postRequest({ "idempotency-key": "abc-123" }))).status).toBe(200);
      expect(t.count()).toBe(2);
    });

    test("POST network error is NOT retried without an Idempotency-Key header", async () => {
      const t = countingTransport([netErr, ok]);
      const rt = createReliableTransport(t.transport, opts("always"));
      await expect(rt.request(postRequest())).rejects.toThrow("socket reset before response");
      expect(t.count()).toBe(1);
    });

    test("POST 429 is retried", async () => {
      const t = countingTransport([r429, ok]);
      const rt = createReliableTransport(t.transport, opts("always"));
      expect((await rt.request(postRequest())).status).toBe(200);
      expect(t.count()).toBe(2);
    });

    test("POST 500 retries up to the configured retry budget then surfaces the failure", async () => {
      const t = countingTransport([r500, r500, r500, ok]);
      const rt = createReliableTransport(t.transport, { ...opts("always"), retries: 2 });
      expect((await rt.request(postRequest())).status).toBe(500);
      expect(t.count()).toBe(3);
    });
  });

  describe("default (no retryPosts option)", () => {
    test("matches the 'never' mode for POST 500, network error, and 429", async () => {
      const fiveHundred = countingTransport([r500, ok]);
      const rt500 = createReliableTransport(fiveHundred.transport, {
        retries: 2, baseDelayMs: 1, maxDelayMs: 1, random: () => 0, sleep: async () => undefined
      });
      expect((await rt500.request(postRequest())).status).toBe(500);
      expect(fiveHundred.count()).toBe(1);

      const network = countingTransport([netErr, ok]);
      const rtNet = createReliableTransport(network.transport, {
        retries: 2, baseDelayMs: 1, maxDelayMs: 1, random: () => 0, sleep: async () => undefined
      });
      await expect(rtNet.request(postRequest())).rejects.toThrow("socket reset before response");
      expect(network.count()).toBe(1);

      const limited = countingTransport([r429, ok]);
      const rt429 = createReliableTransport(limited.transport, {
        retries: 2, baseDelayMs: 1, maxDelayMs: 1, random: () => 0, sleep: async () => undefined
      });
      expect((await rt429.request(postRequest())).status).toBe(200);
      expect(limited.count()).toBe(2);
    });
  });

  describe("validation", () => {
    test("rejects an invalid retryPosts value before the first attempt", async () => {
      const inner: Transport = { request: async () => resp(200) };
      const rt = createReliableTransport(inner, {
        retries: 1,
        retryPosts: "sometimes" as never
      });
      await expect(rt.request(postRequest())).rejects.toThrow("retryPosts");
    });

    test("GET/DELETE retry behavior is unchanged by retryPosts", async () => {
      const t = countingTransport([r500, ok]);
      const rt = createReliableTransport(t.transport, opts("never"));
      expect((await rt.request({ ...postRequest(), method: "GET" })).status).toBe(200);
      expect(t.count()).toBe(2);
    });
  });
});
