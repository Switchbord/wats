import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parseConfig } from "@switchbord/config";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_OUTPUT = [
  "WATS_ACCESS_TOKEN",
  "EAA_DO_NOT_PRINT_SENTINEL",
  "RAW_TOKEN_DO_NOT_PRINT",
  "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
  "raw-service-bearer-token-do-not-print"
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

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function runCli(args: string[], cwd = repoRoot): CliResult {
  const entrypoint = join(repoRoot, "packages/cli/dist/bin.js");
  const completed = Bun.spawnSync(["bun", entrypoint, ...args], {
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

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wats-cli-init-"));
}

function expectNoSecrets(output: string): void {
  for (const forbidden of FORBIDDEN_OUTPUT) {
    expect(output).not.toContain(forbidden);
  }
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/);
  expect(output).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/i);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("wats init", () => {
  test("--help documents real bootstrap behavior without live credentials", () => {
    const result = runCli(["init", "--help"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats init [dir]");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--format yaml|json");
    expect(result.stdout).toContain("--profile <name>");
    expect(result.stdout).toContain("does not resolve live credentials");
    expect(result.stdout).not.toContain("planned config onboarding help only");
  });

  test("--dry-run previews files without writing and redacts secret env names", () => {
    const dir = makeTempDir();
    try {
      const result = runCli(["init", dir, "--dry-run", "--format", "yaml", "--profile", "local"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("init dry-run");
      expect(result.stdout).toContain("files: 2");
      expect(result.stdout).toContain("format: yaml");
      expect(result.stdout).toContain("profile: [REDACTED_PROFILE]");
      expect(result.stdout).not.toContain(dir);
      expectNoSecrets(result.stdout + result.stderr);
      expect(existsSync(join(dir, "wats.config.yaml"))).toBe(false);
      expect(existsSync(join(dir, ".env.example"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates YAML config and .env.example with env-secret refs and no raw secrets", () => {
    const dir = makeTempDir();
    try {
      const result = runCli(["init", dir, "--format", "yaml", "--profile", "local"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("init complete");
      expect(result.stdout).toContain("files: 2");
      expect(result.stdout).not.toContain(dir);
      expectNoSecrets(result.stdout + result.stderr);

      const configPath = join(dir, "wats.config.yaml");
      const envPath = join(dir, ".env.example");
      expect(existsSync(configPath)).toBe(true);
      expect(existsSync(envPath)).toBe(true);

      const configText = read(configPath);
      const envText = read(envPath);
      expect(configText).toContain("version: 1");
      expect(configText).toContain("defaultProfile: local");
      expect(configText).toContain("env: WATS_ACCESS_TOKEN");
      expect(envText).toContain("WATS_ACCESS_TOKEN=");
      expect(envText).toContain("WATS_SERVICE_TOKEN=");
      for (const line of envText.split("\n")) {
        if (line.startsWith("#") || line.trim().length === 0 || line.startsWith("WATS_LIVE_ENABLE=") || line.startsWith("WATS_YES_LIVE=")) continue;
        expect(line).toMatch(/^[A-Z0-9_]+=$/);
      }
      expect(configText + envText).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/);
      expect(configText + envText).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/i);
      expect(parseConfig(configText, { format: "yaml" }).defaultProfile).toBe("local");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates JSON config when requested and validates through @switchbord/config", () => {
    const dir = makeTempDir();
    try {
      const result = runCli(["init", dir, "--format=json", "--profile", "prod"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const configPath = join(dir, "wats.config.json");
      expect(existsSync(configPath)).toBe(true);
      const config = parseConfig(read(configPath), { format: "json" });
      expect(config.defaultProfile).toBe("prod");
      expect(config.profiles.prod).toBeDefined();
      expect(existsSync(join(dir, ".env.example"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses to overwrite existing generated files", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "wats.config.yaml"), "existing", "utf8");
      const result = runCli(["init", dir, "--format", "yaml"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("refusing to overwrite");
      expect(result.stderr).not.toContain(dir);
      expect(read(join(dir, "wats.config.yaml"))).toBe("existing");
      expect(existsSync(join(dir, ".env.example"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails closed for unsafe paths, profiles, formats, duplicate flags, and help sidecars", () => {
    const dir = makeTempDir();
    try {
      const cases = [
        ["--profile", ""],
        ["--profile", "../../.env.local"],
        ["--profile", "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890"],
        ["--format", "toml"],
        ["--format", "yaml", "--format", "json"],
        ["--dry-run", "--unknown=../../.env.local"],
        ["--help", "--unknown=../../.env.local"],
        [".."],
        ["nested/../target"],
        ["bad\u0001path"]
      ];
      for (const args of cases) {
        const result = runCli(["init", ...args], dir);
        expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("wats init --help");
        expectNoSecrets(result.stderr);
        expect(result.stderr).not.toContain("../../.env.local");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
