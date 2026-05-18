import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_SECRET_STRINGS = [
  "WATS_ACCESS_TOKEN",
  "WATS_WEBHOOK_VERIFY_TOKEN",
  "WATS_WEBHOOK_APP_SECRET",
  "WATS_SERVICE_BEARER_TOKEN",
  "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
  "raw-service-bearer-token-do-not-print"
];

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

function runCli(args: string[], cwd = findRepoRoot(import.meta.dir)): CliResult {
  const repoRoot = findRepoRoot(import.meta.dir);
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
  return mkdtempSync(join(tmpdir(), "wats-cli-wats33-"));
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
          verifyToken: { env: "WATS_WEBHOOK_VERIFY_TOKEN" },
          appSecret: { env: "WATS_WEBHOOK_APP_SECRET" },
          maxBodyBytes: 1048576
        },
        service: {
          host: "127.0.0.1",
          port: 8787,
          apiPrefix: "/api",
          bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
        }
      },
      alternate: {
        graph: { apiVersion: "v25.0", baseUrl: "https://graph.facebook.com" },
        whatsapp: { wabaId: "999999999999999", phoneNumberId: "19998887777" },
        auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
        webhook: {
          path: "/hooks/alternate",
          verifyToken: { env: "WATS_WEBHOOK_VERIFY_TOKEN" },
          appSecret: { env: "WATS_WEBHOOK_APP_SECRET" },
          maxBodyBytes: 1048576
        },
        service: {
          host: "localhost",
          port: 9797,
          apiPrefix: "/alt-api",
          bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
        }
      }
    }
  };
}

function writeConfig(dir: string, value: unknown = validConfig(), fileName = "wats.config.json"): string {
  const configPath = join(dir, fileName);
  writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return configPath;
}

function expectNoSecrets(output: string): void {
  for (const forbidden of FORBIDDEN_SECRET_STRINGS) {
    expect(output).not.toContain(forbidden);
  }
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/);
  expect(output).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/i);
  expect(output).not.toContain("../../.env.local");
}

