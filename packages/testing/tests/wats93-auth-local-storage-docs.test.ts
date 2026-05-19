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
    const endpoints = read("docs/reference/endpoints.md");
    const scoped = read("docs/reference/scoped-clients.md");
    const migration = read("docs/migration/pywa-to-wats.md");
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [endpoints, scoped, migration, parity, changelog]) {
      expect(doc).toContain("WATS-93");
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
