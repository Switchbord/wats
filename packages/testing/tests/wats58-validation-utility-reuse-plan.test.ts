// WATS-58 RED — graph validation utility reuse plan docs lock.

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

describe("WATS-58 graph validation utility reuse plan", () => {
  test("design doc exists and records private/no-runtime boundary", () => {
    const docPath = "docs/architecture/wats58-graph-validation-utility-reuse-plan.md";
    expect(existsSync(join(repoRoot, docPath))).toBe(true);
    const doc = read(docPath);

    expectAll(doc, [
      "status: design",
      "applies-to: WATS-58",
      "no runtime source movement in this planning commit",
      "no changed error messages or classes",
      "no new public package exports",
      "no live Meta calls",
      "no broad one-pass replacement"
    ], "WATS-58 design boundary");
  });

  test("plan inventories duplicate validation helper families and target private modules", () => {
    const doc = read("docs/architecture/wats58-graph-validation-utility-reuse-plan.md");
    expectAll(doc, [
      "control-character checks",
      "plain-record and descriptor/accessor guards",
      "unsafe prototype key rejection",
      "path/id traversal and nested percent-decoding",
      "safe JSON clone helpers",
      "packages/graph/src/internal/validation/",
      "errors.ts",
      "strings.ts",
      "records.ts",
      "arrays.ts",
      "paths.ts",
      "json.ts",
      "options.ts"
    ], "WATS-58 inventory and target modules");
  });

  test("plan sequences standalone utilities before scoped clients and business-management", () => {
    const doc = read("docs/architecture/wats58-graph-validation-utility-reuse-plan.md");
    expectAll(doc, [
      "Phase 1 — utilities with standalone tests only",
      "No endpoint code changes in Phase 1",
      "Phase 2 — migrate scoped-client optional params helpers",
      "Phase 3 — migrate business-management path/query/record helpers",
      "Phase 4 — wait until WATS-57 module splits before broad template/Flow/message migration"
    ], "WATS-58 rollout order");
  });

  test("plan defines utility behavior tests, error compatibility, and verification commands", () => {
    const doc = read("docs/architecture/wats58-graph-validation-utility-reuse-plan.md");
    expectAll(doc, [
      "GraphRequestValidationError",
      "family-specific message prefixes",
      "control char detection: NUL, CR, LF, TAB, DEL",
      "assertPlainDataRecord rejects null, arrays, custom prototypes, accessors",
      "assertDenseDataArray rejects sparse arrays",
      "assertRepeatedlyDecodedSafePathId rejects raw, encoded, double-encoded",
      "safeJsonClone rejects cycles with a shared `WeakSet`",
      "bun test packages/graph/tests/internal-validation.test.ts",
      "bun run typecheck",
      "git diff --check"
    ], "WATS-58 behavior and verification");
  });

  test("reference index, package map, and changelog publish WATS-58 without claiming implementation", () => {
    const referenceIndex = read("docs/reference/index.md");
    const packageMap = read("docs/architecture/package-map.md");
    const changelog = read("CHANGELOG.md");

    for (const source of [referenceIndex, packageMap, changelog]) {
      expect(source).toContain("WATS-58");
      expect(source).toContain("graph validation utility reuse plan");
    }

    expect(changelog).toContain("design/docs/test-planner only");
    expect(changelog).toContain("no runtime source movement");
    expect(changelog).toContain("no new public package exports");
  });
});
