import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; private?: boolean };
      if (manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function expectAll(text: string, needles: readonly string[], label: string): void {
  for (const needle of needles) expect(text, `${label} missing ${needle}`).toContain(needle);
}

describe("WATS-109/WATS-117 release governance docs", () => {
  test("repo settings doc captures reproducible branch protection, required CI, Dependabot, and CodeQL hygiene", () => {
    const doc = read("docs/maintainers/repo-settings.md");
    expectAll(doc, [
      "WATS-109",
      "Require pull requests before merging",
      "Require at least one approving review",
      "Bun tests and release hygiene",
      "No force pushes on `main`",
      "Signed commits are optional",
      "Dependabot",
      "github-actions",
      "npm",
      "CodeQL",
      "weekly",
      "gh api repos/Switchbord/wats",
      "branch protection snapshot"
    ], "repo settings doc");

    expect(doc).toMatch(/settings applied by maintainers outside this PR|apply these settings in GitHub before announce/iu);
    expect(doc).not.toMatch(/access[_-]?token\s*[:=]|app[_-]?secret\s*[:=]|Bearer\s+[A-Za-z0-9_.-]{12,}/iu);
  });

  test("Dependabot and CodeQL workflows are checked in with safe low-privilege settings", () => {
    const dependabot = read(".github/dependabot.yml");
    expectAll(dependabot, [
      "version: 2",
      "package-ecosystem: \"npm\"",
      "package-ecosystem: \"github-actions\"",
      "directory: \"/\"",
      "open-pull-requests-limit"
    ], "dependabot config");

    const codeql = read(".github/workflows/codeql.yml");
    expectAll(codeql, [
      "name: CodeQL",
      "security-events: write",
      "contents: read",
      "github/codeql-action/init",
      "github/codeql-action/analyze",
      "javascript-typescript",
      "cron:"
    ], "codeql workflow");
    expect(codeql).not.toMatch(/secrets\.|LINEAR_API_KEY|NPM_TOKEN|META_|WHATSAPP_/u);
  });

  test("README carries the CI badge and maintainer docs are public-manifest excluded deliberately", () => {
    const readme = read("README.md");
    expect(readme).toContain("actions/workflows/ci.yml/badge.svg");
    expect(readme).toContain("actions/workflows/ci.yml");

    const manifest = readJson<{ pages?: string[]; exclude?: string[] }>("docs/public-docs-manifest.json");
    expect(manifest.pages ?? []).not.toContain("maintainers/repo-settings.md");
    expect(manifest.pages ?? []).not.toContain("maintainers/launch-checklist.md");
    expect(manifest.exclude ?? []).toContain("maintainers/**");
  });

  test("launch checklist and announce draft cover public-alpha launch day without claiming release side effects", () => {
    const checklist = read("docs/maintainers/launch-checklist.md");
    const announce = read("docs/maintainers/announce-draft.md");

    expectAll(checklist, [
      "WATS-117",
      "docs site green",
      "npm publishes done with provenance",
      "GitHub release notes",
      "badges live",
      "When NOT to use WATS",
      "telemetry stance live",
      "example bot working",
      "first 48 hours",
      "on-call",
      "dry-run pass"
    ], "launch checklist");

    expectAll(announce, [
      "WATS public alpha",
      "@wats/cli",
      "bunx --bun @wats/cli",
      "No live Meta credentials are required",
      "When NOT to use WATS",
      "no maintainer-owned telemetry",
      "examples/minimal-bot",
      "Feedback"
    ], "announce draft");

    for (const text of [checklist, announce]) {
      expect(text).not.toMatch(/has been published to npm|GitHub Release is live|provenance attestation verified/iu);
      expect(text).not.toMatch(/access[_-]?token\s*[:=]|app[_-]?secret\s*[:=]|Bearer\s+[A-Za-z0-9_.-]{12,}/iu);
    }
  });

  test("changelog records WATS-109 and WATS-117 as release-governance docs-only work", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("WATS-109");
    expect(changelog).toContain("WATS-117");
    expect(changelog).toContain("repo settings hygiene");
    expect(changelog).toContain("launch-day checklist");
    expect(changelog).not.toContain("provenance attestation verified for 0.3.4");
  });
});
