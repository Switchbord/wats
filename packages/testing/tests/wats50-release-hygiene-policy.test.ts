// WATS-50 RED — release hygiene policy and maintainer skill docs lock.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function expectAll(text: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe("WATS-50 release hygiene policy and skill", () => {
  test("design doc records release hygiene policy, semver, and safety boundaries", () => {
    const design = read("docs/architecture/wats50-release-hygiene-policy.md");

    expectAll(design, [
      "status: design",
      "applies-to: WATS-50",
      "Linear remains the source of truth",
      "release classification",
      "every merged alpha PR",
      "patch-class",
      "minor changes on `0.x`",
      "changelog",
      "public docs manifest",
      "no in-repo deferred ledgers",
      "changesets or equivalent",
      "no package publication",
      "no GitHub release",
      "no tag creation",
      "no Docker image publication",
      "no branch-protection mutation",
      "no public repo creation",
      "no credentialed CI",
      "no live Meta calls"
    ]);
  });

  test("release policy records WATS-50 as policy and skill only", () => {
    const releasePolicy = read("docs/architecture/release-policy.md");

    expectAll(releasePolicy, [
      "WATS-50 release hygiene policy",
      "design/docs/test-planner/workflow only",
      "patch-class",
      "every merged alpha PR",
      "documented alpha train",
      "changesets or equivalent",
      "not implemented by this slice",
      "Linear, not repo-local deferred ledgers"
    ]);
  });

  test("ADR-007 and alpha plan use current WATS-50/WATS-51 numbering", () => {
    const adr = read("docs/architecture/decisions/ADR-007-alpha-cli-runtime-operator-layer.md");
    const plan = read("docs/architecture/alpha-cli-runtime-operations-plan.md");

    expectAll(adr, [
      "WATS-50 — Release hygiene",
      "WATS-51 — Config and environment templates"
    ]);

    expectAll(plan, [
      "WATS-50 release hygiene",
      "WATS-51 config/env templates"
    ]);

    expect(plan).not.toContain("WATS-50  config/env templates");
    expect(plan).not.toContain("WATS-50 — Config and environment templates");
  });

  test("public manifest, reference index, roadmap, and changelog include WATS-50 artifacts", () => {
    const manifest = read("docs/public-docs-manifest.json");
    const referenceIndex = read("docs/reference/index.md");
    const roadmap = read("docs/architecture/roadmap-to-whatsapp-pywa-parity.md");
    const changelog = read("CHANGELOG.md");

    expectAll(manifest, ["architecture/wats50-release-hygiene-policy.md"]);
    expect(manifest).not.toContain(".hermes/skills/wats-release-hygiene/SKILL.md");

    expectAll(referenceIndex, ["wats50-release-hygiene-policy.md"]);
    expectAll(roadmap, ["WATS-50", "release hygiene"]);
    expectAll(changelog, [
      "WATS-31, WATS-36A, WATS-83, WATS-84, WATS-85, and WATS-82",
      "credential-free release dry-run workflow",
      "no package publication",
      "No GitHub release/tag creation"
    ]);
  });

  test("WATS-50 design slice does not add side-effecting release automation", () => {
    const rootPackage = read("package.json");
    const ci = read(".github/workflows/ci.yml");
    const combined = `${rootPackage}\n${ci}`;

    for (const forbidden of [
      "npm publish",
      "bun publish",
      "gh release create",
      "git tag",
      "docker push",
      "changeset publish",
      "registry login"
    ]) {
      expect(combined).not.toContain(forbidden);
    }
  });
});
