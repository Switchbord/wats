import { describe, expect, test } from "bun:test";
import { isRecord } from "@switchbord/internal-utils";

describe("isRecord — plain-object positives (adversarial battery §1 boundary)", () => {
  test("returns true for an empty plain object", () => {
    expect(isRecord({})).toBe(true);
  });

  test("returns true for a plain object literal with properties", () => {
    expect(isRecord({ a: 1, b: "s", c: null })).toBe(true);
  });

  test("returns true for an object created with Object.create(null) (null prototype)", () => {
    const nullProtoObject: unknown = Object.create(null);
    expect(isRecord(nullProtoObject)).toBe(true);
  });

  test("returns true for an object whose prototype was tampered back to Object.prototype", () => {
    const tampered: unknown = {};
    Object.setPrototypeOf(tampered, Object.prototype);
    expect(isRecord(tampered)).toBe(true);
  });

  test("narrows the argument to Record<string, unknown> when true (type-level check)", () => {
    const value: unknown = { key: "value" };
    if (isRecord(value)) {
      // Compile-time narrowing assertion; if the type guard is wrong this line fails tsc.
      const narrowed: Record<string, unknown> = value;
      expect(narrowed["key"]).toBe("value");
    } else {
      throw new Error("type narrowing failed");
    }
  });
});

describe("isRecord — nullish and primitive negatives (battery §2/§3)", () => {
  test("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isRecord(undefined)).toBe(false);
  });

  test("returns false for booleans (true and false)", () => {
    expect(isRecord(true)).toBe(false);
    expect(isRecord(false)).toBe(false);
  });

  test("returns false for numbers (including 0, -0, NaN, Infinity)", () => {
    expect(isRecord(0)).toBe(false);
    expect(isRecord(-0)).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(Number.NaN)).toBe(false);
    expect(isRecord(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRecord(Number.NEGATIVE_INFINITY)).toBe(false);
  });

  test("returns false for bigints", () => {
    expect(isRecord(0n)).toBe(false);
    expect(isRecord(42n)).toBe(false);
  });

  test("returns false for strings (including empty, unicode, control chars)", () => {
    expect(isRecord("")).toBe(false);
    expect(isRecord("abc")).toBe(false);
    expect(isRecord("\u0000")).toBe(false);
    expect(isRecord("\r\n")).toBe(false);
    expect(isRecord("🦊")).toBe(false);
  });

  test("returns false for symbols", () => {
    expect(isRecord(Symbol("s"))).toBe(false);
    expect(isRecord(Symbol.iterator)).toBe(false);
  });
});

describe("isRecord — array and callable negatives (battery §4)", () => {
  test("returns false for empty array", () => {
    expect(isRecord([])).toBe(false);
  });

  test("returns false for populated arrays", () => {
    expect(isRecord([1, 2, 3])).toBe(false);
    expect(isRecord([{ a: 1 }])).toBe(false);
  });

  test("returns false for typed arrays", () => {
    expect(isRecord(new Uint8Array(4))).toBe(false);
    expect(isRecord(new Int16Array(2))).toBe(false);
  });

  test("returns false for ArrayBuffer and DataView", () => {
    const buffer = new ArrayBuffer(8);
    expect(isRecord(buffer)).toBe(false);
    expect(isRecord(new DataView(buffer))).toBe(false);
  });

  test("returns false for arrow and classic functions", () => {
    expect(isRecord(() => 1)).toBe(false);
    expect(isRecord(function named() { return 1; })).toBe(false);
  });

  test("returns false for async and generator functions", () => {
    expect(isRecord(async () => 1)).toBe(false);
    expect(isRecord(function* gen() { yield 1; })).toBe(false);
  });
});

describe("isRecord — built-in object negatives (battery §5 prototype/native types)", () => {
  test("returns false for Date", () => {
    expect(isRecord(new Date())).toBe(false);
  });

  test("returns false for RegExp (including literal form)", () => {
    expect(isRecord(/abc/)).toBe(false);
    expect(isRecord(new RegExp("x"))).toBe(false);
  });

  test("returns false for Map and Set", () => {
    expect(isRecord(new Map())).toBe(false);
    expect(isRecord(new Set())).toBe(false);
    expect(isRecord(new WeakMap())).toBe(false);
    expect(isRecord(new WeakSet())).toBe(false);
  });

  test("returns false for Promise", () => {
    expect(isRecord(Promise.resolve(1))).toBe(false);
  });

  test("returns false for Error instances", () => {
    expect(isRecord(new Error("boom"))).toBe(false);
    expect(isRecord(new TypeError("boom"))).toBe(false);
  });

  test("returns false for class instances with non-Object prototype", () => {
    class Thing {
      value = 42;
    }
    expect(isRecord(new Thing())).toBe(false);
  });

  test("returns false for subclass instances", () => {
    class Base {}
    class Child extends Base {}
    expect(isRecord(new Child())).toBe(false);
  });
});

describe("isRecord — exotic / adversarial cases (battery §6 injection/malformed)", () => {
  test("returns false for Proxy wrapping a function", () => {
    const proxied = new Proxy(function noop() { /* noop */ }, {});
    expect(isRecord(proxied)).toBe(false);
  });

  test("returns true for Proxy wrapping a plain object (proxy is transparent for prototype checks)", () => {
    const target: Record<string, unknown> = { a: 1 };
    const proxied: unknown = new Proxy(target, {});
    expect(isRecord(proxied)).toBe(true);
  });

  test("returns false for objects whose prototype is neither Object.prototype nor null", () => {
    const weirdProto: unknown = Object.create({ inherited: true });
    expect(isRecord(weirdProto)).toBe(false);
  });

  test("returns false for Array.prototype itself", () => {
    expect(isRecord(Array.prototype)).toBe(false);
  });

  test("is resilient to objects with tampered toString / Symbol.toPrimitive", () => {
    const tricky: Record<string, unknown> = {
      toString: () => { throw new Error("should not be called"); },
      [Symbol.toPrimitive]: () => { throw new Error("should not be called"); }
    };
    expect(isRecord(tricky)).toBe(true);
  });

  test("returns true for JSON.parse output (plain object)", () => {
    expect(isRecord(JSON.parse('{"ok":true}'))).toBe(true);
  });

  test("returns false for JSON.parse output (array)", () => {
    expect(isRecord(JSON.parse("[1,2,3]"))).toBe(false);
  });
});
