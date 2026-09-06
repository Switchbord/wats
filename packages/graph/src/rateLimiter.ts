// WATS-175 slice A — proactive client-side rate limiter seam.
//
// Shape-only: a token-bucket limiter you can wire into createReliableTransport
// via the `rateLimiter` option. It smooths YOUR outbound request rate so a
// burst of sends does not trip Meta's 429. It is NOT Meta quota management —
// Meta has no published per-token send budget, and a bucket sized from
// observed 429s is a heuristic, not a contract. Tune capacity/refill from your
// own telemetry; never assume a bucket rate equals Meta's limit.
//
// Injectable now()/sleep mirror reliableTransport's pattern so the algorithm
// is fully deterministic under a virtual clock.

export interface RateLimiter {
  /**
   * Wait until `cost` tokens are available, then deduct them. Resolves once
   * the request is admitted; never rejects unless the injected sleep does,
   * or an `AbortSignal` is provided and aborts before admission.
   *
   * The optional `signal` is backwards compatible: callers using the legacy
   * `acquire(cost?)` signature are unaffected. A real `AbortSignal` racing
   * the wait rejects promptly with the signal's reason and consumes no
   * token. Non-AbortSignal inputs fail closed with a TypeError rather than
   * silently dropping cancellation.
   */
  acquire(cost?: number, signal?: AbortSignal): Promise<void>;
  /**
   * Non-blocking admission check. Refills the bucket to the current virtual
   * time, then if `cost` tokens are available deducts them and returns true;
   * otherwise returns false without deducting.
   */
  tryAcquire(cost?: number): boolean;
}

export interface CreateTokenBucketRateLimiterOptions {
  readonly capacity: number;
  readonly refillPerSecond: number;
  /** Injectable clock returning epoch milliseconds. Defaults to Date.now. */
  readonly now?: () => number;
  /** Injectable sleep for the wait path. Defaults to setTimeout-based sleep. */
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const MAX_CAPACITY = 10_000;

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function assertCapacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_CAPACITY) {
    throw new Error(
      `CreateTokenBucketRateLimiterOptions: capacity must be an integer in [1, ${MAX_CAPACITY}].`
    );
  }
  return value;
}

function assertRefillPerSecond(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("CreateTokenBucketRateLimiterOptions: refillPerSecond must be a finite number > 0.");
  }
  return value;
}

export function createTokenBucketRateLimiter(
  options: CreateTokenBucketRateLimiterOptions
): RateLimiter {
  if (options === null || typeof options !== "object") {
    throw new Error("CreateTokenBucketRateLimiterOptions: options must be an object.");
  }
  const capacity = assertCapacity(options.capacity);
  const refillPerSecond = assertRefillPerSecond(options.refillPerSecond);
  if (options.now !== undefined && typeof options.now !== "function") {
    throw new Error("CreateTokenBucketRateLimiterOptions: now must be a function.");
  }
  if (options.sleep !== undefined && typeof options.sleep !== "function") {
    throw new Error("CreateTokenBucketRateLimiterOptions: sleep must be a function.");
  }
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;

  let tokens = capacity;
  let lastRefillMs = now();

  function assertCost(cost: number | undefined): number {
    const c = cost ?? 1;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > capacity) {
      throw new Error(
        `RateLimiter: cost must be an integer in [1, ${capacity}] (the bucket capacity).`
      );
    }
    return c;
  }

  function refill(): void {
    const currentMs = now();
    const elapsedMs = currentMs - lastRefillMs;
    if (elapsedMs > 0) {
      const added = (elapsedMs / 1_000) * refillPerSecond;
      tokens = Math.min(capacity, tokens + added);
      lastRefillMs = currentMs;
    } else if (elapsedMs < 0) {
      // Clock moved backward (NTP skew, VM migration). Do not add negative
      // tokens; re-anchor the refill timestamp so the next tick recomputes
      // from the new baseline.
      lastRefillMs = currentMs;
    }
  }

  return {
    async acquire(cost?: number, signal?: AbortSignal): Promise<void> {
      const c = assertCost(cost);
      if (signal !== undefined) {
        // Fail closed on non-AbortSignal inputs: a duck-typed object is not a
        // real signal, and silently treating it as "no signal" would drop the
        // caller's cancellation intent. Require a genuine AbortSignal.
        if (signal === null || !(signal instanceof AbortSignal)) {
          throw new TypeError(
            "RateLimiter.acquire: signal must be an AbortSignal or undefined."
          );
        }
        if (signal.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new Error("RateLimiter acquire aborted by caller.");
        }
      }
      for (;;) {
        refill();
        if (tokens >= c) {
          tokens -= c;
          return;
        }
        const deficit = c - tokens;
        const waitMs = (deficit / refillPerSecond) * 1_000;
        if (signal === undefined) {
          await sleep(Math.max(0, waitMs));
          continue;
        }
        // Race the wait against the signal. The injected sleep may not be
        // cancellable, so we compose a promise that rejects on abort and
        // settle the race. If the sleep wins (tokens refilled under a virtual
        // clock), the abort listener is removed in finally and the loop
        // rechecks admission; if abort wins, no token is consumed.
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
          onAbort = (): void => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error("RateLimiter acquire aborted by caller.")
            );
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
          await Promise.race([sleep(Math.max(0, waitMs)), aborted]);
        } finally {
          if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
        }
      }
    },
    tryAcquire(cost?: number): boolean {
      const c = assertCost(cost);
      refill();
      if (tokens >= c) {
        tokens -= c;
        return true;
      }
      return false;
    }
  };
}
