// F-4 graph-consumer harness.
//
// Spawns `bun run verify-imports` from the graph-consumer fixture
// directory (which declares `@wats/graph: workspace:*`) and asserts
// the success sentinel + runtime-shape report. Also validates that the
// guide docs/guides/transport-and-testing.md exists and contains the
// required recipes.

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

describe("F-4 @wats/graph consumer fixture", () => {
  test("fixture manifest exists and declares workspace dependencies", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/graph-consumer"
    );

    expect(existsSync(join(fixtureDir, "package.json"))).toBe(true);
    expect(existsSync(join(fixtureDir, "verify-imports.ts"))).toBe(true);

    const manifest = parseJsonFile(join(fixtureDir, "package.json"));
    expect(manifest.name).toBe("graph-consumer");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");

    const dependencies = manifest.dependencies;
    if (!isJsonRecord(dependencies)) {
      throw new Error("Fixture dependencies must be an object");
    }
    expect(dependencies["@wats/graph"]).toBe("workspace:*");
  });

  test("running the fixture entry under bun emits the success sentinel", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/graph-consumer"
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
    expect(lastLine).toBe("graph-consumer:ok");

    const jsonLine = lines.at(-2);
    expect(typeof jsonLine).toBe("string");

    const parsed = JSON.parse(jsonLine as string) as {
      ok: boolean;
      sentinel: string;
      checks: Record<string, boolean>;
      moduleKeys: Record<string, string[]>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.sentinel).toBe("graph-consumer:ok");
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }

    const keys = parsed.moduleKeys["@wats/graph"];
    expect(Array.isArray(keys)).toBe(true);
    expect((keys as string[])).toContain("GraphClient");
    expect((keys as string[])).toContain("createFetchTransport");
    expect((keys as string[])).toContain("scrubErrorCause");
    expect((keys as string[])).toContain("DEFAULT_GRAPH_BASE_URL");
    expect((keys as string[])).toContain("buildSendImagePayload");
    expect((keys as string[])).toContain("buildSendStickerPayload");
    expect((keys as string[])).toContain("buildSendLocationPayload");
    expect((keys as string[])).toContain("buildSendButtonsPayload");
    expect((keys as string[])).toContain("buildSendTemplatePayload");

    const expectedSubpathKeys: Record<string, string[]> = {
      "@wats/graph/endpoints/media": [
        "uploadMedia",
        "downloadMedia",
        "downloadMediaBytes",
        "deleteMedia",
        "decryptEncryptedMedia",
        "createUploadSession",
        "MediaValidationError",
        "DEFAULT_MAX_MEDIA_UPLOAD_BYTES"
      ],
      "@wats/graph/endpoints/templates": [
        "listMessageTemplates",
        "getMessageTemplate",
        "createMessageTemplate",
        "updateMessageTemplate",
        "deleteMessageTemplate",
        "listTemplateGroups",
        "getTemplateGroupAnalytics",
        "buildTemplateHeaderComponent",
        "validateTemplateParameterCounts"
      ],
      "@wats/graph/endpoints/flows": [
        "listFlows",
        "getFlow",
        "createFlow",
        "updateFlowJson",
        "publishFlow",
        "buildFlowJson",
        "FLOW_JSON_MAX_BYTES"
      ]
    };
    for (const [specifier, expectedKeys] of Object.entries(expectedSubpathKeys)) {
      const subpathKeys = parsed.moduleKeys[specifier];
      expect(Array.isArray(subpathKeys), `${specifier} module keys must be reported`).toBe(true);
      for (const expectedKey of expectedKeys) {
        expect(subpathKeys as string[], `${specifier} must export ${expectedKey}`).toContain(expectedKey);
      }
    }

    expect(parsed.checks["WATS-53 media subpath exports runtime surface"]).toBe(true);
    expect(parsed.checks["WATS-53 templates subpath exports runtime surface"]).toBe(true);
    expect(parsed.checks["WATS-53 flows subpath exports runtime surface"]).toBe(true);
  });

  test("transport-and-testing guide contains required recipes", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const guidePath = join(repoRoot, "docs/guides/transport-and-testing.md");
    expect(existsSync(guidePath)).toBe(true);
    const source = readFileSync(guidePath, "utf8");

    // Required phrases that anchor the guide's three required sections:
    //   1. MockTransport recipe for tests.
    //   2. Opt-in reliable Transport recipe (retry/backoff/timeout).
    //   3. Interceptor primer.
    expect(source).toContain("createMockTransport");
    expect(source).toContain("createReliableTransport");
    expect(source).toContain("Opt-in reliable transport");
    expect(source).toContain("Interceptor");
    expect(source).toContain("@wats/graph/testing");
  });
});
