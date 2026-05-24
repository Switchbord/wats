// WATS 0.2.1 alpha launch release contract.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const PUBLISHABLE_PACKAGES = ["types", "crypto", "graph", "core", "http", "internal-utils", "config", "service", "cli"] as const;
const PRIVATE_PACKAGES = ["testing"] as const;

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

describe("WATS 0.2.1 alpha launch release contract", () => {
  test("current release manifests remain publishable while 0.2.1 stays a historical changelog entry", () => {
    const root = readJson("package.json");
    expect(root.private).toBe(true);
    expect(typeof root.version).toBe("string");
    expect(root.version).not.toBe("0.2.1");

    for (const pkg of PUBLISHABLE_PACKAGES) {
      const manifest = readJson(`packages/${pkg}/package.json`);
      expect(manifest.name, `${pkg} npm scope`).toBe(`@wats/${pkg}`);
      expect(manifest.version, `${pkg} version`).toBe(root.version);
      expect(manifest.private, `${pkg} private gate before publish command`).toBe(false);
      expect(manifest.publishConfig, `${pkg} public publishConfig`).toEqual({ access: "public" });
      expect(manifest.repository, `${pkg} repository`).toEqual({
        type: "git",
        url: "git+https://github.com/Switchbord/wats.git",
        directory: `packages/${pkg}`
      });
      expect(manifest.homepage, `${pkg} homepage`).toBe("https://github.com/Switchbord/wats#readme");
      expect(manifest.files).toEqual(["dist", "README.md", "LICENSE"]);
      for (const deps of [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies]) {
        if (deps && typeof deps === "object") {
          expect(JSON.stringify(deps), `${pkg} publish deps must not use workspace protocol`).not.toContain("workspace:");
        }
      }
    }
  });

  test("testing package remains unpublished", () => {
    for (const pkg of PRIVATE_PACKAGES) {
      const manifest = readJson(`packages/${pkg}/package.json`);
      expect(manifest.private).toBe(true);
      expect(manifest.publishConfig).toBeUndefined();
      expect(manifest.files).toBeUndefined();
    }
  });

  test("root release scripts include dry-run and npm public dry-run gates", () => {
    const scripts = readJson("package.json").scripts as JsonRecord;
    expect(scripts["release:dry-run"]).toBe("bun run scripts/release-dry-run.ts");
    expect(scripts["publish:dry-run"]).toBe("bun run scripts/npm-publish-dry-run.ts");
    expect(String(scripts["check-publish"])).toContain("bun run publish:dry-run");
    expect(String(scripts["check-publish"])).toContain("packages/testing/tests/wats021-alpha-release.test.ts");
    expect(String(scripts["check-publish"])).toContain("packages/testing/tests/wats030-release-contract.test.ts");
  });

  test("changelog starts 0.2.1 alpha launch with install guidance and boundaries", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog.startsWith("# Changelog\n\n## [0.2.1] - 2026-05-04\n\nAlpha launch release"));
    expect(changelog).toContain("bun add @wats/cli");
    expect(changelog).toContain("bunx --bun @wats/cli --help");
    expect(changelog).toContain("npm publish --dry-run");
    expect(changelog).toContain("No live Meta calls");
    expect(changelog).toContain("test account credentials are not required for this release");
  });

  test("README announces current alpha install path and credential boundary", () => {
    const readme = read("README.md");
    expect(readme).toContain("Current release: `0.3.3-alpha-compatibility`");
    expect(readme).toContain("bun add @wats/cli");
    expect(readme).toContain("bun add @wats/core @wats/graph @wats/http");
    expect(readme).toContain("test account credentials are not needed for default install or CI");
  });
});
