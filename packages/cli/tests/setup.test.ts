import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parseConfig } from "@switchbord/config";
import { runCli } from "../src/index";

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type PromptRequest = {
  label?: string;
  message?: string;
  defaultValue?: string;
  secret?: boolean;
  required?: boolean;
};

type JsonRecord = Record<string, unknown>;

const ACCESS_TOKEN = "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890";
const APP_SECRET = "APP_SECRET_DO_NOT_PRINT";
const SERVICE_TOKEN = "raw-service-bearer-token-do-not-print";
const VERIFY_TOKEN = "verify-token-do-not-print";
const PROFILE_AT_LIMIT = "p".repeat(32);
const SECRET_AT_LIMIT = "s".repeat(4096);

const FORBIDDEN_OUTPUT = [
  ACCESS_TOKEN,
  APP_SECRET,
  SERVICE_TOKEN,
  VERIFY_TOKEN,
  SECRET_AT_LIMIT,
  "../../.env.local",
  "WATS_ACCESS_TOKEN",
  "WATS_APP_SECRET",
  "WATS_VERIFY_TOKEN",
  "WATS_SERVICE_TOKEN"
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

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wats-cli-setup-"));
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function expectNoSecrets(output: string): void {
  for (const forbidden of FORBIDDEN_OUTPUT) {
    expect(output).not.toContain(forbidden);
  }
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/u);
  expect(output).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/iu);
}

function envValue(envText: string, name: string): string {
  const line = envText.split("\n").find((entry) => entry.startsWith(`${name}=`));
  expect(line, `${name} must exist`).toBeDefined();
  return (line ?? "").slice(name.length + 1);
}

type AnswerOverrides = Partial<{
  profile: unknown;
  apiVersion: unknown;
  baseUrl: unknown;
  wabaId: unknown;
  phoneNumberId: unknown;
  accessToken: unknown;
  appSecret: unknown;
  verifyToken: unknown;
  serviceToken: unknown;
  webhookPath: unknown;
  serviceHost: unknown;
  servicePort: unknown;
  apiPrefix: unknown;
}>;

function answerOverride(overrides: AnswerOverrides, key: keyof AnswerOverrides, fallback: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
}

function validAnswers(overrides: AnswerOverrides = {}): unknown[] {
  return [
    answerOverride(overrides, "profile", "test"),
    answerOverride(overrides, "apiVersion", ""),
    answerOverride(overrides, "baseUrl", ""),
    answerOverride(overrides, "wabaId", "123456789012345"),
    answerOverride(overrides, "phoneNumberId", "987654321098765"),
    answerOverride(overrides, "accessToken", ACCESS_TOKEN),
    answerOverride(overrides, "appSecret", APP_SECRET),
    answerOverride(overrides, "verifyToken", ""),
    answerOverride(overrides, "serviceToken", ""),
    answerOverride(overrides, "webhookPath", ""),
    answerOverride(overrides, "serviceHost", ""),
    answerOverride(overrides, "servicePort", ""),
    answerOverride(overrides, "apiPrefix", "")
  ];
}

async function runSetup(
  args: readonly unknown[],
  answers: readonly unknown[] = validAnswers(),
  cwd = repoRoot
): Promise<{ result: CliResult; prompts: PromptRequest[] }> {
  const prompts: PromptRequest[] = [];
  let answerIndex = 0;
  const result = await runCli(args as readonly string[], {
    cwd,
    prompt: async (request: PromptRequest): Promise<unknown> => {
      prompts.push(request);
      if (answerIndex >= answers.length) return "";
      const answer = answers[answerIndex];
      answerIndex += 1;
      return answer;
    }
  });
  return { result, prompts };
}

