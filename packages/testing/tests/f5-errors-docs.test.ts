// F-5 RED — asserts site/content/docs/reference/errors.mdx rewrite phrases and fixture
// F-5 coverage. These assertions fail until commit 4 ships the rewrite.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function repoRoot(): string {
  // testing/tests/*.test.ts → repoRoot = ../../..
  return resolve(import.meta.dir, "../../..");
}

describe("F-5 errors.md rewrite", () => {
  const errorsDoc = readFileSync(
    join(repoRoot(), "site/content/docs/reference/errors.mdx"),
    "utf8"
  );

  test("contains an 'Error Code Registry' section", () => {
    expect(errorsDoc).toMatch(/##\s+Error Code Registry/i);
  });

  test("documents registerErrorCode, resolveRegisteredError, and clearErrorRegistry", () => {
    expect(errorsDoc).toContain("registerErrorCode");
    expect(errorsDoc).toContain("resolveRegisteredError");
    expect(errorsDoc).toContain("clearErrorRegistry");
  });

  test("documents the tightened OAuth-on-4xx and rate-limit coherence rules", () => {
    expect(errorsDoc).toMatch(/OAuth[^\n]*4xx/i);
    expect(errorsDoc).toMatch(/rate[- ]limit/i);
    expect(errorsDoc).toMatch(/ClientError/i);
    expect(errorsDoc).toMatch(/ServerError/i);
  });

  test("lists concrete seeded subclasses from the pywa-reconciled mapping", () => {
    for (const name of [
      "InvalidParameterError",
      "ToManyAPICallsError",
      "ExpiredAccessTokenError",
      "TemplateParamCountMismatchError",
      "UnsupportedMessageTypeError"
    ]) {
      expect(errorsDoc, `errors.md missing seeded subclass ${name}`).toContain(name);
    }
  });

  test("includes a classification decision tree", () => {
    expect(errorsDoc).toMatch(/classification/i);
    expect(errorsDoc).toMatch(/decision tree|order of checks|classification rules/i);
  });
});

describe("F-5 graph-consumer fixture extension", () => {
  const verifyImports = readFileSync(
    join(
      repoRoot(),
      "packages/testing/fixtures/graph-consumer/verify-imports.ts"
    ),
    "utf8"
  );

  test("fixture imports registerErrorCode + resolveRegisteredError", () => {
    expect(verifyImports).toContain("registerErrorCode");
    expect(verifyImports).toContain("resolveRegisteredError");
  });

  test("fixture imports at least one seeded subclass", () => {
    // Matches any of the seeded names; verifies the fixture exercises
    // the subclass identity across the package boundary.
    expect(verifyImports).toMatch(
      /InvalidParameterError|ToManyAPICallsError|TemplateParamCountMismatchError/
    );
  });

  test("fixture registers a custom error code and resolves it", () => {
    // Required phrases ensure the fixture actually exercises the API
    // rather than merely importing the names.
    expect(verifyImports).toContain("registerErrorCode({");
    expect(verifyImports).toContain("resolveRegisteredError(");
  });
});
