// F-7 RED — asserts site/content/docs/reference/scoped-clients.mdx content and the
// graph-consumer fixture extension for PhoneNumberClient + WABAClient.
// These checks fail until the F-7 GREEN (commit 4) ships the reference
// guide in full and lands the parity-matrix + CHANGELOG updates.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function repoRoot(): string {
  // testing/tests/*.test.ts → repoRoot = ../../..
  return resolve(import.meta.dir, "../../..");
}

describe("F-7 scoped-clients.md reference guide", () => {
  const doc = readFileSync(
    join(repoRoot(), "site/content/docs/reference/scoped-clients.mdx"),
    "utf8"
  );

  test("contains a PhoneNumberClient section", () => {
    expect(doc).toMatch(/##\s+PhoneNumberClient/i);
  });

  test("contains a WABAClient section", () => {
    expect(doc).toMatch(/##\s+WABAClient/i);
  });

  test("documents construction validation reusing F-6 sanitization", () => {
    expect(doc).toMatch(/construction/i);
    expect(doc).toMatch(/phoneNumberId/);
    expect(doc).toMatch(/wabaId/);
    expect(doc).toMatch(/assertSafePathParamValue|F-6|path-param sanitiz/i);
  });

  test("documents bound-id path substitution + delegation to endpoint callables", () => {
    expect(doc).toMatch(/\{phoneNumberId\}|\/\{phoneNumberId\}\//);
    expect(doc).toMatch(/\{wabaId\}|\/\{wabaId\}\//);
    expect(doc).toMatch(/sendMessage/);
    expect(doc).toMatch(/listPhoneNumbers/);
  });

  test("documents interplay with the F-5 error registry (sibling-NOT language)", () => {
    expect(doc).toMatch(/F-5|resolveRegisteredError|error registry/i);
    expect(doc).toMatch(/UnsupportedMessageTypeError|InvalidParameterError/);
  });

  test("contains a method-catalog and forward-declared future methods", () => {
    // Voice pass reworded "forward-declared / later F-step" provenance phrasing.
    // The fact survives: a "Method catalog" heading plus methods marked
    // "not implemented yet" / "unimplemented".
    expect(doc).toMatch(/method catalog|methods/i);
    expect(doc).toMatch(/not implemented yet|unimplemented|credential-gated/i);
  });

  test("contains a usage code sample in TypeScript", () => {
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("new PhoneNumberClient");
    expect(doc).toContain("new WABAClient");
  });
});

describe("F-7 graph-consumer fixture extension", () => {
  const verifyImports = readFileSync(
    join(
      repoRoot(),
      "packages/testing/fixtures/graph-consumer/verify-imports.ts"
    ),
    "utf8"
  );

  test("fixture imports PhoneNumberClient + WABAClient + listPhoneNumbers", () => {
    expect(verifyImports).toContain("PhoneNumberClient");
    expect(verifyImports).toContain("WABAClient");
    expect(verifyImports).toContain("listPhoneNumbers");
  });

  test("fixture constructs PhoneNumberClient via `new`", () => {
    expect(verifyImports).toMatch(/new PhoneNumberClient\s*\(/);
  });

  test("fixture constructs WABAClient via `new`", () => {
    expect(verifyImports).toMatch(/new WABAClient\s*\(/);
  });

  test("fixture asserts PhoneNumberClient URL substitution", () => {
    expect(verifyImports).toMatch(/v25\.0\/555000111\/messages/);
  });

  test("fixture asserts WABAClient URL substitution (phone_numbers)", () => {
    expect(verifyImports).toMatch(/v25\.0\/9876543210\/phone_numbers/);
  });

  test("fixture asserts construction-time rejection of invalid phoneNumberId", () => {
    expect(verifyImports).toMatch(
      /PhoneNumberClient rejects unsafe phoneNumberId at construction/
    );
  });
});

describe("F-7 CHANGELOG", () => {
  const changelog = readFileSync(join(repoRoot(), "CHANGELOG.md"), "utf8");

  test("contains a [0.2.0-f7] section header", () => {
    expect(changelog).toMatch(/\[0\.2\.0-f7\]/);
  });

  test("mentions PhoneNumberClient and WABAClient", () => {
    expect(changelog).toContain("PhoneNumberClient");
    expect(changelog).toContain("WABAClient");
  });
});

describe("F-7 parity matrix", () => {
  const matrix = readFileSync(
    join(repoRoot(), "site/content/docs/parity.mdx"),
    "utf8"
  );

  test("documents the scoped sub-clients row with a status tag", () => {
    // Voice pass removed the WATS-19 ticket ref + F-7 addressed-by phase label.
    // The scoped sub-clients row and its status tag survive.
    expect(matrix).toMatch(/[Ss]coped sub-clients/);
    expect(matrix).toMatch(/PhoneNumberClient/);
    expect(matrix).toMatch(/live-validated|shape-only/);
  });
});
