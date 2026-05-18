// F-4 GraphClient tests migrated from globalThis.fetch stubs onto
// createMockTransport. Every request is inspected via the handle.requests
// array rather than captured fetch args.
//
// All 14 B2 test titles preserved verbatim for test-count-regression
// detection. Added cases for construction-time validation
// (accessToken / apiVersion / baseUrl), baseUrl pathname preservation,
// and scrubErrorCause Bearer redaction.

import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphNetworkError,
  GraphRateLimitError,
  GraphRequestValidationError,
  GraphSerializationError,
  scrubErrorCause,
  DEFAULT_GRAPH_BASE_URL,
  type GraphMessagesSendResponse
} from "../src";
import { ExpiredAccessTokenError } from "../src/errorSubclasses";
import { createMockTransport, type MockTransportResponseSpec } from "../src/createMockTransport";

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec) {
  const handle = createMockTransport(
    Array.isArray(responses) ? { responses } : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

async function captureRequestError(
  client: GraphClient,
  options: unknown
): Promise<unknown> {
  try {
    await (client.request as (input: unknown) => Promise<unknown>).call(
      client,
      options
    );
  } catch (error) {
    return error;
  }
  return undefined;
}

async function expectRequestValidationError(
  client: GraphClient,
  handle: { readonly requests: ReadonlyArray<unknown> },
  options: unknown,
  label: string
): Promise<void> {
  const thrown = await captureRequestError(client, options);
  expect(thrown, label).toBeInstanceOf(GraphRequestValidationError);
  expect(thrown, label).not.toBeInstanceOf(TypeError);
  expect(handle.requests.length, label).toBe(0);
}

async function captureRequestRawError(
  client: GraphClient,
  options: unknown
): Promise<unknown> {
  try {
    await (client.requestRaw as (input: unknown) => Promise<unknown>).call(
      client,
      options
    );
  } catch (error) {
    return error;
  }
  return undefined;
}

async function expectRequestRawValidationError(
  client: GraphClient,
  handle: { readonly requests: ReadonlyArray<unknown> },
  options: unknown,
  label: string
): Promise<void> {
  const thrown = await captureRequestRawError(client, options);
  expect(thrown, label).toBeInstanceOf(GraphRequestValidationError);
  expect(thrown, label).not.toBeInstanceOf(TypeError);
  expect(handle.requests.length, label).toBe(0);
}

describe("B2 graph client primitive", () => {
  test("rejects malformed request options before transport with typed validation errors", async () => {
    for (const options of [undefined, null, [], {}, "", 42, true]) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestValidationError(
        client,
        handle,
        options,
        `options ${JSON.stringify(options)}`
      );
    }
  });

  test("rejects malformed request paths before transport with typed validation errors", async () => {
    const badPaths: unknown[] = [undefined, null, 42, {}, [], "", "   "];
    for (const path of badPaths) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestValidationError(
        client,
        handle,
        { method: "GET", path },
        `path ${JSON.stringify(path)}`
      );
    }
  });

  test("request returns typed response and builds graph URL + auth headers", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "msg_123" }
    });

    const response = await client.request<{ id: string }>({
      method: "POST",
      path: "/123/messages",
      body: { foo: "bar" },
      query: { debug: true }
    });

    expect(response.id).toBe("msg_123");
    expect(handle.requests.length).toBe(1);

    const rec = handle.requests[0];
    expect(rec?.url).toBe(
      "https://graph.facebook.com/v25.0/123/messages?debug=true"
    );
    expect(rec?.method).toBe("POST");
    expect(rec?.headers.get("authorization")).toBe("Bearer test-token");
    expect(rec?.headers.get("content-type")).toBe("application/json");
    expect(rec?.body).toBe(JSON.stringify({ foo: "bar" }));
  });

  test("passes Uint8Array request bodies through unchanged without json content-type", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    const body = new Uint8Array([1, 2, 3, 4]);

    await client.request<{ ok: true }>({
      method: "POST",
      path: "/123/messages",
      body
    });

    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.body).toBe(body);
    expect(rec?.headers.get("content-type")).toBeNull();
  });

  test("passes DataView request bodies through unchanged without json content-type", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    const bytes = new Uint8Array([7, 8, 9, 10]);
    const body = new DataView(bytes.buffer, 1, 2);

    await client.request<{ ok: true }>({
      method: "POST",
      path: "/123/messages",
      body
    });

    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.body).toBe(body);
    expect(rec?.headers.get("content-type")).toBeNull();
  });

  test("maps oauth graph errors into GraphAuthError", async () => {
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "Invalid OAuth access token.",
          type: "OAuthException",
          code: 190,
          error_subcode: 463,
          fbtrace_id: "trace-1"
        }
      }
    });

    let thrown: unknown;
    try {
      await client.request<{ ok: true }>({ method: "GET", path: "/me" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).toBeInstanceOf(GraphAuthError);
    // F-5 remediation (WATS-29): pywa canonical — code 190 → ExpiredAccessToken.
    expect(thrown).toBeInstanceOf(ExpiredAccessTokenError);
    // Sibling assertion: auth failures are NOT rate-limit failures.
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);

    const graphError = thrown as GraphAuthError;
    expect(graphError.status).toBe(400);
    expect(graphError.code).toBe(190);
    expect(graphError.errorSubcode).toBe(463);
    expect(graphError.fbtraceId).toBe("trace-1");
  });

  test("maps fetch failures into GraphNetworkError", async () => {
    const handle = createMockTransport({ fail: new Error("socket hang up") });
    const client = new GraphClient({
      baseUrl: "https://graph.facebook.com",
      apiVersion: "v25.0",
      accessToken: "test-token",
      transport: handle.transport
    });

    await expect(
      client.request<{ ok: true }>({ method: "GET", path: "/me" })
    ).rejects.toBeInstanceOf(GraphNetworkError);
  });

  test("rejects request paths with traversal and encoded dot-segments", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });

    const cases = ["/../me", "/%2e%2e/me", "/%252e%252e/me"];
    for (const path of cases) {
      let thrown: unknown;
      try {
        await client.request<{ ok: true }>({ method: "GET", path });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect((thrown as Error).message).toContain("Invalid Graph request path");
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects query and fragment injection in request paths", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });

    const cases = ["/me?fields=id", "/me#fragment"];
    for (const path of cases) {
      let thrown: unknown;
      try {
        await client.request<{ ok: true }>({ method: "GET", path });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect((thrown as Error).message).toContain("Invalid Graph request path");
    }
    expect(handle.requests.length).toBe(0);
  });

  test("classifies JSON serialization failures separately from network errors", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    let thrown: unknown;
    try {
      await client.request<{ ok: true }>({
        method: "POST",
        path: "/me/messages",
        body: circular
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown).not.toBeInstanceOf(GraphNetworkError);
    expect(thrown).toBeInstanceOf(GraphSerializationError);
    expect((thrown as Error).message).toContain("serialize request body");
    expect(handle.requests.length).toBe(0);
  });

  test("throws GraphSerializationError for 2xx responses with invalid JSON", async () => {
    const { client } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: "{"
    });

    await expect(
      client.request<{ ok: true }>({ method: "GET", path: "/me" })
    ).rejects.toBeInstanceOf(GraphSerializationError);
  });

  test("messages endpoint scaffold sends WhatsApp payload via request helper", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.HBgM" }]
      }
    });

    const response = await client.messages.sendMessage({
      phoneNumberId: "123",
      to: "15551230000",
      text: "hello"
    });

    const typedResponse: GraphMessagesSendResponse = response;
    expect(typedResponse.messages?.[0]?.id).toBe("wamid.HBgM");

    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/123/messages"
    );

    const requestBody = JSON.parse(String(handle.requests[0]?.body)) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string };
    };

    expect(requestBody.messaging_product).toBe("whatsapp");
    expect(requestBody.to).toBe("15551230000");
    expect(requestBody.type).toBe("text");
    expect(requestBody.text.body).toBe("hello");
  });

  test("messages endpoint rejects invalid phoneNumberId path segments", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "should-not-send" }
    });

    let thrown: unknown;
    try {
      await client.messages.sendMessage({
        phoneNumberId: "../123?debug=true",
        to: "15551230000",
        text: "hello"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphApiError);
    expect((thrown as GraphApiError).message).toContain("Invalid phoneNumberId");
    expect(handle.requests.length).toBe(0);
  });

  test("does not auto-throw Graph envelope-shaped payloads on 2xx responses", async () => {
    const { client } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "Embedded error-like object in successful payload",
          type: "OAuthException",
          code: 190
        },
        ok: true
      }
    });

    const response = await client.request<{
      ok: boolean;
      error: { message: string };
    }>({
      method: "GET",
      path: "/me"
    });

    expect(response.ok).toBe(true);
    expect(response.error.message).toBe(
      "Embedded error-like object in successful payload"
    );
  });

  test("maps non-2xx non-envelope payloads to generic GraphApiError without auth subclassing", async () => {
    const { client } = clientWith({
      status: 500,
      headers: { "content-type": "application/json" },
      body: { code: 190, detail: "non-graph arbitrary object" }
    });

    let thrown: unknown;
    try {
      await client.request<{ ok: true }>({ method: "GET", path: "/me" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    // F-5 sibling assertion: generic non-envelope 5xx is not rate-limit.
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
    const graphError = thrown as GraphApiError;
    expect(graphError.message).toBe("Graph API request failed with status 500");
    expect(graphError.payload).toBeUndefined();
  });

  test("non-envelope non-2xx payloads with code 190 remain base GraphApiError", async () => {
    const { client } = clientWith({
      status: 500,
      headers: { "content-type": "application/json" },
      body: { message: "non-envelope fallback payload", code: 190 }
    });

    let thrown: unknown;
    try {
      await client.request<{ ok: true }>({ method: "GET", path: "/me" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect((thrown as Error).name).toBe("GraphApiError");
  });
});

describe("F-4 GraphClient construction-time validation", () => {
  function build(overrides: Partial<{
    accessToken: unknown;
    apiVersion: unknown;
    baseUrl: unknown;
  }> = {}): () => GraphClient {
    const base = {
      accessToken: "test-token",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com"
    };
    const merged = { ...base, ...overrides };
    return () =>
      new GraphClient(merged as unknown as {
        accessToken: string;
        apiVersion: string;
        baseUrl: string;
      });
  }

  test("rejects empty accessToken", () => {
    expect(build({ accessToken: "" })).toThrow(GraphRequestValidationError);
  });

  test("rejects non-string accessToken", () => {
    expect(build({ accessToken: 42 })).toThrow(GraphRequestValidationError);
    expect(build({ accessToken: null })).toThrow(GraphRequestValidationError);
    expect(build({ accessToken: undefined })).toThrow(GraphRequestValidationError);
  });

  test("rejects CR/LF/NUL in accessToken", () => {
    expect(build({ accessToken: "foo\r" })).toThrow(GraphRequestValidationError);
    expect(build({ accessToken: "foo\n" })).toThrow(GraphRequestValidationError);
    expect(build({ accessToken: "foo\u0000" })).toThrow(GraphRequestValidationError);
  });

  test("rejects oversized accessToken", () => {
    expect(build({ accessToken: "a".repeat(4097) })).toThrow(GraphRequestValidationError);
  });

  test("rejects invalid apiVersion shape", () => {
    for (const v of [
      "",
      "20.0",
      "v",
      "v25.0/foo",
      "v25.0?x=1",
      "v25.0#frag",
      "v..20",
      "v25.0\n"
    ]) {
      expect(build({ apiVersion: v }), `apiVersion ${JSON.stringify(v)}`)
        .toThrow(GraphRequestValidationError);
    }
  });

  test("accepts canonical apiVersion shapes", () => {
    expect(build({ apiVersion: "v20" })).not.toThrow();
    expect(build({ apiVersion: "v25.0" })).not.toThrow();
    expect(build({ apiVersion: "v1.2" })).not.toThrow();
  });

  test("rejects invalid baseUrl", () => {
    expect(build({ baseUrl: "not a url" })).toThrow(GraphRequestValidationError);
    expect(build({ baseUrl: "" })).toThrow(GraphRequestValidationError);
    expect(build({ baseUrl: 42 })).toThrow(GraphRequestValidationError);
  });

  test("preserves baseUrl pathname prefix in request URL", async () => {
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
      baseUrl: "https://proxy.example.com/api",
      transport: handle.transport
    });
    await client.request({ method: "GET", path: "/me" });
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]?.url).toBe(
      "https://proxy.example.com/api/v25.0/me"
    );
  });

  test("preserves multi-segment baseUrl pathname prefix", async () => {
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
      baseUrl: "https://proxy.example.com/tenant/42/graph/",
      transport: handle.transport
    });
    await client.request({ method: "GET", path: "/me" });
    expect(handle.requests[0]?.url).toBe(
      "https://proxy.example.com/tenant/42/graph/v25.0/me"
    );
  });

  test("DEFAULT_GRAPH_BASE_URL is exported and points at graph.facebook.com", () => {
    expect(typeof DEFAULT_GRAPH_BASE_URL).toBe("string");
    expect(DEFAULT_GRAPH_BASE_URL.startsWith("https://graph.facebook.com")).toBe(true);
  });
});

