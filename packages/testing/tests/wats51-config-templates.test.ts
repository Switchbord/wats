import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseConfig, redactConfig } from "../../config/src/index";

type JsonRecord = Record<string, unknown>;

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

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

const forbiddenSecretPatterns = [
  /EAA[A-Za-z0-9_-]{20,}/u,
  /raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/iu,
  /whatsapp_business_account_id_[A-Za-z0-9_-]+/iu,
  /phone_number_id_[A-Za-z0-9_-]+/iu,
  /postgres(?:ql)?:\/\/[^\s]*:[^\s]*@/iu,
  /sk_live_[A-Za-z0-9_-]+/u
];

function expectNoRawSecrets(text: string): void {
  for (const pattern of forbiddenSecretPatterns) {
    expect(text).not.toMatch(pattern);
  }
}

describe("WATS-51 config and env templates", () => {
  test("checked-in template files exist and stay out of local generated config paths", () => {
    for (const path of [
      "examples/config/wats.config.example.yaml",
      "examples/config/wats.config.example.json",
      ".env.example"
    ]) {
      expect(existsSync(join(repoRoot, path)), `${path} should exist`).toBe(true);
    }

    const gitignore = read(".gitignore");
    expect(gitignore).toContain("!.env.example");
    expect(gitignore).toContain("wats.config.yaml");
    expect(gitignore).toContain("wats.config.json");
  });

  test("YAML and JSON examples parse through @wats/config and redact env names", () => {
    const yaml = read("examples/config/wats.config.example.yaml");
    const json = read("examples/config/wats.config.example.json");

    expectNoRawSecrets(yaml + json);

    const parsedYaml = parseConfig(yaml, { format: "yaml" });
    const parsedJson = parseConfig(json, { format: "json" });

    expect(parsedYaml.defaultProfile).toBe("local");
    expect(parsedJson.defaultProfile).toBe("local");
    expect(Object.keys(parsedYaml.profiles)).toEqual(["local", "prod"]);
    expect(Object.keys(parsedJson.profiles)).toEqual(["local", "prod"]);
    expect(parsedYaml.profiles.local.service.apiPrefix).toBe("/api");
    expect(parsedYaml.profiles.prod.webhook.path).toBe("/webhooks/whatsapp");

    const redacted = redactConfig(parsedYaml);
    expect(JSON.stringify(redacted)).toContain("[REDACTED_ENV]");
    expect(JSON.stringify(redacted)).not.toContain("WATS_ACCESS_TOKEN");
    expect(JSON.stringify(redacted)).not.toContain("WATS_APP_SECRET");
  });

  test(".env.example documents placeholder names only and omits raw values", () => {
    const envExample = read(".env.example");
    expectNoRawSecrets(envExample);

    for (const required of [
      "WATS_ACCESS_TOKEN=",
      "WATS_WABA_ID=",
      "WATS_PHONE_NUMBER_ID=",
      "WATS_VERIFY_TOKEN=",
      "WATS_APP_SECRET=",
      "WATS_SERVICE_TOKEN=",
      "WATS_DATABASE_URL=",
      "WATS_LIVE_ENABLE=0",
      "WATS_CLI_ORBIT=0",
      "WATS_CLI_STATUS_UI=0"
    ]) {
      expect(envExample).toContain(required);
    }

    expect(envExample).toContain("placeholder only");
    expect(envExample).toContain("Do not commit real values");
  });

  test("public docs describe WATS-51 templates and WATS-69 init generation boundary", () => {
    const configReference = read("docs/reference/config.md");
    const cliGuide = read("docs/guides/cli-init.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [configReference, cliGuide, changelog]) {
      expect(doc).toContain("WATS-51");
      expect(doc).toContain("examples/config/wats.config.example.yaml");
      expect(doc).toContain(".env.example");
      expect(doc).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/u);
      expect(doc).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/iu);
      expect(doc).not.toMatch(/postgres(?:ql)?:\/\/[^\s]*:[^\s]*@/iu);
    }

    expect(cliGuide).toContain("WATS-69 adds real local generation");
    expect(configReference).toContain("wats init` as of WATS-69");
    expect(changelog).toContain("no live Meta calls");
  });
});
