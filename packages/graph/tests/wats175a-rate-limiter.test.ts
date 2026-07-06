// WATS-175 slice A — token-bucket rate limiter battery.
//
// Virtual-clock tests over createTokenBucketRateLimiter: token exhaustion
// delays, refill math, validation rejection matrix, tryAcquire admission, and
// integration proving createReliableTransport calls acquire() before every
// attempt (including retries).

import { describe, expect, test } from "bun:test";
import {
  createTokenBucketRateLimiter,
  createReliableTransport,
  GraphNetworkError,
  type Transport,
  type TransportRequest,
  type TransportResponse
} from "../src";

function makeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; }
  };
}

function fakeSleep(clock: { advance: (ms: number) => void }): (delayMs: number) => Promise<void> {
  return async (delayMs: number) => { clock.advance(delayMs); };
}

function resp(status: number): TransportResponse {
  return {
    status,
    headers: new Headers(),
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async <T = unknown>() => ({}) as T,
    text: async () => ""
  };
}

describe("WATS-175 createTokenBucketRateLimiter", () => {
  describe("admission and refill math (virtual clock)", () => {
    test("tryAcquire admits up to capacity then rejects until refill", async () => {
      const clock = makeClock();
      const rl = createTokenBucketRateLimiter({
        capacity: 3,
        refillPerSecond: 1,
        now: clock.now,
        sleep: fakeSleep(clock)
      });
      expect(rl.tryAcquire(1)).toBe(true);
      expect(rl.tryAcquire(1)).toBe(true);
      expect(rl.tryAcquire(1)).toBe(true);
      expect(rl.tryAcquire(1)).toBe(false);
      // Advance 1s -> 1 token refilled.
      clock.advance(1_000);
      expect(rl.tryAcquire(1)).toBe(true);
      expect(rl.tryAcquire(1)).toBe(false);
    });

    test("tryAcquire with cost > 1 deducts the full cost", async () => {
      const clock = makeClock();
      const rl = createTokenBucketRateLimiter({
        capacity: 5,
        refillPerSecond: 2,
        now: clock.now,
        sleep: fakeSleep(clock)
      });
      expect(rl.tryAcquire(4)).toBe(true);
      expect(rl.tryAcquire(2)).toBe(false);
      expect(rl.tryAcquire(1)).toBe(true); // 1 token left
      expect(rl.tryAcquire(1)).toBe(false);
    });

    test("acquire waits until enough tokens refill, then admits", async () => {
      const clock = makeClock();
      const calls: number[] = [];
      const sleep = async (ms: number): Promise<void> => {
        calls.push(ms);
        clock.advance(ms);
      };
      const rl = createTokenBucketRateLimiter({
        capacity: 2,
        refillPerSecond: 2, // 1 token / 500ms
        now: clock.now,
        sleep
      });
      expect(rl.tryAcquire(2)).toBe(true); // bucket drained
      await rl.acquire(1); // needs 1 token -> 500ms wait
      expect(calls).toEqual([500]);
      expect(rl.tryAcquire(1)).toBe(false); // acquired token just consumed
    });

    test("refill does not exceed capacity (capped accumulation)", async () => {
      const clock = makeClock();
      const rl = createTokenBucketRateLimiter({
        capacity: 3,
        refillPerSecond: 100,
        now: clock.now,
        sleep: fakeSleep(clock)
      });
      expect(rl.tryAcquire(3)).toBe(true);
      clock.advance(10_000); // would add 1000 tokens if uncapped
      expect(rl.tryAcquire(3)).toBe(true); // only 3 available
      expect(rl.tryAcquire(1)).toBe(false);
    });

    test("tryAcquire does not deduct on rejection (no token leak)", async () => {
      const clock = makeClock();
      const rl = createTokenBucketRateLimiter({
        capacity: 1,
        refillPerSecond: 1,
        now: clock.now,
        sleep: fakeSleep(clock)
      });
      expect(rl.tryAcquire(1)).toBe(true);
      expect(rl.tryAcquire(1)).toBe(false); // rejection
      clock.advance(1_000);
      expect(rl.tryAcquire(1)).toBe(true); // 1 token refilled, not consumed by the rejected call
    });

    test("backward clock movement does not grant tokens", async () => {
      let t = 1_000;
      const rl = createTokenBucketRateLimiter({
        capacity: 2,
        refillPerSecond: 10,
        now: () => t,
        sleep: async () => { t += 100; }
      });
      expect(rl.tryAcquire(2)).toBe(true);
      t = 500; // clock jumps back
      expect(rl.tryAcquire(1)).toBe(false);
      t = 600; // 100ms forward from the re-anchored baseline
      expect(rl.tryAcquire(1)).toBe(true); // 1 token (10/s * 0.1s)
    });
  });

  describe("validation rejection matrix", () => {
    test("rejects capacity < 1", () => {
      expect(() => createTokenBucketRateLimiter({ capacity: 0, refillPerSecond: 1 }))
        .toThrow("capacity");
    });
    test("rejects non-integer capacity", () => {
      expect(() => createTokenBucketRateLimiter({ capacity: 2.5, refillPerSecond: 1 }))
        .toThrow("capacity");
    });
    test("rejects capacity above 10000", () => {
      expect(() => createTokenBucketRateLimiter({ capacity: 10_001, refillPerSecond: 1 }))
        .toThrow("capacity");
    });
    test("rejects refillPerSecond <= 0", () => {
      expect(() => createTokenBucketRateLimiter({ capacity: 1, refillPerSecond: 0 }))
        .toThrow("refillPerSecond");
    });
    test("rejects non-finite refillPerSecond", () => {
      expect(() => createTokenBucketRateLimiter({ capacity: 1, refillPerSecond: Number.NaN }))
        .toThrow("refillPerSecond");
    });
    test("rejects non-number capacity", () => {
      expect(() => createTokenBucketRateLimiter({ capacity: "5" as never, refillPerSecond: 1 }))
        .toThrow("capacity");
    });
    test("rejects acquire cost > capacity", async () => {
      const rl = createTokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1 });
      await expect(rl.acquire(4)).rejects.toThrow("cost");
    });
    test("rejects acquire cost < 1", async () => {
      const rl = createTokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1 });
      await expect(rl.acquire(0)).rejects.toThrow("cost");
    });
    test("rejects non-integer acquire cost", async () => {
      const rl = createTokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1 });
      await expect(rl.acquire(1.5)).rejects.toThrow("cost");
    });
    test("rejects tryAcquire cost > capacity", () => {
      const rl = createTokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1 });
      expect(() => rl.tryAcquire(4)).toThrow("cost");
    });
    test("rejects non-object options", () => {
      expect(() => createTokenBucketRateLimiter(null as never)).toThrow("options");
    });
    test("rejects non-function now", () => {
      expect(() => createTokenBucketRateLimiter({
        capacity: 1, refillPerSecond: 1, now: "x" as never
      })).toThrow("now");
    });
    test("rejects non-function sleep", () => {
      expect(() => createTokenBucketRateLimiter({
        capacity: 1, refillPerSecond: 1, sleep: 5 as never
      })).toThrow("sleep");
    });
  });
});