describe("F-4 scrubErrorCause", () => {
  test("redacts Bearer tokens in Error messages", () => {
    const err = new Error("Request failed with header Authorization: Bearer TOKENxxxyyy");
    const scrubbed = scrubErrorCause(err) as Error;
    expect(scrubbed).toBeInstanceOf(Error);
    expect(scrubbed.message).toContain("Bearer ***");
    expect(scrubbed.message).not.toContain("TOKENxxxyyy");
  });

  test("redacts Bearer tokens in cause chains", () => {
    const inner = new Error("auth failed: Bearer SECRET_TOKEN_1");
    const outer = new Error("Request failed");
    (outer as Error & { cause?: unknown }).cause = inner;

    const scrubbed = scrubErrorCause(outer) as Error & { cause?: Error };
    expect(scrubbed.cause).toBeDefined();
    expect((scrubbed.cause as Error).message).toContain("Bearer ***");
    expect((scrubbed.cause as Error).message).not.toContain("SECRET_TOKEN_1");
  });

  test("redacts Bearer tokens in string inputs", () => {
    const scrubbed = scrubErrorCause(
      "Authorization: Bearer TOKENxxxyyy at line 1"
    ) as string;
    expect(typeof scrubbed).toBe("string");
    expect(scrubbed).toContain("Bearer ***");
    expect(scrubbed).not.toContain("TOKENxxxyyy");
  });

  test("returns non-Error/non-string inputs unchanged", () => {
    expect(scrubErrorCause(null)).toBe(null);
    expect(scrubErrorCause(undefined)).toBe(undefined);
    expect(scrubErrorCause(42)).toBe(42);
  });
});

