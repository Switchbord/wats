import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createTokenBucketRateLimiter } from "../src/rateLimiter";

describe("rate limiter cancellation cleanup", () => {
  test("aborting the default wait clears its native timer", () => {
    const source = `
      import { createTokenBucketRateLimiter } from ${JSON.stringify(new URL("../src/rateLimiter.ts", import.meta.url).pathname)};
      const limiter = createTokenBucketRateLimiter({capacity:1,refillPerSecond:0.01});
      limiter.tryAcquire();
      const controller = new AbortController();
      const task = limiter.acquire(1,controller.signal);
      setTimeout(()=>controller.abort(),5);
      try { await task; } catch { console.log("aborted"); }
    `;
    const child = spawnSync("bun", ["--eval", source], { encoding: "utf8", timeout: 1000 });
    expect(child.stdout).toContain("aborted");
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
  });

  test("abort after a resolved wait does not debit the refilled token", async () => {
    let now = 0;
    const controller = new AbortController();
    const limiter = createTokenBucketRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => now,
      sleep: async () => { now = 1000; queueMicrotask(() => controller.abort(new Error("cancelled"))); }
    });
    limiter.tryAcquire();
    await expect(limiter.acquire(1, controller.signal)).rejects.toThrow("cancelled");
    expect(limiter.tryAcquire()).toBe(true);
  });
});
