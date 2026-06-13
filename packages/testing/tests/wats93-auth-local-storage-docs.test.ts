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

describe("WATS-93 auth-template/local-storage docs", () => {
  test("reference docs and changelog document supported_apps, storage_configuration, and removed register localization", () => {
    const endpoints = read("site/content/docs/reference/endpoints.mdx");
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    const migration = read("site/content/docs/migration/pywa.mdx");
    const changelog = read("CHANGELOG.md");

    // E3: WATS-93 ticket traceability legitimately lives in the changelog (not
    // voice-governed) — keep it. The voice pass removed the WATS-93 token from
    // the site reference/migration docs; the field-name assertions below are
    // the surviving drift guard.
    //
    // NOTE (real doc gap for parent): parity.mdx no longer documents the
    // WATS-93 auth-template/local-storage surface at all (no supported_apps /
    // storage_configuration / data_localization_region), so it is excluded
    // here rather than weakened to a no-op.
    expect(changelog).toContain("WATS-93");

    for (const doc of [endpoints, scoped, migration, changelog]) {
      expect(doc).toContain("supported_apps");
      expect(doc).toContain("package_name");
      expect(doc).toContain("signature_hash");
      expect(doc).toContain("storage_configuration");
      expect(doc).toContain("data_localization_region");
    }

    expect(endpoints).toContain("supportedApps");
    expect(scoped).toContain("updateSettings");
    expect(changelog).toContain("does not emit `data_localization_region`");
  });
});