describe("F-4 remediation: baseUrl protocol allowlist", () => {
  function buildWithBaseUrl(baseUrl: string): () => GraphClient {
    return () =>
      new GraphClient({
        accessToken: "t",
        apiVersion: "v25.0",
        baseUrl
      });
  }

  test("rejects non-http(s) schemes", () => {
    const forbidden = [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://a",
      "data:,x",
      "about:blank",
      "blob:http://a/"
    ];
    for (const url of forbidden) {
      let thrown: unknown;
      try {
        buildWithBaseUrl(url)();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `baseUrl ${JSON.stringify(url)}`).toBeInstanceOf(
        GraphRequestValidationError
      );
      expect((thrown as Error).message).toContain("protocol");
    }
  });

  test("accepts http: and https: URLs including proxy pathnames", () => {
    expect(buildWithBaseUrl("http://localhost")).not.toThrow();
    expect(buildWithBaseUrl("https://graph.facebook.com")).not.toThrow();
    expect(buildWithBaseUrl("https://proxy.example.com/api")).not.toThrow();
  });

  test("rejects whitespace-only accessToken", () => {
    expect(
      () =>
        new GraphClient({
          accessToken: "   ",
          apiVersion: "v25.0",
          baseUrl: "https://graph.facebook.com"
        })
    ).toThrow(GraphRequestValidationError);
    expect(
      () =>
        new GraphClient({
          accessToken: "\t\t",
          apiVersion: "v25.0",
          baseUrl: "https://graph.facebook.com"
        })
    ).toThrow(GraphRequestValidationError);
  });
});

