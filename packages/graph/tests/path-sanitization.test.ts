// F-4 path sanitization tests.
//
// Regression coverage for Graph request path rules. The client's path
// sanitizer MUST reject:
//   - control chars (U+0000..U+001F, U+007F) anywhere in a segment
//   - traversal via `.` / `..` / `%2e%2e` / `%252e%252e` (B2 regression)
//   - query strings and fragments in path (`?` / `#`)
//   - CR/LF/NUL (request-smuggling vectors)
// and MUST NOT fire fetch when any of the above fails.

import { describe, expect, test } from "bun:test";
import { GraphClient, GraphRequestValidationError } from "../src";
import { createMockTransport } from "../src/createMockTransport";

function makeClient(): { client: GraphClient; handle: ReturnType<typeof createMockTransport> } {
  const handle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    }
  });
  const client = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: handle.transport
  });
  return { client, handle };
}

describe("F-4 path sanitization — control chars (WATS-8 L1)", () => {
  test("rejects NUL (U+0000) in path segment", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me\u0000/detail" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects CR (U+000D) in path segment", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me\r/detail" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects LF (U+000A) in path segment", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me\n/detail" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects TAB (U+0009) in path segment", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me\t/detail" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects DEL (U+007F) in path segment", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me\u007f/detail" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects percent-encoded control chars (e.g. %0A) after decoding", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me%0A/detail" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects double-encoded control chars (%250A)", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me%250A/detail" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("sweeps every U+0001..U+001F control codepoint", async () => {
    for (let cp = 0x01; cp <= 0x1f; cp += 1) {
      const { client, handle } = makeClient();
      const path = `/me${String.fromCharCode(cp)}x`;
      await expect(
        client.request({ method: "GET", path }),
        `codepoint 0x${cp.toString(16)} must be rejected`
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
      expect(handle.requests.length).toBe(0);
    }
  });
});

describe("F-4 path sanitization — traversal regression", () => {
  test("rejects dot traversal", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/../me" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects %2e%2e traversal", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/%2e%2e/me" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects %252e%252e double-encoded traversal", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/%252e%252e/me" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects query and fragment injection", async () => {
    const { client, handle } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/me?fields=id" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    await expect(
      client.request({ method: "GET", path: "/me#frag" })
    ).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});
