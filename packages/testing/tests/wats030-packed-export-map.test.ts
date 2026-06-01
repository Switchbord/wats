// WATS 0.3.0 packed export-map smoke contract.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const PUBLISHABLE_PACKAGES = ["types", "crypto", "graph", "core", "http", "internal-utils", "config", "persistence", "service", "cli"] as const;

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

function readJson(path: string): JsonRecord {
  return JSON.parse(read(path)) as JsonRecord;
}

describe("WATS 0.3.0 packed export-map smoke contract", () => {
  test("pack-smoke enumerates every publishable export-map subpath", () => {
    const smoke = read("scripts/pack-smoke.ts");
    expect(smoke).toContain("exportSpecifiersForPackage");
    expect(smoke).toContain("for (const specifier of exportSpecifiersForPackage(pkg))");
    expect(smoke).toContain("subpath-smoke.ts");

    const specifierCount = PUBLISHABLE_PACKAGES.reduce((count, pkg) => {
      const manifest = readJson(`packages/${pkg}/package.json`);
      const exportsMap = manifest.exports as JsonRecord;
      return count + Object.keys(exportsMap).length;
    }, 0);
    // 46 + 1 for the WATS-131 @wats/types/groups subpath.
    expect(specifierCount).toBe(47);
  });
});
