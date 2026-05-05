// @switchbord/http — Fetch adapter wrapper (F-12 GREEN + WATS-29 hardening).
//
// WinterCG-shaped adapter: takes a WHATWG Request and returns a
// Promise<Response>. Usable directly from Cloudflare Workers, Deno,
// Bun's fetch handler, and any edge runtime implementing fetch.
//
// Zero node:* imports, Zero Node globals (Buffer, process). The
// workspace-policy test + the F-12 edge-runtime sanity test both
// assert that this file's static import graph contains no node:*
// reference. Keep it that way.
//
// F-12 remediation (WATS-29): the wrapper enforces the adapter's
// maxBodyBytes cap at READ time rather than handing the full body
// to `request.arrayBuffer()` up-front. Two belt-and-suspenders
// guards:
//   1) If a Content-Length header is present and > cap, return 413
//      WITHOUT ever reading the body.
//   2) If the body is a streaming ReadableStream (no Content-Length),
//      read via getReader() and abort mid-stream once total > cap.

import type { WebhookAdapter, WebhookRequest, WebhookResponse } from "./webhookAdapter";

const OVERSIZED_RESPONSE_BODY = JSON.stringify({
  error: {
    code: "payload_too_large",
    message: "Body exceeds maxBodyBytes."
  }
});

function oversized(): Response {
  return new Response(OVERSIZED_RESPONSE_BODY, {
    status: 413,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function parseContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null) return null;
  // RFC 7230 §3.3.2: CL is a decimal non-negative integer. Reject
  // anything else (treat as unknown — do not short-circuit).
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

async function readBodyWithCap(
  request: Request,
  maxBodyBytes: number
): Promise<Uint8Array | null | "over_limit"> {
  // Prefer the streaming reader so we can stop early when over cap.
  const stream = (request as unknown as { body?: ReadableStream<Uint8Array> | null }).body;
  if (stream && typeof (stream as { getReader?: unknown }).getReader === "function") {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.byteLength;
        if (total > maxBodyBytes) {
          // Cancel the underlying source so the runtime can release
          // resources without buffering the remainder.
          try {
            await reader.cancel(new Error("payload_too_large"));
          } catch {
            /* cancel is best-effort */
          }
          return "over_limit";
        }
        chunks.push(value);
      }
    } catch {
      // Stream failure mirrors the old behaviour — surface as null
      // so the adapter core responds 400 missing_body.
      return null;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* best effort */
      }
    }
    if (total === 0) return null;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  // No streaming body → fall back to arrayBuffer(). Still capped,
  // but here the full body is already resident (the runtime already
  // buffered it). Keep the core's safety net via maxBodyBytes check.
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > maxBodyBytes) return "over_limit";
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export function createFetchWebhookHandler(
  adapter: WebhookAdapter
): (request: Request) => Promise<Response> {
  if (
    adapter === null ||
    typeof adapter !== "object" ||
    typeof (adapter as { handle?: unknown }).handle !== "function"
  ) {
    throw new Error(
      "createFetchWebhookHandler: adapter must be a WebhookAdapter."
    );
  }

  const maxBodyBytes = adapter.maxBodyBytes;

  return async function fetchHandler(request: Request): Promise<Response> {
    let body: Uint8Array | null = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      // Guard 1: Content-Length pre-check. Cheap belt-and-suspenders
      // — short-circuit without ever reading the body stream.
      const declared = parseContentLength(request.headers);
      if (declared !== null && declared > maxBodyBytes) {
        return oversized();
      }
      // Guard 2: streaming read with cap.
      const result = await readBodyWithCap(request, maxBodyBytes);
      if (result === "over_limit") {
        return oversized();
      }
      body = result;
    }

    const webhookRequest: WebhookRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body
    };

    const webhookResponse: WebhookResponse = await adapter.handle(webhookRequest);
    return toFetchResponse(webhookResponse);
  };
}

function toFetchResponse(response: WebhookResponse): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    headers.set(name, value);
  }
  // The Response constructor accepts string | Uint8Array | ArrayBuffer.
  // Both of our shape variants are supported verbatim.
  return new Response(response.body as BodyInit, {
    status: response.status,
    headers
  });
}