describe("F-4 remediation: CRLF in custom header values and names", () => {
  test("rejects CR/LF/NUL in header values with typed error", async () => {
    const injections = [
      "a\rX-Evil: y",
      "a\nX-Evil: y",
      "a\r\nX-Evil: y",
      "a\n\rX-Evil: y",
      "a\u0000b"
    ];

    for (const value of injections) {
      const { client, handle } = clientWith({
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true }
      });
      let thrown: unknown;
      try {
        await client.request<{ ok: true }>({
          method: "GET",
          path: "/me",
          headers: { "x-custom": value }
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `value ${JSON.stringify(value)}`).toBeInstanceOf(
        GraphRequestValidationError
      );
      expect(handle.requests.length).toBe(0);
    }
  });

  test("rejects CRLF in header names with typed error", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    let thrown: unknown;
    try {
      await client.request<{ ok: true }>({
        method: "GET",
        path: "/me",
        headers: { "x-bad\r\nX-Injected": "value" }
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects caller-supplied Authorization header override", async () => {
    for (const name of ["authorization", "Authorization", "AUTHORIZATION"]) {
      const { client, handle } = clientWith({
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true }
      });
      let thrown: unknown;
      try {
        await client.request<{ ok: true }>({
          method: "GET",
          path: "/me",
          headers: { [name]: "Bearer evil" }
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `name ${name}`).toBeInstanceOf(
        GraphRequestValidationError
      );
      expect((thrown as Error).message.toLowerCase()).toContain("authorization");
      expect(handle.requests.length).toBe(0);
    }
  });
});

describe("WATS-37 GraphClient.requestRaw validation", () => {
  test("sends an absolute raw URL with managed Bearer auth and no API-version prefix", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3])
    });

    const response = await client.requestRaw({
      method: "GET",
      url: "https://lookaside.example.test/media/abc?token=resolved"
    });

    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toEqual(
      new Uint8Array([1, 2, 3]).buffer
    );
    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.url).toBe("https://lookaside.example.test/media/abc?token=resolved");
    expect(rec?.url).not.toContain("/v25.0/");
    expect(rec?.method).toBe("GET");
    expect(rec?.headers.get("authorization")).toBe("Bearer test-token");
  });

  test("rejects non-object requestRaw options before transport with typed validation errors", async () => {
    for (const options of [undefined, null, "", "GET", 42, true, []]) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestRawValidationError(
        client,
        handle,
        options,
        `options ${JSON.stringify(options)}`
      );
    }
  });

  test("rejects non-string empty whitespace control-char and unsupported raw methods", async () => {
    const badMethods: unknown[] = [
      undefined,
      null,
      42,
      true,
      {},
      [],
      "",
      "   ",
      "\t",
      "GET\n",
      "PO\rST",
      "CONNECT",
      "HEAD",
      "OPTIONS"
    ];

    for (const method of badMethods) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestRawValidationError(
        client,
        handle,
        { method, url: "https://lookaside.example.test/media/abc" },
        `method ${JSON.stringify(method)}`
      );
    }
  });

  test("rejects malformed raw URLs including relative values schemes and controls", async () => {
    const badUrls: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "   ",
      "/media/abc",
      "media/abc",
      "not a url",
      "ftp://example.test/media",
      "file:///etc/passwd",
      "data:,x",
      "javascript:alert(1)",
      "https://example.test/media\nX-Evil: y",
      "https://example.test/media\u0000x"
    ];

    for (const url of badUrls) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestRawValidationError(
        client,
        handle,
        { method: "GET", url },
        `url ${JSON.stringify(url)}`
      );
    }
  });

  test("rejects requestRaw Authorization overrides before transport", async () => {
    const cases: HeadersInit[] = [
      { authorization: "Bearer evil" },
      { Authorization: "Bearer evil" },
      [["AUTHORIZATION", "Bearer evil"]],
      new Headers({ authorization: "Bearer evil" })
    ];

    for (const headers of cases) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestRawValidationError(
        client,
        handle,
        {
          method: "GET",
          url: "https://lookaside.example.test/media/abc",
          headers
        },
        "authorization override"
      );
    }
  });

  test("rejects requestRaw CR/LF/NUL header injection with typed validation errors", async () => {
    const cases: HeadersInit[] = [
      { "x-custom": "a\rX-Evil: y" },
      { "x-custom": "a\nX-Evil: y" },
      { "x-custom": "a\u0000b" },
      { "x-bad\r\nX-Injected": "value" }
    ];

    for (const headers of cases) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestRawValidationError(
        client,
        handle,
        {
          method: "GET",
          url: "https://lookaside.example.test/media/abc",
          headers
        },
        "header injection"
      );
    }
  });

  test("rejects fake requestRaw AbortSignal-like objects before transport", async () => {
    const fakeSignals: unknown[] = [
      { aborted: false },
      { aborted: "false", addEventListener() {}, removeEventListener() {} },
      { aborted: false, addEventListener() {} },
      { aborted: false, removeEventListener() {} }
    ];

    for (const signal of fakeSignals) {
      const { client, handle } = clientWith({ status: 200, body: { ok: true } });
      await expectRequestRawValidationError(
        client,
        handle,
        {
          method: "GET",
          url: "https://lookaside.example.test/media/abc",
          signal
        },
        "fake signal"
      );
    }
  });

  test("passes requestRaw BodyInit bodies through by identity and JSON-serializes object bodies", async () => {
    const uint8Body = new Uint8Array([4, 5, 6]);
    const dataViewBody = new DataView(new Uint8Array([7, 8, 9]).buffer);
    const arrayBufferBody = new Uint8Array([10, 11]).buffer;
    const paramsBody = new URLSearchParams({ a: "1" });
    const blobBody = new Blob(["blob"]);
    const formBody = new FormData();
    formBody.set("field", "value");
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([12]));
        controller.close();
      }
    });
    const objectBody = { ok: true };

    const bodies: Array<{
      readonly name: string;
      readonly body: unknown;
      readonly expected: (actual: BodyInit | null) => void;
    }> = [
      { name: "null", body: null, expected: (actual) => expect(actual).toBeNull() },
      { name: "undefined", body: undefined, expected: (actual) => expect(actual).toBeNull() },
      { name: "string", body: "raw", expected: (actual) => expect(actual).toBe("raw") },
      {
        name: "Uint8Array",
        body: uint8Body,
        expected: (actual) => expect(actual).toBe(uint8Body)
      },
      {
        name: "DataView",
        body: dataViewBody,
        expected: (actual) => expect(actual).toBe(dataViewBody)
      },
      {
        name: "ArrayBuffer",
        body: arrayBufferBody,
        expected: (actual) => expect(actual).toBe(arrayBufferBody)
      },
      {
        name: "URLSearchParams",
        body: paramsBody,
        expected: (actual) => expect(actual).toBe(paramsBody)
      },
      {
        name: "Blob",
        body: blobBody,
        expected: (actual) => expect(actual).toBe(blobBody)
      },
      {
        name: "FormData",
        body: formBody,
        expected: (actual) => expect(actual).toBe(formBody)
      },
      {
        name: "ReadableStream",
        body: streamBody,
        expected: (actual) => expect(actual).toBe(streamBody)
      },
      {
        name: "object",
        body: objectBody,
        expected: (actual) => expect(actual).toBe(JSON.stringify(objectBody))
      }
    ];

    for (const { name, body, expected } of bodies) {
      const { client, handle } = clientWith({ status: 204, body: null });
      await client.requestRaw({
        method: "POST",
        url: "https://lookaside.example.test/upload",
        body
      });
      expect(handle.requests.length, name).toBe(1);
      expected(handle.requests[0]?.body ?? null);
    }
  });
});

