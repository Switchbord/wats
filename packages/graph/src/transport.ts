// F-4 Transport seam for GraphClient.
//
// Defines the Transport contract that GraphClient consumes. Two canonical
// implementations ship alongside:
//   - createFetchTransport (production default; wraps globalThis.fetch)
//   - createMockTransport (exported from `@wats/graph/testing` for tests)
//
// The Transport boundary is deliberately minimal: a single async `request`
// method that accepts a fully-resolved TransportRequest and returns a
// TransportResponse. Retry, auth refresh, tracing, etc. are all implemented
// as Transport decorators (future work — F-4 ships the seam, not decorators).

export type TransportHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TransportRequest {
  readonly method: TransportHttpMethod;
  readonly url: string;
  readonly headers: Headers;
  readonly body: BodyInit | null;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
}

export interface TransportOptions {
  readonly signal?: AbortSignal;
}

export interface Transport {
  request(req: TransportRequest, opts?: TransportOptions): Promise<TransportResponse>;
}

// Retry policy SHAPE only; F-4 transport does not retry. Exposed so future
// retry decorators have a stable contract to consume.
export interface TransportRetryPolicy {
  readonly retries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter?: (attempt: number, baseDelayMs: number) => number;
}

export const DEFAULT_TRANSPORT_RETRY_POLICY: TransportRetryPolicy = {
  retries: 3,
  baseDelayMs: 200,
  maxDelayMs: 30_000
};

// Interceptor hooks consumed by createFetchTransport and any Transport
// implementation that opts in. Interceptors run in array order on request,
// reverse order on response is NOT guaranteed — they run in array order on
// response as well (onRequest forward, onResponse forward). Document this
// in the guide.
export interface TransportInterceptor {
  onRequest?(req: TransportRequest): TransportRequest | Promise<TransportRequest>;
  onResponse?(
    req: TransportRequest,
    res: TransportResponse
  ): TransportResponse | Promise<TransportResponse>;
}

export {
  createReliableTransport
} from "./reliableTransport.js";
export type {
  ReliableTransportOptions,
  ReliableTransportRetryContext
} from "./reliableTransport.js";
