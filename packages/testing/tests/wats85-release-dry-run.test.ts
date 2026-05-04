// WATS-85 RED — release automation and provenance dry-run workflow.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson(path: string): JsonRecord {
  return JSON.parse(read(path)) as JsonRecord;
}

function expectAll(text: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe("WATS-85 release dry-run automation", () => {
  test("root manifest exposes a credential-free release dry-run gate", () => {
    const manifest = readJson("package.json");
    const scripts = manifest.scripts as JsonRecord;

    expect(scripts["release:dry-run"]).toBe("bun run scripts/release-dry-run.ts");
    expect(String(scripts["check-publish"])).toContain("bun run release:dry-run");
  });

  test("release dry-run script checks provenance inputs without publishing", () => {
    const script = read("scripts/release-dry-run.ts");
    expectAll(script, [
      "WATS_RELEASE_DRY_RUN",
      "git",
      "status",
      "build:packages",
      "pack:smoke",
      "LICENSE",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "private false",
      "provenance",
      "no package publication",
      "no GitHub release"
    ]);
    for (const forbidden of ["npm publish", "bun publish", "gh release create", "git tag", "git push", "docker push", "registry login"]) {
      expect(script).not.toContain(forbidden);
    }
  });

  test("GitHub Actions workflow runs dry-run only on manual dispatch and has no secrets", () => {
    const workflow = read(".github/workflows/release-dry-run.yml");
    expectAll(workflow, [
      "name: Release dry-run",
      "workflow_dispatch:",
      "permissions:",
      "contents: read",
      "id-token: none",
      "persist-credentials: false",
      "bun run release:dry-run",
      "WATS_RELEASE_DRY_RUN: \"1\""
    ]);
    expect(workflow).not.toMatch(/secrets\.|NPM_TOKEN|GITHUB_TOKEN|META|WHATSAPP|APP_SECRET/);
    for (const forbiddenTrigger of ["push:", "pull_request:", "schedule:", "workflow_call:"]) {
      expect(workflow).not.toContain(forbiddenTrigger);
    }
    expect(workflow).not.toContain("npm publish");
    expect(workflow).not.toContain("gh release create");
  });

  test("release policy and changelog document WATS-85 boundary", () => {
    const releasePolicy = read("docs/architecture/release-policy.md");
    const changelog = read("CHANGELOG.md");
    expectAll(releasePolicy, [
      "WATS-85 release automation dry-run",
      "manual GitHub Actions `workflow_dispatch`",
      "credential-free",
      "provenance preflight",
      "no publishing authority",
      "no tags/releases"
    ]);
    expectAll(changelog, [
      "credential-free release dry-run workflow",
      "bun run release:dry-run",
      "credential-free provenance preflight",
      "no package publication",
      "No GitHub release/tag creation"
    ]);
  });
});
