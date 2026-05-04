// WATS-53 RED — @wats/graph endpoint subpath consistency for media, templates, and flows.

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
    expect(source, `${label} must mention ${needle}`).toContain(needle);
  }
}

describe("WATS-53 @wats/graph endpoint subpath exports", () => {
  test("package exports publish media, templates, and flows subpaths", () => {
    const packageJson = JSON.parse(read("packages/graph/package.json")) as {
      exports?: Record<string, string>;
    };

    expect(packageJson.exports?.["./endpoints/media"]).toEqual({ types: "./dist/endpoints/media.d.ts", import: "./dist/endpoints/media.js" });
    expect(packageJson.exports?.["./endpoints/templates"]).toEqual({ types: "./dist/endpoints/templates.d.ts", import: "./dist/endpoints/templates.js" });
    expect(packageJson.exports?.["./endpoints/flows"]).toEqual({ types: "./dist/endpoints/flows.d.ts", import: "./dist/endpoints/flows.js" });
  });

  test("graph-consumer fixture imports and runtime-checks every new subpath", () => {
    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");
    expectAll(fixture, [
      'from "@wats/graph/endpoints/media"',
      'from "@wats/graph/endpoints/templates"',
      'from "@wats/graph/endpoints/flows"',
      "WATS-53 media subpath exports runtime surface",
      "WATS-53 templates subpath exports runtime surface",
      "WATS-53 flows subpath exports runtime surface"
    ], "graph-consumer fixture");
  });
});

describe("WATS-53 docs lockstep", () => {
  test("public-surface, package-map, reference index, migration guide, and changelog document new subpaths", () => {
    const referenceIndex = read("docs/reference/index.md");
    const publicApi = read("docs/architecture/public-api-surface.md");
    const packageMap = read("docs/architecture/package-map.md");
    const migration = read("docs/migration/pywa-to-wats.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [referenceIndex, publicApi, packageMap, migration, changelog]) {
      expectAll(doc, [
        "@wats/graph/endpoints/media",
        "@wats/graph/endpoints/templates",
        "@wats/graph/endpoints/flows"
      ], "WATS-53 docs packet");
    }

    expect(migration).not.toContain("Some root `@wats/graph` exports do not yet have dedicated package subpaths");
    expect(changelog).toContain("WATS-53");
    expect(publicApi).toContain("WATS-53");
  });
});
