import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { runCli } from "../src/index";

type CliResult = Awaited<ReturnType<typeof runCli>>;
type JsonRecord = Record<string, unknown>;

const PUBLIC_WATS_PACKAGES = [
  "@wats/cli",
  "@wats/core",
  "@wats/graph",
  "@wats/http",
  "@wats/config",
  "@wats/service"
] as const;

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
const cliVersion = String(parseJsonFile(join(repoRoot, "packages/cli/package.json")).version);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wats-cli-upgrade-"));
}

function expectNoSecrets(output: string): void {
  for (const sentinel of SENTINELS) expect(output).not.toContain(sentinel);
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/u);
  expect(output).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/iu);
}

function packageJson(dependencies: Record<string, string>): string {
  return `${JSON.stringify({ name: "wats-upgrade-fixture", version: "1.0.0", dependencies }, null, 2)}\n`;
}

describe("wats CLI version and package upgrades", () => {
  test("root --version prints the installed CLI package version only", async () => {
    for (const args of [["--version"], ["-v"]]) {
      const result = await runCli(args);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${cliVersion}\n`);
      expectNoSecrets(result.stdout + result.stderr);
    }
  });

  test("root help advertises version, upgrade, and update commands", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("wats --version");
    expect(result.stdout).toContain("wats upgrade");
    expect(result.stdout).toContain("wats update");
  });

  test("upgrade --help documents the updater and credential boundary", async () => {
    const result = await runCli(["upgrade", "--help"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats upgrade");
    expect(result.stdout).toContain("wats update");
    expect(result.stdout).toContain("bun update --latest");
    expect(result.stdout).toContain("@wats/service");
    expect(result.stdout).toContain("does not read .env.local");
    expectNoSecrets(result.stdout + result.stderr);
  });

  test("upgrade --dry-run reports the Bun update command without modifying package.json", async () => {
    const dir = makeTempDir();
    try {
      const manifestPath = join(dir, "package.json");
      const original = packageJson({
        "@wats/cli": "0.3.4",
        "@wats/core": "0.3.4",
        "@wats/graph": "0.3.4",
        "left-pad": "1.3.0"
      });
      writeFileSync(manifestPath, original, "utf8");

      const result = await runCli(["upgrade", "--dry-run"], { cwd: dir });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("upgrade dry-run");
      expect(result.stdout).toContain("bun update --latest");
      for (const packageName of PUBLIC_WATS_PACKAGES) {
        expect(result.stdout).toContain(packageName);
      }
      expect(result.stdout).not.toContain("left-pad");
      expect(readFileSync(manifestPath, "utf8")).toBe(original);
      expectNoSecrets(result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("update is an alias for upgrade dry-run output", async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "package.json"), packageJson({ "@wats/cli": "0.3.4" }), "utf8");
      const upgrade = await runCli(["upgrade", "--dry-run"], { cwd: dir });
      const update = await runCli(["update", "--dry-run"], { cwd: dir });
      expect(update.exitCode, update.stderr).toBe(0);
      expect(update.stdout).toBe(upgrade.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upgrade rejects unsafe args and missing package manifests without path echoes", async () => {
    const cases: Array<readonly string[]> = [
      ["upgrade", "--unknown", "../../.env.local"],
      ["upgrade", "--help", "--unknown", "../../.env.local"],
      ["upgrade", "../../.env.local"],
      ["update", "--dry-run=TOKEN_SENTINEL_DO_NOT_PRINT_1234567890"]
    ];
    for (const args of cases) {
      const result = await runCli(args);
      expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("wats upgrade --help");
      expect(result.stderr).not.toContain("../../.env.local");
      expectNoSecrets(result.stderr);
    }

    const dir = makeTempDir();
    try {
      const result = await runCli(["upgrade", "--dry-run"], { cwd: dir });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("PackageManifestError");
      expect(result.stderr).not.toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("doctor json includes package version check and warns when installed WATS packages are outdated", async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "package.json"), packageJson({
        "@wats/cli": "0.3.5",
        "@wats/core": cliVersion,
        "@wats/service": "workspace:*",
        "left-pad": "1.3.0"
      }), "utf8");
      const configPath = join(dir, "wats.config.json");
      writeFileSync(configPath, JSON.stringify({
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
      }, null, 2), "utf8");

      const result = await runCli(["doctor", "--config", configPath, "--format", "json"], { cwd: dir });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const json = JSON.parse(result.stdout) as JsonRecord;
      expect(json.summary).toEqual({ ok: 6, warning: 1, error: 0 });
      const checks = json.checks as JsonRecord[];
      expect(checks.map((check) => check.name)).toEqual(["runtime", "package-imports", "packages", "config", "profile", "routes", "openapi"]);
      const packagesCheck = checks.find((check) => check.name === "packages");
      expect(packagesCheck?.status).toBe("warning");
      expect(packagesCheck?.message).toBe("1 WATS package appears older than this CLI.");
      expect(result.stdout).not.toContain("left-pad");
      expect(result.stdout).not.toContain(dir);
      expectNoSecrets(result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upgrade invokes Bun for the public WATS package set only", async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "package.json"), packageJson({ "@wats/cli": "0.3.4" }), "utf8");
      const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
      const result = await runCli(["upgrade"], {
        cwd: dir,
        spawn: (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return { exitCode: 0, stdout: "UPDATED_SENTINEL", stderr: "ERR_SENTINEL" };
        }
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("upgrade complete\npackages: 6\n");
      expect(calls).toEqual([{ command: "bun", args: ["update", "--latest", ...PUBLIC_WATS_PACKAGES], cwd: dir }]);
      expect(result.stdout).not.toContain("UPDATED_SENTINEL");
      expect(result.stdout).not.toContain("ERR_SENTINEL");
      expectNoSecrets(result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
