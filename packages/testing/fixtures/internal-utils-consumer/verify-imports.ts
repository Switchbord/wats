// Consumer fixture for @wats/internal-utils.
//
// This file is imported from the fixture runtime via the published
// specifier "@wats/internal-utils" (not via relative paths), which is
// exactly how a downstream workspace package would use it. It prints a
// single-line JSON report on stdout with a success sentinel so the
// runner under packages/testing/tests/ can assert the contract.
//
// A failure inside verify() must throw; the runner treats a non-zero
// exit code as a fixture failure.

import { isRecord, containsUnsafePathSegment } from "@wats/internal-utils";

interface VerifyReportOk {
  readonly ok: true;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly sentinel: "internal-utils-consumer:ok";
}

function verify(): VerifyReportOk {
  const checks: Record<string, boolean> = {
    "isRecord is a function": typeof isRecord === "function",
    "isRecord({}) === true": isRecord({}) === true,
    "isRecord(null) === false": isRecord(null) === false,
    "isRecord([]) === false": isRecord([]) === false,
    "isRecord(Object.create(null)) === true": isRecord(Object.create(null) as unknown) === true,
    "isRecord(new Date()) === false": isRecord(new Date()) === false,
    "isRecord('s') === false": isRecord("s") === false,
    "containsUnsafePathSegment is a function": typeof containsUnsafePathSegment === "function",
    "containsUnsafePathSegment('..') === true": containsUnsafePathSegment("..") === true,
    "containsUnsafePathSegment('%2e%2e') === true": containsUnsafePathSegment("%2e%2e") === true,
    "containsUnsafePathSegment('\\\\') === true": containsUnsafePathSegment("\\") === true,
    "containsUnsafePathSegment(':') === true": containsUnsafePathSegment(":") === true,
    "containsUnsafePathSegment('%2f') === true": containsUnsafePathSegment("%2f") === true,
    "containsUnsafePathSegment('%5c') === true": containsUnsafePathSegment("%5c") === true,
    "containsUnsafePathSegment('') === true": containsUnsafePathSegment("") === true,
    "containsUnsafePathSegment(42) === true": containsUnsafePathSegment(42) === true,
    "containsUnsafePathSegment('wats.sqlite') === false": containsUnsafePathSegment("wats.sqlite") === false,
    "containsUnsafePathSegment('/var/lib/wats') === false": containsUnsafePathSegment("/var/lib/wats") === false
  };

  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) {
      throw new Error(`internal-utils-consumer check failed: ${label}`);
    }
  }

  return {
    ok: true,
    checks,
    sentinel: "internal-utils-consumer:ok"
  };
}

const report = verify();
console.log(JSON.stringify(report));
