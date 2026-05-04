// F-5 remediation (WATS-29) RED: pywa-parity regression.
//
// Parses /tmp/wats-research/pywa/pywa/errors.py at test time and extracts
// the canonical (code → class, axis) mapping. For EACH pywa entry the
// WATS seed claims to cover, we assert:
//   (a) the code is seeded in the WATS registry,
//   (b) the resolved subclass name matches the pywa class name
//       (case-insensitive; optional trailing "Error" suffix on the WATS
//       side is ignored),
//   (c) the parent-class axis matches (auth / rate-limit / other).
//
// If the pywa source is not present on disk (e.g. running in CI without
// the research checkout), the suite emits a single placeholder test that
// skips gracefully — per the task brief.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  resolveRegisteredError,
  type GraphErrorFactoryContext
} from "../src/errorRegistry";
import {
  GraphApiError,
  GraphAuthError,
  GraphRateLimitError
} from "../src/errors";
// Side-effect import: seeds the built-in registry.
import "../src/errorSubclasses";

const PYWA_ERRORS_PATH = "/tmp/wats-research/pywa/pywa/errors.py";

type Axis = "auth" | "rate-limit" | "other";

interface PywaEntry {
  readonly code: number;
  readonly className: string;
  readonly axis: Axis;
}

interface PywaRange {
  readonly start: number;
  readonly endExclusive: number;
  readonly className: string;
  readonly axis: Axis;
}

const AXIS_BY_BASE: Record<string, Axis> = {
  AuthorizationError: "auth",
  ThrottlingError: "rate-limit",
  IntegrityError: "other",
  SendMessageError: "other",
  FlowError: "other",
  BlockUserError: "other",
  CallingError: "other"
};

function parsePywaErrors(source: string): {
  readonly entries: readonly PywaEntry[];
  readonly ranges: readonly PywaRange[];
} {
  const entries: PywaEntry[] = [];
  const ranges: PywaRange[] = [];

  // Match class declarations that extend a known base. Look-ahead
  // captures the `__error_codes__` assignment that follows.
  const classRegex =
    /class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*:([\s\S]*?)(?=\nclass\s|\n#\s*={3,}|$)/g;

  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(source)) !== null) {
    const className = match[1]!;
    const baseName = match[2]!;
    const body = match[3]!;
    const axis = AXIS_BY_BASE[baseName];
    if (axis === undefined) {
      continue; // base class itself or unrelated subclass
    }
    const codesMatch = /__error_codes__\s*=\s*([^\n]+)/.exec(body);
    if (codesMatch === null) {
      continue;
    }
    const codesExpr = codesMatch[1]!.trim();
    if (codesExpr === "None") {
      continue;
    }
    // range(start, end) form
    const rangeMatch = /range\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(codesExpr);
    if (rangeMatch !== null) {
      ranges.push({
        start: Number.parseInt(rangeMatch[1]!, 10),
        endExclusive: Number.parseInt(rangeMatch[2]!, 10),
        className,
        axis
      });
      continue;
    }
    // tuple form: (x,) or (x, y, ...)
    const tupleMatch = /\(([^)]*)\)/.exec(codesExpr);
    if (tupleMatch !== null) {
      const inner = tupleMatch[1]!;
      for (const chunk of inner.split(",")) {
        const trimmed = chunk.trim();
        if (trimmed.length === 0) {
          continue;
        }
        const codeNum = Number.parseInt(trimmed, 10);
        if (Number.isFinite(codeNum)) {
          entries.push({ code: codeNum, className, axis });
        }
      }
    }
  }

  return { entries, ranges };
}

function normalize(name: string): string {
  // Strip trailing "Error" suffix once, lowercase. "AuthException" stays
  // as "authexception"; "ExpiredAccessTokenError" → "expiredaccesstoken";
  // pywa "ExpiredAccessToken" → "expiredaccesstoken".
  const stripped = name.endsWith("Error") ? name.slice(0, -"Error".length) : name;
  return stripped.toLowerCase();
}

function axisOfInstance(instance: GraphApiError): Axis {
  if (instance instanceof GraphAuthError) {
    return "auth";
  }
  if (instance instanceof GraphRateLimitError) {
    return "rate-limit";
  }
  return "other";
}

