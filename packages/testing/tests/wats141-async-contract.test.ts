import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function parseJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function findRepoRoot(startDir: string): string {
  let cur = resolve(startDir);
  for (;;) {
    if (existsSync(join(cur, "package.json")) && existsSync(join(cur, "packages"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) throw new Error("repo root not found");
    cur = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function runBun(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const completed = Bun.spawnSync(["bun", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

describe("async WATS integration contract", () => {
  test("documents the app-side async import allowlist and dependency boundary", () => {
    const doc = read("site/content/docs/concepts/async-integration-contract.mdx");
    for (const phrase of [
      "@wats/http",
      "@wats/core",
      "@wats/core/filtersTyped",
      "@wats/graph",
      "@wats/graph/testing",
      "@wats/graph/transport",
      "@wats/types",
      "@wats/config",
      "Do not build distributed state on `@wats/persistence`",
      "Redis/BullMQ idempotency and queue state should live in the app-side async layer",
      "Do not import from `packages/*/src`",
      "Do not key every update on `message.id`"
    ]) expect(doc).toContain(phrase);

    const meta = read("site/content/docs/concepts/meta.json");
    expect(meta).toContain("async-integration-contract");
  });

  test("consumer fixture imports only allowlisted public WATS specifiers", () => {
    const fixture = read("packages/testing/fixtures/async-wats-contract/verify-imports.ts");
    const importSpecifiers = Array.from(fixture.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1]);
    expect(importSpecifiers.sort()).toEqual([
      "@wats/config",
      "@wats/core",
      "@wats/core/filtersTyped",
      "@wats/graph",
      "@wats/graph/testing",
      "@wats/graph/transport",
      "@wats/http",
      "@wats/types"
    ].sort());
    expect(fixture).not.toContain("packages/");
    expect(fixture).not.toContain("/src");
    expect(fixture).not.toContain("@wats/persistence");
    expect(fixture).not.toContain("@wats/internal-utils");
  });

  test("fixture typechecks through package specifiers", () => {
    const fixtureDir = join(repoRoot, "packages/testing/fixtures/async-wats-contract");
    const manifest = parseJson(join(fixtureDir, "package.json"));
    expect(manifest.name).toBe("async-wats-contract-consumer");
    const result = runBun(["run", "verify-imports"], fixtureDir);
    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.at(-1)).toBe("async-wats-contract-consumer:ok");
    const report = JSON.parse(lines.at(-2) ?? "{}") as { ok: boolean; checks: Record<string, boolean> };
    expect(report.ok).toBe(true);
    for (const [name, ok] of Object.entries(report.checks)) expect(ok, name).toBe(true);
  });
});
