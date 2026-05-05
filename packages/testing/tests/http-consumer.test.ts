// F-3 http-consumer harness.
//
// Spawns `bun run verify-imports` from the http-consumer fixture
// directory (which declares `@switchbord/http: workspace:*`) and asserts the
// success sentinel + runtime-shape report.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

function includesWorkspacePackagesGlob(workspaces: unknown): boolean {
  if (Array.isArray(workspaces)) {
    return workspaces.includes("packages/*");
  }
  if (isJsonRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.includes("packages/*");
  }
  return false;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (includesWorkspacePackagesGlob(manifest.workspaces)) {
        return currentDir;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate workspace root from ${startDir}`);
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

describe("F-3 @switchbord/http consumer fixture", () => {
  test("fixture manifest exists and declares workspace dependencies", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/http-consumer"
    );

    expect(existsSync(join(fixtureDir, "package.json"))).toBe(true);
    expect(existsSync(join(fixtureDir, "verify-imports.ts"))).toBe(true);

    const manifest = parseJsonFile(join(fixtureDir, "package.json"));
    expect(manifest.name).toBe("http-consumer");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");

    const dependencies = manifest.dependencies;
    if (!isJsonRecord(dependencies)) {
      throw new Error("Fixture dependencies must be an object");
    }
    expect(dependencies["@switchbord/http"]).toBe("workspace:*");
    expect(dependencies["@switchbord/crypto"]).toBe("workspace:*");
  });

  test("running the fixture entry under bun emits the success sentinel", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/http-consumer"
    );

    const result = runBun(["run", "verify-imports"], fixtureDir);

    expect(result.exitCode).toBe(
      0,
      `fixture verify-imports failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );

    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const lastLine = lines.at(-1);
    expect(lastLine).toBe("http-consumer:ok");

    const jsonLine = lines.at(-2);
    expect(typeof jsonLine).toBe("string");

    const parsed = JSON.parse(jsonLine as string) as {
      ok: boolean;
      sentinel: string;
      checks: Record<string, boolean>;
      moduleKeys: Record<string, string[]>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.sentinel).toBe("http-consumer:ok");
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }

    const keys = parsed.moduleKeys["@switchbord/http"];
    expect(Array.isArray(keys)).toBe(true);
    expect((keys as string[])).toContain("validateWebhookSignature");
    expect((keys as string[])).toContain("verifyWebhookChallenge");
  });
});
