/**
 * WATS-196 — canonical guards: isRecord + containsUnsafePathSegment.
 *
 * Part A: consumer-fixture style test importing `@wats/internal-utils`
 *   asserting it exports `containsUnsafePathSegment` with the sqlite-variant
 *   semantics (the most rigorous of the three pre-canonical copies) and
 *   `isRecord` with the rigorous prototype-chain semantics.
 *
 * Part B: behavior-pinning tests asserting the path-safety matrix is UNIFORM
 *   across @wats/config, @wats/service, and @wats/persistence after the swap.
 *   This tightens config/service (the point of WATS-196): patterns the old
 *   inline copies allowed (colon, %2f, %252f, %5c, %255c, "." segments) must
 *   now be rejected.
 */
import { describe, expect, test } from "bun:test";
import { isRecord, containsUnsafePathSegment } from "@wats/internal-utils";
import {
  validateConfig,
  ConfigValidationError,
  type WatsProfileConfig
} from "@wats/config";
import {
  createWatsServiceOpenApiDocument,
  WatsServiceError
} from "@wats/service";
import { createMockTransport } from "@wats/graph/testing";
import {
  createSqlitePersistence,
  PersistenceError
} from "@wats/persistence";

// ---------------------------------------------------------------------------
// Helpers for behavior-pinning tests
// ---------------------------------------------------------------------------

