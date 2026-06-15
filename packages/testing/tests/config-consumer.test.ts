import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (manifest.name === "wats" && manifest.private === true) {
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

function runBun(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const completed = Bun.spawnSync(["bun", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

describe("WATS-32 @wats/config consumer fixture", () => {
  test("fixture imports the public package specifier and verifies runtime shapes", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(repoRoot, "packages/testing/fixtures/config-consumer");

    const manifest = parseJsonFile(join(fixtureDir, "package.json"));
    expect(manifest.name).toBe("config-consumer");
    expect(manifest.private).toBe(true);
    const dependencies = manifest.dependencies;
    expect(isJsonRecord(dependencies)).toBe(true);
    expect((dependencies as JsonRecord)["@wats/config"]).toBe("workspace:*");

    const result = runBun(["run", "verify-imports"], fixtureDir);
    expect(
      result.exitCode,
      `fixture verify-imports failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    ).toBe(0);

    const lines = result.stdout.trim().split("\n").filter((line) => line.length > 0);
    expect(lines.at(-1)).toBe("config-consumer:ok");
    const report = JSON.parse(lines.at(-2) as string) as { ok: boolean; checks: Record<string, boolean>; errorName: string };
    expect(report.ok).toBe(true);
    expect(report.errorName).toBe("ConfigValidationError");
    for (const [label, ok] of Object.entries(report.checks)) {
      expect(ok, `fixture check ${label} must report true`).toBe(true);
    }
  });
});
