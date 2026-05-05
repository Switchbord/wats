// @switchbord/http — Node adapter wrapper (F-12 GREEN).
//
// Returns a request listener compatible with the standard Node
// `http.createServer((req, res) => ...)` shape. The adapter core is
// runtime-neutral, so this module only marshals Node's
// IncomingMessage/ServerResponse to/from the adapter's WHATWG-shaped
// WebhookRequest/WebhookResponse.
//
// IMPORTANT: this module contains zero static `node:*` imports. The
// workspace-policy test forbids static node:* references in any
// @switchbord/http src file (matches the @switchbord/crypto/adapters/node
// precedent). If the caller hands us an IncomingMessage/ServerResponse
// pair, we already have enough surface to work — we don't need to
// resolve `node:http` at import time.

import type { WebhookAdapter, WebhookRequest } from "./webhookAdapter";

export interface NodeIncomingMessageLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  on(event: "data" | "end" | "error", listener: (chunk?: unknown) => void): unknown;
  // F-12 remediation (WATS-29): the adapter needs to abort an
  // oversized body at read time (not after buffering). `destroy` is
  // present on every Node IncomingMessage (inherited from Readable).
  destroy?(err?: unknown): unknown;
}

export interface NodeServerResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string | Uint8Array): unknown;
}

export type NodeWebhookHandler = (
  req: NodeIncomingMessageLike,
  res: NodeServerResponseLike
) => Promise<void>;

// Constructs a full absolute URL from a Node IncomingMessage. Node's
// `req.url` is only the request-target portion ("/path?query"); the
// adapter core expects an absolute URL so `new URL(...)` works in the
// GET verify handler.
function resolveAbsoluteUrl(req: NodeIncomingMessageLike): string {
  const relative = typeof req.url === "string" ? req.url : "/";
  const hostHeader = getHeaderValue(req.headers, "host") ?? "localhost";
  return `http://${hostHeader}${relative.startsWith("/") ? relative : `/${relative}`}`;
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const lower = name.toLowerCase();
  const value = headers[lower] ?? headers[name];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

function buildHeaders(
  raw: Record<string, string | string[] | undefined>
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(name, v);
      }
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

// F-12 remediation (WATS-29): read with a hard cap. A malicious
// sender can otherwise stream an arbitrarily large body and force
// unbounded memory usage before the adapter core's post-read
// maxBodyBytes check fires. Track running total; when the incoming
// chunk would push us over the cap, call `req.destroy(...)` to
// abort the socket and resolve with a sentinel so the wrapper can
// respond 413 without returning the oversized body.
const OVER_LIMIT = Symbol("node-body-over-limit");
type ReadBodyResult = Uint8Array | null | typeof OVER_LIMIT;

async function readBody(
  req: NodeIncomingMessageLike,
  maxBodyBytes: number
): Promise<ReadBodyResult> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let finalized = false;
    const finish = (value: ReadBodyResult) => {
      if (finalized) return;
      finalized = true;
      resolve(value);
    };
    req.on("data", (chunk: unknown) => {
      if (finalized) return;
      let bytes: Uint8Array | null = null;
      if (chunk instanceof Uint8Array) {
        bytes = chunk;
      } else if (typeof chunk === "string") {
        bytes = new TextEncoder().encode(chunk);
      }
      if (bytes === null) return;
      total += bytes.byteLength;
      // Enforce the cap BEFORE retaining the chunk. If `total` now
      // exceeds `maxBodyBytes`, abort the socket and resolve
      // immediately — the oversized bytes are never appended to
      // the buffer, so the peak memory stays bounded.
      if (total > maxBodyBytes) {
        // Resolve with OVER_LIMIT FIRST so any error-listener path
        // triggered synchronously by `req.destroy` cannot race us
        // into a plain-null resolution (which would look like a
        // missing body to the core).
        finish(OVER_LIMIT);
        if (typeof req.destroy === "function") {
          try {
            req.destroy(new Error("payload_too_large"));
          } catch {
            /* destroy is best-effort */
          }
        }
        return;
      }
      chunks.push(bytes);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        finish(null);
        return;
      }
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      finish(joined);
    });
    req.on("error", () => finish(null));
  });
}

export function createNodeWebhookHandler(
  adapter: WebhookAdapter
): NodeWebhookHandler {
  if (
    adapter === null ||
    typeof adapter !== "object" ||
    typeof (adapter as { handle?: unknown }).handle !== "function"
  ) {
    throw new Error(
      "createNodeWebhookHandler: adapter must be a WebhookAdapter."
    );
  }

  return async function nodeHandler(
    req: NodeIncomingMessageLike,
    res: NodeServerResponseLike
  ): Promise<void> {
    const method = typeof req.method === "string" ? req.method : "GET";
    const url = resolveAbsoluteUrl(req);
    const headers = buildHeaders(req.headers);

    // F-12 remediation (WATS-29): pull the applied cap off the
    // adapter (not from config — which lives behind the factory
    // closure) so the wrapper can reject oversized bodies at READ
    // time rather than after buffering.
    const maxBodyBytes = adapter.maxBodyBytes;

    let body: Uint8Array | null = null;
    if (method !== "GET" && method !== "HEAD") {
      const result = await readBody(req, maxBodyBytes);
      if (result === OVER_LIMIT) {
        // Synthesize a 413 response without running the core. The
        // core never sees the oversized bytes; peak memory stays
        // bounded regardless of adversarial chunk sizing.
        res.statusCode = 413;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: {
              code: "payload_too_large",
              message: "Body exceeds maxBodyBytes."
            }
          })
        );
        return;
      }
      body = result;
    }

    const request: WebhookRequest = { method, url, headers, body };
    const response = await adapter.handle(request);
    res.statusCode = response.status;
    for (const [name, value] of Object.entries(response.headers)) {
      res.setHeader(name, value);
    }
    res.end(response.body);
  };
}