function jsonFromStdout(stdout: string): JsonRecord {
  const parsed = JSON.parse(stdout) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object stdout, got ${stdout}`);
  }
  return parsed;
}

describe("wats config validate", () => {
  test("--help documents real validation without secret resolution", () => {
    const result = runCli(["config", "validate", "--help"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats config validate <path>");
    expect(result.stdout).toContain("Validates a WATS config file");
    expect(result.stdout).toContain("does not resolve env-secret values");
    expect(result.stdout).not.toContain("planned config validation");
  });

  test("valid config path exits 0 with redacted count-only summary", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);

    const result = runCli(["config", "validate", configPath]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("config valid");
    expect(result.stdout).toContain("default profile: [REDACTED_PROFILE]");
    expect(result.stdout).toContain("profiles: 2");
    expect(result.stdout).not.toContain("profile names:");
    expect(result.stdout).not.toContain("local");
    expect(result.stdout).not.toContain("alternate");
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("valid config summaries do not echo token-like or path-like profile names", () => {
    const dir = makeTempDir();
    const config = validConfig();
    config.defaultProfile = "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890";
    config.profiles = {
      TOKEN_SENTINEL_DO_NOT_PRINT_1234567890: (config.profiles as JsonRecord).local as JsonRecord,
      "../../.env.local": (config.profiles as JsonRecord).alternate as JsonRecord
    };
    const configPath = writeConfig(dir, config, "token-like-profiles.json");

    const result = runCli(["config", "validate", configPath]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("config valid");
    expect(result.stdout).toContain("profiles: 2");
    expect(result.stdout).toContain("default profile: [REDACTED_PROFILE]");
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("--config alias validates the same file", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);

    const result = runCli(["config", "validate", "--config", configPath]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("config valid");
    expect(result.stdout).toContain("default profile: [REDACTED_PROFILE]");
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("missing, empty, whitespace-ish, and unknown-flag inputs fail closed without echoing attacker values", () => {
    const cases = [
      [] as string[],
      [""],
      ["   "],
      ["--config"],
      ["--unknown=../../.env.local"],
      ["--help", "--unknown=../../.env.local"],
      ["--config", "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890"]
    ];

    for (const args of cases) {
      const result = runCli(["config", "validate", ...args]);
      expect(result.exitCode, `args ${JSON.stringify(args)} stdout ${result.stdout}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("wats config validate --help");
      expectNoSecrets(result.stderr);
      expect(result.stderr).not.toContain("TOKEN_SENTINEL_DO_NOT_PRINT_1234567890");
    }
  });

  test("malformed and schema-invalid config print ConfigValidationError taxonomy without stack traces or secrets", () => {
    const dir = makeTempDir();
    const malformedPath = join(dir, "malformed.json");
    writeFileSync(malformedPath, "{ not json and TOKEN_SENTINEL_DO_NOT_PRINT_1234567890", "utf8");
    const invalidPath = writeConfig(dir, { ...validConfig(), version: 999 }, "invalid.json");
    const attackerProfileConfig = validConfig();
    attackerProfileConfig.defaultProfile = "../../.env.local";
    const attackerProfilePath = writeConfig(dir, attackerProfileConfig, "attacker-profile.json");
    const tokenLikeProfileConfig = validConfig();
    tokenLikeProfileConfig.defaultProfile = "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890";
    const tokenLikeProfilePath = writeConfig(dir, tokenLikeProfileConfig, "token-profile.json");
    const tokenLikeNestedConfig = validConfig();
    tokenLikeNestedConfig.defaultProfile = "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890";
    tokenLikeNestedConfig.profiles = {
      TOKEN_SENTINEL_DO_NOT_PRINT_1234567890: {
        ...((tokenLikeNestedConfig.profiles as JsonRecord).local as JsonRecord),
        auth: { accessToken: "raw-service-bearer-token-do-not-print" }
      }
    };
    const tokenLikeNestedPath = writeConfig(dir, tokenLikeNestedConfig, "token-nested-profile.json");
    const spacedProfileConfig = validConfig();
    spacedProfileConfig.defaultProfile = "safe ../../.env.local";
    spacedProfileConfig.profiles = {
      "safe ../../.env.local": {
        ...((spacedProfileConfig.profiles as JsonRecord).local as JsonRecord),
        auth: { accessToken: "raw-service-bearer-token-do-not-print" }
      }
    };
    const spacedProfilePath = writeConfig(dir, spacedProfileConfig, "spaced-profile.json");

    for (const [args, expectedCode, expectedPath] of [
      [["config", "validate", malformedPath], "parse_error", "$"],
      [["config", "validate", invalidPath], "invalid_version", "$.version"],
      [["config", "validate", attackerProfilePath], "missing_default_profile", "$.profiles.<redacted>"],
      [["config", "validate", tokenLikeProfilePath], "missing_default_profile", "$.profiles.<redacted>"],
      [["config", "validate", tokenLikeNestedPath], "invalid_env_ref", "$.profiles.<redacted>"],
      [["config", "validate", spacedProfilePath], "invalid_env_ref", "$.profiles.<redacted>"]
    ] as const) {
      const result = runCli([...args]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("ConfigValidationError");
      expect(result.stderr).toContain(`code: ${expectedCode}`);
      expect(result.stderr).toContain(`path: ${expectedPath}`);
      expect(result.stderr).toContain("message:");
      expect(result.stderr).not.toContain("at ");
      expect(result.stderr).not.toContain(malformedPath);
      expect(result.stderr).not.toContain("../../.env.local");
      expectNoSecrets(result.stderr);
    }
  });
});