function validProfile(overrides: Partial<WatsProfileConfig> = {}): WatsProfileConfig {
  return {
    graph: { apiVersion: "v25.0", baseUrl: "https://graph.test/root/" },
    whatsapp: { wabaId: "123456789012345", phoneNumberId: "15551234567" },
    auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
    webhook: {
      path: "/webhooks/whatsapp",
      verifyToken: { env: "WATS_WEBHOOK_VERIFY_TOKEN" },
      appSecret: { env: "WATS_WEBHOOK_APP_SECRET" },
      maxBodyBytes: 1_048_576
    },
    service: {
      host: "127.0.0.1",
      port: 8787,
      apiPrefix: "/api",
      bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
    },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Part A: @wats/internal-utils export surface
// ---------------------------------------------------------------------------

describe("WATS-196 @wats/internal-utils containsUnsafePathSegment", () => {
  test("is a function exported from the package root", () => {
    expect(typeof containsUnsafePathSegment).toBe("function");
  });

  const rejected: Array<[string, unknown]> = [
    ["double-dot segment ..", "safe/../wats"],
    ["single-dot segment .", "safe/./wats"],
    ["percent-encoded .. %2e%2e", "safe%2e%2ewats"],
    ["double-encoded .. %252e%252e", "safe%252e%252ewats"],
    ["backslash \\\\", "safe\\\\evil"],
    ["question mark ?", "safe?evil"],
    ["hash #", "safe#evil"],
    ["colon :", "safe:evil"],
    ["percent-encoded slash %2f", "safe%2fevil"],
    ["double-encoded slash %252f", "safe%252fevil"],
    ["percent-encoded backslash %5c", "safe%5cevil"],
    ["double-encoded backslash %255c", "safe%255cevil"],
    ["carriage return CR", "safe\revil"],
    ["line feed LF", "safe\nevil"],
    ["NUL byte", "safe\0evil"],
    ["DEL 0x7f", "safe\u007fevil"],
    ["control char 0x01", "safe\u0001evil"],
    ["empty string", ""],
    ["non-string number", 42],
    ["non-string null", null],
    ["non-string undefined", undefined],
    ["non-string object", {}],
    ["non-string array", [1, 2, 3]]
  ];

  for (const [label, input] of rejected) {
    test(`returns true (unsafe) for ${label}`, () => {
      expect(containsUnsafePathSegment(input)).toBe(true);
    });
  }

  const accepted: Array<[string, string]> = [
    ["simple filename", "wats.sqlite"],
    ["hyphenated name", "wats-data.sqlite"],
    ["name with dots", "wats.data.sqlite"],
    ["relative path with slash", "subdir/wats.sqlite"],
    ["absolute path", "/var/lib/wats/wats.sqlite"],
    ["alphanumeric", "abc123def"]
  ];

  for (const [label, input] of accepted) {
    test(`returns false (safe) for ${label}`, () => {
      expect(containsUnsafePathSegment(input)).toBe(false);
    });
  }
});

describe("WATS-196 @wats/internal-utils isRecord (rigorous)", () => {
  test("is a function exported from the package root", () => {
    expect(typeof isRecord).toBe("function");
  });

  test("accepts plain object literal", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  test("accepts null-prototype object", () => {
    expect(isRecord(Object.create(null))).toBe(true);
  });

  test("accepts Object.prototype-prototype object", () => {
    expect(isRecord(Object.create(Object.prototype))).toBe(true);
  });

  test("rejects null", () => {
    expect(isRecord(null)).toBe(false);
  });

  test("rejects undefined", () => {
    expect(isRecord(undefined)).toBe(false);
  });

  test("rejects primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(Symbol("s"))).toBe(false);
  });

  test("rejects arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  test("rejects Date instances", () => {
    expect(isRecord(new Date())).toBe(false);
  });

  test("rejects class instances", () => {
    class Custom {
      x = 1;
    }
    expect(isRecord(new Custom())).toBe(false);
  });

  test("rejects Error instances", () => {
    expect(isRecord(new Error("err"))).toBe(false);
  });

  test("rejects Map/Set/RegExp/Promise instances", () => {
    expect(isRecord(new Map())).toBe(false);
    expect(isRecord(new Set())).toBe(false);
    expect(isRecord(/regex/)).toBe(false);
    expect(isRecord(Promise.resolve(1))).toBe(false);
  });

  test("rejects functions", () => {
    expect(isRecord(() => {})).toBe(false);
    expect(isRecord(function () {})).toBe(false);
  });

  test("rejects typed arrays and ArrayBuffer", () => {
    expect(isRecord(new Uint8Array(1))).toBe(false);
    expect(isRecord(new ArrayBuffer(1))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part B: uniform path-safety matrix across config / service / persistence
// ---------------------------------------------------------------------------

/**
 * The full unsafe-path matrix. After WATS-196, all three call-site packages
 * must reject every entry here. The entries that were previously allowed by
 * the weaker inline copies (colon, %2f, %252f, %5c, %255c, "." segment) are
 * the ones being tightened.
 */
const UNSAFE_PATH_FRAGMENTS = [
  "seg/../seg",
  "seg/./seg",
  "seg%2e%2eseg",
  "seg%252e%252eseg",
  "seg\\evil",
  "seg?evil",
  "seg#evil",
  "seg:evil",
  "seg%2fevil",
  "seg%252fevil",
  "seg%5cevil",
  "seg%255cevil",
  "seg\revil",
  "seg\nevil",
  "seg\u0000evil",
  "seg\u007fevil",
  "seg\u0001evil"
];

describe("WATS-196 @wats/config path validation (uniform matrix)", () => {
  for (const fragment of UNSAFE_PATH_FRAGMENTS) {
    const webhookPath = `/webhook/${fragment}`;
    test(`rejects webhook.path with unsafe fragment: ${JSON.stringify(fragment)}`, () => {
      const config: unknown = {
        version: 1,
        defaultProfile: "local",
        profiles: {
          local: {
            ...validProfile(),
            webhook: { ...validProfile().webhook, path: webhookPath }
          }
        }
      };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });

    const apiPrefix = `/api/${fragment}`;
    test(`rejects service.apiPrefix with unsafe fragment: ${JSON.stringify(fragment)}`, () => {
      const config: unknown = {
        version: 1,
        defaultProfile: "local",
        profiles: {
          local: {
            ...validProfile(),
            service: { ...validProfile().service, apiPrefix }
          }
        }
      };
      expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    });
  }
});

describe("WATS-196 @wats/service path validation (uniform matrix)", () => {
  function makeServiceConfig() {
    const mock = createMockTransport({
      defaultResponse: {
        status: 200,
        body: { messaging_product: "whatsapp", messages: [{ id: "wamid.TEST" }] }
      }
    });
    return {
      profile: validProfile(),
      secrets: {
        accessToken: "graph-access-token",
        webhookVerifyToken: "verify-token",
        webhookAppSecret: "app-secret",
        serviceBearerToken: "service-bearer"
      },
      transport: mock.transport
    };
  }

  for (const fragment of UNSAFE_PATH_FRAGMENTS) {
    const webhookPath = `/webhook/${fragment}`;
    test(`rejects webhook.path with unsafe fragment: ${JSON.stringify(fragment)}`, () => {
      const cfg = makeServiceConfig();
      cfg.profile = validProfile({
        webhook: { ...validProfile().webhook, path: webhookPath }
      });
      expect(() =>
        createWatsServiceOpenApiDocument(cfg.profile)
      ).toThrow(WatsServiceError);
    });

    const apiPrefix = `/api/${fragment}`;
    test(`rejects service.apiPrefix with unsafe fragment: ${JSON.stringify(fragment)}`, () => {
      const cfg = makeServiceConfig();
      cfg.profile = validProfile({
        service: { ...validProfile().service, apiPrefix }
      });
      expect(() =>
        createWatsServiceOpenApiDocument(cfg.profile)
      ).toThrow(WatsServiceError);
    });
  }
});

describe("WATS-196 @wats/persistence filename validation (uniform matrix)", () => {
  for (const fragment of UNSAFE_PATH_FRAGMENTS) {
    const filename = `safe-${fragment}.sqlite`;
    test(`rejects filename with unsafe fragment: ${JSON.stringify(fragment)}`, async () => {
      try {
        await createSqlitePersistence({ filename });
        throw new Error("expected createSqlitePersistence to reject unsafe filename");
      } catch (error) {
        expect(error).toBeInstanceOf(PersistenceError);
      }
    });
  }
});
