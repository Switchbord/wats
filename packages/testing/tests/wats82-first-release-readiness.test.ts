// WATS-82 RED — first-release readiness and public push sanitization gates.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

interface PublicDocsManifest {
  pages: string[];
  exclude: string[];
}

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

function readJson<T = JsonRecord>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function expectAll(text: string, snippets: readonly string[]): void {
  for (const snippet of snippets) expect(text).toContain(snippet);
}

describe("WATS-82 first-release readiness", () => {
  test("public release readiness doc records sanitized publication gate", () => {
    const doc = read("docs/architecture/wats82-first-release-readiness.md");
    expectAll(doc, [
      "status: readiness-gate",
      "applies-to: WATS-82",
      "switchbord/wats",
      "GH auth currently unavailable",
      "do not push current history public as-is",
      "tracked internal handoff",
      "private planning artifacts",
      "private issue metadata",
      "fresh sanitized public import",
      "LICENSE",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "bun run check-publish",
      "bun run release:dry-run",
      "no live Meta calls"
    ]);
  });

  test("release dry-run script and readiness docs agree on public push blockers", () => {
    const script = read("scripts/release-dry-run.ts");
    const doc = read("docs/architecture/wats82-first-release-readiness.md");
    expectAll(script, ["git", "status", "build:packages", "pack:smoke", "docs:check"]);
    expectAll(doc, [
      "GitHub CLI is installed but unauthenticated",
      "no configured remote",
      "sanitized tree",
      "history rewrite or fresh import",
      "untracked private planning files must not be committed"
    ]);
  });

  test("public docs manifest excludes WATS-82 readiness plan while changelog retains release gate summary", () => {
    const manifest = readJson<PublicDocsManifest>("docs/public-docs-manifest.json");
    const changelog = read("CHANGELOG.md");
    expect(manifest.pages).toContain("architecture/release-policy.md");
    expect(manifest.pages).not.toContain("architecture/wats82-first-release-readiness.md");
    expect(manifest.exclude).toContain("architecture/wats82-first-release-readiness.md");
    expectAll(changelog, [
      "WATS-82",
      "first-release readiness documentation",
      "sanitized public repository",
      "No package publication"
    ]);
  });

  test("package release gates remain wired before public push", () => {
    const manifest = readJson("package.json");
    const scripts = manifest.scripts as JsonRecord;
    expect(String(scripts["check-publish"])).toContain("release:dry-run");
    expect(String(scripts["check-publish"])).toContain("pack:smoke");
    expect(String(scripts["release:dry-run"])).toBe("bun run scripts/release-dry-run.ts");
  });
});
