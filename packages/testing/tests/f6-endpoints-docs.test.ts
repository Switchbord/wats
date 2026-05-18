// F-6 RED — asserts docs/reference/endpoints.md contents and
// graph-consumer fixture extension. These checks fail until commit 4
// ships the reference doc and extends the fixture.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function repoRoot(): string {
  // testing/tests/*.test.ts → repoRoot = ../../..
  return resolve(import.meta.dir, "../../..");
}

describe("F-6 endpoints.md reference guide", () => {
  const endpointsDoc = readFileSync(
    join(repoRoot(), "docs/reference/endpoints.md"),
    "utf8"
  );

  test("contains a 'defineEndpoint' section", () => {
    expect(endpointsDoc).toMatch(/##\s+defineEndpoint/i);
  });

  test("documents path-template syntax, param kinds, and body handling", () => {
    expect(endpointsDoc).toMatch(/path[- ]template/i);
    expect(endpointsDoc).toMatch(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/);
    expect(endpointsDoc).toMatch(/path parameter/i);
    expect(endpointsDoc).toMatch(/query parameter/i);
    expect(endpointsDoc).toContain("buildBody");
  });

  test("documents integration with GraphClient.request and F-5 error registry", () => {
    expect(endpointsDoc).toContain("GraphClient");
    expect(endpointsDoc).toMatch(/F-5|error registry|resolveRegisteredError/i);
  });

  test("documents both invocation shapes (class + endpoint-registry)", () => {
    expect(endpointsDoc).toContain("GraphMessagesEndpoint");
    expect(endpointsDoc).toContain("sendMessage");
  });

  test("contains a 'Custom endpoint' tutorial with a code sample", () => {
    expect(endpointsDoc).toMatch(/custom endpoint/i);
    expect(endpointsDoc).toMatch(/```[ \t]*(ts|typescript)/i);
  });
});

describe("F-6 graph-consumer fixture extension", () => {
  const verifyImports = readFileSync(
    join(
      repoRoot(),
      "packages/testing/fixtures/graph-consumer/verify-imports.ts"
    ),
    "utf8"
  );

  test("fixture imports defineEndpoint", () => {
    expect(verifyImports).toContain("defineEndpoint");
  });

  test("fixture imports sendMessage endpoint-registry callable", () => {
    expect(verifyImports).toContain("sendMessage");
  });

  test("fixture defines and invokes a custom endpoint", () => {
    // Required phrases ensure the fixture actually exercises the API
    // rather than merely importing the names.
    expect(verifyImports).toMatch(/defineEndpoint[<(]/);
    expect(verifyImports).toMatch(/pathTemplate:/);
  });
});
