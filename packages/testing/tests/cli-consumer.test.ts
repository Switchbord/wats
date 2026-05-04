import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

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
      throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

function runBun(args: string[], cwd: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
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

describe("WATS-33 @wats/cli consumer fixture", () => {
  test("package manifest exposes documented export and bin", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const manifest = parseJsonFile(join(repoRoot, "packages/cli/package.json"));

    expect(manifest.name).toBe("@wats/cli");
    expect(manifest.type).toBe("module");
    expect(manifest.exports).toEqual({ ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } });
    expect(manifest.bin).toEqual({ wats: "./dist/bin.js" });
  });

  test("fixture imports @wats/cli and verifies runtime shape", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(repoRoot, "packages/testing/fixtures/cli-consumer");

    const result = runBun(["run", "verify-imports"], fixtureDir);

    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);

    const lines = result.stdout.trim().split("\n").map((line) => line.trim());
    expect(lines.at(-1)).toBe("cli-consumer:ok");

    const report = JSON.parse(lines.at(-2) ?? "{}") as {
      ok: boolean;
      checks: Record<string, boolean>;
      moduleKeys: string[];
    };

    expect(report.ok).toBe(true);
    expect(report.moduleKeys).toContain("runCli");
    expect(report.moduleKeys).toContain("createWebhookVerifyToken");
    for (const [name, ok] of Object.entries(report.checks)) {
      expect(ok, `fixture check ${name} must be true`).toBe(true);
    }
  });
});
