import { GraphNetworkError } from "./errors.js";
import type {
  Transport,
  TransportHttpMethod,
  TransportOptions,
  TransportRequest,
  TransportResponse,
  TransportRetryPolicy
} from "./transport.js";
import { DEFAULT_TRANSPORT_RETRY_POLICY } from "./transport.js";
import type { RateLimiter } from "./rateLimiter.js";

export interface ReliableTransportRetryContext {
  readonly attempt: number;
  readonly request: TransportRequest;
  readonly response?: TransportResponse;
  readonly error?: unknown;
}

export type RetryPostMode = "never" | "network-only" | "always";

export interface ReliableTransportOptions extends Partial<TransportRetryPolicy> {
  readonly timeoutMs?: number;
  readonly retryOn?: (ctx: ReliableTransportRetryContext) => boolean;
  readonly onRetry?: (ctx: ReliableTransportRetryContext & { readonly delayMs: number }) => void | Promise<void>;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly random?: () => number;
  /**
   * Controls retry of non-idempotent POST requests. Default "never" preserves
   * the historical behavior: POST is retried only on 429 (the rate-limit
   * exception), never on 5xx or network errors.
   *
   * - "network-only": additionally retry a POST whose request threw a
   *   GraphNetworkError BEFORE any response arrived, but only when the request
   *   carries an Idempotency-Key header (case-insensitive). A pre-response
   *   network failure is the one POST failure shape that cannot have been
   *   processed by the server, so an idempotency key makes the retry safe.
   *   POST 5xx is still not retried — the server may have side-effected.
   * - "always": additionally retry POST on 5xx. Requires server-side
   *   idempotency for the endpoint; a 5xx after the server began processing
   *   can otherwise duplicate a send. Use only for endpoints you have
   *   verified are idempotent or dedupe by Idempotency-Key.
   */
  readonly retryPosts?: RetryPostMode;
  readonly rateLimiter?: RateLimiter;
}

interface ResolvedReliableTransportPolicy {
  readonly retries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter?: (attempt: number, baseDelayMs: number) => number;
  readonly timeoutMs?: number;
  readonly retryOn?: (ctx: ReliableTransportRetryContext) => boolean;
  readonly onRetry?: (ctx: ReliableTransportRetryContext & { readonly delayMs: number }) => void | Promise<void>;
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly random: () => number;
  readonly retryPosts: RetryPostMode;
  readonly rateLimiter?: RateLimiter;
}

const VALID_RETRY_POST_MODES: readonly RetryPostMode[] = ["never", "network-only", "always"];

function assertFiniteNumber(value: unknown, name: string, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`ReliableTransportOptions: ${name} must be a finite number >= ${min}.`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`ReliableTransportOptions: ${name} must be a non-negative integer.`);
  }
  return value;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function resolvePolicy(options?: ReliableTransportOptions): ResolvedReliableTransportPolicy {
  const retries = assertNonNegativeInteger(options?.retries ?? DEFAULT_TRANSPORT_RETRY_POLICY.retries, "retries");
  const baseDelayMs = assertFiniteNumber(options?.baseDelayMs ?? DEFAULT_TRANSPORT_RETRY_POLICY.baseDelayMs, "baseDelayMs", 0);
  const maxDelayMs = assertFiniteNumber(options?.maxDelayMs ?? DEFAULT_TRANSPORT_RETRY_POLICY.maxDelayMs, "maxDelayMs", 1);
  if (baseDelayMs > maxDelayMs) throw new Error("ReliableTransportOptions: baseDelayMs must be <= maxDelayMs.");
  if (options?.timeoutMs !== undefined) assertFiniteNumber(options.timeoutMs, "timeoutMs", 1);
  if (options?.jitter !== undefined && typeof options.jitter !== "function") throw new Error("ReliableTransportOptions: jitter must be a function.");
  if (options?.retryOn !== undefined && typeof options.retryOn !== "function") throw new Error("ReliableTransportOptions: retryOn must be a function.");
  if (options?.onRetry !== undefined && typeof options.onRetry !== "function") throw new Error("ReliableTransportOptions: onRetry must be a function.");
  if (options?.sleep !== undefined && typeof options.sleep !== "function") throw new Error("ReliableTransportOptions: sleep must be a function.");
  if (options?.random !== undefined && typeof options.random !== "function") throw new Error("ReliableTransportOptions: random must be a function.");
  const retryPosts = resolveRetryPostMode(options?.retryPosts);
  if (options?.rateLimiter !== undefined) {
    const rl = options.rateLimiter;
    if (rl === null || typeof rl !== "object" || typeof rl.acquire !== "function") {
      throw new Error("ReliableTransportOptions: rateLimiter must be an object with an acquire(cost?) => Promise<void> method.");
    }
    if (typeof rl.tryAcquire !== "function") {
      throw new Error("ReliableTransportOptions: rateLimiter must also implement tryAcquire(cost?) => boolean.");
    }
  }
  return {
    retries,
    baseDelayMs,
    maxDelayMs,
    ...(options?.jitter !== undefined ? { jitter: options.jitter } : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.retryOn !== undefined ? { retryOn: options.retryOn } : {}),
    ...(options?.onRetry !== undefined ? { onRetry: options.onRetry } : {}),
    sleep: options?.sleep ?? defaultSleep,
    random: options?.random ?? Math.random,
    retryPosts,
    ...(options?.rateLimiter !== undefined ? { rateLimiter: options.rateLimiter } : {})
  };
}

function resolveRetryPostMode(value: unknown): RetryPostMode {
  if (value === undefined) return "never";
  if (typeof value !== "string" || !VALID_RETRY_POST_MODES.includes(value as RetryPostMode)) {
    throw new Error(
      `ReliableTransportOptions: retryPosts must be one of ${VALID_RETRY_POST_MODES.map((m) => `"${m}"`).join(", ")} (got ${value === undefined ? "undefined" : JSON.stringify(value)}).`
    );
  }
  return value as RetryPostMode;
}

