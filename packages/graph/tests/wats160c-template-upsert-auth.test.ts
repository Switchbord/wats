// WATS-160C RED/GREEN behavioral tests for upsertAuthenticationTemplate.
// MockTransport only — no live calls.
//
// Covers: exact POST URL/body, COPY_CODE body, ONE_TAP supported_apps,
// rejection of unsupported otpType, ONE_TAP without supportedApps,
// text/autofillText on otpButton, bad languages, bad codeExpirationMinutes,
// messageSendTtlSeconds validation, descriptor-safe params/body (no host
// TypeError), no transport on bad input, response shape (data array with
// id/status/language and unknowns preserved), and WABAClient scoped method
// parity (bound wabaId wins).

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  WABAClient,
  upsertAuthenticationTemplate,
  type UpsertAuthenticationTemplateResponse
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(
  responses: MockTransportResponseSpec[] | MockTransportResponseSpec
) {
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

function ok(body: object = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): unknown {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

const COPY_CODE_BODY = {
  name: "auth_login",
  languages: ["en_US"],
  otpButton: { otpType: "COPY_CODE" as const }
};

// ---------------------------------------------------------------------------

describe("WATS-160C upsertAuthenticationTemplate — request contract", () => {
  test("POST /{wabaId}/upsert_message_templates with COPY_CODE JSON body", async () => {
    const { client, handle } = clientWith(
      ok({
        data: [
          { id: "tpl1", status: "PENDING", language: "en_US" }
        ]
      })
    );

    const res: UpsertAuthenticationTemplateResponse =
      await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        name: "auth_login",
        languages: ["en_US"],
        otpButton: { otpType: "COPY_CODE" }
      });

    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/WABA-1/upsert_message_templates"
    );
    expect(handle.requests[0]?.headers.get("content-type")).toBe(
      "application/json"
    );
    // COPY_CODE body: BODY + BUTTONS with OTP button, no supported_apps,
    // no FOOTER (codeExpirationMinutes absent), no add_security_recommendation.
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "auth_login",
      languages: ["en_US"],
      category: "AUTHENTICATION",
      components: [
        { type: "BODY" },
        {
          type: "BUTTONS",
          buttons: [{ type: "OTP", otp_type: "COPY_CODE" }]
        }
      ]
    });

    expect(res.data).toEqual([
      { id: "tpl1", status: "PENDING", language: "en_US" }
    ]);
  });

  test("full COPY_CODE body with all optional fields mapped to Graph wire", async () => {
    const { client, handle } = clientWith(ok());
    await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
      name: "auth_login",
      languages: ["en_US", "es_ES"],
      otpButton: { otpType: "COPY_CODE" },
      addSecurityRecommendation: true,
      codeExpirationMinutes: 10,
      messageSendTtlSeconds: 3600
    });
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "auth_login",
      languages: ["en_US", "es_ES"],
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        {
          type: "BUTTONS",
          buttons: [{ type: "OTP", otp_type: "COPY_CODE" }]
        }
      ],
      message_send_ttl_seconds: 3600
    });
  });

  test("ONE_TAP maps supportedApps to supported_apps with package_name/signature_hash", async () => {
    const { client, handle } = clientWith(ok());
    await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
      name: "auth_otp",
      languages: ["en_US"],
      otpButton: {
        otpType: "ONE_TAP",
        supportedApps: [
          { packageName: "com.example.app", signatureHash: "abc123sig" }
        ]
      }
    });
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "auth_otp",
      languages: ["en_US"],
      category: "AUTHENTICATION",
      components: [
        { type: "BODY" },
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "OTP",
              otp_type: "ONE_TAP",
              supported_apps: [
                { package_name: "com.example.app", signature_hash: "abc123sig" }
              ]
            }
          ]
        }
      ]
    });
  });

  test("ZERO_TAP with supportedApps is accepted", async () => {
    const { client, handle } = clientWith(ok());
    await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
      name: "auth_zero",
      languages: ["en_US"],
      otpButton: {
        otpType: "ZERO_TAP",
        supportedApps: [
          { packageName: "com.example.app", signatureHash: "sig" }
        ]
      }
    });
    const parsed = parseBody(handle.requests[0]?.body) as {
      components: { buttons: { otp_type: string; supported_apps: unknown[] }[] }[];
    };
    expect(parsed.components[1].buttons[0].otp_type).toBe("ZERO_TAP");
    expect(parsed.components[1].buttons[0].supported_apps).toHaveLength(1);
  });

  test("otpType is uppercased (lowercase input accepted)", async () => {
    const { client, handle } = clientWith(ok());
    await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
      name: "auth_login",
      languages: ["en_US"],
      otpButton: { otpType: "copy_code" as never }
    });
    const parsed = parseBody(handle.requests[0]?.body) as {
      components: { buttons: { otp_type: string }[] }[];
    };
    expect(parsed.components[1].buttons[0].otp_type).toBe("COPY_CODE");
  });
});

// ---------------------------------------------------------------------------

