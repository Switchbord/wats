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

describe("WATS-94 template group docs", () => {
  test("reference, consumer docs, parity, and changelog document template_groups and analytics", () => {
    const docs = [
      read("docs/reference/endpoints.md"),
      read("docs/reference/scoped-clients.md"),
      read("docs/migration/pywa-to-wats.md"),
      read("docs/parity/pywa-parity-matrix.md"),
      read("docs/architecture/package-map.md"),
      read("CHANGELOG.md")
    ];
    for (const doc of docs) {
      expect(doc).toContain("WATS-94");
      expect(doc).toContain("template_groups");
      expect(doc).toContain("template_group_analytics");
      expect(doc).toContain("listTemplateGroups");
      expect(doc).toContain("getTemplateGroupAnalytics");
    }
  });
});
