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
    const errors = read("site/content/docs/reference/errors.mdx");
    const pagination = read("site/content/docs/reference/pagination.mdx");
    const changelog = read("CHANGELOG.md");

    // CHANGELOG is not voice-governed: keep the WATS-91 ticket ref plus feature terms.
    expect(changelog).toContain("WATS-91");

    // Site MDX (errors/pagination) had WATS-91 stripped by the voice pass; the
    // feature/API-name terms below are the surviving drift guard. parity.mdx is a
    // high-level capability matrix and never carried these granular error/cursor
    // fields (DOC-GAP for parent: parity.mdx does not enumerate WATS-91 specifics —
    // they live in the errors/pagination references and the changelog instead).
    for (const doc of [errors, pagination, changelog]) {
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
