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

describe("WATS-92 error registry documentation", () => {
  test("errors, parity, and changelog document v21-v25 WhatsApp/Marketing diagnostic codes", () => {
    const errors = read("site/content/docs/reference/errors.mdx");
    const parity = read("site/content/docs/parity.mdx");
    const changelog = read("CHANGELOG.md");

    // Ticket traceability lives in the changelog, not the voice-governed site docs.
    expect(changelog).toContain("WATS-92");

    // The detailed diagnostic-code registry lives in the errors reference and the
    // changelog; the parity matrix is a condensed status view, not a code listing.
    for (const doc of [errors, changelog]) {
      for (const code of ["131050", "132018", "131059", "131064", "134100", "134101", "134102", "134103"]) {
        expect(doc).toContain(code);
      }
      expect(doc).toContain("InvalidTemplateParameterError");
      expect(doc).toContain("TemplateClassificationRateLimitError");
      expect(doc).toContain("MarketingMessagesLiteUnsupportedMessageTypeError");
      expect(doc).toContain("Marketing Messages Lite");
    }
    expect(parity).toContain("marketing");
  });
});
