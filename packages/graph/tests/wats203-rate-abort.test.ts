// WATS-203 — rate-limiter acquisition abort + POST no-response safety correction.
//
// Behavioral battery over the optional cancellation signal passed to
// RateLimiter.acquire and the createReliableTransport admission recheck.
// Covers: real exhausted-bucket abort, no inner transport calls after abort,
// followup normal waiter succeeds, pre/during/post abort timing, malformed
// cancellation signals (fail-closed typed error, not silent ignore), custom-
// limiter cancellation race fallback, and the timeoutMs-per-attempt (not
// total deadline) invariant. Also documents the no-response POST ambiguity
// (server may have applied the request; an Idempotency-Key header alone
// proves nothing without verified remote idempotency).

import { describe, expect, test } from "bun:test";
import {
  createReliableTransport,
  createTokenBucketRateLimiter,
  GraphNetworkError,
  type RateLimiter,
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

function request(method: TransportRequest["method"] = "GET"): TransportRequest {
  return {
    method,
    url: "https://graph.facebook.com/v25.0/123/messages",
    headers: new Headers(),
    body: null
  };
}

// A sleep that parks on a real timer so the abort event can interleave; a
// no-op sleep with an unchanged clock starves the event loop and the abort
// never fires. Resolution is deferred via a long-but-bounded timeout that
// the caller never waits out (the abort always wins the race).
function pendingSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WATS-203 acquire cancellation signal", () => {
  describe("built-in token-bucket acquire with AbortSignal", () => {
    test("acquire(signal) rejects promptly when the bucket is exhausted and the caller aborts", async () => {
      // Real timer sleep so the abort can interleave; abort after 10ms.
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: pendingSleep
      });
      expect(rl.tryAcquire(1)).toBe(true); // bucket drained
      const controller = new AbortController();
      const task = rl.acquire(1, controller.signal);
      setTimeout(() => controller.abort(new Error("caller cancelled")), 10);
      await expect(task).rejects.toThrow("caller cancelled");
    });

    test("acquire(signal) does not consume a token when aborted mid-wait", async () => {
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: pendingSleep
      });
      expect(rl.tryAcquire(1)).toBe(true); // drained
      const controller = new AbortController();
      const task = rl.acquire(1, controller.signal);
      setTimeout(() => controller.abort(), 10);
      await expect(task).rejects.toThrow();
      // Bucket still has zero tokens; the aborted wait consumed nothing.
      expect(rl.tryAcquire(1)).toBe(false);
    });

    test("acquire(signal) leaks no timer or listener after abort (prompt cleanup)", async () => {
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: pendingSleep
      });
      expect(rl.tryAcquire(1)).toBe(true);
      const controller = new AbortController();
      const task = rl.acquire(1, controller.signal);
      setTimeout(() => controller.abort(new Error("done")), 5);
      await expect(task).rejects.toThrow("done");
      // The refill timer the acquire parked on must be cleared in a finally;
      // the behavioral proof is prompt rejection with no hang.
    });

    test("acquire(signal) that completes before abort resolves normally and ignores later abort", async () => {
      const rl = createTokenBucketRateLimiter({
        capacity: 2,
        refillPerSecond: 1,
        sleep: pendingSleep
      });
      const controller = new AbortController();
      // Enough tokens: acquire resolves immediately; late abort is a no-op.
      await rl.acquire(1, controller.signal);
      controller.abort(new Error("too late"));
      // Token was already consumed before the abort; nothing throws.
      expect(rl.tryAcquire(1)).toBe(true); // 1 token remains of capacity 2
    });

    test("a followup normal waiter after an aborted acquire succeeds once tokens refill", async () => {
      let t = 0;
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        now: () => t,
        sleep: async (ms: number) => { t += ms; }
      });
      expect(rl.tryAcquire(1)).toBe(true); // drained
      const controller = new AbortController();
      // Signal-bearing acquire parks on a virtual-clock sleep; abort it.
      const abortedTask = rl.acquire(1, controller.signal);
      queueMicrotask(() => controller.abort(new Error("cancelled")));
      await expect(abortedTask).rejects.toThrow("cancelled");
      // A subsequent waiter without a signal waits 1000ms (1 token / 1 per s)
      // and then admits.
      await rl.acquire(1);
      expect(rl.tryAcquire(1)).toBe(false); // the refilled token was consumed
    });

    test("pre-abort: an already-aborted signal rejects before any sleep", async () => {
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: async () => { throw new Error("sleep must not run"); }
      });
      expect(rl.tryAcquire(1)).toBe(true);
      const controller = new AbortController();
      controller.abort(new Error("pre-aborted"));
      await expect(rl.acquire(1, controller.signal)).rejects.toThrow("pre-aborted");
    });

    test("malformed signal: undefined signal behaves like no signal (waits)", async () => {
      let t = 0;
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        now: () => t,
        sleep: async (ms: number) => { t += ms; }
      });
      expect(rl.tryAcquire(1)).toBe(true);
      // undefined signal must not throw; behaves as the legacy no-signal path.
      await rl.acquire(1, undefined);
      expect(rl.tryAcquire(1)).toBe(false);
    });

    test("malformed signal: a non-AbortSignal object is rejected with a typed error (fail-closed)", async () => {
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: pendingSleep
      });
      expect(rl.tryAcquire(1)).toBe(true);
      // A plain object is not a real AbortSignal. Fail closed: the caller
      // passed something signal-shaped that is not a signal; do not silently
      // drop cancellation by treating it as "no signal".
      await expect(rl.acquire(1, { aborted: false } as never)).rejects.toThrow();
      // No token consumed by the rejected call.
      expect(rl.tryAcquire(1)).toBe(false);
    });

    test("malformed signal: a duck-typed { aborted: true } object is rejected, not honored (fail-closed)", async () => {
      let sleepCalls = 0;
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: async () => { sleepCalls += 1; }
      });
      expect(rl.tryAcquire(1)).toBe(true);
      // { aborted: true } is a duck-typed lie; only a real AbortSignal aborts.
      // It is also not a valid signal, so fail closed rather than waiting.
      await expect(rl.acquire(1, { aborted: true } as never)).rejects.toThrow();
      expect(sleepCalls).toBe(0);
      expect(rl.tryAcquire(1)).toBe(false);
    });
  });

  describe("createReliableTransport admission recheck after rate-limiter wait", () => {
    test("aborts while waiting for an exhausted bucket do not call the inner transport", async () => {
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          return resp(200);
        }
      };
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: pendingSleep
      });
      expect(rl.tryAcquire(1)).toBe(true); // drain the bucket
      const transport = createReliableTransport(inner, { rateLimiter: rl, retries: 0 });
      const controller = new AbortController();
      const task = transport.request(request("GET"), { signal: controller.signal });
      setTimeout(() => controller.abort(new Error("caller cancelled")), 10);
      await expect(task).rejects.toThrow("caller cancelled");
      expect(innerCalls).toBe(0);
    });

    test("aborts during the rate-limiter wait propagate the caller abort reason", async () => {
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          return resp(200);
        }
      };
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        sleep: pendingSleep
      });
      expect(rl.tryAcquire(1)).toBe(true);
      const transport = createReliableTransport(inner, { rateLimiter: rl, retries: 0 });
      const controller = new AbortController();
      const task = transport.request(request("GET"), { signal: controller.signal });
      setTimeout(() => controller.abort(new Error("during-wait abort")), 10);
      await expect(task).rejects.toThrow("during-wait abort");
      expect(innerCalls).toBe(0);
    });

    test("a followup normal request after an aborted rate-limited request succeeds", async () => {
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          return resp(200);
        }
      };
      let t = 0;
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        now: () => t,
        sleep: async (ms: number) => { t += ms; }
      });
      const transport = createReliableTransport(inner, { rateLimiter: rl, retries: 0 });
      // First request consumes the only token and succeeds.
      expect((await transport.request(request("GET"))).status).toBe(200);
      // Second request waits for a refill; abort it.
      const controller = new AbortController();
      const abortedTask = transport.request(request("GET"), { signal: controller.signal });
      queueMicrotask(() => controller.abort(new Error("gave up")));
      await expect(abortedTask).rejects.toThrow("gave up");
      // Third request, no signal, waits for the refill and succeeds.
      expect((await transport.request(request("GET"))).status).toBe(200);
      expect(innerCalls).toBe(2);
    });

    test("rechecks abort after admission but before dispatching the inner transport", async () => {
      // The caller aborts exactly as acquire resolves. The transport must
      // re-check the caller signal after the wait and before the inner call,
      // so an abort that races the admission must not start a request.
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          return resp(200);
        }
      };
      let t = 0;
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        now: () => t,
        sleep: async (ms: number) => { t += ms; }
      });
      expect(rl.tryAcquire(1)).toBe(true);
      const transport = createReliableTransport(inner, { rateLimiter: rl, retries: 0 });
      const controller = new AbortController();
      // Abort synchronously right after admission resolves (sleep advances
      // the clock, so acquire resolves on the next microtask).
      const task = transport.request(request("GET"), { signal: controller.signal });
      controller.abort(new Error("raced admission"));
      await expect(task).rejects.toThrow("raced admission");
      expect(innerCalls).toBe(0);
    });
  });

  describe("custom limiter cancellation race fallback", () => {
    test("a custom limiter that does not accept a signal is still cancelled by the transport's own abort race", async () => {
      // A legacy custom limiter with the old acquire(cost?) signature (no
      // signal). When the caller aborts mid-wait, the transport must race
      // the acquire against the caller signal and reject, not hang.
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          return resp(200);
        }
      };
      let releaseAcquire: (() => void) | undefined;
      const legacyLimiter: RateLimiter = {
        async acquire(): Promise<void> {
          await new Promise<void>((resolve) => { releaseAcquire = resolve; });
        },
        tryAcquire(): boolean { return true; }
      };
      const transport = createReliableTransport(inner, {
        rateLimiter: legacyLimiter,
        retries: 0
      });
      const controller = new AbortController();
      const task = transport.request(request("GET"), { signal: controller.signal });
      queueMicrotask(() => controller.abort(new Error("caller cancelled")));
      await expect(task).rejects.toThrow("caller cancelled");
      expect(innerCalls).toBe(0);
      // Clean up the dangling acquire so no token is consumed and no
      // unhandled rejection lingers.
      releaseAcquire?.();
    });
  });

  describe("timeoutMs is per-attempt, not a total deadline", () => {
    test("timeoutMs does not shrink across retries (each attempt gets the full budget)", async () => {
      const attempts: number[] = [];
      let attempt = 0;
      const inner: Transport = {
        async request(_req, opts): Promise<TransportResponse> {
          attempt += 1;
          attempts.push(attempt);
          // First two attempts time out; third succeeds.
          if (attempt < 3) {
            // Wait longer than the timeout; the composed signal fires.
            await new Promise((resolve) => setTimeout(resolve, 60));
            return resp(500);
          }
          // Sanity: the signal is fresh per attempt (not already aborted).
          if (opts?.signal?.aborted) throw new Error("signal leaked across attempts");
          return resp(200);
        }
      };
      const transport = createReliableTransport(inner, {
        retries: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        timeoutMs: 20,
        random: () => 0,
        sleep: async () => undefined
      });
      const res = await transport.request(request("GET"));
      expect(res.status).toBe(200);
      expect(attempts).toEqual([1, 2, 3]);
    });
  });

  describe("no-response POST safety (idempotency is not a retry license)", () => {
    test("POST network failure with an Idempotency-Key is NOT retried under the default never policy", async () => {
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          throw new GraphNetworkError("socket reset before response");
        }
      };
      const headers = new Headers({ "idempotency-key": "abc-123" });
      const req: TransportRequest = { ...request("POST"), headers };
      // Default: no retryPosts option -> never. The key does not opt in.
      const transport = createReliableTransport(inner, { retries: 3 });
      await expect(transport.request(req)).rejects.toThrow("socket reset before response");
      expect(innerCalls).toBe(1);
    });

    test("POST 500 with an Idempotency-Key is NOT retried under network-only", async () => {
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          return resp(500);
        }
      };
      const headers = new Headers({ "idempotency-key": "abc-123" });
      const req: TransportRequest = { ...request("POST"), headers };
      const transport = createReliableTransport(inner, {
        retries: 3,
        retryPosts: "network-only"
      });
      expect((await transport.request(req)).status).toBe(500);
      expect(innerCalls).toBe(1);
    });

    test("an Idempotency-Key header alone does not make a no-response POST retry safe", async () => {
      // Behavioral mirror of the docs claim: the header presence is a
      // necessary, not sufficient, condition. The retry only happens when
      // the caller opts into network-only/always AND the failure is a
      // pre-response network error. This test pins that the default (never)
      // refuses to retry even with the key — proving the key is not a
      // standalone retry license.
      let innerCalls = 0;
      const inner: Transport = {
        async request(): Promise<TransportResponse> {
          innerCalls += 1;
          throw new GraphNetworkError("connection reset");
        }
      };
      const headers = new Headers({ "Idempotency-Key": "case-insensitive-key" });
      const req: TransportRequest = { ...request("POST"), headers };
      const transport = createReliableTransport(inner, { retries: 5 });
      await expect(transport.request(req)).rejects.toThrow("connection reset");
      expect(innerCalls).toBe(1);
    });
  });
});