describe("wats openapi", () => {
  test("--help documents implemented export, stdout default, --out no-overwrite, and no live credentials", () => {
    const result = runCli(["openapi", "--help"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats openapi --config <path>");
    expect(result.stdout).toContain("Prints OpenAPI JSON to stdout by default");
    expect(result.stdout).toContain("--out <path>");
    expect(result.stdout).toContain("refuses to overwrite");
    expect(result.stdout).not.toContain("not implemented");
  });

  test("prints OpenAPI JSON for the default profile without leaking config env names", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);

    const result = runCli(["openapi", "--config", configPath]);
    const doc = jsonFromStdout(result.stdout);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(doc.openapi).toBe("3.1.0");
    expect(isJsonRecord(doc.paths) && doc.paths["/webhooks/whatsapp"]).toBeTruthy();
    expect(isJsonRecord(doc.paths) && doc.paths["/api/messages"]).toBeTruthy();
    expect(isJsonRecord(doc.components)).toBe(true);
    const components = doc.components as JsonRecord;
    expect(JSON.stringify(components)).toContain("serviceBearerAuth");
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("selects a named profile and safe server URL", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);

    const result = runCli([
      "openapi",
      "--config",
      configPath,
      "--profile",
      "alternate",
      "--server-url",
      "https://example.test/base?ignored=1#fragment"
    ]);
    const doc = jsonFromStdout(result.stdout);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(doc.servers).toEqual([{ url: "https://example.test/base" }]);
    expect(isJsonRecord(doc.paths) && doc.paths["/hooks/alternate"]).toBeTruthy();
    expect(isJsonRecord(doc.paths) && doc.paths["/alt-api/messages/text"]).toBeTruthy();
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("writes JSON only when --out is explicit and refuses to overwrite existing files", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const outPath = join(dir, "openapi.json");

    const first = runCli(["openapi", "--config", configPath, "--out", outPath]);
    expect(first.exitCode, first.stderr).toBe(0);
    expect(first.stdout).toContain("OpenAPI JSON written");
    expect(first.stdout).not.toContain(outPath);
    expect(first.stderr).toBe("");
    const written = parseJsonFile(outPath);
    expect(written.openapi).toBe("3.1.0");
    expectNoSecrets(first.stdout + first.stderr + JSON.stringify(written));

    const before = readFileSync(outPath, "utf8");
    const second = runCli(["openapi", "--config", configPath, "--out", outPath]);
    expect(second.exitCode).toBe(1);
    expect(second.stdout).toBe("");
    expect(second.stderr).toContain("refusing to overwrite");
    expect(second.stderr).toContain("wats openapi --help");
    expect(second.stderr).not.toContain(outPath);
    expect(readFileSync(outPath, "utf8")).toBe(before);
  });

  test("rejects invalid profile, unsafe serverUrl, unsafe --out, directories, missing values, and unknown flags safely", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const outDir = join(dir, "out-dir");
    mkdirSync(outDir);
    const traversalOut = join("..", "..", ".env.local");

    const cases = [
      ["--config", configPath, "--profile", "missing-profile"],
      ["--config", configPath, "--profile", ""],
      ["--config", configPath, "--profile", "   "],
      ["--config", configPath, "--server-url", "javascript:alert(1)"],
      ["--config", configPath, "--server-url", "https://example.test/has\\backslash"],
      ["--config", configPath, "--out", ""],
      ["--config", configPath, "--out", "   "],
      ["--config", configPath, "--out", traversalOut],
      ["--config", configPath, "--out", outDir],
      ["--config", configPath, "--unknown=../../.env.local"],
      ["--help", "--unknown=../../.env.local"],
      ["--config"],
      []
    ];

    for (const args of cases) {
      const result = runCli(["openapi", ...args]);
      expect(result.exitCode, `args ${JSON.stringify(args)} stdout ${result.stdout}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("wats openapi --help");
      expect(result.stderr).not.toContain("missing-profile");
      expect(result.stderr).not.toContain("javascript:alert");
      expect(result.stderr).not.toContain("has\\backslash");
      expect(result.stderr).not.toContain(outDir);
      expectNoSecrets(result.stderr);
    }
  });

  test("does not create output files unless --out is explicit", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const impliedPath = join(dir, "should-not-exist.json");

    const result = runCli(["openapi", "--config", configPath], dir);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("\"openapi\":");
    expect(existsSync(impliedPath)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("wats serve dry-run help", () => {
  test("serve --help documents the real dry-run process wrapper", () => {
    const result = runCli(["serve", "--help"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats serve --config <path> --dry-run");
    expect(result.stdout).toContain("--print-routes");
    expect(result.stdout).toContain("dry-run mock transport");
    expect(result.stdout).not.toContain("server runtime is not implemented");
    expect(result.stdout).toContain("No live credentials are read or required");
  });
});
