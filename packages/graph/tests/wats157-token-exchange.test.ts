// WATS-157C — Embedded Signup code→business-token exchange helper.
//
// Tests are credential-free and use MockTransport only. clientSecret, code,
// and access_token-like strings are treated as secrets; validation errors must
// never echo them.

import { describe, expect, test } from "bun:test";
import {
  exchangeBusinessAccessToken,
  GraphClient,
  GraphRequestValidationError,
  type BusinessAccessTokenResponse
} from "../src";
import { createMockTransport, type MockTransportResponseSpec } from "../src/createMockTransport";

function clientWith(response: MockTransportResponseSpec = { status: 200, headers: { "content-type": "application/json" }, body: { access_token: "EAA_TEST_TOKEN", token_type: "bearer", expires_in: 3600 } }) {
  const handle = createMockTransport({ defaultResponse: response });
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "service-token",
    transport: handle.transport
  });
  return { client, handle };
}

function query(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("WATS-157C exchangeBusinessAccessToken", () => {
  test("GET /oauth/access_token maps camelCase params to Graph query and parses response", async () => {
    const { client, handle } = clientWith();

    const res: BusinessAccessTokenResponse = await exchangeBusinessAccessToken(client, {
      clientId: "1234567890",
      clientSecret: "app-secret-value",
      code: "embedded-signup-code"
    });

    expect(res.access_token).toBe("EAA_TEST_TOKEN");
    expect(res.token_type).toBe("bearer");
    expect(res.expires_in).toBe(3600);
    expect(handle.requests.length).toBe(1);
    const req = handle.requests[0]!;
    expect(req.method).toBe("GET");
    expect(req.url.startsWith("https://graph.facebook.com/v25.0/oauth/access_token?")).toBe(true);
    expect(query(req.url).get("client_id")).toBe("1234567890");
    expect(query(req.url).get("client_secret")).toBe("app-secret-value");
    expect(query(req.url).get("code")).toBe("embedded-signup-code");
    expect(req.body).toBeNull();
  });

  test("rejects a body argument before transport", async () => {
    const { client, handle } = clientWith();
    await expect(
      exchangeBusinessAccessToken(
        client,
        { clientId: "123", clientSecret: "secret", code: "code" },
        {} as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("validates all required params without echoing secret values", async () => {
    const { client, handle } = clientWith();
    const secret = "secret-value-that-must-not-leak";
    const code = "code-value-that-must-not-leak";
    const cases: Array<[string, unknown, string]> = [
      ["clientId", "", "123"],
      ["clientId", "   ", "123"],
      ["clientId", 123, "123"],
      ["clientId", "a\n", "123"],
      ["clientSecret", "", secret],
      ["clientSecret", "   ", secret],
      ["clientSecret", 123, secret],
      ["clientSecret", "bad\rsecret", secret],
      ["clientSecret", "bad\0secret", secret],
      ["code", "", code],
      ["code", "   ", code],
      ["code", 123, code],
      ["code", "bad\ncode", code]
    ];

    for (const [field, bad, leak] of cases) {
      const input: Record<string, unknown> = {
        clientId: "1234567890",
        clientSecret: secret,
        code
      };
      input[field] = bad;
      let thrown: unknown;
      try {
        await exchangeBusinessAccessToken(client, input as never);
      } catch (error) {
        thrown = error;
      }
      const err = thrown as Error;
      expect(err).toBeInstanceOf(GraphRequestValidationError);
      expect(err.message).toContain(field);
      expect(err.message).not.toContain(leak);
      expect(err.message).not.toContain(secret);
      expect(err.message).not.toContain(code);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("rejects oversize values before transport without echoing them", async () => {
    const { client, handle } = clientWith();
    const hugeClientId = "1".repeat(65);
    const hugeSecret = "s".repeat(4097);
    const hugeCode = "c".repeat(4097);

    for (const input of [
      { clientId: hugeClientId, clientSecret: "secret", code: "code" },
      { clientId: "123", clientSecret: hugeSecret, code: "code" },
      { clientId: "123", clientSecret: "secret", code: hugeCode }
    ] as const) {
      let thrown: unknown;
      try {
        await exchangeBusinessAccessToken(client, input);
      } catch (error) {
        thrown = error;
      }
      const err = thrown as Error;
      expect(err).toBeInstanceOf(GraphRequestValidationError);
      expect(err.message).not.toContain(hugeClientId);
      expect(err.message).not.toContain(hugeSecret);
      expect(err.message).not.toContain(hugeCode);
    }

    expect(handle.requests.length).toBe(0);
  });

  test("rejects accessor-backed params and malformed options without host TypeError", async () => {
    const { client, handle } = clientWith();
    const accessor = { clientId: "123", clientSecret: "secret" } as Record<string, unknown>;
    Object.defineProperty(accessor, "code", {
      enumerable: true,
      get() {
        throw new TypeError("code getter should not run");
      }
    });

    await expect(exchangeBusinessAccessToken(client, accessor as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(
      exchangeBusinessAccessToken(
        client,
        { clientId: "123", clientSecret: "secret", code: "code" },
        undefined,
        { headers: { get authorization() { throw new TypeError("header getter should not run"); } } } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("GraphClient rejects authorization override on options headers", async () => {
    const { client, handle } = clientWith();
    await expect(
      exchangeBusinessAccessToken(
        client,
        { clientId: "123", clientSecret: "secret", code: "code" },
        undefined,
        { headers: { authorization: "Bearer attacker" } }
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});
