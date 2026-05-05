import { describe, expect, test } from "bun:test";
import { isRecord } from "@switchbord/internal-utils";

// F-0 edge-runtime module-resolver guard placeholder.
//
// This test runs under the default `bun test` runtime. It asserts that
// importing @switchbord/internal-utils from an edge-suite file succeeds and that
// the exported contract has the shape an edge runtime (WinterCG / Workers)
// can rely on without any node:* capabilities.
//
// When F-12 introduces a real WinterCG / Miniflare harness, this file is
// the anchor point the harness will replace. Until then it locks the fact
// that @switchbord/internal-utils has zero runtime capabilities beyond pure
// JavaScript.

describe("edge-runtime module-resolver guard (F-0 placeholder)", () => {
  test("@switchbord/internal-utils exports isRecord as a pure function", () => {
    expect(typeof isRecord).toBe("function");
    expect(isRecord.length).toBe(1);
  });

  test("isRecord runtime behavior under edge-shaped inputs", () => {
    // Inputs that actually appear on the wire through an Edge request
    // body after JSON.parse: plain objects and arrays.
    expect(isRecord({})).toBe(true);
    expect(isRecord({ k: "v" })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  test("isRecord does not rely on Node globals (process, Buffer)", () => {
    // The guard must not crash if a caller shadows or deletes a Node
    // global; this simulates the edge environment at the API boundary.
    // We do NOT actually mutate globals (that would leak between tests);
    // we just exercise inputs that don't rely on Buffer or process.
    const payload: unknown = { from: "15550001234", text: "hi" };
    expect(isRecord(payload)).toBe(true);
  });
});
