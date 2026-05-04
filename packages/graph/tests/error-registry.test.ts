// F-5 RED: error registry coverage.
//
// Tests assert registration, resolution, subcode precedence, input
// validation, and built-in seeding. All tests should fail in RED
// because the registry is a throwing stub.

import { afterEach, describe, expect, test } from "bun:test";
import {
  clearErrorRegistry,
  registerErrorCode,
  resolveRegisteredError,
  type GraphErrorFactoryContext,
  type GraphErrorRegistryEntry
} from "../src/errorRegistry";
import {
  GraphApiError,
  GraphAuthError,
  GraphRateLimitError,
  type GraphApiErrorPayload
} from "../src/errors";
import {
  ExpiredAccessTokenError,
  InvalidParameterError,
  TemplateParamCountMismatchError,
  ToManyAPICallsError,
  UnsupportedMessageTypeError,
  registerBuiltInErrorCodes
} from "../src/errorSubclasses";

function buildContext(
  payload: GraphApiErrorPayload | undefined,
  status = 400
): GraphErrorFactoryContext {
  return {
    payload,
    status,
    headers: new Headers(),
    requestUrl: "https://graph.facebook.com/v20.0/me"
  };
}

class MockRegisteredError extends GraphApiError {
  static readonly code = 999999;
  constructor(ctx: GraphErrorFactoryContext) {
    super({
      message: (ctx.payload?.message as string | undefined) ?? "mock",
      status: ctx.status,
      ...(ctx.payload !== undefined ? { payload: ctx.payload } : {})
    });
    this.name = "MockRegisteredError";
  }
}

function saveAndClear(): () => void {
  // Full restore: we rely on module reload not being feasible, so GREEN
  // contract is: clearErrorRegistry() + re-register built-ins idempotently
  // at module reload. For each test, we clear + re-register built-ins
  // via a dynamic import of the subclasses module (whose top-level call
  // re-seeds the registry when clearErrorRegistry resets the flag).
  clearErrorRegistry();
  return (): void => {
    // After each test: clear and re-import subclasses to re-seed.
    clearErrorRegistry();
  };
}

describe("F-5 error registry: register + resolve", () => {
  afterEach(() => {
    // Reset registry AND rebuild the built-in seeds so subsequent suites
    // (including built-in seeding below) see a populated registry.
    clearErrorRegistry();
    registerBuiltInErrorCodes();
  });

  test("registering a code resolves to that entry", () => {
    clearErrorRegistry();
    const entry: GraphErrorRegistryEntry = {
      code: 777001,
      errorName: "TestSentinelError",
      factory: (ctx) => new MockRegisteredError(ctx)
    };
    registerErrorCode(entry);
    const resolved = resolveRegisteredError(777001, undefined);
    expect(resolved).toBeDefined();
    expect(resolved?.errorName).toBe("TestSentinelError");
  });

  test("resolved factory produces a GraphApiError instance", () => {
    clearErrorRegistry();
    registerErrorCode({
      code: 777002,
      errorName: "MockRegisteredError",
      factory: (ctx) => new MockRegisteredError(ctx)
    });
    const entry = resolveRegisteredError(777002, undefined);
    const instance = entry?.factory(
      buildContext({ message: "boom" } as GraphApiErrorPayload)
    );
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance?.name).toBe("MockRegisteredError");
    expect(instance?.status).toBe(400);
  });

  test("subcode exact match takes precedence over no-subcode match", () => {
    clearErrorRegistry();
    class SpecificError extends GraphApiError {
      constructor(ctx: GraphErrorFactoryContext) {
        super({
          message: "specific",
          status: ctx.status,
          ...(ctx.payload !== undefined ? { payload: ctx.payload } : {})
        });
        this.name = "SpecificError";
      }
    }
    registerErrorCode({
      code: 777003,
      errorName: "GenericAt777003",
      factory: (ctx) => new MockRegisteredError(ctx)
    });
    registerErrorCode({
      code: 777003,
      subcode: 42,
      errorName: "SpecificAt777003_42",
      factory: (ctx) => new SpecificError(ctx)
    });
    const specific = resolveRegisteredError(777003, 42);
    expect(specific?.errorName).toBe("SpecificAt777003_42");
    const generic = resolveRegisteredError(777003, undefined);
    expect(generic?.errorName).toBe("GenericAt777003");
  });

  test("resolution with subcode that has no specific entry falls back to no-subcode entry", () => {
    clearErrorRegistry();
    registerErrorCode({
      code: 777004,
      errorName: "FallbackGeneric",
      factory: (ctx) => new MockRegisteredError(ctx)
    });
    const resolved = resolveRegisteredError(777004, 9999);
    expect(resolved?.errorName).toBe("FallbackGeneric");
  });

  test("unregistered code returns undefined", () => {
    clearErrorRegistry();
    expect(resolveRegisteredError(123456789, undefined)).toBeUndefined();
  });

  test("clearErrorRegistry removes all entries", () => {
    clearErrorRegistry();
    registerErrorCode({
      code: 777005,
      errorName: "Temp",
      factory: (ctx) => new MockRegisteredError(ctx)
    });
    expect(resolveRegisteredError(777005, undefined)).toBeDefined();
    clearErrorRegistry();
    expect(resolveRegisteredError(777005, undefined)).toBeUndefined();
  });

  test("last-writer-wins semantics when the same key is registered twice", () => {
    clearErrorRegistry();
    registerErrorCode({
      code: 777006,
      errorName: "First",
      factory: (ctx) => new MockRegisteredError(ctx)
    });
    registerErrorCode({
      code: 777006,
      errorName: "Second",
      factory: (ctx) => new MockRegisteredError(ctx)
    });
    expect(resolveRegisteredError(777006, undefined)?.errorName).toBe("Second");
  });
});

