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

describe("WATS-91 business limits/template cursor docs", () => {
  test("reference docs capture portfolio messaging-limit fields, 131059, and opt-in cursor retry guidance", () => {
    const errors = read("docs/reference/errors.md");
    const pagination = read("docs/reference/pagination.md");
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [errors, pagination, parity, changelog]) {
      expect(doc).toContain("WATS-91");
      expect(doc).toContain("whatsapp_business_manager_messaging_limit");
      expect(doc).toContain("messaging_limit_tier");
      expect(doc).toContain("131059");
      expect(doc).toContain("InvalidTemplateCursorError");
      expect(doc).toContain("message_templates");
    }

    expect(pagination).toContain("retry without before/after");
    expect(pagination).toContain("opt-in");
  });
});