async function runSetupWithAnswers(
  args: readonly unknown[],
  answers: readonly unknown[],
  cwd = repoRoot
): Promise<{ result: CliResult; prompts: PromptRequest[] }> {
  const prompts: PromptRequest[] = [];
  let answerIndex = 0;
  const result = await runCli(args as readonly string[], {
    cwd,
    prompt: async (request: PromptRequest): Promise<unknown> => {
      prompts.push(request);
      if (answerIndex >= answers.length) return "";
      const answer = answers[answerIndex];
      answerIndex += 1;
      return answer;
    }
  });
  return { result, prompts };
}

function secretPromptLabels(prompts: readonly PromptRequest[]): string[] {
  return prompts
    .filter((prompt) => prompt.secret === true)
    .map((prompt) => prompt.label ?? prompt.message ?? "");
}

describe("wats setup", () => {
  test("--help documents the non-live credential setup wizard", async () => {
    const { result, prompts } = await runSetup(["setup", "--help"], []);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats setup [dir]");
    expect(result.stdout).toContain("interactive credential setup wizard");
    expect(result.stdout).toContain(".env.local");
    expect(result.stdout).toContain("refuses to overwrite");
    expect(result.stdout).toContain("No live credentials are read or required");
    expect(prompts).toHaveLength(0);
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("writes deterministic YAML and .env.local while redacting output", async () => {
    const dir = makeTempDir();
    try {
      const { result, prompts } = await runSetup(["setup", dir]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("setup complete");
      expect(result.stdout).toContain("files: 2");
      expect(result.stdout).toContain("profile: [REDACTED_PROFILE]");
      expect(result.stdout).not.toContain(dir);
      expectNoSecrets(result.stdout + result.stderr);

      const configPath = join(dir, "wats.config.yaml");
      const envPath = join(dir, ".env.local");
      expect(existsSync(configPath)).toBe(true);
      expect(existsSync(envPath)).toBe(true);

      const configText = read(configPath);
      const envText = read(envPath);
      expect(configText).toBe(`version: 1
defaultProfile: test
profiles:
  test:
    graph:
      apiVersion: v25.0
      baseUrl: https://graph.facebook.com
    whatsapp:
      wabaId: "123456789012345"
      phoneNumberId: "987654321098765"
    auth:
      accessToken:
        env: WATS_ACCESS_TOKEN
    webhook:
      path: /webhooks/whatsapp
      verifyToken:
        env: WATS_VERIFY_TOKEN
      appSecret:
        env: WATS_APP_SECRET
      maxBodyBytes: 1048576
    service:
      host: 127.0.0.1
      port: 8787
      apiPrefix: /api
      bearerToken:
        env: WATS_SERVICE_TOKEN
`);
      expect(configText).not.toContain(ACCESS_TOKEN);
      expect(configText).not.toContain(APP_SECRET);
      expect(configText).not.toContain(SERVICE_TOKEN);
      expect(configText).not.toContain(VERIFY_TOKEN);

      const parsed = parseConfig(configText, { format: "yaml" });
      expect(parsed.defaultProfile).toBe("test");
      expect(parsed.profiles.test?.webhook.maxBodyBytes).toBe(1_048_576);

      expect(envValue(envText, "WATS_ACCESS_TOKEN")).toBe(ACCESS_TOKEN);
      expect(envValue(envText, "WATS_APP_SECRET")).toBe(APP_SECRET);
      expect(envValue(envText, "WATS_WABA_ID")).toBe("123456789012345");
      expect(envValue(envText, "WATS_PHONE_NUMBER_ID")).toBe("987654321098765");
      expect(envValue(envText, "WATS_VERIFY_TOKEN")).toMatch(/^wats_wh_[A-Za-z0-9_-]{32,}$/u);
      expect(envValue(envText, "WATS_SERVICE_TOKEN")).toMatch(/^wats_srv_[A-Za-z0-9_-]{32,}$/u);
      expect(envValue(envText, "WATS_LIVE_ENABLE")).toBe("0");
      expect(envValue(envText, "WATS_YES_LIVE")).toBe("0");

      expect(secretPromptLabels(prompts)).toEqual([
        "Meta access token",
        "Meta app secret",
        "Webhook verify token",
        "WATS service bearer token"
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts profile and secret values exactly at documented limits", async () => {
    const dir = makeTempDir();
    try {
      const { result } = await runSetup(["setup", dir], validAnswers({ profile: PROFILE_AT_LIMIT, accessToken: SECRET_AT_LIMIT, verifyToken: VERIFY_TOKEN, serviceToken: SERVICE_TOKEN }));
      expect(result.exitCode, result.stderr).toBe(0);
      expectNoSecrets(result.stdout + result.stderr);
      const config = parseConfig(read(join(dir, "wats.config.yaml")), { format: "yaml" });
      expect(config.defaultProfile).toBe(PROFILE_AT_LIMIT);
      const envText = read(join(dir, ".env.local"));
      expect(envValue(envText, "WATS_ACCESS_TOKEN")).toHaveLength(4096);
      expect(envValue(envText, "WATS_VERIFY_TOKEN")).toBe(VERIFY_TOKEN);
      expect(envValue(envText, "WATS_SERVICE_TOKEN")).toBe(SERVICE_TOKEN);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects null, empty, whitespace, non-string, control, and over-limit secret answers without throwing", async () => {
    const cases: Array<{ answer: unknown; error: string }> = [
      { answer: null, error: "PromptInputError" },
      { answer: undefined, error: "PromptInputError" },
      { answer: 12345, error: "PromptInputError" },
      { answer: {}, error: "PromptInputError" },
      { answer: [], error: "PromptInputError" },
      { answer: "", error: "SetupInputError" },
      { answer: "   ", error: "SetupInputError" },
      { answer: "token\nINJECT=1", error: "SetupInputError" },
      { answer: "token\0INJECT=1", error: "SetupInputError" },
      { answer: "x".repeat(4097), error: "SetupInputError" }
    ];

    for (const entry of cases) {
      const dir = makeTempDir();
      try {
        const { result } = await runSetupWithAnswers(["setup", dir], validAnswers({ accessToken: entry.answer }));
        expect(result.exitCode, `answer=${String(entry.answer)} stdout=${result.stdout}`).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(entry.error);
        expect(result.stderr).toContain("wats setup --help");
        expect(result.stderr).not.toContain("INJECT=1");
        expectNoSecrets(result.stderr);
        expect(existsSync(join(dir, "wats.config.yaml"))).toBe(false);
        expect(existsSync(join(dir, ".env.local"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("fails closed for unsafe profiles, malformed config answers, numeric bounds, paths, and flags", async () => {
    const dir = makeTempDir();
    try {
      const cases: Array<{ args: readonly unknown[]; answers?: readonly unknown[]; error: string }> = [
        { args: ["setup", dir, "--profile", "../../.env.local"], error: "CliUsageError" },
        { args: ["setup", dir, "--profile", "tokenSecret"], error: "CliUsageError" },
        { args: ["setup", dir, "--profile", "a".repeat(33)], error: "CliUsageError" },
        { args: ["setup", dir, "--profile", "ok", "--profile", "again"], error: "CliUsageError" },
        { args: ["setup", dir, "--unknown=../../.env.local"], error: "CliUsageError" },
        { args: ["setup", "--help", "--unknown=../../.env.local"], error: "CliUsageError" },
        { args: ["setup", ".."], error: "CliUsageError" },
        { args: ["setup", "nested/../target"], error: "CliUsageError" },
        { args: ["setup", "bad\u0001path"], error: "CliUsageError" },
        { args: ["setup", dir], answers: validAnswers({ profile: "a".repeat(33) }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ profile: "bad/name" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ apiVersion: "25.0" }), error: "ConfigValidationError" },
        { args: ["setup", dir], answers: validAnswers({ baseUrl: "ftp://graph.facebook.com" }), error: "ConfigValidationError" },
        { args: ["setup", dir], answers: validAnswers({ wabaId: "not-digits" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ phoneNumberId: "" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ webhookPath: "/webhooks/../secret" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ webhookPath: "/webhooks/%252e%252e/secret" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ servicePort: "0" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ servicePort: "65536" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ servicePort: "1.5" }), error: "SetupInputError" },
        { args: ["setup", dir], answers: validAnswers({ apiPrefix: "/api/../messages" }), error: "SetupInputError" }
      ];

      for (const entry of cases) {
        const { result } = await runSetup(entry.args, entry.answers ?? validAnswers());
        expect(result.exitCode, `args=${JSON.stringify(entry.args)} stdout=${result.stdout}`).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(entry.error);
        expect(result.stderr).toContain("wats setup --help");
        expect(result.stderr).not.toContain("../../.env.local");
        expectNoSecrets(result.stderr);
        rmSync(join(dir, "wats.config.yaml"), { force: true });
        rmSync(join(dir, ".env.local"), { force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses overwrites and rolls config back when secret-file exclusive write fails", async () => {
    const existingConfigDir = makeTempDir();
    try {
      writeFileSync(join(existingConfigDir, "wats.config.yaml"), "existing", "utf8");
      const { result } = await runSetup(["setup", existingConfigDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("OutputError");
      expect(result.stderr).toContain("refusing to overwrite");
      expect(read(join(existingConfigDir, "wats.config.yaml"))).toBe("existing");
      expect(existsSync(join(existingConfigDir, ".env.local"))).toBe(false);
    } finally {
      rmSync(existingConfigDir, { recursive: true, force: true });
    }

    const existingEnvDir = makeTempDir();
    try {
      writeFileSync(join(existingEnvDir, ".env.local"), "existing", "utf8");
      const { result } = await runSetup(["setup", existingEnvDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("OutputError");
      expect(existsSync(join(existingEnvDir, "wats.config.yaml"))).toBe(false);
      expect(read(join(existingEnvDir, ".env.local"))).toBe("existing");
    } finally {
      rmSync(existingEnvDir, { recursive: true, force: true });
    }

    const rollbackDir = makeTempDir();
    try {
      symlinkSync(join(rollbackDir, "missing-target"), join(rollbackDir, ".env.local"));
      expect(lstatSync(join(rollbackDir, ".env.local")).isSymbolicLink()).toBe(true);
      const { result } = await runSetup(["setup", rollbackDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("OutputError");
      expect(existsSync(join(rollbackDir, "wats.config.yaml"))).toBe(false);
      expect(lstatSync(join(rollbackDir, ".env.local")).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(rollbackDir, { recursive: true, force: true });
    }
  });

  test("malformed argv, missing prompt provider, and thrown prompt errors return typed failures", async () => {
    const malformedArgvResult = await runCli([null as unknown as string, "setup"] as readonly string[]);
    expect(malformedArgvResult.exitCode).toBe(1);
    expect(malformedArgvResult.stderr).toContain("CliUsageError");

    const dir = makeTempDir();
    try {
      const missingPromptResult = await runCli(["setup", dir]);
      expect(missingPromptResult.exitCode).toBe(1);
      expect(missingPromptResult.stderr).toContain("PromptInputError");
      expect(missingPromptResult.stderr).toContain("wats setup --help");

      const thrownPromptResult = await runCli(["setup", dir], {
        prompt: async (): Promise<string> => {
          throw new Error(`do not leak ${ACCESS_TOKEN}`);
        }
      });
      expect(thrownPromptResult.exitCode).toBe(1);
      expect(thrownPromptResult.stderr).toContain("PromptInputError");
      expectNoSecrets(thrownPromptResult.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(".env.local remains gitignored by repository policy", () => {
    expect(read(join(repoRoot, ".gitignore"))).toContain(".env.*");
  });
});
