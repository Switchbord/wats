import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function parseJsonFile(filePath: string): JsonRecord {
  return JSON.parse(readFileSync(filePath, "utf8")) as JsonRecord;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate repo root from ${startDir}`);
    currentDir = parentDir;
  }
}

function runBun(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const completed = Bun.spawnSync(["bun", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

describe("WATS-120 @wats/persistence consumer fixture", () => {
  test("package manifest exposes root and sqlite subpath exports", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const manifest = parseJsonFile(join(repoRoot, "packages/persistence/package.json"));
    expect(manifest.name).toBe("@wats/persistence");
    expect(manifest.private).toBe(false);
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./sqlite": { types: "./dist/sqlite.d.ts", import: "./dist/sqlite.js" }
    });
  });

  test("fixture imports package specifiers and verifies runtime shape", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(repoRoot, "packages/testing/fixtures/persistence-consumer");
    const result = runBun(["run", "verify-imports"], fixtureDir);
    expect(result.exitCode, `stdout:
${result.stdout}
stderr:
${result.stderr}`).toBe(0);
    const lines = result.stdout.trim().split("\n").map((line) => line.trim());
    expect(lines.at(-1)).toBe("persistence-consumer:ok");
    const report = JSON.parse(lines.at(-2) ?? "{}") as { ok: boolean; checks: Record<string, boolean> };
    expect(report.ok).toBe(true);
    expect(report.checks.currentSchemaVersion).toBe(true);
    for (const [name, ok] of Object.entries(report.checks)) {
      expect(ok, `fixture check ${name} must be true`).toBe(true);
    }
  });
});
