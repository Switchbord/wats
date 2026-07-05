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
    const changelog = read("CHANGELOG.md");
    const parity = read("site/content/docs/parity.mdx");
    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    // Detailed template-group APIs live in the reference docs, package map, and
    // changelog; parity/migration are condensed status views.
    const detailedDocs = [
      read("site/content/docs/reference/endpoints.mdx"),
      read("site/content/docs/reference/scoped-clients.mdx"),
      read("site/content/docs/concepts/package-map.mdx"),
      changelog
    ];
    // Ticket traceability lives in the changelog, not the voice-governed site docs.
    expect(changelog).toContain("WATS-94");
    for (const doc of detailedDocs) {
      expect(doc).toContain("template_groups");
      expect(doc).toContain("template_group_analytics");
      expect(doc).toContain("listTemplateGroups");
      expect(doc).toContain("getTemplateGroupAnalytics");
    }
    expect(parity).toContain("template-group analytics");
    expect(migration).toContain("template");
  });
});
