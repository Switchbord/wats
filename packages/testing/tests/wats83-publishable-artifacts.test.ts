// WATS-83 RED — publishable package artifact and packed-output smoke contract.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const PUBLISHABLE_PACKAGES = [
  "types",
  "crypto",
  "graph",
  "core",
  "http",
  "internal-utils",
  "config",
  "persistence",
  "service",
  "cli"
] as const;

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

describe("WATS-83 publishable artifact smoke contract", () => {
  test("root scripts expose deterministic build and packed smoke gates", () => {
    const rootManifest = readJson("package.json");
    const scripts = rootManifest.scripts as JsonRecord;

    expect(scripts["build:packages"]).toBe("bun run scripts/build-packages.ts");
    expect(scripts["pack:smoke"]).toBe("bun run scripts/pack-smoke.ts");
    expect(String(scripts["check-publish"])).toContain("bun run typecheck");
    expect(String(scripts["check-publish"])).toContain("bun run build:packages");
    expect(String(scripts["check-publish"])).toContain("bun run pack:smoke");
    expect(String(scripts["check-publish"])).toContain("packages/testing/tests/wats83-publishable-artifacts.test.ts");
  });

  test("publishable package manifests point at dist artifacts and constrain packed files", () => {
    for (const pkg of PUBLISHABLE_PACKAGES) {
      const manifest = readJson(`packages/${pkg}/package.json`);
      expect(manifest.private, `${pkg} is publishable for the 0.2.1 alpha launch`).toBe(false);
      expect(manifest.main, `${pkg} main`).toBe("./dist/index.js");
      expect(manifest.types, `${pkg} types`).toBe("./dist/index.d.ts");
      expect(manifest.files, `${pkg} files`).toEqual(["dist", "README.md", "LICENSE"]);

      const readme = read(`packages/${pkg}/README.md`);
      expect(readme, `${pkg} package README names package`).toContain(`@wats/${pkg}`);
      expect(readme, `${pkg} package README has Bun install command`).toContain(`bun add @wats/${pkg}`);
      expect(readme, `${pkg} package README has npm install command`).toContain(`npm i @wats/${pkg}`);
      expect(readme, `${pkg} package README links docs`).toContain("https://github.com/Switchbord/wats");
      expect(readme, `${pkg} package README has license line`).toContain("MIT");
      expect(readme.split("\n").filter((line) => line.trim().length > 0).length, `${pkg} package README must be useful on npm`).toBeGreaterThanOrEqual(10);

      const exportsMap = manifest.exports as JsonRecord;
      expect(exportsMap["."], `${pkg} root export`).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js"
      });
      expect(JSON.stringify(exportsMap), `${pkg} exports should not publish src`).not.toContain("./src/");
    }
  });

  test("testing package remains unpublished and internal-utils is included for config runtime installs", () => {
    const testingManifest = readJson("packages/testing/package.json");
    expect(testingManifest.private).toBe(true);
    expect(testingManifest.files).toBeUndefined();

    const internalManifest = readJson("packages/internal-utils/package.json");
    expect(internalManifest.private).toBe(false);
    expect(internalManifest.main).toBe("./dist/index.js");
    expect(internalManifest.files).toEqual(["dist", "README.md", "LICENSE"]);

    const buildScript = read("scripts/build-packages.ts");
    const smokeScript = read("scripts/pack-smoke.ts");
    expect(buildScript).toContain("PUBLISHABLE_PACKAGES");
    expect(smokeScript).toContain("PUBLISHABLE_PACKAGES");
    expect(smokeScript).not.toContain('"testing"');
  });

  test("packed-output smoke script verifies tarballs without publishing", () => {
    const smokeScript = read("scripts/pack-smoke.ts");
    expectAll(smokeScript, [
      "\"pm\", \"pack\"",
      "--dry-run",
      "--ignore-scripts",
      "dist/index.js",
      "dist/index.d.ts",
      "package.json",
      "LICENSE",
      "no package publication",
      "npm publish",
      "must preserve the Bun shebang"
    ]);
  });

  test("release policy and changelog document WATS-83 boundary", () => {
    const releasePolicy = read("docs/architecture/release-policy.md");
    const changelog = read("CHANGELOG.md");

    expectAll(releasePolicy, [
      "WATS-83 publishable package artifacts",
      "built `dist` artifacts",
      "packed-output smoke tests",
      "packages are publishable with `private: false`",
      "no registry publication",
      "no GitHub release"
    ]);
    expectAll(changelog, [
      "builds and verifies `dist` package artifacts during release checks",
      "packed-output smoke tests",
      "bun run build:packages",
      "bun run pack:smoke",
      "private package guards",
      "no package publication",
      "No GitHub release/tag creation"
    ]);
  });
});
