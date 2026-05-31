import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PUBLISHABLE_PACKAGE_NAMES = [
  "@wats/types",
  "@wats/crypto",
  "@wats/graph",
  "@wats/core",
  "@wats/http",
  "@wats/internal-utils",
  "@wats/cli",
  "@wats/service",
  "@wats/config",
  "@wats/persistence"
] as const;

const PRIVATE_PACKAGE_NAMES = ["@wats/testing"] as const;
const CURRENT_RELEASE_VERSION = "0.3.10" as const;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }
  return parsed;
}

function isExpectedWorkspaceRootManifest(manifest: JsonRecord): boolean {
  return manifest.name === "wats" && manifest.private === true;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);

  while (true) {
    const candidateManifestPath = join(currentDir, "package.json");
    if (existsSync(candidateManifestPath)) {
      const candidateManifest = parseJsonFile(candidateManifestPath);
      if (isExpectedWorkspaceRootManifest(candidateManifest)) {
        return currentDir;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate workspace root from ${startDir}`);
    }

    currentDir = parentDir;
  }
}

function expectScript(manifest: JsonRecord, name: string, command: string): void {
  expect(isJsonRecord(manifest.scripts)).toBe(true);
  expect((manifest.scripts as JsonRecord)[name]).toBe(command);
}

function expectDevDependency(manifest: JsonRecord, name: string): void {
  expect(isJsonRecord(manifest.devDependencies)).toBe(true);
  expect(typeof (manifest.devDependencies as JsonRecord)[name]).toBe("string");
}

describe("WATS-31 release and CI publishability scaffold", () => {
  test("root manifest exposes deterministic release hygiene scripts", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const rootManifest = parseJsonFile(join(repoRoot, "package.json"));

    expectScript(rootManifest, "test", "bun test");
    expectScript(rootManifest, "typecheck", "bunx tsc --noEmit -p tsconfig.release.json");
    expectScript(rootManifest, "build:packages", "bun run scripts/build-packages.ts");
    expectScript(rootManifest, "pack:smoke", "bun run scripts/pack-smoke.ts");
    expectScript(rootManifest, "publish:dry-run", "bun run scripts/npm-publish-dry-run.ts");
    expectScript(rootManifest, "release:dry-run", "bun run scripts/release-dry-run.ts");
    expectScript(rootManifest, "check-publish", "bun run typecheck && bun run build:packages && bun run pack:smoke && bun run publish:dry-run && bun run release:dry-run && bun test packages/testing/tests/wats31-release-ci-policy.test.ts packages/testing/tests/wats83-publishable-artifacts.test.ts packages/testing/tests/wats85-release-dry-run.test.ts packages/testing/tests/wats021-alpha-release.test.ts packages/testing/tests/wats030-release-contract.test.ts");
    expectDevDependency(rootManifest, "typescript");
  });

  test("testing workspace package remains guarded and publishable packages are released", () => {
    const repoRoot = findRepoRoot(import.meta.dir);

    for (const packageName of PRIVATE_PACKAGE_NAMES) {
      const packageDir = packageName.replace(/^@wats\//, "");
      const manifest = parseJsonFile(join(repoRoot, "packages", packageDir, "package.json"));

      expect(manifest.name).toBe(packageName);
      expect(manifest.private).toBe(true);
    }

    for (const packageName of PUBLISHABLE_PACKAGE_NAMES) {
      const packageDir = packageName.replace(/^@wats\//, "");
      const manifest = parseJsonFile(join(repoRoot, "packages", packageDir, "package.json"));
      expect(manifest.name).toBe(packageName);
      expect(manifest.version).toBe(CURRENT_RELEASE_VERSION);
      expect(manifest.private).toBe(false);
    }
  });

  test("publishability typecheck includes current public package sources", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const tsconfig = parseJsonFile(join(repoRoot, "tsconfig.release.json"));

    expect(tsconfig.extends).toBe("./tsconfig.base.json");
    expect(tsconfig.noEmit).toBe(undefined);
    expect(tsconfig.include).toEqual(
      PUBLISHABLE_PACKAGE_NAMES.map(
        (packageName) => `packages/${packageName.replace(/^@wats\//, "")}/src/**/*.ts`
      )
    );
  });

  test("GitHub Actions CI runs install, tests, typecheck, and publish guard without credentials", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const workflowPath = join(repoRoot, ".github/workflows/ci.yml");

    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun test");
    expect(workflow).toContain("bun run typecheck");
    expect(workflow).toContain("bun run check-publish");
    expect(workflow).toContain("oven-sh/setup-bun");
    expect(workflow).toContain("uses: actions/checkout@v5");
    expect(workflow).not.toMatch(/uses:\s+actions\/checkout@v[0-4]\b/u);
    expect(workflow).not.toMatch(/META|WHATSAPP|ACCESS_TOKEN|APP_SECRET|REGISTRY_TOKEN|REMOTE_TOKEN/);
  });

  test("release policy documents exact WATS-31 commands and credential-free CI scope", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const releasePolicy = readFileSync(
      join(repoRoot, "docs/architecture/release-policy.md"),
      "utf8"
    );
    const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

    expect(releasePolicy).toContain("WATS-31 publishability scaffold");
    expect(releasePolicy).toContain("bun install --frozen-lockfile");
    expect(releasePolicy).toContain("bun test");
    expect(releasePolicy).toContain("bun run typecheck");
    expect(releasePolicy).toContain("bun run check-publish");
    expect(releasePolicy).toContain("No Meta credentials");
    expect(changelog).toContain("WATS-31");
  });
});
