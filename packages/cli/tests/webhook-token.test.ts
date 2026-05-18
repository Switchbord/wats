import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

type JsonRecord = Record<string, unknown>;

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

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

function runCli(args: string[]): CliResult {
  const repoRoot = findRepoRoot(import.meta.dir);
  const entrypoint = join(repoRoot, "packages/cli/dist/bin.js");
  const completed = Bun.spawnSync(["bun", entrypoint, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

function tokenLine(stdout: string): string {
  const lines = stdout.trim().split("\n").map((line) => line.trim());
  const token = lines.at(-1);
  if (typeof token !== "string") {
    throw new Error(`Expected token output, got: ${stdout}`);
  }
  return token;
}

describe("wats webhook token", () => {
  test("--help documents safe token generation without file writes", () => {
    const result = runCli(["webhook", "token", "--help"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats webhook token");
    expect(result.stdout).toContain("prints one freshly generated verify token");
    expect(result.stdout).toContain("does not write files");
    expect(result.stdout).toContain("No live credentials are read or required");
  });

  test("prints only a generated token by default", () => {
    const result = runCli(["webhook", "token"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("APP_SECRET");
    expect(result.stdout).not.toContain("ACCESS_TOKEN");

    const token = tokenLine(result.stdout);
    expect(token).toMatch(/^wats_wh_[A-Za-z0-9_-]{32,}$/);
    expect(token.length).toBeLessThanOrEqual(96);
  });

  test("rejects unknown flags and never echoes attacker supplied values", () => {
    const result = runCli(["webhook", "token", "--output=../../.env.local"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option");
    expect(result.stderr).toContain("wats webhook token --help");
    expect(result.stderr).not.toContain("../../.env.local");
  });
});
