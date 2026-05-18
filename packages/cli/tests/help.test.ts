import { describe, expect, test } from "bun:test";
import { join, resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

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

function expectSuccessfulHelp(result: CliResult, phrases: string[]): void {
  expect(result.exitCode, `stderr:\n${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  for (const phrase of phrases) {
    expect(result.stdout).toContain(phrase);
  }
  expect(result.stdout).toContain("No live credentials are read or required");
  expect(result.stdout).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/);
  expect(result.stdout).not.toContain("APP_SECRET=");
}

describe("wats CLI help skeleton", () => {
  test("wats --help lists onboarding and diagnostics commands", () => {
    expectSuccessfulHelp(runCli(["--help"]), [
      "WATS CLI",
      "wats init",
      "wats setup",
      "wats config validate",
      "wats doctor",
      "wats openapi",
      "wats onboarding",
      "wats webhook token"
    ]);
  });

  test("wats init --help documents real safe bootstrap", () => {
    expectSuccessfulHelp(runCli(["init", "--help"]), [
      "Usage: wats init [dir]",
      "Generate WATS config",
      "refuses to overwrite existing files"
    ]);
  });

  test("wats config validate --help documents real safe validation", () => {
    expectSuccessfulHelp(runCli(["config", "validate", "--help"]), [
      "Usage: wats config validate",
      "Validates a WATS config file",
      "@wats/config"
    ]);
  });

  test("wats doctor --help documents offline diagnostics", () => {
    expectSuccessfulHelp(runCli(["doctor", "--help"]), [
      "Usage: wats doctor",
      "offline diagnostics",
      "no Graph API calls"
    ]);
  });

  test("wats openapi --help documents implemented schema export", () => {
    expectSuccessfulHelp(runCli(["openapi", "--help"]), [
      "Usage: wats openapi",
      "exports OpenAPI 3.1 JSON",
      "Prints OpenAPI JSON to stdout by default"
    ]);
  });

  test("unknown commands fail closed with help on stderr", () => {
    const result = runCli(["../../etc/passwd"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command");
    expect(result.stderr).toContain("wats --help");
    expect(result.stderr).not.toContain("/etc/passwd");
  });
});
