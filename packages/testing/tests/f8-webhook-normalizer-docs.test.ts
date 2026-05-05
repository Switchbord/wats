// F-8 RED — asserts docs/reference/webhook-normalizer.md content and
// the core-consumer fixture shape for normalizeWebhookEnvelope.
// These checks fail until the F-8 GREEN commit ships the reference
// guide in full and lands the parity-matrix + CHANGELOG updates.

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

describe("F-8 webhook-normalizer.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "docs/reference/webhook-normalizer.md");
  const doc = readFileSync(docPath, "utf8");

  test("contains a TypedUpdate catalog section", () => {
    expect(doc).toMatch(/##\s+TypedUpdate/i);
    expect(doc).toContain("TypedMessageUpdate");
    expect(doc).toContain("TypedStatusUpdate");
    expect(doc).toContain("TypedAccountUpdate");
    expect(doc).toContain("TypedUnknownUpdate");
  });

  test("documents envelope-level error taxonomy", () => {
    expect(doc).toContain("WebhookNormalizationError");
    expect(doc).toContain("invalid_envelope");
    expect(doc).toContain("missing_object_field");
    expect(doc).toContain("unsupported_object");
    expect(doc).toContain("invalid_entry_array");
  });

  test("documents the skipped reason taxonomy", () => {
    expect(doc).toContain("malformed_entry");
    expect(doc).toContain("malformed_change");
    expect(doc).toContain("malformed_field");
    expect(doc).toContain("duplicate_update_id");
  });

  test("documents soft-truncate maxEventsPerEnvelope semantics", () => {
    expect(doc).toMatch(/maxEventsPerEnvelope/);
    expect(doc).toMatch(/soft[- ]truncate/i);
    expect(doc).toMatch(/DEFAULT_MAX_EVENTS_PER_ENVELOPE|1000/);
    expect(doc).toContain("limitError");
  });

  test("documents CRLF / NUL defense on id-bearing fields (WATS-12 L6)", () => {
    expect(doc).toMatch(/CR\/LF|CRLF|\\r\\n/);
    expect(doc).toMatch(/NUL|\\u0000|\\0/);
    expect(doc).toMatch(/WATS-12/);
    expect(doc).toMatch(/phone_number_id|phoneNumberId/);
  });

  test("documents within-envelope duplicate-id dedup (WATS-14 L8)", () => {
    expect(doc).toMatch(/WATS-14/);
    expect(doc).toMatch(/dedup|duplicate/i);
    expect(doc).toMatch(/first wins|first-wins/i);
  });

  test("documents non-goal: cross-envelope dedup is caller responsibility", () => {
    expect(doc).toMatch(/cross[- ]envelope/i);
    expect(doc).toMatch(/caller|consumer/i);
  });

  test("contains a usage code sample in TypeScript", () => {
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("normalizeWebhookEnvelope");
  });

  test("references ADR-004 and the F-8 scope", () => {
    expect(doc).toMatch(/ADR-004/);
    expect(doc).toMatch(/F-8/);
  });
});

describe("F-8 core-consumer fixture", () => {
  test("fixture manifest exists and declares @switchbord/core workspace dep", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/core-consumer"
    );
    expect(existsSync(join(fixtureDir, "package.json"))).toBe(true);
    expect(existsSync(join(fixtureDir, "verify-imports.ts"))).toBe(true);

    const manifest = parseJsonFile(join(fixtureDir, "package.json"));
    expect(manifest.name).toBe("core-consumer");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");

    const dependencies = manifest.dependencies;
    if (!isJsonRecord(dependencies)) {
      throw new Error("Fixture dependencies must be an object");
    }
    expect(dependencies["@switchbord/core"]).toBe("workspace:*");
  });

  test("fixture imports normalizeWebhookEnvelope + error class via @switchbord/core", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const verifyPath = join(
      repoRoot,
      "packages/testing/fixtures/core-consumer/verify-imports.ts"
    );
    const source = readFileSync(verifyPath, "utf8");
    expect(source).toContain('from "@switchbord/core"');
    expect(source).toContain("normalizeWebhookEnvelope");
    expect(source).toContain("WebhookNormalizationError");
    expect(source).toContain("TypedMessageUpdate");
    expect(source).toContain("TypedStatusUpdate");
    expect(source).toContain("TypedAccountUpdate");
    expect(source).toContain("TypedUnknownUpdate");
    expect(source).toContain("DEFAULT_MAX_EVENTS_PER_ENVELOPE");
  });

  test("running the fixture entry under bun emits the success sentinel", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/core-consumer"
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
    expect(lastLine).toBe("core-consumer:ok");

    const jsonLine = lines.at(-2);
    expect(typeof jsonLine).toBe("string");

    const parsed = JSON.parse(jsonLine as string) as {
      ok: boolean;
      sentinel: string;
      checks: Record<string, boolean>;
      moduleKeys: Record<string, string[]>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.sentinel).toBe("core-consumer:ok");
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }

    const keys = parsed.moduleKeys["@switchbord/core"];
    expect(Array.isArray(keys)).toBe(true);
    expect((keys as string[])).toContain("normalizeWebhookEnvelope");
    expect((keys as string[])).toContain("WebhookNormalizationError");
    expect((keys as string[])).toContain("DEFAULT_MAX_EVENTS_PER_ENVELOPE");
  });
});

describe("F-8 CHANGELOG", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

  test("contains a [0.2.0-f8] section header", () => {
    expect(changelog).toMatch(/\[0\.2\.0-f8\]/);
  });

  test("mentions normalizeWebhookEnvelope", () => {
    expect(changelog).toContain("normalizeWebhookEnvelope");
  });
});

describe("F-8 parity matrix", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const matrix = readFileSync(
    join(repoRoot, "docs/parity/pywa-parity-matrix.md"),
    "utf8"
  );

  test("mentions WATS-2 / WATS-7 / WATS-12 / WATS-14 / WATS-16 with F-8 addressed-by", () => {
    expect(matrix).toMatch(/WATS-2/);
    expect(matrix).toMatch(/WATS-7/);
    expect(matrix).toMatch(/WATS-12/);
    expect(matrix).toMatch(/WATS-14/);
    expect(matrix).toMatch(/WATS-16/);
    expect(matrix).toMatch(/F-8/);
  });
});
