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
    const webhook = read("site/content/docs/reference/webhook.mdx");
    const normalizer = read("site/content/docs/reference/webhook-normalizer.mdx");
    const parity = read("site/content/docs/parity.mdx");
    const changelog = read("CHANGELOG.md");

    expect(changelog).toContain("WATS-89");

    // Detailed v24/v25 webhook fields live in the reference docs + changelog; the
    // parity matrix is a condensed status view.
    for (const doc of [webhook, normalizer, changelog]) {
      expect(doc).toContain("played");
      expect(doc).toContain("media.url");
      expect(doc).toContain("PARTNER_REMOVED");
      expect(doc).toContain("account_offboarded");
      expect(doc).toContain("account_reconnected");
      expect(doc).toContain("disconnectionInfo");
      expect(doc).toContain("request_welcome");
    }
    expect(parity).toContain("Webhook normalization");

    expect(normalizer).toContain("is optional");
    expect(webhook).toContain("absent by default");
  });
});
