import { describe, expect, test } from "bun:test";
import {
  clearWabaCallbackOverride,
  GraphClient,
  GraphRequestValidationError,
  setWabaCallbackOverride,
  WABAClient
} from "../src";
import { createMockTransport, type MockTransportResponseSpec } from "../src/createMockTransport";

function clientWith(response: MockTransportResponseSpec = { status: 200, headers: { "content-type": "application/json" }, body: { success: true } }) {
  const handle = createMockTransport({ defaultResponse: response });
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function parseBody(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

const unsafeIds = [null, undefined, "", "   ", 123, {}, [], "bad\n", ".", "..", "a/b", "a\\b", "a?b", "a#b", "%2e%2e", "%252f"] as const;

describe("WATS-157B WABA callback override", () => {
  test("setWabaCallbackOverride POSTs override_callback_uri and verify_token JSON body", async () => {
    const { client, handle } = clientWith();
    await setWabaCallbackOverride(client, {
      wabaId: "waba-1",
      overrideCallbackUri: "https://example.com/webhook",
      verifyToken: "verify-secret"
    });

    expect(handle.requests.length).toBe(1);
    const req = handle.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://graph.facebook.com/v25.0/waba-1/subscribed_apps");
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(parseBody(req.body)).toEqual({
      override_callback_uri: "https://example.com/webhook",
      verify_token: "verify-secret"
    });
  });

  test("clearWabaCallbackOverride POSTs the same edge with no body", async () => {
    const { client, handle } = clientWith();
    await clearWabaCallbackOverride(client, { wabaId: "waba-1" });

    expect(handle.requests.length).toBe(1);
    const req = handle.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://graph.facebook.com/v25.0/waba-1/subscribed_apps");
    expect(req.body).toBeNull();
  });

  test("WABAClient methods inject the bound wabaId and ignore caller overrides", async () => {
    const { client, handle } = clientWith();
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });

    await waba.setCallbackOverride({
      wabaId: "ATTACKER",
      overrideCallbackUri: "https://example.com/webhook",
      verifyToken: "verify-secret"
    } as never);
    await waba.clearCallbackOverride({ wabaId: "ATTACKER" } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/BOUND-WABA/subscribed_apps",
      "POST https://graph.facebook.com/v25.0/BOUND-WABA/subscribed_apps"
    ]);
  });

  test("rejects unsafe wabaId values before transport", async () => {
    const { client, handle } = clientWith();
    for (const bad of unsafeIds) {
      await expect(setWabaCallbackOverride(client, {
        wabaId: bad as never,
        overrideCallbackUri: "https://example.com/webhook",
        verifyToken: "verify-secret"
      } as never)).rejects.toThrow(GraphRequestValidationError);
      await expect(clearWabaCallbackOverride(client, { wabaId: bad as never } as never)).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("requires https override URL and rejects malformed URLs before transport", async () => {
    const { client, handle } = clientWith();
    for (const bad of ["", "   ", "http://example.com/webhook", "ftp://example.com", "not-a-url", "https://bad\n.example"] as const) {
      await expect(setWabaCallbackOverride(client, {
        wabaId: "waba-1",
        overrideCallbackUri: bad,
        verifyToken: "verify-secret"
      })).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("verifyToken validation never echoes the raw token", async () => {
    const { client, handle } = clientWith();
    const token = "secret-token-that-must-not-leak";
    for (const bad of ["", "   ", 123, `${token}\n`, `${token}\0`, "x".repeat(257)] as const) {
      let thrown: unknown;
      try {
        await setWabaCallbackOverride(client, {
          wabaId: "waba-1",
          overrideCallbackUri: "https://example.com/webhook",
          verifyToken: bad as never
        });
      } catch (error) {
        thrown = error;
      }
      const err = thrown as Error;
      expect(err).toBeInstanceOf(GraphRequestValidationError);
      expect(err.message).toContain("verifyToken");
      expect(err.message).not.toContain(token);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects accessor-backed params and header overrides before transport", async () => {
    const { client, handle } = clientWith();
    const accessor = { wabaId: "waba-1", overrideCallbackUri: "https://example.com/webhook" } as Record<string, unknown>;
    Object.defineProperty(accessor, "verifyToken", {
      enumerable: true,
      get() {
        throw new TypeError("verifyToken getter should not run");
      }
    });

    await expect(setWabaCallbackOverride(client, accessor as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(setWabaCallbackOverride(client, {
      wabaId: "waba-1",
      overrideCallbackUri: "https://example.com/webhook",
      verifyToken: "verify-secret"
    }, undefined, { headers: { authorization: "Bearer attacker" } })).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});
