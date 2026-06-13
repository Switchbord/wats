import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const REQUIRED_DOC_PATHS = [
  "README.md",
  "site/content/docs/reference/index.mdx",
  "site/content/docs/guide.mdx",
  "site/content/docs/reference/client.mdx",
  "site/content/docs/reference/endpoints.mdx",
  "site/content/docs/reference/webhook.mdx",
  "site/content/docs/reference/config.mdx",
  "site/content/docs/reference/cli.mdx",
  "site/content/docs/reference/service.mdx",
  "site/content/docs/guides/cli-init.mdx",
  "site/content/docs/migration/pywa.mdx",
  "site/content/docs/parity.mdx",
  "site/content/docs/concepts/overview.mdx",
  "site/content/docs/concepts/package-map.mdx",
  "site/content/docs/meta/release-policy.mdx"
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

describe("documentation scaffolding", () => {
  test("required A2 documentation files exist", () => {
    const repoRoot = findRepoRoot(import.meta.dir);

    for (const relativePath of REQUIRED_DOC_PATHS) {
      expect(existsSync(join(repoRoot, relativePath))).toBe(true);
    }
  });
});