function ctxFor(code: number): GraphErrorFactoryContext {
  return {
    payload: { message: `pywa-parity probe for code ${code}`, code },
    status: 400,
    headers: new Headers(),
    requestUrl: ""
  };
}

describe("F-5 pywa-parity: seed table mirrors pywa/errors.py", () => {
  if (!existsSync(PYWA_ERRORS_PATH)) {
    test.skip("pywa/errors.py not available on disk — skipping parity sweep", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const source = readFileSync(PYWA_ERRORS_PATH, "utf8");
  const { entries: pywaEntries, ranges: pywaRanges } = parsePywaErrors(source);

  test("parser extracts a non-trivial set of pywa entries", () => {
    expect(pywaEntries.length).toBeGreaterThan(30);
  });

  for (const entry of pywaEntries) {
    test(`pywa code ${entry.code} (${entry.className}) is seeded with matching name + axis`, () => {
      const registryEntry = resolveRegisteredError(entry.code, undefined);
      expect(
        registryEntry,
        `code ${entry.code} (${entry.className}) missing from WATS seed`
      ).toBeDefined();
      if (registryEntry === undefined) {
        return;
      }
      // (b) name parity — case-insensitive, Error-suffix stripped.
      expect(
        normalize(registryEntry.errorName),
        `code ${entry.code}: WATS seed name "${registryEntry.errorName}" does not match pywa "${entry.className}"`
      ).toBe(normalize(entry.className));
      // (c) axis parity.
      const instance = registryEntry.factory(ctxFor(entry.code));
      expect(
        axisOfInstance(instance),
        `code ${entry.code} (${entry.className}): axis mismatch`
      ).toBe(entry.axis);
    });
  }

  // pywa declares APIPermission as range(200, 300). WATS registers a
  // single representative code (200) and documents the fall-through. The
  // parity test accepts either (a) explicit registration of 200 with a
  // matching class, or (b) a range-scoped registration covering 200.
  for (const range of pywaRanges) {
    const representative = range.start;
    test(`pywa range ${range.start}..${range.endExclusive} (${range.className}) has a representative seeded at ${representative}`, () => {
      const registryEntry = resolveRegisteredError(representative, undefined);
      expect(
        registryEntry,
        `representative code ${representative} for range ${range.start}..${range.endExclusive} (${range.className}) is not seeded`
      ).toBeDefined();
      if (registryEntry === undefined) {
        return;
      }
      expect(normalize(registryEntry.errorName)).toBe(normalize(range.className));
      const instance = registryEntry.factory(ctxFor(representative));
      expect(axisOfInstance(instance)).toBe(range.axis);
    });
  }
});

describe("F-5 pywa-parity: no fabricated codes that pywa does not list", () => {
  if (!existsSync(PYWA_ERRORS_PATH)) {
    test.skip("pywa/errors.py not available — skipping fabrication check", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const source = readFileSync(PYWA_ERRORS_PATH, "utf8");
  // Codes that were previously invented in WATS without pywa support.
  // Asserting ABSENCE forces the reconciliation to actually drop them.
  const fabricatedCodes: ReadonlyArray<{ code: number; reason: string }> = [
    { code: 102, reason: "SessionExpiredError — not in pywa" },
    { code: 463, reason: "ExpiredAccessTokenError @ 463 — pywa places ExpiredAccessToken at 190" }
  ];

  for (const { code, reason } of fabricatedCodes) {
    test(`code ${code} should not appear as a pywa entry (${reason})`, () => {
      const matches = Array.from(
        source.matchAll(/__error_codes__\s*=\s*\(([^)]*)\)/g)
      )
        .flatMap((m) => m[1]!.split(","))
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
      expect(
        matches.includes(code),
        `code ${code} unexpectedly present in pywa (${reason})`
      ).toBe(false);
      // Correspondingly, the WATS seed must not register this code
      // under a fabricated name — either unregistered or registered
      // under a legitimate pywa-sourced mapping.
      const entry = resolveRegisteredError(code, undefined);
      if (entry !== undefined) {
        // If present, its errorName must match SOMETHING pywa declares
        // for that code — but since we just proved pywa does not list
        // this code, any registration is a fabrication.
        throw new Error(
          `WATS registry still has a fabricated entry for code ${code} (${entry.errorName}); pywa does not list this code`
        );
      }
      expect(entry).toBeUndefined();
    });
  }
});
