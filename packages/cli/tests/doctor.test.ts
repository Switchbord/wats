import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type JsonRecord = Record<string, unknown>;

const SENTINELS = [
  "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
  "APP_SECRET_DO_NOT_PRINT",
  "raw-service-bearer-token-do-not-print",
  "../../.env.local"
] as const;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) throw new Error(`Expected JSON object at ${filePath}`);
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
    stderr: "pipe",
    env: {
      ...process.env,
      WATS_ACCESS_TOKEN: "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
      WATS_APP_SECRET: "APP_SECRET_DO_NOT_PRINT",
      WATS_SERVICE_TOKEN: "raw-service-bearer-token-do-not-print"
    }
  });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wats-cli-doctor-"));
}

function expectNoSecrets(output: string): void {
  for (const sentinel of SENTINELS) expect(output).not.toContain(sentinel);
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/u);
  expect(output).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/iu);
}

function validConfig(): JsonRecord {
  return {
    version: 1,
    defaultProfile: "local",
    profiles: {
      local: {
        graph: { apiVersion: "v25.0", baseUrl: "https://graph.facebook.com" },
        whatsapp: { wabaId: "123456789012345", phoneNumberId: "15551234567" },
        auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
        webhook: {
          path: "/webhooks/whatsapp",
          verifyToken: { env: "WATS_VERIFY_TOKEN" },
          appSecret: { env: "WATS_APP_SECRET" },
          maxBodyBytes: 1048576
        },
        service: {
          host: "127.0.0.1",
          port: 8787,
          apiPrefix: "/api",
          bearerToken: { env: "WATS_SERVICE_TOKEN" }
        }
      }
    }
  };
}

function writeConfig(dir: string, value: unknown = validConfig()): string {
  const configPath = join(dir, "wats.config.json");
  writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return configPath;
}

function parseDoctorJson(stdout: string): JsonRecord {
  const parsed = JSON.parse(stdout) as unknown;
  if (!isJsonRecord(parsed)) throw new Error(`Expected JSON object stdout: ${stdout}`);
  return parsed;
}

describe("wats doctor offline diagnostics", () => {
  test("--help documents real offline diagnostics and output formats", () => {
    const result = runCli(["doctor", "--help"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats doctor");
    expect(result.stdout).toContain("--config <path>");
    expect(result.stdout).toContain("--check-env");
    expect(result.stdout).toContain("--format text|json");
    expect(result.stdout).toContain("offline diagnostics");
    expect(result.stdout).not.toContain("help only");
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("valid config reports offline runtime, package, config, profile, route, and OpenAPI checks", () => {
    const dir = makeTempDir();
    try {
      const configPath = writeConfig(dir);
      const result = runCli(["doctor", "--config", configPath, "--profile", "local"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("doctor ok");
      for (const check of ["runtime", "package-imports", "config", "profile", "routes", "openapi"]) {
        expect(result.stdout).toContain(`${check}: ok`);
      }
      expect(result.stdout).not.toContain("WATS_ACCESS_TOKEN");
      expect(result.stdout).not.toContain("local");
      expect(result.stdout).not.toContain(configPath);
      expectNoSecrets(result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("json format has stable redacted check shape", () => {
    const dir = makeTempDir();
    try {
      const configPath = writeConfig(dir);
      const result = runCli(["doctor", "--config", configPath, "--profile", "local", "--format", "json"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const json = parseDoctorJson(result.stdout);
      expect(json.ok).toBe(true);
      expect(json.summary).toEqual({ ok: 7, warning: 0, error: 0 });
      expect(Array.isArray(json.checks)).toBe(true);
      const checks = json.checks as JsonRecord[];
      expect(checks.map((check) => check.name)).toEqual(["runtime", "package-imports", "packages", "config", "profile", "routes", "openapi"]);
      for (const check of checks) {
        expect(check.status).toBe("ok");
        expect(typeof check.message).toBe("string");
      }
      expectNoSecrets(result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--check-env checks presence only and redacts env names and values", () => {
    const dir = makeTempDir();
    try {
      const configPath = writeConfig(dir);
      const result = runCli(["doctor", "--config", configPath, "--check-env", "--format", "json"]);
      expect(result.exitCode, result.stderr).toBe(1);
      const json = parseDoctorJson(result.stdout);
      expect(json.ok).toBe(false);
      expect(json.summary).toEqual({ ok: 7, warning: 0, error: 1 });
      const envCheck = (json.checks as JsonRecord[]).find((check) => check.name === "env");
      expect(envCheck).toBeDefined();
      expect(envCheck?.status).toBe("error");
      expect(String(envCheck?.message)).toContain("missing 1 required env value");
      expect(result.stdout).not.toContain("WATS_ACCESS_TOKEN");
      expect(result.stdout).not.toContain("WATS_APP_SECRET");
      expect(result.stdout).not.toContain("WATS_SERVICE_TOKEN");
      expectNoSecrets(result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid config aggregates safe findings without stack traces or attacker path echoes", () => {
    const dir = makeTempDir();
    try {
      const invalid = validConfig();
      ((invalid.profiles as JsonRecord).local as JsonRecord).webhook = {
        path: "/healthz",
        verifyToken: { env: "WATS_VERIFY_TOKEN" },
        appSecret: { env: "WATS_APP_SECRET" },
        maxBodyBytes: 1048576
      };
      const configPath = writeConfig(dir, invalid);
      const result = runCli(["doctor", "--config", configPath, "--profile", "../../.env.local", "--format", "json"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      const json = parseDoctorJson(result.stdout);
      expect(json.ok).toBe(false);
      const statuses = (json.checks as JsonRecord[]).map((check) => `${check.name}:${check.status}`);
      expect(statuses).toContain("profile:error");
      expect(statuses).toContain("routes:error");
      expect(statuses).toContain("openapi:error");
      expect(JSON.stringify(json)).not.toContain("../../.env.local");
      expect(JSON.stringify(json)).not.toContain(configPath);
      expect(JSON.stringify(json)).not.toContain("/healthz");
      expectNoSecrets(result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unsafe arguments fail closed without echoing attacker values", () => {
    const cases = [
      ["--config"],
      ["--profile", "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890"],
      ["--format", "xml"],
      ["--format", "json", "--format", "text"],
      ["--check-env", "--unknown", "../../.env.local"],
      ["--help", "--unknown", "../../.env.local"]
    ];
    for (const args of cases) {
      const result = runCli(["doctor", ...args]);
      expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("wats doctor --help");
      expect(result.stderr).not.toContain("../../.env.local");
      expectNoSecrets(result.stderr);
    }
  });
});
