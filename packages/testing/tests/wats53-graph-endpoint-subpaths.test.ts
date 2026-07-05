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
      exports?: Record<string, { types: string; import: string }>;
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
    const referenceIndex = read("site/content/docs/reference/index.mdx");
    const publicApi = read("site/content/docs/concepts/public-api-surface.mdx");
    const packageMap = read("site/content/docs/concepts/package-map.mdx");
    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    const changelog = read("CHANGELOG.md");

    for (const doc of [publicApi, packageMap, migration, changelog]) {
      expectAll(doc, [
        "@wats/graph/endpoints/media",
        "@wats/graph/endpoints/templates",
        "@wats/graph/endpoints/flows"
      ], "WATS-53 docs packet");
    }

    // E3: the reference index lists the endpoint family as a single brace-
    // expansion (`@wats/graph/endpoints/{messages,media,templates,flows,...}`)
    // rather than per-subpath literals; assert on that surviving form.
    expect(referenceIndex).toContain("@wats/graph/endpoints/{");
    for (const member of ["media", "templates", "flows"]) {
      expect(referenceIndex, `reference index must list ${member} subpath`).toMatch(
        new RegExp(`@wats/graph/endpoints/\\{[^}]*\\b${member}\\b[^}]*\\}`)
      );
    }

    expect(migration).not.toContain("Some root `@wats/graph` exports do not yet have dedicated package subpaths");
    // WATS-53 ticket traceability legitimately lives in the changelog (not
    // voice-governed) — keep it. The voice pass removed the WATS-53 token from
    // public-api-surface.mdx; the subpath assertions above are its drift guard.
    expect(changelog).toContain("WATS-53");
  });
});
