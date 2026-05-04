// F-4 createMockTransport — in-memory Transport for tests.
//
// Returns a handle exposing the Transport plus a read-only requests array
// and imperative `respond`/`reset` methods. Every request is recorded
// verbatim (method/url/headers/body captured as-provided).
//
// Response dispatch algorithm:
//   1. If `fail` is set AND (failAfter is unset OR requestCount + 1 > failAfter)
//      then throw `fail` (or `fail(req)`).
//   2. Else consume FIFO from the responses queue.
//   3. Else use defaultResponse.
//   4. Else throw a descriptive Error indicating the mock was underspecified.
//
// The MockTransport is intended exclusively for test suites. Exposed via
// the `@wats/graph/testing` subpath so production code cannot import it.

import type {
  Transport,
  TransportRequest,
  TransportResponse
} from "./transport";

export type MockTransportResponseSpec =
  | {
      readonly status: number;
      readonly headers?: Record<string, string> | Headers;
      readonly body?: string | Uint8Array | object | null;
    }
  | ((req: TransportRequest) => MockTransportResponseSpec | Promise<MockTransportResponseSpec>);

export interface MockTransportConfig {
  readonly responses?: readonly MockTransportResponseSpec[];
  readonly defaultResponse?: MockTransportResponseSpec;
  readonly onRequest?: (req: TransportRequest) => void;
  readonly fail?: Error | ((req: TransportRequest) => Error);
  readonly failAfter?: number;
}

export interface MockTransportHandle {
  readonly transport: Transport;
  readonly requests: ReadonlyArray<TransportRequest>;
  respond(response: MockTransportResponseSpec): void;
  reset(): void;
}

function toHeaders(
  init: Record<string, string> | Headers | undefined
): Headers {
  if (init instanceof Headers) {
    return init;
  }
  if (init === undefined) {
    return new Headers();
  }
  return new Headers(init);
}

function encodeBody(
  body: string | Uint8Array | object | null | undefined
): { bytes: Uint8Array; contentType: string | null } {
  if (body === null || body === undefined) {
    return { bytes: new Uint8Array(0), contentType: null };
  }
  if (typeof body === "string") {
    return { bytes: new TextEncoder().encode(body), contentType: null };
  }
  if (body instanceof Uint8Array) {
    return { bytes: body, contentType: null };
  }
  // plain object -> JSON
  const jsonString = JSON.stringify(body);
  return {
    bytes: new TextEncoder().encode(jsonString),
    contentType: "application/json"
  };
}

function buildTransportResponse(spec: MockTransportResponseSpec extends infer S
  ? S extends (...args: never) => unknown
    ? never
    : S
  : never
): TransportResponse {
  // Narrow: spec is now the object form.
  const objSpec = spec as {
    readonly status: number;
    readonly headers?: Record<string, string> | Headers;
    readonly body?: string | Uint8Array | object | null;
  };

  const headers = toHeaders(objSpec.headers);
  const { bytes, contentType } = encodeBody(objSpec.body);
  if (contentType !== null && !headers.has("content-type")) {
    headers.set("content-type", contentType);
  }

  let consumed = false;
  const consume = (): Uint8Array => {
    if (consumed) {
      throw new Error("MockTransport response body already consumed");
    }
    consumed = true;
    return bytes;
  };

  // Make a ReadableStream from the bytes lazily (one-shot).
  const makeStream = (): ReadableStream<Uint8Array> => {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes.length > 0) {
          controller.enqueue(bytes);
        }
        controller.close();
      }
    });
  };

  const response: TransportResponse = {
    status: objSpec.status,
    headers,
    body: bytes.length === 0 ? null : makeStream(),
    async arrayBuffer(): Promise<ArrayBuffer> {
      const b = consume();
      const buf = new ArrayBuffer(b.byteLength);
      new Uint8Array(buf).set(b);
      return buf;
    },
    async text(): Promise<string> {
      const b = consume();
      return new TextDecoder().decode(b);
    },
    async json<T = unknown>(): Promise<T> {
      const b = consume();
      return JSON.parse(new TextDecoder().decode(b)) as T;
    }
  };
  return response;
}

async function resolveSpec(
  spec: MockTransportResponseSpec,
  req: TransportRequest
): Promise<MockTransportResponseSpec> {
  if (typeof spec === "function") {
    return resolveSpec(await spec(req), req);
  }
  return spec;
}

export function createMockTransport(config?: MockTransportConfig): MockTransportHandle {
  const cfg: MockTransportConfig = config ?? {};
  const queue: MockTransportResponseSpec[] = cfg.responses
    ? [...cfg.responses]
    : [];
  const requests: TransportRequest[] = [];

  const handle: MockTransportHandle = {
    transport: {
      async request(req: TransportRequest): Promise<TransportResponse> {
        if (cfg.onRequest !== undefined) {
          cfg.onRequest(req);
        }
        requests.push(req);

        if (cfg.fail !== undefined) {
          const threshold = cfg.failAfter;
          const shouldFail =
            threshold === undefined || requests.length > threshold;
          if (shouldFail) {
            const err =
              typeof cfg.fail === "function" ? cfg.fail(req) : cfg.fail;
            throw err;
          }
        }

        let spec: MockTransportResponseSpec | undefined = queue.shift();
        if (spec === undefined) {
          spec = cfg.defaultResponse;
        }
        if (spec === undefined) {
          throw new Error(
            `MockTransport received an unexpected request (${req.method} ${req.url}): no queued response and no defaultResponse configured.`
          );
        }
        const resolved = await resolveSpec(spec, req);
        return buildTransportResponse(
          resolved as Exclude<MockTransportResponseSpec, (...args: never) => unknown>
        );
      }
    },
    get requests(): ReadonlyArray<TransportRequest> {
      // F-4 remediation: return a frozen shallow copy so external
      // mutation of the returned array cannot corrupt internal state.
      return Object.freeze(requests.slice());
    },
    respond(response: MockTransportResponseSpec): void {
      queue.push(response);
    },
    reset(): void {
      queue.length = 0;
      requests.length = 0;
    }
  };
  return handle;
}
