import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS-75 auth-template DSL docs and consumer lockstep", () => {
  test("docs and consumer fixture document zero-tap auth-template fields", () => {
    const endpoints = read("docs/reference/endpoints.md");
    const scoped = read("docs/reference/scoped-clients.md");
    const migration = read("docs/migration/pywa-to-wats.md");
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const changelog = read("CHANGELOG.md");
    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");

    for (const doc of [endpoints, scoped, migration, parity, changelog, fixture]) {
      expect(doc).toContain("WATS-75");
      expect(doc).toContain("autofillText");
      expect(doc).toContain("zeroTapTermsAccepted");
      expect(doc).toContain("autofill_text");
      expect(doc).toContain("zero_tap_terms_accepted");
    }

    expect(fixture).toContain("WATS-75 auth template OTP maps zero-tap fields");
    expect(parity).toContain("authentication template DSL");
    expect(migration).toContain("credential-free");
  });
});
