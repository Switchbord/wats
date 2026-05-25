// WATS 0.3.5 release-prep contract.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

type Manifest = JsonRecord & {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const RELEASE_VERSION = "0.3.5";
const PREVIOUS_RELEASE_VERSION = "0.2.1";
const PUBLISHABLE_PACKAGES = ["types", "crypto", "graph", "core", "http", "internal-utils", "config", "persistence", "service", "cli"] as const;
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

function readManifest(pkg: string): Manifest {
  return readJson(`packages/${pkg}/package.json`) as Manifest;
}

describe("WATS 0.3.5 release-prep contract", () => {
  test("root and publishable package manifests are aligned on the next release version", () => {
    const root = readJson("package.json");
    expect(root.version).toBe(RELEASE_VERSION);
    expect(root.private).toBe(true);

    for (const pkg of PUBLISHABLE_PACKAGES) {
      const manifest = readManifest(pkg);
      expect(manifest.name, `${pkg} npm scope`).toBe(`@wats/${pkg}`);
      expect(manifest.version, `${pkg} version`).toBe(RELEASE_VERSION);
      expect(manifest.private, `${pkg} private gate`).toBe(false);
      expect(manifest.publishConfig, `${pkg} public publishConfig`).toEqual({ access: "public" });

      for (const [kind, deps] of Object.entries({
        dependencies: manifest.dependencies,
        peerDependencies: manifest.peerDependencies,
        optionalDependencies: manifest.optionalDependencies
      })) {
        if (deps === undefined) continue;
        for (const [name, spec] of Object.entries(deps)) {
          expect(spec, `${pkg} ${kind} ${name} must not use workspace protocol`).not.toContain("workspace:");
          expect(name, `${pkg} ${kind} must not depend on the temporary @switchbord scope`).not.toStartWith("@switchbord/");
          if (name.startsWith("@wats/")) {
            expect(spec, `${pkg} ${kind} ${name} release range`).toBe(`^${RELEASE_VERSION}`);
          }
        }
      }
    }
  });

  test("private testing package remains unpublished and can stay outside public release versioning", () => {
    for (const pkg of PRIVATE_PACKAGES) {
      const manifest = readManifest(pkg);
      expect(manifest.private).toBe(true);
      expect(manifest.publishConfig).toBeUndefined();
      expect(manifest.files).toBeUndefined();
    }
  });

  test("release scripts derive next release version instead of hard-coding stale 0.2.1", () => {
    const scripts = [
      "scripts/npm-publish-dry-run.ts",
      "scripts/pack-smoke.ts",
      "scripts/generate-docs-openapi.ts"
    ];
    for (const scriptPath of scripts) {
      const script = read(scriptPath);
      expect(script, `${scriptPath} must not hard-code ${PREVIOUS_RELEASE_VERSION}`).not.toContain(`"${PREVIOUS_RELEASE_VERSION}"`);
      expect(script, `${scriptPath} should read the root manifest version`).toContain("readReleaseVersion");
    }
  });

  test("service OpenAPI default and generated docs use the package release version", () => {
    const serviceSource = read("packages/service/src/index.ts");
    expect(serviceSource).toContain(`DEFAULT_OPENAPI_VERSION = "${RELEASE_VERSION}"`);

    const generator = read("scripts/generate-docs-openapi.ts");
    expect(generator).not.toContain(`version: "${PREVIOUS_RELEASE_VERSION}"`);
    expect(generator).toContain("version: readReleaseVersion()");
  });
});