describe("WATS-160C upsertAuthenticationTemplate — validation rejection matrix", () => {
  test("rejects unsupported otpType", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        otpButton: { otpType: "FOUR_TAP" as never }
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects ONE_TAP without supportedApps", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        name: "auth_otp",
        languages: ["en_US"],
        otpButton: { otpType: "ONE_TAP" }
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects ZERO_TAP without supportedApps", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        name: "auth_otp",
        languages: ["en_US"],
        otpButton: { otpType: "ZERO_TAP" }
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects text on otpButton", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        name: "auth_login",
        languages: ["en_US"],
        otpButton: { otpType: "COPY_CODE", text: "Copy code" } as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects autofillText on otpButton", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        name: "auth_login",
        languages: ["en_US"],
        otpButton: { otpType: "COPY_CODE", autofillText: "Autofill" } as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects bad languages (empty, non-array, non-string entries)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        languages: [] as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        languages: "en_US" as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        languages: ["en_US", 123] as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        languages: ["en_US", ""] as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects bad codeExpirationMinutes (0, 91, non-integer, non-number)", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of [0, 91, 1.5, -1, "10", NaN] as never[]) {
      await expect(
        upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
          ...COPY_CODE_BODY,
          codeExpirationMinutes: bad
        })
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("accepts codeExpirationMinutes boundaries 1 and 90", async () => {
    const { client, handle } = clientWith([ok(), ok()]);
    await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
      ...COPY_CODE_BODY,
      codeExpirationMinutes: 1
    });
    await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
      ...COPY_CODE_BODY,
      codeExpirationMinutes: 90
    });
    expect(handle.requests.length).toBe(2);
  });

  test("rejects bad messageSendTtlSeconds (negative, non-integer, non-number)", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of [-1, 1.5, "10", NaN] as never[]) {
      await expect(
        upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
          ...COPY_CODE_BODY,
          messageSendTtlSeconds: bad
        })
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects bad addSecurityRecommendation (non-boolean)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        addSecurityRecommendation: "yes" as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects missing/empty/non-string name", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        name: "" as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        ...COPY_CODE_BODY,
        name: undefined as never
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects missing otpButton", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, {
        name: "auth_login",
        languages: ["en_US"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects bad wabaId (empty, unsafe path, non-string) before transport", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of ["", "   ", "../evil", "a/b", "a?b", undefined, null] as never[]) {
      await expect(
        upsertAuthenticationTemplate(client, { wabaId: bad }, COPY_CODE_BODY as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params and accessor-backed params (no host TypeError)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      upsertAuthenticationTemplate(client, null as never, COPY_CODE_BODY as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      upsertAuthenticationTemplate(client, undefined as never, COPY_CODE_BODY as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      upsertAuthenticationTemplate(client, "x" as never, COPY_CODE_BODY as never)
    ).rejects.toThrow(GraphRequestValidationError);

    // Accessor-backed wabaId must not trigger a host TypeError.
    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "wabaId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      upsertAuthenticationTemplate(client, accessorParams as never, COPY_CODE_BODY as never)
    ).rejects.toThrow(GraphRequestValidationError);

    // Accessor-backed body field must not trigger a host TypeError.
    const accessorBody = {} as Record<string, unknown>;
    accessorBody.name = "auth_login";
    accessorBody.languages = ["en_US"];
    accessorBody.otpButton = { otpType: "COPY_CODE" };
    Object.defineProperty(accessorBody, "name", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, accessorBody as never)
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("WATS-160C upsertAuthenticationTemplate — response shape", () => {
  test("data array entries preserve id/status/language and unknowns", async () => {
    const { client } = clientWith(
      ok({
        data: [
          { id: "tpl1", status: "PENDING", language: "en_US", extra: "x" },
          { id: "tpl2", status: "APPROVED", language: "es_ES", category: "AUTHENTICATION" }
        ],
        paging: { next: "cursor" }
      })
    );
    const res = await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, COPY_CODE_BODY);
    expect(res.data).toHaveLength(2);
    expect(res.data?.[0].id).toBe("tpl1");
    expect(res.data?.[0].status).toBe("PENDING");
    expect(res.data?.[0].language).toBe("en_US");
    expect((res.data?.[0] as Record<string, unknown>).extra).toBe("x");
    expect((res as Record<string, unknown>).paging).toEqual({ next: "cursor" });
  });

  test("missing data field is preserved as undefined", async () => {
    const { client } = clientWith(ok({ unrelated: true }));
    const res = await upsertAuthenticationTemplate(client, { wabaId: "WABA-1" }, COPY_CODE_BODY);
    expect(res.data).toBeUndefined();
    expect((res as Record<string, unknown>).unrelated).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("WATS-160C WABAClient scoped upsertAuthenticationTemplate", () => {
  test("delegates with the bound wabaId in the path", async () => {
    const { client, handle } = clientWith(
      ok({ data: [{ id: "tpl1", status: "PENDING", language: "en_US" }] })
    );
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const res = await waba.upsertAuthenticationTemplate(COPY_CODE_BODY);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/BOUND-WABA/upsert_message_templates"
    );
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      name: "auth_login",
      languages: ["en_US"],
      category: "AUTHENTICATION",
      components: [
        { type: "BODY" },
        {
          type: "BUTTONS",
          buttons: [{ type: "OTP", otp_type: "COPY_CODE" }]
        }
      ]
    });
    expect(res.data?.[0].id).toBe("tpl1");
  });

  test("bound wabaId wins (caller cannot override via params)", async () => {
    const { client, handle } = clientWith(ok());
    // The WABAClient method only accepts (body, opts) — there is no wabaId
    // param to override. This test confirms the bound id is always used.
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await waba.upsertAuthenticationTemplate(COPY_CODE_BODY);
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/BOUND-WABA/upsert_message_templates"
    );
  });

  test("rejects bad body before transport on the scoped method", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(
      waba.upsertAuthenticationTemplate({
        ...COPY_CODE_BODY,
        otpButton: { otpType: "ONE_TAP" }
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      waba.upsertAuthenticationTemplate({
        ...COPY_CODE_BODY,
        codeExpirationMinutes: 0
      })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});
