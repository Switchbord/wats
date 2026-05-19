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

describe("WATS-89 webhook v24/v25 docs", () => {
  test("reference docs capture played, media url, unsupported details, and coexistence events", () => {
    const webhook = read("docs/reference/webhook.md");
    const normalizer = read("docs/reference/webhook-normalizer.md");
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [webhook, normalizer, parity, changelog]) {
      expect(doc).toContain("WATS-89");
      expect(doc).toContain("played");
      expect(doc).toContain("media.url");
      expect(doc).toContain("PARTNER_REMOVED");
      expect(doc).toContain("account_offboarded");
      expect(doc).toContain("account_reconnected");
      expect(doc).toContain("disconnectionInfo");
      expect(doc).toContain("request_welcome");
    }

    expect(normalizer).toContain("conversation is optional");
    expect(webhook).toContain("conversation is absent by default");
  });
});
