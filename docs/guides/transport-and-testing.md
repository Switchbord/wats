# Transport and Testing

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-21

## Purpose

`@switchbord/graph` ships a small `Transport` seam under `GraphClient` so that every HTTP concern — retries, authentication refresh, tracing, mocking in tests — lives in a composable layer the user controls. The default transport (`createFetchTransport`) is a thin wrapper over `globalThis.fetch`. Tests inject `createMockTransport` via the `@switchbord/graph/testing` subpath and assert on a `requests` array rather than monkey-patching global state.

This guide covers three recipes: the test recipe, a custom Transport for production concerns, and the Interceptor primer.

## The Transport contract

```ts
import type { Transport, TransportRequest, TransportResponse } from "@switchbord/graph";
```

A `Transport` has one method:

```ts
interface Transport {
  request(req: TransportRequest, opts?: { signal?: AbortSignal }): Promise<TransportResponse>;
}
```

`TransportRequest` is a fully-resolved absolute URL, a `Headers` instance, the chosen `BodyInit | null`, and the HTTP method (`GET | POST | PUT | PATCH | DELETE`). `TransportResponse` exposes `status`, `headers`, `body: ReadableStream<Uint8Array> | null`, and `arrayBuffer() / text() / json<T>()` methods.

The seam is intentionally minimal: if you can write the function, you can swap it in. `GraphClient` never looks at the underlying fetch implementation; everything goes through the `Transport`.

## Recipe 1 — Testing with `createMockTransport`

Import the mock factory from the `@switchbord/graph/testing` subpath. This subpath is separate so production bundles do not pull the mock in by accident.

```ts
import { GraphClient } from "@switchbord/graph";
import { createMockTransport } from "@switchbord/graph/testing";

const handle = createMockTransport({
  responses: [
    {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messaging_product: "whatsapp", messages: [{ id: "wamid.HBgM" }] }
    }
  ]
});

const client = new GraphClient({
  accessToken: "test-token",
  apiVersion: "v20.0",
  baseUrl: "https://graph.facebook.com",
  transport: handle.transport
});

const res = await client.messages.sendMessage({
  phoneNumberId: "123",
  to: "15551230000",
  text: "hi"
});

// Assert on the recorded request — method/url/headers/body — verbatim.
expect(handle.requests.length).toBe(1);
expect(handle.requests[0]?.url).toBe(
  "https://graph.facebook.com/v20.0/123/messages"
);
expect(handle.requests[0]?.headers.get("authorization")).toBe("Bearer test-token");
```

`createMockTransport` options:

| Field | Purpose |
| --- | --- |
| `responses` | FIFO queue of response specs; each request consumes one. |
| `defaultResponse` | Used after the queue is exhausted. |
| `onRequest(req)` | Spy called before dispatch. |
| `fail` | `Error` (or `(req) => Error`) to throw instead of responding. Simulates fetch-level failures. |
| `failAfter` | Threshold at which `fail` starts firing (the first N requests still respond normally). |

Response specs can be objects `{ status, headers?, body? }` or functions `(req) => spec` for per-request dynamic responses. The `body` can be a `string`, `Uint8Array`, a plain object (auto-JSON with `application/json` content-type), or `null`.

The handle exposes `respond(spec)` to push into the queue mid-test and `reset()` to clear both the queue and the recorded requests.

## Recipe 2 — Writing a Custom Transport

Any `Transport` is just an object with a `request` method. Wrap the default transport to add retry, auth refresh, or tracing without touching `GraphClient`.

```ts
import {
  createFetchTransport,
  type Transport,
  type TransportRequest
} from "@switchbord/graph";

export function createRetryingTransport(
  inner: Transport,
  opts: { retries: number; baseDelayMs: number }
): Transport {
  return {
    async request(req, options) {
      let attempt = 0;
      for (;;) {
        try {
          const res = await inner.request(req, options);
          if (res.status < 500 || attempt >= opts.retries) {
            return res;
          }
        } catch (error) {
          if (attempt >= opts.retries) {
            throw error;
          }
        }
        attempt += 1;
        const delay = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), 30_000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  };
}

const base = createFetchTransport();
const retry = createRetryingTransport(base, { retries: 3, baseDelayMs: 200 });
const client = new GraphClient({
  accessToken: token,
  apiVersion: "v20.0",
  transport: retry
});
```

The same shape composes: `auth-refresh -> retry -> tracing -> fetch`. Each layer is a function that takes `(inner: Transport) => Transport`. Because every layer sees the same `TransportRequest`/`TransportResponse` shape, the layers stay independently testable.

`TransportRetryPolicy` is exposed as a shared type for retry decorators to consume a standard config: `{ retries, baseDelayMs, maxDelayMs, jitter? }`. The default constant `DEFAULT_TRANSPORT_RETRY_POLICY` exposes conservative values (`retries: 3`, `baseDelayMs: 200`, `maxDelayMs: 30_000`). F-4 does NOT apply retries by default — retry is opt-in.

## Recipe 2a — Streaming request bodies (`ReadableStream`)

`GraphClient.request` treats `ReadableStream` request bodies as an opaque passthrough: the stream is handed to the underlying transport by reference (never buffered, never `JSON.stringify`'d). If the caller does not supply a `content-type`, the client defaults to `application/octet-stream` rather than `application/json`.

```ts
const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new Uint8Array([/* binary frame 1 */]));
    controller.enqueue(new Uint8Array([/* binary frame 2 */]));
    controller.close();
  }
});

await client.request<{ id: string }>({
  method: "POST",
  path: "/media",
  body: stream,
  // Optional. Omit to accept the application/octet-stream default.
  headers: { "content-type": "application/octet-stream" }
});
```

This path composes with the other body types: `FormData`, `Blob`, `ArrayBuffer`, `ArrayBufferView` (`Uint8Array`/`DataView`), `URLSearchParams`, and `string` all pass through unchanged; only plain objects are JSON-serialized. This is how Media uploads and streamed attachments ride through the same primitive.

## Recipe 3 — Interceptor primer

`createFetchTransport` accepts an optional `interceptors` array for the common case where you just want to rewrite the request or observe the response without wrapping the entire Transport:

```ts
import { createFetchTransport, type TransportInterceptor } from "@switchbord/graph";

const tracing: TransportInterceptor = {
  onRequest: (req) => {
    const headers = new Headers(req.headers);
    headers.set("x-request-id", crypto.randomUUID());
    return { ...req, headers };
  },
  onResponse: (req, res) => {
    console.log(`${req.method} ${req.url} -> ${res.status}`);
    return res;
  }
};

const transport = createFetchTransport({ interceptors: [tracing] });
```

Ordering:
- `onRequest` hooks run in **array order** before fetch is invoked. Each hook may mutate the request by returning a new `TransportRequest` (plain objects are fine).
- `onResponse` hooks run in **array order** after fetch resolves. Each hook may return a replacement `TransportResponse`.

Interceptors can be async; the chain awaits each hook. For errors originating inside fetch, the `createFetchTransport` catches the throw and re-throws it as `GraphNetworkError` with `cause` preserved — interceptors do not see the raw fetch error.

## Why a separate testing subpath?

`createMockTransport` lives at `@switchbord/graph/testing`, not the package root. Production code that imports `@switchbord/graph` never pulls the mock in. Tests import `@switchbord/graph/testing` explicitly, which keeps the dependency graph honest and keeps mocks out of production bundles.

## Related ADRs

- ADR-003 Transport and crypto abstractions — defines the Transport contract, retry policy, and interceptor model.
- ADR-006 Testing and consumer fixture strategy — motivates MockTransport over global-fetch patching.
