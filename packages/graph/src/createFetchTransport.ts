// F-4 createFetchTransport — production-default Transport wrapping fetch.
//
// Implementation notes:
//   - fetch is resolved from options.fetch, then globalThis.fetch, at
//     request time. If neither is available, GraphNetworkError is thrown
//     on request (not at factory call) so the Transport stays usable in
//     environments where fetch is polyfilled after module load.
//   - Interceptors run in array order on request and in array order on
//     response (documented in docs/guides/transport-and-testing.md).
//   - fetch-level throws are wrapped in GraphNetworkError with the
//     original error preserved as `.cause`.
//   - AbortSignal is forwarded verbatim.

import { GraphNetworkError } from "./errors.js";
import type {
  Transport,
  TransportInterceptor,
  TransportOptions,
  TransportRequest,
  TransportResponse
} from "./transport.js";

export interface CreateFetchTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly interceptors?: readonly TransportInterceptor[];
}

function wrapResponse(res: Response): TransportResponse {
  return {
    status: res.status,
    headers: res.headers,
    body: res.body,
    arrayBuffer: () => res.arrayBuffer(),
    json: <T = unknown>() => res.json() as Promise<T>,
    text: () => res.text()
  };
}

export function createFetchTransport(
  options?: CreateFetchTransportOptions
): Transport {
  const interceptors = options?.interceptors ?? [];

  return {
    async request(
      req: TransportRequest,
      opts?: TransportOptions
    ): Promise<TransportResponse> {
      const resolvedFetch = options?.fetch ?? globalThis.fetch;
      if (typeof resolvedFetch !== "function") {
        throw new GraphNetworkError(
          "No fetch implementation available: provide options.fetch or a runtime that exposes globalThis.fetch."
        );
      }

      let currentReq: TransportRequest = req;
      for (const interceptor of interceptors) {
        if (interceptor.onRequest !== undefined) {
          currentReq = await interceptor.onRequest(currentReq);
        }
      }

      let rawResponse: Response;
      try {
        rawResponse = await resolvedFetch(currentReq.url, {
          method: currentReq.method,
          headers: currentReq.headers,
          body: currentReq.body,
          ...(opts?.signal !== undefined ? { signal: opts.signal } : {})
        });
      } catch (error) {
        throw new GraphNetworkError(
          "Graph request failed due to a network error",
          error
        );
      }

      let wrapped: TransportResponse = wrapResponse(rawResponse);
      for (const interceptor of interceptors) {
        if (interceptor.onResponse !== undefined) {
          wrapped = await interceptor.onResponse(currentReq, wrapped);
        }
      }
      return wrapped;
    }
  };
}
