// F-7 WABAClient tests (WATS-19 / Arch-E) — RED.
//
// Parallels phoneNumberClient.test.ts: constructor validation (parallel
// rules), listPhoneNumbers round-trip through MockTransport, and F-5
// registry error-classification with sibling-NOT assertions.

import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRateLimitError,
  GraphRequestValidationError,
  WABAClient,
  listPhoneNumbers
} from "../src";
import {
  ExpiredAccessTokenError,
  InvalidParameterError
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

describe("F-7 WABAClient construction validation", () => {
  test("rejects non-object config", () => {
    expect(
      () => new WABAClient(null as unknown as never)
    ).toThrow(GraphRequestValidationError);
    expect(
      () => new WABAClient(undefined as unknown as never)
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects graphClient without .request()", () => {
    expect(
      () =>
        new WABAClient({
          graphClient: {} as unknown as GraphClient,
          wabaId: "555"
        })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects missing / non-string wabaId", () => {
    const { client } = clientWith({ status: 200, body: {} });
    expect(
      () =>
        new WABAClient({ graphClient: client } as unknown as never)
    ).toThrow(GraphRequestValidationError);
    expect(
      () =>
        new WABAClient({
          graphClient: client,
          wabaId: 42 as unknown as string
        })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects empty / whitespace-only wabaId", () => {
    const { client } = clientWith({ status: 200, body: {} });
    expect(
      () => new WABAClient({ graphClient: client, wabaId: "" })
    ).toThrow(GraphRequestValidationError);
    expect(
      () => new WABAClient({ graphClient: client, wabaId: "   " })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects wabaId with control / CR / LF / NUL chars", () => {
    const { client } = clientWith({ status: 200, body: {} });
    for (const bad of ["5\r", "5\n", "5\u0000", "5\u0007"]) {
      expect(
        () => new WABAClient({ graphClient: client, wabaId: bad })
      ).toThrow(GraphRequestValidationError);
    }
  });

  test("rejects wabaId containing slashes or traversal dots", () => {
    const { client } = clientWith({ status: 200, body: {} });
    for (const bad of ["a/b", "..", ".", "a\\b", "?q", "#f"]) {
      expect(
        () => new WABAClient({ graphClient: client, wabaId: bad })
      ).toThrow(GraphRequestValidationError);
    }
  });

  test("valid wabaId exposes accessors", () => {
    const { client } = clientWith({ status: 200, body: {} });
    const waba = new WABAClient({
      graphClient: client,
      wabaId: "1234567890"
    });
    expect(waba.wabaId).toBe("1234567890");
    expect(waba.graphClient).toBe(client);
  });
});

describe("F-7 WABAClient.listPhoneNumbers round-trip", () => {
  test("GETs /{wabaId}/phone_numbers and parses response", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        data: [
          { id: "111", display_phone_number: "+1 555 0000" },
          { id: "222", display_phone_number: "+1 555 1111" }
        ]
      }
    });
    const waba = new WABAClient({
      graphClient: client,
      wabaId: "999"
    });
    const res = await waba.listPhoneNumbers();
    expect(res.data?.length).toBe(2);
    expect(res.data?.[0]?.id).toBe("111");
    const rec = handle.requests[0];
    expect(rec?.method).toBe("GET");
    expect(rec?.url).toBe(
      "https://graph.facebook.com/v20.0/999/phone_numbers"
    );
    expect(rec?.headers.get("authorization")).toBe("Bearer test-token");
  });

  test("direct listPhoneNumbers callable and WABAClient method produce identical requests", async () => {
    const { client: c1, handle: h1 } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { data: [] }
    });
    await listPhoneNumbers(c1, { wabaId: "999" });

    const { client: c2, handle: h2 } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { data: [] }
    });
    const waba = new WABAClient({
      graphClient: c2,
      wabaId: "999"
    });
    await waba.listPhoneNumbers();

    expect(h1.requests[0]?.url).toBe(h2.requests[0]?.url);
    expect(h1.requests[0]?.method).toBe(h2.requests[0]?.method);
  });

  test("401 + code 190 → ExpiredAccessTokenError (sibling-NOT InvalidParameterError/GraphRateLimitError)", async () => {
    const { client } = clientWith({
      status: 401,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "Error validating access token: session expired.",
          code: 190,
          type: "OAuthException"
        }
      }
    });
    const waba = new WABAClient({
      graphClient: client,
      wabaId: "999"
    });
    let thrown: unknown;
    try {
      await waba.listPhoneNumbers();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExpiredAccessTokenError);
    expect(thrown).toBeInstanceOf(GraphAuthError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(InvalidParameterError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("400 + code 100 → InvalidParameterError (sibling-NOT GraphAuthError)", async () => {
    const { client } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: {
        error: {
          message: "Invalid parameter",
          code: 100
        }
      }
    });
    const waba = new WABAClient({
      graphClient: client,
      wabaId: "999"
    });
    let thrown: unknown;
    try {
      await waba.listPhoneNumbers();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidParameterError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
  });
});

describe("WATS-61 WABAClient params validation utility migration", () => {
  test("rejects symbol-keyed optional params before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { data: [] } });
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const symbolKey = Symbol("hidden");
    const params = { limit: "5", [symbolKey]: "hidden" };

    let thrown: unknown;
    try {
      await waba.listPhoneNumbers(params as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(handle.requests.length).toBe(0);
  });

  test("wraps optional params proxy descriptor traps as GraphRequestValidationError before transport", async () => {
    const { client, handle } = clientWith({ status: 200, body: { data: [] } });
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const params = new Proxy({}, {
      ownKeys() {
        return ["limit"];
      },
      getOwnPropertyDescriptor() {
        throw new Error("waba params descriptor trap should be wrapped");
      }
    });

    let thrown: unknown;
    try {
      await waba.listPhoneNumbers(params as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as GraphRequestValidationError).cause).toBeInstanceOf(Error);
    expect(handle.requests.length).toBe(0);
  });

  test("continues to omit undefined params and preserve constructor-bound wabaId", async () => {
    const { client, handle } = clientWith({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { data: [] }
    });
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });

    await waba.listPhoneNumbers({ wabaId: "OVERRIDE", limit: undefined } as never);

    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v20.0/BOUND-WABA/phone_numbers");
  });
});
