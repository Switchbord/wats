// WATS-54 RED — deterministic public API consistency check for Graph endpoint subpaths.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(path: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object at ${path}`);
  }
  return parsed;
}

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (manifest.name === "wats" && manifest.private === true) return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

function runBun(args: readonly string[], cwd: string): {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const completed = Bun.spawnSync(["bun", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env }
  });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

const repoRoot = findRepoRoot(import.meta.dir);

const expectedGraphEndpointSpecifiers = [
  "@wats/graph/endpoints/messages",
  "@wats/graph/endpoints/media",
  "@wats/graph/endpoints/templates",
  "@wats/graph/endpoints/flows",
  "@wats/graph/endpoints/calling",
  "@wats/graph/endpoints/business-management",
  "@wats/graph/endpoints/groups"
] as const;

describe("WATS-54 public API consistency check", () => {
  test("root script, manifest, and checker are wired for Graph endpoint subpaths", () => {
    const rootManifest = parseJsonFile(join(repoRoot, "package.json"));
    expect(isJsonRecord(rootManifest.scripts)).toBe(true);
    expect((rootManifest.scripts as JsonRecord)["api:check"]).toBe(
      "bun run scripts/check-public-api-consistency.ts"
    );

    const manifest = parseJsonFile(join(repoRoot, "scripts/public-api-consistency-manifest.json"));
    expect(manifest.schema).toBe("wats.public-api-consistency.v1");
    expect(manifest.scope).toBe("@wats/graph endpoint subpaths");
    expect(Array.isArray(manifest.graphEndpointSubpaths)).toBe(true);

    const entries = manifest.graphEndpointSubpaths as unknown[];
    expect(entries).toHaveLength(expectedGraphEndpointSpecifiers.length);
    const specifiers = entries.map((entry) => {
      if (!isJsonRecord(entry)) throw new Error("manifest entry must be an object");
      return entry.specifier;
    });
    expect(specifiers).toEqual([...expectedGraphEndpointSpecifiers]);

    for (const entry of entries) {
      if (!isJsonRecord(entry)) throw new Error("manifest entry must be an object");
      expect(entry.packageName).toBe("@wats/graph");
      expect(typeof entry.exportKey).toBe("string");
      expect(typeof entry.source).toBe("string");
      expect(Array.isArray(entry.fixtureChecks)).toBe(true);
      expect(Array.isArray(entry.docs)).toBe(true);
      expect((entry.docs as unknown[])).toHaveLength(5);
    }
  });

  test("bun run api:check validates the manifest and emits a deterministic summary", () => {
    const result = runBun(["run", "api:check"], repoRoot);
    expect(
      result.exitCode,
      `api:check failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    ).toBe(0);
    expect(result.stdout).toContain("public-api-consistency:ok");
    expect(result.stdout).toContain("checked 7 graph endpoint subpaths");
    expect(result.stdout).toContain("docs=35");
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/https?:\/\//u);
    expect(combined).not.toMatch(/ACCESS_TOKEN|APP_SECRET|META|WHATSAPP|Bearer/u);
  });

  test("checker reports actionable failures for a broken export without network or credentials", () => {
    const result = runBun(
      [
        "run",
        "scripts/check-public-api-consistency.ts",
        "--manifest",
        "packages/testing/fixtures/public-api-consistency/broken-graph-export.json"
      ],
      repoRoot
    );

    expect(result.exitCode).toBe(1);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toContain("public-api-consistency:fail");
    expect(combined).toContain("@wats/graph/endpoints/messages");
    expect(combined).toContain("package export ./endpoints/messages");
    expect(combined).toContain("expected {\"types\":\"./dist/endpoints/not-real.d.ts\",\"import\":\"./dist/endpoints/not-real.js\"}");
    expect(combined).not.toMatch(/ACCESS_TOKEN|APP_SECRET|META|WHATSAPP|Bearer/u);
  });
});
