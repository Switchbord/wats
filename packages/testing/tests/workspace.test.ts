import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const REQUIRED_WORKSPACE_PACKAGES = [
  { dir: "packages/core", name: "@wats/core" },
  { dir: "packages/graph", name: "@wats/graph" },
  { dir: "packages/types", name: "@wats/types" },
  { dir: "packages/http", name: "@wats/http" },
  { dir: "packages/crypto", name: "@wats/crypto" },
  { dir: "packages/testing", name: "@wats/testing" }
] as const;

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

function getWorkspacePatterns(manifest: JsonRecord): string[] {
  const workspaces = manifest.workspaces;

  if (Array.isArray(workspaces)) {
    return workspaces.filter((value): value is string => typeof value === "string");
  }

  if (isJsonRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.filter(
      (value): value is string => typeof value === "string"
    );
  }

  return [];
}

function workspacePatternIncludesPackage(
  workspacePattern: string,
  packageDirectory: string
): boolean {
  const normalizedPattern = workspacePattern.replaceAll("\\", "/");
  const normalizedPackageDir = packageDirectory.replaceAll("\\", "/");

  const escaped = normalizedPattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\*/g, "[^/]+")}$`);

  return regex.test(normalizedPackageDir);
}

function isExpectedWorkspaceRootManifest(manifest: JsonRecord): boolean {
  if (manifest.name !== "wats" || manifest.private !== true) {
    return false;
  }

  const workspacePatterns = getWorkspacePatterns(manifest);
  return workspacePatterns.some((pattern) => pattern.startsWith("packages/"));
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

describe("workspace helper logic", () => {
  test("findRepoRoot walks upward until the expected workspace root manifest", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "wats-repo-root-"));

    try {
      const repoRoot = join(tempRoot, "repo");
      const nestedDir = join(repoRoot, "packages/testing/tests");

      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify({
          name: "wats",
          private: true,
          workspaces: ["packages/*"]
        })
      );

      expect(findRepoRoot(nestedDir)).toBe(repoRoot);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("getWorkspacePatterns supports object-form workspace config", () => {
    expect(
      getWorkspacePatterns({
        workspaces: {
          packages: ["packages/*"]
        }
      })
    ).toEqual(["packages/*"]);
  });
});

describe("workspace integrity", () => {
  test("root config, workspace packages, and marker content are semantically valid", () => {
    const repoRoot = findRepoRoot(import.meta.dir);

    const requiredRepoPaths = [
      "package.json",
      "bunfig.toml",
      "tsconfig.base.json",
      "docs/qa/a1/workspace-integrity.marker"
    ];

    for (const relativePath of requiredRepoPaths) {
      expect(existsSync(join(repoRoot, relativePath))).toBe(true);
    }

    const rootManifest = parseJsonFile(join(repoRoot, "package.json"));
    const workspacePatterns = getWorkspacePatterns(rootManifest);

    expect(rootManifest.name).toBe("wats");
    expect(rootManifest.private).toBe(true);
    expect(workspacePatterns.length).toBeGreaterThan(0);

    for (const requiredPackage of REQUIRED_WORKSPACE_PACKAGES) {
      expect(
        workspacePatterns.some((pattern) =>
          workspacePatternIncludesPackage(pattern, requiredPackage.dir)
        )
      ).toBe(true);

      const packageManifestPath = join(repoRoot, requiredPackage.dir, "package.json");
      expect(existsSync(packageManifestPath)).toBe(true);

      const packageManifest = parseJsonFile(packageManifestPath);
      expect(packageManifest.name).toBe(requiredPackage.name);
      expect(typeof packageManifest.version).toBe("string");
      expect((packageManifest.version as string).length).toBeGreaterThan(0);
    }

    const markerContent = readFileSync(
      join(repoRoot, "docs/qa/a1/workspace-integrity.marker"),
      "utf8"
    );

    expect(markerContent).toContain("Feature A1 workspace integrity marker");
    expect(markerContent).toContain("Version: 1");
  });
});
