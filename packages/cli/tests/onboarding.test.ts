import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type JsonRecord = Record<string, unknown>;

const FORBIDDEN_OUTPUT = [
  "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
  "raw-service-bearer-token-do-not-print",
  "APP_SECRET_DO_NOT_PRINT",
  "../../.env.local"
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

function runCli(args: string[]): CliResult {
  const entrypoint = join(repoRoot, "packages/cli/dist/bin.js");
  const completed = Bun.spawnSync(["bun", entrypoint, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WATS_ACCESS_TOKEN: "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
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

function expectNoSecrets(output: string): void {
  for (const forbidden of FORBIDDEN_OUTPUT) {
    expect(output).not.toContain(forbidden);
  }
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/u);
  expect(output).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/iu);
}

function expectTokenShape(value: string, prefix: string): void {
  expect(value.startsWith(prefix), `${value} prefix`).toBe(true);
  expect(value.length, `${value} length`).toBeGreaterThanOrEqual(32);
  expect(value).toMatch(/^[A-Za-z0-9_-]+$/u);
}

describe("wats onboarding", () => {
  test("--help documents webhook URL and user-generated credential guidance", () => {
    const result = runCli(["onboarding", "--help"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats onboarding --public-url <https URL>");
    expect(result.stdout).toContain("webhook callback address");
    expect(result.stdout).toContain("WATS_VERIFY_TOKEN");
    expect(result.stdout).toContain("WATS_APP_SECRET");
    expect(result.stdout).toContain("WATS_SERVICE_TOKEN");
    expect(result.stdout).toContain("WATS_ACCESS_TOKEN");
    expect(result.stdout).toContain("Meta App Dashboard");
    expect(result.stdout).toContain("No live credentials are read or required");
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("prints generated local secrets and webhook callback address without reading env secrets", () => {
    const result = runCli([
      "onboarding",
      "--public-url",
      "https://example.test/wats",
      "--webhook-path",
      "/webhooks/whatsapp"
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("webhook callback address: https://example.test/wats/webhooks/whatsapp");
    expect(result.stdout).toContain("Meta App Dashboard > WhatsApp > Configuration");
    expect(result.stdout).toContain("Generate or copy from Meta/user side:");
    expect(result.stdout).toContain("WATS_ACCESS_TOKEN=<copy from Meta system user/app token>");
    expect(result.stdout).toContain("WATS_APP_SECRET=<copy from Meta App Dashboard>");
    expect(result.stdout).toContain("WATS_WABA_ID=<copy from WhatsApp Manager>");
    expect(result.stdout).toContain("WATS_PHONE_NUMBER_ID=<copy from WhatsApp Manager>");
    expect(result.stdout).toContain("Generated locally by WATS:");
    expect(result.stdout).toContain("WATS_VERIFY_TOKEN=");
    expect(result.stdout).toContain("WATS_SERVICE_TOKEN=");
    expect(result.stdout).toContain("No live credentials are read or required");
    expectNoSecrets(result.stdout + result.stderr);

    const verifyLine = result.stdout.split("\n").find((line) => line.startsWith("WATS_VERIFY_TOKEN="));
    const serviceLine = result.stdout.split("\n").find((line) => line.startsWith("WATS_SERVICE_TOKEN="));
    expect(verifyLine).toBeDefined();
    expect(serviceLine).toBeDefined();
    expectTokenShape((verifyLine ?? "").split("=")[1] ?? "", "wats_wh_");
    expectTokenShape((serviceLine ?? "").split("=")[1] ?? "", "wats_srv_");
  });

  test("canonicalizes base URL and default webhook path", () => {
    const result = runCli(["onboarding", "--public-url", "https://example.test/base/"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("webhook callback address: https://example.test/base/webhooks/whatsapp");
  });

  test("fails closed for unsafe URLs, paths, unknown flags, and help sidecars", () => {
    const cases = [
      ["--public-url", "http://example.test"],
      ["--public-url", "https://example.test/with space"],
      ["--public-url", "javascript:alert(1)"],
      ["--public-url", "https://example.test/wats/../admin"],
      ["--public-url", "https://example.test/%2e%2e/admin"],
      ["--public-url", "https://example.test/foo/%2e%2e/bar"],
      ["--public-url", "https://example.test/foo/%252e%252e/bar"],
      ["--public-url", "https://example.test", "--webhook-path", "../webhook"],
      ["--public-url", "https://example.test", "--webhook-path", "/webhooks/../secret"],
      ["--public-url", "https://example.test", "--unknown", "../../.env.local"],
      ["--help", "--unknown", "../../.env.local"]
    ];
    for (const args of cases) {
      const result = runCli(["onboarding", ...args]);
      expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("wats onboarding --help");
      expect(result.stderr).not.toContain("../../.env.local");
      expectNoSecrets(result.stderr);
    }
  });
});
