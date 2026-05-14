// WATS-57 RED — high-risk graph endpoint module split plan docs lock.

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

function expectAll(source: string, needles: readonly string[], label: string): void {
  for (const needle of needles) {
    expect(source, `${label} must contain ${needle}`).toContain(needle);
  }
}

describe("WATS-57 graph endpoint module split plan", () => {
  test("design doc exists and records docs-only no-runtime boundary", () => {
    const docPath = "docs/architecture/wats57-graph-endpoint-module-split-plan.md";
    expect(existsSync(join(repoRoot, docPath))).toBe(true);
    const doc = read(docPath);

    expectAll(doc, [
      "status: design",
      "applies-to: WATS-57",
      "no runtime code movement in this design slice",
      "no live Meta calls",
      "no behavior changes to validators, builders, payload shapes, or Graph routes",
      "no broad validation utility consolidation"
    ], "WATS-57 design boundary");
  });

  test("plan captures current high-risk modules and target family layout", () => {
    const doc = read("docs/architecture/wats57-graph-endpoint-module-split-plan.md");
    expectAll(doc, [
      "packages/graph/src/endpoints/messages.ts",
      "packages/graph/src/endpoints/wabaEndpoints.ts",
      "packages/graph/src/endpoints/media.ts",
      "packages/graph/src/endpoints/messages/",
      "packages/graph/src/endpoints/templates/",
      "packages/graph/src/endpoints/flows/",
      "packages/graph/src/endpoints/waba/"
    ], "WATS-57 module layout");
  });

  test("plan sequences template, Flow, WABA, and message split phases", () => {
    const doc = read("docs/architecture/wats57-graph-endpoint-module-split-plan.md");
    expectAll(doc, [
      "Phase 1 — split templates only",
      "Phase 2 — split flows",
      "Phase 3 — split WABA phone listing or retire `wabaEndpoints.ts`",
      "Phase 4 — split messages",
      "Phase 5 — docs and manifest cleanup",
      "Do not combine mechanical subpath/export consistency with large internal module splits"
    ], "WATS-57 split sequence");
  });

  test("plan defines pre-move tests, risk register, and verification matrix", () => {
    const doc = read("docs/architecture/wats57-graph-endpoint-module-split-plan.md");
    expectAll(doc, [
      "Tests to add before code movement",
      "Template split regression tests",
      "packages/graph/tests/wabaTemplates.test.ts",
      "Flow split regression tests",
      "packages/graph/tests/wabaFlows.test.ts",
      "Message split regression tests",
      "Risk register",
      "Circular imports",
      "Request snapshots are unchanged",
      "bun run api:check",
      "bun run typecheck",
      "bun run docs:check",
      "git diff --check"
    ], "WATS-57 tests and risks");

    expect(doc).not.toContain("packages/graph/tests/templates.test.ts");
    expect(doc).not.toContain("packages/graph/tests/flows.test.ts");
    expect(doc).not.toContain("packages/graph/tests/*template*");
    expect(doc).not.toContain("packages/graph/tests/*flow*");
  });

  test("reference index, package map, and changelog publish WATS-57 without claiming implementation", () => {
    const referenceIndex = read("docs/reference/index.md");
    const packageMap = read("docs/architecture/package-map.md");
    const changelog = read("CHANGELOG.md");

    for (const source of [referenceIndex, packageMap, changelog]) {
      expect(source).toContain("WATS-57");
      expect(source).toContain("graph endpoint module split plan");
    }

    expect(changelog).toContain("design/docs/test-planner only");
    expect(changelog).toContain("no runtime code movement");
  });
});

  test("WATS-65 template split implementation keeps template runtime outside wabaEndpoints", () => {
    const templateBarrel = read("packages/graph/src/endpoints/templates.ts");
    const templateIndex = read("packages/graph/src/endpoints/templates/index.ts");
    const wabaEndpoints = read("packages/graph/src/endpoints/wabaEndpoints.ts");
    const changelog = read("CHANGELOG.md");
    const packageMap = read("docs/architecture/package-map.md");

    expect(templateBarrel).toContain('from "./templates/index"');
    expect(templateIndex).toContain('from "./callables"');
    expect(templateIndex).toContain('from "./builders"');
    expect(templateIndex).toContain('from "./validation"');
    expect(wabaEndpoints).toContain('from "./templates/index"');
    expect(wabaEndpoints).not.toContain("function normalizeListParams");
    expect(wabaEndpoints).not.toContain("const listMessageTemplatesRaw");
    expect(wabaEndpoints).not.toContain("function placeholders");
    expect(changelog).toContain("WATS-65");
    expect(changelog).toContain("template endpoint family");
    expect(packageMap).toContain("WATS-65");
    expect(packageMap).toContain("packages/graph/src/endpoints/templates/");
  });