describe("F-4 remediation: ReadableStream body passthrough", () => {
  test("passes ReadableStream body through by identity without JSON serialization", async () => {
    const { client, handle } = clientWith({
      status: 204,
      headers: { "content-type": "application/octet-stream" },
      // Use a pre-encoded response body so MockTransport does not itself
      // invoke JSON.stringify when buffering the response. This keeps the
      // stringify spy scoped to request-body handling only.
      body: new Uint8Array(0)
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      }
    });

    const origStringify = JSON.stringify;
    let stringifyCalled = 0;
    (JSON as unknown as { stringify: typeof JSON.stringify }).stringify = ((
      ...args: Parameters<typeof JSON.stringify>
    ) => {
      stringifyCalled += 1;
      return origStringify(...args);
    }) as typeof JSON.stringify;

    try {
      await client.request<{ ok: true }>({
        method: "POST",
        path: "/123/messages",
        body: stream,
        headers: { "content-type": "application/octet-stream" }
      });
    } finally {
      (JSON as unknown as { stringify: typeof JSON.stringify }).stringify =
        origStringify;
    }

    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.body).toBe(stream);
    expect(rec?.headers.get("content-type")).toBe("application/octet-stream");
    expect(stringifyCalled).toBe(0);
  });

  test("defaults content-type to application/octet-stream for ReadableStream when caller omits one", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });

    await client.request<{ ok: true }>({
      method: "POST",
      path: "/123/messages",
      body: stream
    });

    const rec = handle.requests[0];
    expect(rec?.body).toBe(stream);
    expect(rec?.headers.get("content-type")).toBe("application/octet-stream");
  });
});

describe("F-4 remediation: messages endpoint typed validation error", () => {
  test("invalid phoneNumberId throws GraphRequestValidationError (subclass)", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "should-not-send" }
    });

    let thrown: unknown;
    try {
      await client.messages.sendMessage({
        phoneNumberId: "../123?debug=true",
        to: "15551230000",
        text: "hello"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect((thrown as Error).message).toContain("Invalid phoneNumberId");
    expect(handle.requests.length).toBe(0);
  });
});