describe("WATS-175 reliableTransport rateLimiter integration", () => {
  test("calls acquire() before every attempt, including retries", async () => {
    const acquireCalls: number[] = [];
    let attempts = 0;
    const inner: Transport = {
      async request(): Promise<TransportResponse> {
        attempts += 1;
        return attempts < 3 ? resp(500) : resp(200);
      }
    };
    const rateLimiter = {
      async acquire(): Promise<void> { acquireCalls.push(attempts); },
      tryAcquire(): boolean { return true; }
    };
    const rt = createReliableTransport(inner, {
      retries: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
      random: () => 0,
      sleep: async () => undefined,
      rateLimiter
    });
    expect((await rt.request({ method: "GET", url: "https://x.test/m", headers: new Headers(), body: null })).status).toBe(200);
    expect(attempts).toBe(3);
    // acquire is called BEFORE the attempt counter advances, so the recorded
    // values reflect attempts completed so far: 0, 1, 2.
    expect(acquireCalls).toEqual([0, 1, 2]);
  });

  test("rejects a non-RateLimiter rateLimiter option before the first request", async () => {
    const inner: Transport = { request: async () => resp(200) };
    const rt = createReliableTransport(inner, {
      retries: 1,
      rateLimiter: { tryAcquire: () => true } as never
    });
    await expect(rt.request({ method: "GET", url: "https://x.test/m", headers: new Headers(), body: null }))
      .rejects.toThrow("rateLimiter");
  });

  test("rate limiter wait serializes attempts (acquire blocks before attempt)", async () => {
    const clock = makeClock();
    let attempts = 0;
    const inner: Transport = {
      async request(): Promise<TransportResponse> {
        attempts += 1;
        return resp(200);
      }
    };
    const rl = createTokenBucketRateLimiter({
      capacity: 1,
      refillPerSecond: 1, // 1 token / 1000ms
      now: clock.now,
      sleep: fakeSleep(clock)
    });
    const rt = createReliableTransport(inner, {
      retries: 0,
      rateLimiter: rl
    });
    const req: TransportRequest = { method: "GET", url: "https://x.test/m", headers: new Headers(), body: null };
    await rt.request(req);
    await rt.request(req); // second request must wait 1000ms for a refill
    expect(attempts).toBe(2);
  });

  test("acquire runs before a network-error retry as well", async () => {
    const acquireCalls: number[] = [];
    let attempts = 0;
    const inner: Transport = {
      async request(): Promise<TransportResponse> {
        attempts += 1;
        if (attempts < 2) throw new GraphNetworkError("transient");
        return resp(200);
      }
    };
    const rt = createReliableTransport(inner, {
      retries: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
      random: () => 0,
      sleep: async () => undefined,
      rateLimiter: {
        async acquire(): Promise<void> { acquireCalls.push(attempts); },
        tryAcquire(): boolean { return true; }
      }
    });
    expect((await rt.request({ method: "GET", url: "https://x.test/m", headers: new Headers(), body: null })).status).toBe(200);
    expect(attempts).toBe(2);
    expect(acquireCalls).toEqual([0, 1]);
  });
});
