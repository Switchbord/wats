// F-6 defineEndpoint — RED tests (WATS-18 / Arch-D).
//
// Covers: define-time validation (method/pathTemplate/params), call-time
// validation (missing/unknown params, path sanitization, query
// serialization, body passthrough/buildBody transformer, opts signal +
// headers), and integration with GraphClient.request via MockTransport
// including full request-shape assertion and error-registry routing.

import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRateLimitError,
  GraphRequestValidationError,
  defineEndpoint,
  type EndpointDefinition
} from "../src";
import {
  InvalidParameterError,
  UnsupportedMessageTypeError
} from "../src/errorSubclasses";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(
  responses: MockTransportResponseSpec[] | MockTransportResponseSpec
) {
  const handle = createMockTransport(
    Array.isArray(responses)
      ? { responses }
      : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v20.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

describe("F-6 defineEndpoint define-time validation", () => {
  test("rejects invalid HTTP method", () => {
    expect(() =>
      defineEndpoint({
        // @ts-expect-error — intentionally invalid method
        method: "TRACE",
        pathTemplate: "/foo",
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects empty pathTemplate", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "",
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects non-string pathTemplate", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        // @ts-expect-error — intentionally invalid
        pathTemplate: 123,
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects pathTemplate with control characters", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/foo\n/bar",
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects pathTemplate with empty placeholder {}", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/foo/{}",
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects pathTemplate with unbalanced placeholder {x", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/foo/{x",
        params: { x: { in: "path" } }
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects pathTemplate with stray closing brace x}", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/foo/x}/bar",
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects pathTemplate with duplicate placeholder names {x}{x}", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/{x}/{x}",
        params: { x: { in: "path" } }
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects placeholder name with invalid syntax", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/{1abc}",
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects placeholder without matching param declaration", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/{phoneNumberId}/messages",
        params: {}
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects path param declared but absent from template", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/messages",
        params: { phoneNumberId: { in: "path" } }
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects invalid param.in value", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/{x}",
        // @ts-expect-error — intentionally invalid
        params: { x: { in: "header" } }
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects non-function buildBody", () => {
    expect(() =>
      defineEndpoint({
        method: "POST",
        pathTemplate: "/foo",
        params: {},
        // @ts-expect-error — intentionally invalid
        buildBody: "not a function"
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects non-object params", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/foo",
        // @ts-expect-error — intentionally invalid
        params: null
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("accepts a well-formed definition and attaches it as `definition`", () => {
    const def: EndpointDefinition<
      { phoneNumberId: string },
      { hello: string },
      { id: string }
    > = {
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } },
      bodyContentType: "application/json"
    };
    const ep = defineEndpoint(def);
    expect(typeof ep).toBe("function");
    expect(ep.definition.method).toBe("POST");
    expect(ep.definition.pathTemplate).toBe("/{phoneNumberId}/messages");
  });
});

describe("F-6 defineEndpoint call-time validation", () => {
  test("rejects missing required path param", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      // @ts-expect-error — intentionally missing required param
      await ep(client, {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("rejects unknown param at call time", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        // @ts-expect-error — intentionally unknown param
        { phoneNumberId: "123", nope: "bad" }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("rejects non-string param value", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        // @ts-expect-error — intentionally wrong type
        { phoneNumberId: 123 }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("rejects path param value with control chars", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client, handle } = clientWith({
      status: 200,
      body: { ok: true }
    });
    let thrown: unknown;
    try {
      await ep(client, { phoneNumberId: "123\nbad" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects path param value containing slash (traversal)", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client, handle } = clientWith({
      status: 200,
      body: { ok: true }
    });
    let thrown: unknown;
    try {
      await ep(client, { phoneNumberId: "../evil" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects empty path param value", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(client, { phoneNumberId: "" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("query params are URL-encoded (spaces + special chars)", async () => {
    const ep = defineEndpoint<{ q: string }>({
      method: "GET",
      pathTemplate: "/search",
      params: { q: { in: "query", required: true } }
    });
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    await ep(client, { q: "hello world&x=1" });
    expect(handle.requests.length).toBe(1);
    const url = handle.requests[0]?.url ?? "";
    expect(url).toContain("q=hello+world%26x%3D1");
  });

  test("query param undefined values are skipped", async () => {
    const ep = defineEndpoint<{ after?: string }>({
      method: "GET",
      pathTemplate: "/feed",
      params: { after: { in: "query", required: false } }
    });
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    await ep(client, {});
    expect(handle.requests.length).toBe(1);
    const url = handle.requests[0]?.url ?? "";
    expect(url).toBe("https://graph.facebook.com/v20.0/feed");
  });

  test("query param with CR/LF rejected", async () => {
    const ep = defineEndpoint<{ q: string }>({
      method: "GET",
      pathTemplate: "/search",
      params: { q: { in: "query", required: true } }
    });
    const { client, handle } = clientWith({
      status: 200,
      body: { ok: true }
    });
    let thrown: unknown;
    try {
      await ep(client, { q: "hello\nworld" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("body object is passed through and JSON-serialized by client", async () => {
    const ep = defineEndpoint<
      { phoneNumberId: string },
      { a: number; b: string }
    >({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    await ep(client, { phoneNumberId: "123" }, { a: 1, b: "x" });
    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.method).toBe("POST");
    expect(rec?.url).toBe(
      "https://graph.facebook.com/v20.0/123/messages"
    );
    expect(rec?.headers.get("content-type")).toBe("application/json");
    expect(rec?.body).toBe(JSON.stringify({ a: 1, b: "x" }));
  });

  test("body Uint8Array passes through unchanged (no JSON re-encoding)", async () => {
    const ep = defineEndpoint<
      { phoneNumberId: string },
      Uint8Array
    >({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/media",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client, handle } = clientWith({
      status: 200,
      body: { ok: true }
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await ep(client, { phoneNumberId: "123" }, bytes);
    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    expect(rec?.body).toBeInstanceOf(Uint8Array);
    expect(rec?.headers.has("content-type")).toBe(false);
  });

  test("buildBody transformer is applied when provided", async () => {
    const ep = defineEndpoint<
      { phoneNumberId: string },
      { text: string },
      { id: string }
    >({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } },
      buildBody: (body) => ({
        messaging_product: "whatsapp",
        type: "text",
        text: { body: body.text }
      })
    });
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "wamid.X" }
    });
    await ep(client, { phoneNumberId: "123" }, { text: "hi" });
    expect(handle.requests.length).toBe(1);
    const rec = handle.requests[0];
    const parsed = JSON.parse(String(rec?.body)) as {
      messaging_product: string;
      text: { body: string };
    };
    expect(parsed.messaging_product).toBe("whatsapp");
    expect(parsed.text.body).toBe("hi");
  });

  test("AbortSignal from opts propagates to transport", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const transport = {
      async request(
        _req: unknown,
        opts?: { signal?: AbortSignal }
      ): Promise<never> {
        seenSignal = opts?.signal;
        throw new Error("short-circuit");
      }
    };
    const client = new GraphClient({
      baseUrl: "https://graph.facebook.com",
      apiVersion: "v20.0",
      accessToken: "test-token",
      transport: transport as unknown as import("../src/transport").Transport
    });
    let thrown: unknown;
    try {
      await ep(
        client,
        { phoneNumberId: "123" },
        undefined,
        { signal: controller.signal }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeTruthy();
    expect(seenSignal).toBe(controller.signal);
  });

  test("opts.headers merged with managed Authorization guard", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        { phoneNumberId: "123" },
        undefined,
        { headers: { authorization: "Bearer override" } }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("opts.headers attach to the request", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    });
    await ep(
      client,
      { phoneNumberId: "123" },
      undefined,
      { headers: { "x-custom": "yes" } }
    );
    expect(handle.requests[0]?.headers.get("x-custom")).toBe("yes");
  });
});

describe("F-6 defineEndpoint integration with GraphClient + F-5 registry", () => {
  test("full request shape recorded (method, url, headers, body)", async () => {
    const ep = defineEndpoint<
      { phoneNumberId: string },
      { to: string },
      { id: string }
    >({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: "msg_1" }
    });
    const res = await ep(client, { phoneNumberId: "123" }, { to: "555" });
    expect(res.id).toBe("msg_1");
    const rec = handle.requests[0];
    expect(rec?.method).toBe("POST");
    expect(rec?.url).toBe(
      "https://graph.facebook.com/v20.0/123/messages"
    );
    expect(rec?.headers.get("authorization")).toBe("Bearer test-token");
    expect(rec?.headers.get("content-type")).toBe("application/json");
    expect(rec?.body).toBe(JSON.stringify({ to: "555" }));
  });

  test("error response surfaces as InvalidParameterError (sibling-class assertion)", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "Invalid parameter.",
          code: 100
        }
      }
    });
    let thrown: unknown;
    try {
      await ep(client, { phoneNumberId: "123" }, { foo: "bar" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidParameterError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    // sibling-class NOT assertions
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
    expect(thrown).not.toBeInstanceOf(UnsupportedMessageTypeError);
  });

  test("error response surfaces as UnsupportedMessageTypeError (sibling NOT InvalidParameterError)", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "POST",
      pathTemplate: "/{phoneNumberId}/messages",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "Unsupported message type.",
          code: 131051
        }
      }
    });
    let thrown: unknown;
    try {
      await ep(client, { phoneNumberId: "123" }, { foo: "bar" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnsupportedMessageTypeError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    // sibling-class NOT assertions
    expect(thrown).not.toBeInstanceOf(InvalidParameterError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
  });
});

describe("F-6 remediation", () => {
  // --- F6-L1: opts.headers taxonomy parity with client.request path ---

  test("opts.headers with LF in value → GraphRequestValidationError (not raw TypeError)", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        { phoneNumberId: "123" },
        undefined,
        { headers: { "x-inject": "a\r\nEvil: 1" } }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("opts.headers with NUL in value → GraphRequestValidationError", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        { phoneNumberId: "123" },
        undefined,
        { headers: { "x-inject": "with\u0000nul" } }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("opts.headers with bare CR → GraphRequestValidationError", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        { phoneNumberId: "123" },
        undefined,
        { headers: { "x-inject": "with\rcr" } }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("opts.headers authorization (lowercase) still rejected", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        { phoneNumberId: "123" },
        undefined,
        { headers: { authorization: "Bearer evil" } }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("opts.headers Authorization (capital A) still rejected", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    let thrown: unknown;
    try {
      await ep(
        client,
        { phoneNumberId: "123" },
        undefined,
        { headers: { Authorization: "Bearer X" } }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
  });

  test("endpoint and direct client.request produce same error taxonomy for identical invalid headers", async () => {
    const ep = defineEndpoint<{ phoneNumberId: string }>({
      method: "GET",
      pathTemplate: "/{phoneNumberId}",
      params: { phoneNumberId: { in: "path" } }
    });
    const { client } = clientWith({ status: 200, body: { ok: true } });
    const badHeaders = { "x-inject": "a\r\nEvil: 1" };

    let fromEndpoint: unknown;
    try {
      await ep(client, { phoneNumberId: "123" }, undefined, {
        headers: badHeaders
      });
    } catch (error) {
      fromEndpoint = error;
    }

    let fromDirect: unknown;
    try {
      await client.request({
        method: "GET",
        path: "/123",
        headers: badHeaders
      });
    } catch (error) {
      fromDirect = error;
    }

    expect(fromEndpoint).toBeInstanceOf(GraphRequestValidationError);
    expect(fromDirect).toBeInstanceOf(GraphRequestValidationError);
    // Identical error taxonomy — no raw TypeError leakage from the endpoint path.
    expect((fromEndpoint as Error).constructor).toBe(
      (fromDirect as Error).constructor
    );
  });

  // --- F6-L2: frozen definition contract ---

  test("sendMessage.definition is frozen (top-level)", async () => {
    const { sendMessage } = await import("../src/endpoints/messages");
    expect(Object.isFrozen(sendMessage.definition)).toBe(true);
  });

  test("sendMessage.definition.params is frozen", async () => {
    const { sendMessage } = await import("../src/endpoints/messages");
    expect(Object.isFrozen(sendMessage.definition.params)).toBe(true);
  });

  test("mutation of ep.definition.method is not retained", async () => {
    const { sendMessage } = await import("../src/endpoints/messages");
    const original = sendMessage.definition.method;
    try {
      // cast to mutable for the probe; frozen object should reject/ignore.
      (sendMessage.definition as unknown as { method: string }).method = "GET";
    } catch {
      // acceptable: strict-mode TypeError is fine
    }
    expect(sendMessage.definition.method).toBe(original);
  });

  test("defineEndpoint returns a frozen definition", () => {
    const ep = defineEndpoint({
      method: "GET",
      pathTemplate: "/{a}",
      params: { a: { in: "path" } }
    });
    expect(Object.isFrozen(ep.definition)).toBe(true);
    expect(Object.isFrozen(ep.definition.params)).toBe(true);
  });

  // --- Param-spec key name validation at define time ---

  test("rejects empty param-spec key name at define time", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/x",
        params: { "": { in: "query" } }
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects whitespace / invalid-identifier param-spec key at define time", () => {
    expect(() =>
      defineEndpoint({
        method: "GET",
        pathTemplate: "/x",
        params: { "bad name": { in: "query" } }
      })
    ).toThrow(GraphRequestValidationError);
  });
});
