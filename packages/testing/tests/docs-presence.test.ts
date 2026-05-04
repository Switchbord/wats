import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const REQUIRED_DOC_PATHS = [
  "docs/reference/client.md",
  "docs/reference/handlers.md",
  "docs/reference/filters.md",
  "docs/reference/listeners.md",
  "docs/reference/types.md",
  "docs/reference/errors.md",
  "docs/reference/webhook.md",
  "docs/guides/getting-started.md",
  "docs/parity/pywa-parity-matrix.md",
  "docs/migration/pywa-to-wats.md",
  "docs/architecture/decisions/ADR-001-api-shape.md",
  "docs/qa/a2/docs-presence-red-green.marker"
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