function isRetryableMethod(method: TransportHttpMethod): boolean {
  return method === "GET" || method === "DELETE";
}

function hasIdempotencyKey(req: TransportRequest): boolean {
  // Headers.has() is case-insensitive per the Fetch standard, so this matches
  // "Idempotency-Key", "IDEMPOTENCY-KEY", "idempotency-key", etc.
  return req.headers.has("idempotency-key");
}

function makeDefaultRetryOn(retryPosts: RetryPostMode): (ctx: ReliableTransportRetryContext) => boolean {
  return (ctx: ReliableTransportRetryContext): boolean => {
    const status = ctx.response?.status;
    // 429 is the one status retried for ANY method regardless of mode — the
    // server signaled "back off", not "I processed and failed". This is the
    // pre-175 behavior and is preserved across all modes.
    if (status === 429) return true;
    const method = ctx.request.method;
    const retryableMethod = isRetryableMethod(method);
    const is5xx = typeof status === "number" && status >= 500 && status < 600;

    if (ctx.error instanceof GraphNetworkError) {
      // Network error thrown BEFORE a response arrived.
      if (retryableMethod) return true;
      if (method === "POST" && retryPosts !== "never") {
        // The only safe POST-network retry: gated on an idempotency key so a
        // duplicate send, if it happens to land, is deduped server-side.
        return hasIdempotencyKey(ctx.request);
      }
      return false;
    }

    // Response received.
    if (retryableMethod) return is5xx;
    if (method === "POST" && retryPosts === "always") return is5xx;
    return false;
  };
}

function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) return seconds * 1_000;
  }
  if (trimmed.startsWith("-")) return null;
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

function boundedDelayMs(
  attempt: number,
  response: TransportResponse | undefined,
  policy: ResolvedReliableTransportPolicy
): number {
  const retryAfter = parseRetryAfterMs(response?.headers.get("retry-after") ?? null, Date.now());
  if (retryAfter !== null) return Math.min(retryAfter, policy.maxDelayMs);
  const exponential = Math.min(policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)), policy.maxDelayMs);
  if (policy.jitter !== undefined) {
    const custom = policy.jitter(attempt, policy.baseDelayMs);
    return Math.min(assertFiniteNumber(custom, "jitter result", 0), policy.maxDelayMs);
  }
  const random = policy.random();
  if (typeof random !== "number" || !Number.isFinite(random) || random < 0 || random > 1) {
    throw new Error("ReliableTransportOptions: random must return a finite number in [0, 1].");
  }
  return Math.floor(exponential * random);
}

function composeSignal(caller: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  if (timeoutMs === undefined) return caller;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (caller === undefined) return timeoutSignal;
  return AbortSignal.any([caller, timeoutSignal]);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    throw new GraphNetworkError("Transport request aborted by caller.");
  }
}

async function cancelRetryResponseBody(response: TransportResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort resource cleanup only; a cancel failure must not change retry behavior.
  }
}

async function sleepWithAbort(
  sleep: (delayMs: number) => Promise<void>,
  delayMs: number,
  signal: AbortSignal | undefined
): Promise<void> {
  if (signal === undefined) {
    await sleep(delayMs);
    return;
  }
  throwIfAborted(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => {
      const reason = signal.reason;
      reject(reason instanceof Error ? reason : new GraphNetworkError("Transport request aborted by caller."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(delayMs), aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

export function createReliableTransport(inner: Transport, options?: ReliableTransportOptions): Transport {
  if (inner === null || typeof inner !== "object" || typeof inner.request !== "function") {
    throw new Error("ReliableTransportOptions: inner transport must implement request().");
  }

  return {
    async request(req: TransportRequest, opts?: TransportOptions): Promise<TransportResponse> {
      const policy = resolvePolicy(options);
      const retryOn = policy.retryOn ?? makeDefaultRetryOn(policy.retryPosts);
      let attempt = 0;
      for (;;) {
        throwIfAborted(opts?.signal);
        // Admit through the rate limiter (if any) before every attempt,
        // including retries, so a burst of retries cannot overrun the bucket.
        if (policy.rateLimiter !== undefined) {
          await policy.rateLimiter.acquire();
        }
        attempt += 1;
        const composedSignal = composeSignal(opts?.signal, policy.timeoutMs);
        const attemptOpts: TransportOptions | undefined = composedSignal !== undefined
          ? { signal: composedSignal }
          : undefined;
        try {
          const response = await inner.request(req, attemptOpts);
          const ctx: ReliableTransportRetryContext = { attempt, request: req, response };
          const shouldRetry = retryOn(ctx);
          if (!shouldRetry || attempt > policy.retries) return response;
          await cancelRetryResponseBody(response);
          throwIfAborted(opts?.signal);
          const delayMs = boundedDelayMs(attempt, response, policy);
          await policy.onRetry?.({ ...ctx, delayMs });
          await sleepWithAbort(policy.sleep, delayMs, opts?.signal);
        } catch (error) {
          if (opts?.signal?.aborted) throw error;
          const ctx: ReliableTransportRetryContext = { attempt, request: req, error };
          const shouldRetry = retryOn(ctx);
          if (!shouldRetry || attempt > policy.retries) throw error;
          throwIfAborted(opts?.signal);
          const delayMs = boundedDelayMs(attempt, undefined, policy);
          await policy.onRetry?.({ ...ctx, delayMs });
          await sleepWithAbort(policy.sleep, delayMs, opts?.signal);
        }
      }
    }
  };
}