describe("F-5 error registry: input validation (adversarial section 1)", () => {
  afterEach(() => {
    clearErrorRegistry();
    registerBuiltInErrorCodes();
  });

  test("rejects non-number code", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: "100" as unknown as number,
        errorName: "X",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
  });

  test("rejects NaN code", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: Number.NaN,
        errorName: "X",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
  });

  test("rejects negative code", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: -1,
        errorName: "X",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
  });

  test("rejects non-finite code", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: Number.POSITIVE_INFINITY,
        errorName: "X",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
  });

  test("rejects NaN subcode when provided", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: 10,
        subcode: Number.NaN,
        errorName: "X",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
  });

  test("rejects empty errorName", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: 10,
        errorName: "",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
  });

  test("rejects non-function factory", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: 10,
        errorName: "X",
        factory: "not a function" as unknown as (
          ctx: GraphErrorFactoryContext
        ) => GraphApiError
      })
    ).toThrow();
  });
});

describe("F-5 error registry: built-in seeding", () => {
  test("code 100 resolves to a factory that produces InvalidParameterError", () => {
    const entry = resolveRegisteredError(100, undefined);
    expect(entry).toBeDefined();
    const instance = entry?.factory(
      buildContext({ message: "Invalid parameter.", code: 100 } as GraphApiErrorPayload, 400)
    );
    expect(instance).toBeInstanceOf(InvalidParameterError);
    expect(instance).toBeInstanceOf(GraphApiError);
    // Sibling assertion: NOT a rate-limit error.
    expect(instance).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("code 4 resolves to TooManyRequestsError", () => {
    const entry = resolveRegisteredError(4, undefined);
    expect(entry).toBeDefined();
    const instance = entry?.factory(
      buildContext({ message: "Too many API calls", code: 4 } as GraphApiErrorPayload, 429)
    );
    expect(instance).toBeInstanceOf(ToManyAPICallsError);
    expect(instance).toBeInstanceOf(GraphRateLimitError);
    // Sibling assertion: NOT an auth error.
    expect(instance).not.toBeInstanceOf(GraphAuthError);
  });

  test("code 190 resolves to ExpiredAccessTokenError", () => {
    const entry = resolveRegisteredError(190, undefined);
    expect(entry).toBeDefined();
    const instance = entry?.factory(
      buildContext(
        { message: "Invalid token", code: 190, type: "OAuthException" } as GraphApiErrorPayload,
        401
      )
    );
    expect(instance).toBeInstanceOf(ExpiredAccessTokenError);
    expect(instance).toBeInstanceOf(GraphAuthError);
    // Sibling assertion: NOT a rate-limit error.
    expect(instance).not.toBeInstanceOf(GraphRateLimitError);
  });

  test("code 132000 resolves to TemplateParamCountMismatchError", () => {
    const entry = resolveRegisteredError(132000, undefined);
    expect(entry).toBeDefined();
    const instance = entry?.factory(
      buildContext(
        { message: "Template param count mismatch", code: 132000 } as GraphApiErrorPayload,
        400
      )
    );
    expect(instance).toBeInstanceOf(TemplateParamCountMismatchError);
  });

  test("code 131051 resolves to UnsupportedMessageTypeError", () => {
    const entry = resolveRegisteredError(131051, undefined);
    expect(entry).toBeDefined();
    const instance = entry?.factory(
      buildContext(
        { message: "The message type is not supported.", code: 131051 } as GraphApiErrorPayload,
        400
      )
    );
    expect(instance).toBeInstanceOf(UnsupportedMessageTypeError);
  });

  test("built-in factory preserves the original payload verbatim", () => {
    const payload = {
      message: "Invalid parameter.",
      code: 100,
      error_subcode: 2494023,
      type: "GraphMethodException",
      fbtrace_id: "abc"
    } as GraphApiErrorPayload;
    const entry = resolveRegisteredError(100, undefined);
    const instance = entry?.factory(buildContext(payload, 400));
    expect(instance?.payload).toBe(payload);
    expect(instance?.code).toBe(100);
    expect(instance?.errorSubcode).toBe(2494023);
    expect(instance?.fbtraceId).toBe("abc");
  });
});

// Keep `saveAndClear` referenced to document intent (not yet used in this
// file; reserved for future registry-round-trip tests).
void saveAndClear;

// ---------------------------------------------------------------------
// F-5 remediation (WATS-29) RED tests. Cover the clearErrorRegistry
// footgun + Number.isInteger + negative-subcode rejection.
// ---------------------------------------------------------------------

describe("F-5 remediation: clearErrorRegistry round-trip reseeds", () => {
  afterEach(() => {
    // Leave the registry populated for downstream suites.
    clearErrorRegistry();
    registerBuiltInErrorCodes();
  });

  test("clearErrorRegistry() wipes built-in seeds (code 100 disappears)", () => {
    // Sanity: seed is present before we clear.
    expect(resolveRegisteredError(100, undefined)).toBeDefined();
    clearErrorRegistry();
    expect(resolveRegisteredError(100, undefined)).toBeUndefined();
  });

  test("registerBuiltInErrorCodes() after clearErrorRegistry() re-seeds (no footgun)", () => {
    clearErrorRegistry();
    // Second call must succeed — previously silently no-opped because
    // the `_registered` guard still flagged true.
    registerBuiltInErrorCodes();
    const entry = resolveRegisteredError(100, undefined);
    expect(entry, "clearErrorRegistry + registerBuiltInErrorCodes should re-seed code 100").toBeDefined();
    expect(entry?.errorName).toBe("InvalidParameterError");
  });

  test("round-trip: clear → register → clear → register again", () => {
    clearErrorRegistry();
    registerBuiltInErrorCodes();
    expect(resolveRegisteredError(4, undefined)).toBeDefined();
    clearErrorRegistry();
    expect(resolveRegisteredError(4, undefined)).toBeUndefined();
    registerBuiltInErrorCodes();
    expect(resolveRegisteredError(4, undefined)).toBeDefined();
  });
});

describe("F-5 remediation: registerErrorCode rejects non-integer / negative subcode", () => {
  afterEach(() => {
    clearErrorRegistry();
    registerBuiltInErrorCodes();
  });

  test("rejects fractional code (1.5)", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: 1.5,
        errorName: "Frac",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
    registerBuiltInErrorCodes();
  });

  test("rejects fractional subcode (2.5)", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: 100,
        subcode: 2.5,
        errorName: "FracSub",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
    registerBuiltInErrorCodes();
  });

  test("rejects negative subcode (-1)", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: 100,
        subcode: -1,
        errorName: "NegSub",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).toThrow();
    registerBuiltInErrorCodes();
  });

  test("still accepts integer subcode zero", () => {
    clearErrorRegistry();
    expect(() =>
      registerErrorCode({
        code: 100,
        subcode: 0,
        errorName: "ZeroSub",
        factory: (ctx) => new MockRegisteredError(ctx)
      })
    ).not.toThrow();
    registerBuiltInErrorCodes();
  });
});
