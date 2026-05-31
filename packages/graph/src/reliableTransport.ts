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

export interface ReliableTransportRetryContext {
  readonly attempt: number;
  readonly request: TransportRequest;
  readonly response?: TransportResponse;
  readonly error?: unknown;
}

export interface ReliableTransportOptions extends Partial<TransportRetryPolicy> {
  readonly timeoutMs?: number;
  readonly retryOn?: (ctx: ReliableTransportRetryContext) => boolean;
  readonly onRetry?: (ctx: ReliableTransportRetryContext & { readonly delayMs: number }) => void | Promise<void>;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly random?: () => number;
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
}

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
  return {
    retries,
    baseDelayMs,
    maxDelayMs,
    ...(options?.jitter !== undefined ? { jitter: options.jitter } : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.retryOn !== undefined ? { retryOn: options.retryOn } : {}),
    ...(options?.onRetry !== undefined ? { onRetry: options.onRetry } : {}),
    sleep: options?.sleep ?? defaultSleep,
    random: options?.random ?? Math.random
  };
}

function isRetryableMethod(method: TransportHttpMethod): boolean {
  return method === "GET" || method === "DELETE";
}

function defaultRetryOn(ctx: ReliableTransportRetryContext): boolean {
  const status = ctx.response?.status;
  if (status === 429) return true;
  if (!isRetryableMethod(ctx.request.method)) return false;
  if (ctx.error instanceof GraphNetworkError) return true;
  return typeof status === "number" && status >= 500 && status < 600;
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
      let attempt = 0;
      for (;;) {
        throwIfAborted(opts?.signal);
        attempt += 1;
        const composedSignal = composeSignal(opts?.signal, policy.timeoutMs);
        const attemptOpts: TransportOptions | undefined = composedSignal !== undefined
          ? { signal: composedSignal }
          : undefined;
        try {
          const response = await inner.request(req, attemptOpts);
          const ctx: ReliableTransportRetryContext = { attempt, request: req, response };
          const shouldRetry = (policy.retryOn ?? defaultRetryOn)(ctx);
          if (!shouldRetry || attempt > policy.retries) return response;
          await cancelRetryResponseBody(response);
          throwIfAborted(opts?.signal);
          const delayMs = boundedDelayMs(attempt, response, policy);
          await policy.onRetry?.({ ...ctx, delayMs });
          await sleepWithAbort(policy.sleep, delayMs, opts?.signal);
        } catch (error) {
          if (opts?.signal?.aborted) throw error;
          const ctx: ReliableTransportRetryContext = { attempt, request: req, error };
          const shouldRetry = (policy.retryOn ?? defaultRetryOn)(ctx);
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
