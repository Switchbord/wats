import { describe, expect, test } from "bun:test";

import { GraphRequestValidationError } from "../src/errors";
import {
  assertBoundedString,
  assertDenseDataArray,
  assertJoinedStringQueryArray,
  assertNonEmptyString,
  assertPlainDataRecord,
  assertQueryString,
  assertRepeatedlyDecodedSafePathId,
  copyOptionalParamsObject,
  graphValidationError,
  hasAsciiControlChar,
  ownDataValue,
  safeJsonClone,
  splitRequiredStringDataProp,
  sanitizeHeaderInit
} from "../src/internal/validation";

const helperName = "internalValidationTest";

function expectValidationThrow(fn: () => unknown): GraphRequestValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GraphRequestValidationError);
    return error as GraphRequestValidationError;
  }
  throw new Error("Expected GraphRequestValidationError");
}

describe("private Graph internal validation utilities", () => {
  test("graphValidationError preserves GraphRequestValidationError cause", () => {
    const cause = new Error("boom");
    const error = graphValidationError("Invalid test input.", cause);

    expect(error).toBeInstanceOf(GraphRequestValidationError);
    expect(error.name).toBe("GraphRequestValidationError");
    expect(error.message).toBe("Invalid test input.");
    expect(error.cause).toBe(cause);
  });

  test("string helpers reject empty, whitespace, control, and oversized values", () => {
    expect(hasAsciiControlChar("ok\0")).toBe(true);
    expect(hasAsciiControlChar("ok\n")).toBe(true);
    expect(hasAsciiControlChar("ok\r")).toBe(true);
    expect(hasAsciiControlChar("ok\t")).toBe(true);
    expect(hasAsciiControlChar(`ok${String.fromCharCode(0x7f)}`)).toBe(true);
    expect(hasAsciiControlChar("safe-value")).toBe(false);

    expect(assertNonEmptyString(" value ", { helperName, fieldName: "name" })).toBe(" value ");

    for (const bad of [undefined, null, "", "   ", 123, {}, []]) {
      expectValidationThrow(() => assertNonEmptyString(bad, { helperName, fieldName: "name" }));
    }

    expectValidationThrow(() => assertBoundedString("abc", { helperName, fieldName: "name", maxLength: 2 }));
    expectValidationThrow(() => assertBoundedString("a\nb", { helperName, fieldName: "name" }));
  });

  test("assertPlainDataRecord rejects null, arrays, custom prototypes, unsafe keys, and accessors without invoking them", () => {
    for (const bad of [undefined, null, 1, "x", [], () => undefined]) {
      expectValidationThrow(() => assertPlainDataRecord(bad, { helperName, path: "params" }));
    }

    const customProto = Object.create({ inherited: true });
    customProto.value = 1;
    expectValidationThrow(() => assertPlainDataRecord(customProto, { helperName, path: "params" }));

    expectValidationThrow(() => assertPlainDataRecord(JSON.parse('{"__proto__": 1}'), { helperName, path: "params" }));
    expectValidationThrow(() => assertPlainDataRecord({ constructor: 1 }, { helperName, path: "params" }));
    expectValidationThrow(() => assertPlainDataRecord({ prototype: 1 }, { helperName, path: "params" }));

    let invoked = false;
    const accessorRecord = {};
    Object.defineProperty(accessorRecord, "danger", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("getter executed");
      }
    });

    const accessorError = expectValidationThrow(() =>
      assertPlainDataRecord(accessorRecord, { helperName, path: "params" })
    );
    expect(accessorError.message).toContain("accessors");
    expect(invoked).toBe(false);

    expectValidationThrow(() =>
      assertPlainDataRecord({ toJSON() { return {}; } }, { helperName, path: "params" })
    );
    expectValidationThrow(() =>
      assertPlainDataRecord({ big: 1n }, { helperName, path: "params", rejectFunctionsSymbolsBigInts: true })
    );

    const symbolKey = Symbol("hidden");
    const symbolValueRecord = { [symbolKey]: "hidden-value" };
    expectValidationThrow(() => assertPlainDataRecord(symbolValueRecord, { helperName, path: "params" }));

    let symbolDescriptorCalls = 0;
    const disappearingSymbolRecord = new Proxy({}, {
      ownKeys() {
        return [symbolKey];
      },
      getOwnPropertyDescriptor(_, key) {
        if (key === symbolKey) {
          symbolDescriptorCalls += 1;
          if (symbolDescriptorCalls === 1) {
            return { configurable: true, enumerable: true, value: "hidden-value", writable: true };
          }
          return undefined;
        }
        return undefined;
      }
    });
    expectValidationThrow(() => assertPlainDataRecord(disappearingSymbolRecord, { helperName, path: "params" }));

    let symbolAccessorInvoked = false;
    const symbolAccessorRecord = {};
    Object.defineProperty(symbolAccessorRecord, symbolKey, {
      enumerable: true,
      get() {
        symbolAccessorInvoked = true;
        throw new Error("symbol getter executed");
      }
    });
    expectValidationThrow(() => assertPlainDataRecord(symbolAccessorRecord, { helperName, path: "params" }));
    expect(symbolAccessorInvoked).toBe(false);

    const proxySymbol = Symbol("proxy");
    let descriptorCalls = 0;
    const symbolDescriptorProxy = new Proxy({}, {
      ownKeys() {
        return [proxySymbol];
      },
      getOwnPropertyDescriptor() {
        descriptorCalls += 1;
        if (descriptorCalls === 1) return { configurable: true, enumerable: true, value: "ok", writable: true };
        throw new Error("symbol descriptor trap executed twice");
      }
    });
    expectValidationThrow(() =>
      assertPlainDataRecord(symbolDescriptorProxy, { helperName, path: "params" })
    );
  });

  test("ownDataValue does not invoke accessors and can require data properties", () => {
    const record = { safe: "ok" } as Record<string, unknown>;
    expect(ownDataValue(record, "safe", { helperName, path: "params.safe", required: true })).toBe("ok");
    expect(ownDataValue(record, "missing", { helperName, path: "params.missing" })).toBeUndefined();
    expectValidationThrow(() => ownDataValue(record, "missing", { helperName, path: "params.missing", required: true }));

    let invoked = false;
    const accessorRecord = {} as Record<string, unknown>;
    Object.defineProperty(accessorRecord, "danger", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("getter executed");
      }
    });

    expectValidationThrow(() => ownDataValue(accessorRecord, "danger", { helperName, path: "params.danger" }));
    expect(invoked).toBe(false);
  });

  test("sanitizeHeaderInit clones Headers and plain string records", () => {
    const headers = new Headers({ "x-safe": "before" });
    const cloned = sanitizeHeaderInit(headers, { helperName, path: "opts.headers" });
    headers.set("x-safe", "after");
    expect(cloned).toBeInstanceOf(Headers);
    expect((cloned as Headers).get("x-safe")).toBe("before");

    const record = { "x-record": "record-before" } as Record<string, string>;
    const copied = sanitizeHeaderInit(record, { helperName, path: "opts.headers" });
    record["x-record"] = "record-after";
    expect(copied).toEqual({ "x-record": "record-before" });
  });

  test("sanitizeHeaderInit wraps prototype inspection traps", () => {
    const protoTrap = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("proto trap");
      }
    });

    const trapError = expectValidationThrow(() =>
      sanitizeHeaderInit(protoTrap, { helperName, path: "opts.headers" })
    );
    expect(trapError.message).toBe("Invalid internalValidationTest input: opts.headers could not be inspected.");
    expect(trapError.cause).toBeInstanceOf(Error);
    expect((trapError.cause as Error).message).toBe("proto trap");
  });

  test("sanitizeHeaderInit rejects spoofed Headers without leaking second prototype traps", () => {
    let protoCalls = 0;
    const secondProtoTrap = new Proxy(Object.create(Headers.prototype), {
      getPrototypeOf() {
        protoCalls += 1;
        if (protoCalls === 1) return Headers.prototype;
        throw new Error("second proto trap");
      }
    });

    const trapError = expectValidationThrow(() =>
      sanitizeHeaderInit(secondProtoTrap, { helperName, path: "opts.headers" })
    );
    expect(trapError.message).toBe("Invalid internalValidationTest input: opts.headers could not be inspected.");
    expect(trapError.cause).toBeInstanceOf(Error);
    expect(protoCalls).toBe(1);
  });

  test("sanitizeHeaderInit rejects spoofed Headers prototype objects with own iterators", () => {
    let iteratorConsumed = false;
    const spoofIter = {};
    Object.setPrototypeOf(spoofIter, Headers.prototype);
    Object.defineProperty(spoofIter, Symbol.iterator, {
      enumerable: true,
      value: function* () {
        iteratorConsumed = true;
        yield ["x-spoof", "v"];
      }
    });

    const error = expectValidationThrow(() =>
      sanitizeHeaderInit(spoofIter, { helperName, path: "opts.headers" })
    );

    expect(error.message).toContain("opts.headers");
    expect(iteratorConsumed).toBe(false);
  });

  test("sanitizeHeaderInit rejects proxy-spoofed Headers prototype iterators", () => {
    let iteratorReads = 0;
    let iteratorConsumed = false;
    const proxySpoofIter = new Proxy({}, {
      getPrototypeOf() {
        return Headers.prototype;
      },
      get(target, key, receiver) {
        if (key === Symbol.iterator) {
          iteratorReads += 1;
          return function* () {
            iteratorConsumed = true;
            yield ["x-proxy", "v"];
          };
        }
        return Reflect.get(target, key, receiver);
      }
    });

    const error = expectValidationThrow(() =>
      sanitizeHeaderInit(proxySpoofIter, { helperName, path: "opts.headers" })
    );

    expect(error.message).toContain("opts.headers");
    expect(iteratorReads).toBe(0);
    expect(iteratorConsumed).toBe(false);
  });

  test("sanitizeHeaderInit wraps proxied Headers clone failures", () => {
    const proxiedHeaders = new Proxy(new Headers({ "x-safe": "ok" }), {});

    const trapError = expectValidationThrow(() =>
      sanitizeHeaderInit(proxiedHeaders, { helperName, path: "opts.headers" })
    );
    expect(trapError.message).toBe("Invalid internalValidationTest input: opts.headers could not be inspected.");
    expect(trapError.cause).toBeInstanceOf(TypeError);
  });

  test("sanitizeHeaderInit rejects malformed header records without reading caller-owned values", () => {
    for (const bad of [undefined, null, 1, "x", [], () => undefined, Object.create({ inherited: true })]) {
      expectValidationThrow(() => sanitizeHeaderInit(bad, { helperName, path: "opts.headers" }));
    }

    let invoked = false;
    const accessorHeaders = {} as Record<string, unknown>;
    Object.defineProperty(accessorHeaders, "x-danger", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("getter executed");
      }
    });
    const accessorError = expectValidationThrow(() => sanitizeHeaderInit(accessorHeaders, { helperName, path: "opts.headers" }));
    expect(accessorError.message).toBe("Invalid internalValidationTest input: opts.headers must not use accessors.");
    expect(invoked).toBe(false);

    const nonStringError = expectValidationThrow(() =>
      sanitizeHeaderInit({ "x-value": 1 }, { helperName, path: "opts.headers" })
    );
    expect(nonStringError.message).toBe("Invalid internalValidationTest input: opts.headers values must be strings.");

    const symbolKey = Symbol("header");
    expectValidationThrow(() => sanitizeHeaderInit({ [symbolKey]: "hidden" }, { helperName, path: "opts.headers" }));
    expectValidationThrow(() => sanitizeHeaderInit(JSON.parse('{"__proto__":"polluted"}'), { helperName, path: "opts.headers" }));

    const descriptorTrap = new Proxy({}, {
      ownKeys() {
        return ["x-safe"];
      },
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      }
    });
    const trapError = expectValidationThrow(() => sanitizeHeaderInit(descriptorTrap, { helperName, path: "opts.headers" }));
    expect(trapError.cause).toBeInstanceOf(Error);
  });

  test("assertDenseDataArray rejects sparse arrays, custom prototypes, accessors, and own iterator/map overrides", () => {
    expect(assertDenseDataArray(["a", 1, false], { helperName, path: "items" })).toEqual(["a", 1, false]);

    const sparse: unknown[] = [];
    sparse[1] = "hole-before-me";
    expectValidationThrow(() => assertDenseDataArray(sparse, { helperName, path: "items" }));

    const customProto = ["x"];
    Object.setPrototypeOf(customProto, Object.create(Array.prototype));
    expectValidationThrow(() => assertDenseDataArray(customProto, { helperName, path: "items" }));

    const mapOverride = ["x"] as unknown[];
    Object.defineProperty(mapOverride, "map", { value: () => [], enumerable: true });
    expectValidationThrow(() => assertDenseDataArray(mapOverride, { helperName, path: "items" }));

    let invoked = false;
    const accessorArray = ["safe"] as unknown[];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("array getter executed");
      }
    });
    expectValidationThrow(() => assertDenseDataArray(accessorArray, { helperName, path: "items" }));

    const proxyArray = new Proxy(Object.assign(["x"], { map: "override" }), {
      getOwnPropertyDescriptor(target, key) {
        if (key === "map") throw new Error("array raw gopd");
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const proxyError = expectValidationThrow(() => assertDenseDataArray(proxyArray, { helperName, path: "items" }));
    expect(proxyError.cause).toBeInstanceOf(Error);

    const lengthTrapArray = new Proxy(["x"], {
      get(target, key, receiver) {
        if (key === "length") throw new Error("array raw length");
        return Reflect.get(target, key, receiver);
      }
    });
    const lengthProxyError = expectValidationThrow(() => assertDenseDataArray(lengthTrapArray, { helperName, path: "items" }));
    expect(lengthProxyError.cause).toBeInstanceOf(Error);

    const capBypassArray = new Proxy([1, 2, 3], {
      get(target, key, receiver) {
        if (key === "length") return 2;
        return Reflect.get(target, key, receiver);
      },
      ownKeys() {
        return ["0", "1", "2", "length"];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "length") return { value: 2, writable: true, enumerable: false, configurable: false };
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    expectValidationThrow(() => assertDenseDataArray(capBypassArray, { helperName, path: "items", maxLength: 2 }));

    const arraySymbolKey = Symbol("array-hidden");
    const arrayWithSymbolData = Object.assign(["x"], { [arraySymbolKey]: "hidden" });
    expectValidationThrow(() => assertDenseDataArray(arrayWithSymbolData, { helperName, path: "items" }));

    let arraySymbolAccessorInvoked = false;
    const arrayWithSymbolAccessor = ["x"] as unknown[];
    Object.defineProperty(arrayWithSymbolAccessor, arraySymbolKey, {
      enumerable: true,
      get() {
        arraySymbolAccessorInvoked = true;
        throw new Error("array symbol getter executed");
      }
    });
    expectValidationThrow(() => assertDenseDataArray(arrayWithSymbolAccessor, { helperName, path: "items" }));
    expect(arraySymbolAccessorInvoked).toBe(false);

    let arraySymbolDescriptorCalls = 0;
    const disappearingArraySymbol = new Proxy(["x"], {
      ownKeys() {
        return ["0", "length", arraySymbolKey];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === arraySymbolKey) {
          arraySymbolDescriptorCalls += 1;
          if (arraySymbolDescriptorCalls === 1) {
            return { configurable: true, enumerable: true, value: "hidden", writable: true };
          }
          return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    expectValidationThrow(() => assertDenseDataArray(disappearingArraySymbol, { helperName, path: "items" }));

    // A hostile proxy can coordinate get("length"), ownKeys(), and length descriptors
    // to hide target elements completely. ECMAScript does not expose an independent,
    // side-effect-free target length for arbitrary proxies. The utility can reject
    // observable descriptor inconsistencies, but not invisible target state.
  });

  test("assertRepeatedlyDecodedSafePathId rejects raw, encoded, double-encoded, malformed, and excessive traversal", () => {
    expect(assertRepeatedlyDecodedSafePathId("phone_123", { helperName, fieldName: "phoneNumberId" })).toBe("phone_123");

    for (const bad of [
      ".",
      "..",
      "a/b",
      "a\\b",
      "a?b",
      "a#b",
      "a\nb",
      "%2e%2e",
      "%252e%252e",
      "%2f",
      "%255c",
      "%3f",
      "%23",
      "%E0%A4%A",
      "%2525252525252e"
    ]) {
      expectValidationThrow(() => assertRepeatedlyDecodedSafePathId(bad, { helperName, fieldName: "phoneNumberId" }));
    }
  });

  test("assertQueryString preserves business-management query-string message compatibility", () => {
    expect(assertQueryString("fields,id", { helperName: "getWabaInfo", fieldName: "fields", maxLength: 16 })).toBe("fields,id");
    expect(assertQueryString("25", { helperName: "listPhoneNumbers", fieldName: "limit", maxLength: 32 })).toBe("25");

    const cases = [
      { value: 42, message: "Invalid listPhoneNumbers input: limit must be a string." },
      { value: "", message: "Invalid listPhoneNumbers input: limit must be non-empty." },
      { value: "   ", message: "Invalid listPhoneNumbers input: limit must be non-empty." },
      { value: "bad\n", message: "Invalid listPhoneNumbers input: limit must not contain control characters." },
      { value: "x".repeat(33), message: "Invalid listPhoneNumbers input: limit exceeds 32-character limit." }
    ] as const;

    for (const c of cases) {
      const error = expectValidationThrow(() =>
        assertQueryString(c.value, { helperName: "listPhoneNumbers", fieldName: "limit", maxLength: 32 })
      );
      expect(error.message).toBe(c.message);
    }
  });

  test("assertJoinedStringQueryArray clones descriptor-safe strings and joins without caller methods", () => {
    const fields = ["id", "name"];
    const joined = assertJoinedStringQueryArray(fields, {
      helperName: "getWabaInfo",
      path: "fields",
      maxLength: 50,
      maxItemLength: 128
    });
    fields[0] = "MUTATED";
    expect(joined).toBe("id,name");

    const iteratorOverride = ["id"] as unknown[];
    Object.defineProperty(iteratorOverride, Symbol.iterator, { value: function* () { yield "evil"; }, enumerable: true });
    const iteratorError = expectValidationThrow(() =>
      assertJoinedStringQueryArray(iteratorOverride, {
        helperName: "getWabaInfo",
        path: "fields",
        maxLength: 50,
        maxItemLength: 128
      })
    );
    expect(iteratorError.message).toBe("Invalid getWabaInfo input: fields must not override Array.prototype methods.");

    const mapOverride = ["id"] as unknown[];
    Object.defineProperty(mapOverride, "map", { value: () => ["evil"], enumerable: true });
    const mapError = expectValidationThrow(() =>
      assertJoinedStringQueryArray(mapOverride, {
        helperName: "getWabaInfo",
        path: "fields",
        maxLength: 50,
        maxItemLength: 128
      })
    );
    expect(mapError.message).toBe("Invalid getWabaInfo input: fields must not override Array.prototype methods.");

    const symbolKey = Symbol("hidden-field");
    const symbolFields = Object.assign(["id"], { [symbolKey]: "name" });
    const symbolError = expectValidationThrow(() =>
      assertJoinedStringQueryArray(symbolFields, {
        helperName: "getWabaInfo",
        path: "fields",
        maxLength: 50,
        maxItemLength: 128
      })
    );
    expect(symbolError.message).toBe("Invalid getWabaInfo input: fields must not contain symbol keys.");

    const unsafeKeyFields = ["id"] as unknown[];
    Object.defineProperty(unsafeKeyFields, "constructor", { value: "bad", enumerable: true });
    const unsafeKeyError = expectValidationThrow(() =>
      assertJoinedStringQueryArray(unsafeKeyFields, {
        helperName: "getWabaInfo",
        path: "fields",
        maxLength: 50,
        maxItemLength: 128,
        unsafePrototypeKeyMessage: "Invalid getWabaInfo input: fields contains an unsafe prototype key."
      })
    );
    expect(unsafeKeyError.message).toBe("Invalid getWabaInfo input: fields contains an unsafe prototype key.");

    const extraPropertyFields = ["id"] as unknown[];
    Object.defineProperty(extraPropertyFields, "extra", { value: "bad", enumerable: true });
    const extraPropertyError = expectValidationThrow(() =>
      assertJoinedStringQueryArray(extraPropertyFields, {
        helperName: "getWabaInfo",
        path: "fields",
        maxLength: 50,
        maxItemLength: 128,
        unsupportedPropertyMessage: "Invalid getWabaInfo input: fields contains unsupported properties."
      })
    );
    expect(extraPropertyError.message).toBe("Invalid getWabaInfo input: fields contains unsupported properties.");

    const lengthBypass = new Proxy(["id", "name"], {
      get(target, key, receiver) {
        if (key === "length") return 1;
        return Reflect.get(target, key, receiver);
      },
      ownKeys() {
        return ["0", "1", "length"];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "length") return { value: 1, writable: true, enumerable: false, configurable: false };
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const lengthError = expectValidationThrow(() =>
      assertJoinedStringQueryArray(lengthBypass, {
        helperName: "getWabaInfo",
        path: "fields",
        maxLength: 1,
        maxItemLength: 128
      })
    );
    expect(lengthError.message).toBe("Invalid getWabaInfo input: fields has indexes beyond its array length.");
  });

  test("safeJsonClone rejects cycles with a shared WeakSet and rejects unsafe JSON-like data without host errors", () => {
    const input = { ok: ["yes", 1, true, null], nested: { value: "safe" } };
    const cloned = safeJsonClone(input, {
      helperName,
      path: "body",
      maxDepth: 4,
      maxArrayLength: 4,
      maxStringLength: 16,
      maxKeys: 4
    });
    expect(cloned).toEqual(input);
    expect(cloned).not.toBe(input);

    const sharedCycle: Record<string, unknown> = { label: "cycle" };
    sharedCycle.self = sharedCycle;
    expectValidationThrow(() => safeJsonClone([sharedCycle], { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 16 }));

    const parent: Record<string, unknown> = {};
    const child: Record<string, unknown> = { parent };
    parent.child = child;
    expectValidationThrow(() => safeJsonClone(parent, { helperName, path: "body", maxDepth: 6, maxArrayLength: 4, maxStringLength: 16 }));

    let invoked = false;
    const accessorRecord = {};
    Object.defineProperty(accessorRecord, "danger", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("getter executed");
      }
    });
    expectValidationThrow(() => safeJsonClone(accessorRecord, { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 16 }));
    expect(invoked).toBe(false);

    expectValidationThrow(() => safeJsonClone(JSON.parse('{"__proto__": 1}'), { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 16 }));

    const symbolKey = Symbol("hidden");
    expectValidationThrow(() => safeJsonClone({ [symbolKey]: "hidden-value" }, { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 16 }));

    let symbolAccessorInvoked = false;
    const symbolAccessorRecord = {};
    Object.defineProperty(symbolAccessorRecord, symbolKey, {
      enumerable: true,
      get() {
        symbolAccessorInvoked = true;
        throw new Error("symbol getter executed");
      }
    });
    expectValidationThrow(() => safeJsonClone(symbolAccessorRecord, { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 16 }));
    expect(symbolAccessorInvoked).toBe(false);

    expectValidationThrow(() => safeJsonClone(Number.POSITIVE_INFINITY, { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 16 }));
    expectValidationThrow(() => safeJsonClone("too-long", { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 3 }));
    expectValidationThrow(() => safeJsonClone([1, 2, 3], { helperName, path: "body", maxDepth: 4, maxArrayLength: 2, maxStringLength: 16 }));
    expectValidationThrow(() => safeJsonClone({ a: { b: { c: true } } }, { helperName, path: "body", maxDepth: 1, maxArrayLength: 4, maxStringLength: 16 }));

    let ownKeysCalls = 0;
    const secondInspectionProxy = new Proxy({ a: 1 }, {
      ownKeys(target) {
        ownKeysCalls += 1;
        if (ownKeysCalls === 1) return Reflect.ownKeys(target);
        throw new Error("second ownKeys trap executed");
      },
      getOwnPropertyDescriptor(target, key) {
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const proxyError = expectValidationThrow(() =>
      safeJsonClone(secondInspectionProxy, { helperName, path: "body", maxDepth: 4, maxArrayLength: 4, maxStringLength: 16 })
    );
    expect(proxyError.cause).toBeInstanceOf(Error);
  });

  test("optional params helpers copy descriptor-safe data and split required string properties", () => {
    expect(copyOptionalParamsObject(undefined, helperName)).toEqual({});
    expect(copyOptionalParamsObject({ a: 1, b: undefined }, helperName)).toEqual({ a: 1 });

    let invoked = false;
    const accessorParams = {};
    Object.defineProperty(accessorParams, "danger", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("getter executed");
      }
    });
    expectValidationThrow(() => copyOptionalParamsObject(accessorParams, helperName));
    expect(invoked).toBe(false);

    const delayedCopyTrapParams = new Proxy({ a: 1 }, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "a") {
          const current = Reflect.getOwnPropertyDescriptor(target, key);
          if (current?.value === 1) {
            Object.defineProperty(target, key, { value: 2, configurable: true, enumerable: true, writable: true });
            return current;
          }
          throw new Error("options raw gopd");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const copyProxyError = expectValidationThrow(() => copyOptionalParamsObject(delayedCopyTrapParams, helperName));
    expect(copyProxyError.cause).toBeInstanceOf(Error);

    const delayedSplitTrapParams = new Proxy({ flowId: "flow_1", limit: 10 }, {
      ownKeys(target) {
        if (target.limit === 10) {
          target.limit = 11;
          return Reflect.ownKeys(target);
        }
        throw new Error("split raw ownKeys");
      },
      getOwnPropertyDescriptor(target, key) {
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const splitProxyError = expectValidationThrow(() => splitRequiredStringDataProp(delayedSplitTrapParams, "flowId", helperName));
    expect(splitProxyError.cause).toBeInstanceOf(Error);

    const split = splitRequiredStringDataProp({ flowId: "flow_1", limit: 10 }, "flowId", helperName);
    expect(split.value).toBe("flow_1");
    expect(split.rest).toEqual({ limit: 10 });

    expectValidationThrow(() => splitRequiredStringDataProp({ flowId: 1 }, "flowId", helperName));
    expectValidationThrow(() => splitRequiredStringDataProp({}, "flowId", helperName));
  });
});
