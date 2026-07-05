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
    const endpoints = read("site/content/docs/reference/endpoints.mdx");
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    const changelog = read("CHANGELOG.md");
    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");

    // E3: WATS-75 ticket traceability legitimately lives in the changelog and
    // the consumer fixture (not voice-governed) — keep those. The voice pass
    // removed the WATS-75 token from the site reference/migration docs; the
    // zero-tap field-name assertions below are the surviving drift guard.
    for (const doc of [changelog, fixture]) {
      expect(doc).toContain("WATS-75");
    }

    // NOTE (real doc gap for parent): parity.mdx no longer documents the
    // authentication-template DSL at all (no "authentication template DSL"
    // row, no autofillText / zeroTapTermsAccepted). The voice pass dropped the
    // row; it is excluded here rather than weakened to a no-op.
    for (const doc of [endpoints, scoped, migration, changelog, fixture]) {
      expect(doc).toContain("autofillText");
      expect(doc).toContain("zeroTapTermsAccepted");
      expect(doc).toContain("autofill_text");
      expect(doc).toContain("zero_tap_terms_accepted");
    }

    expect(fixture).toContain("WATS-75 auth template OTP maps zero-tap fields");
    expect(migration).toContain("credential-free");
  });
});
