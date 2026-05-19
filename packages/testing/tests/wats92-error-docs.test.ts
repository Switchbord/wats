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
    const errors = read("docs/reference/errors.md");
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [errors, parity, changelog]) {
      expect(doc).toContain("WATS-92");
      for (const code of ["131050", "132018", "131059", "131064", "134100", "134101", "134102", "134103"]) {
        expect(doc).toContain(code);
      }
      expect(doc).toContain("InvalidTemplateParameterError");
      expect(doc).toContain("TemplateClassificationRateLimitError");
      expect(doc).toContain("MarketingMessagesLiteUnsupportedMessageTypeError");
      expect(doc).toContain("Marketing Messages Lite");
    }
  });
});
