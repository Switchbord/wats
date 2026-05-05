// F-9 RED — asserts docs/reference/filters.md content + F-9 parity
// matrix / CHANGELOG updates + the core-consumer fixture coverage
// for the new typed-filter surface. These checks fail until the F-9
// GREEN doc commit ships the reference guide in full, the parity
// row is updated, and the [0.2.0-f9] CHANGELOG entry lands.

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

describe("F-9 filters.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "docs/reference/filters.md");
  const doc = readFileSync(docPath, "utf8");

  test("contains a TypedFilter surface section", () => {
    expect(doc).toMatch(/##\s+TypedFilter/i);
    expect(doc).toContain("FILTER_BRAND");
    expect(doc).toContain("createTypedFilter");
    expect(doc).toContain("isTypedFilter");
  });

  test("documents the kind filters (message / status / account / unknown)", () => {
    expect(doc).toMatch(/##\s+Kind filters/i);
    expect(doc).toMatch(/\bmessage\b/);
    expect(doc).toMatch(/\bstatus\b/);
    expect(doc).toMatch(/\baccount\b/);
    expect(doc).toMatch(/\bunknown\b/);
  });

  test("documents the combinators (and / or / not / custom)", () => {
    expect(doc).toMatch(/##\s+Combinators/i);
    expect(doc).toContain("and(");
    expect(doc).toContain("or(");
    expect(doc).toContain("not(");
    expect(doc).toContain("custom(");
  });

  test("documents the message built-ins (text / textMatches / textEquals / type / from)", () => {
    expect(doc).toContain("message.text");
    expect(doc).toContain("message.textMatches");
    expect(doc).toContain("message.textEquals");
    expect(doc).toContain("message.type");
    expect(doc).toContain("message.from");
  });

  test("documents the status built-ins (sent / delivered / read / failed)", () => {
    expect(doc).toContain("status.sent");
    expect(doc).toContain("status.delivered");
    expect(doc).toContain("status.read");
    expect(doc).toContain("status.failed");
  });

  test("documents FilterValidationError + error-code taxonomy", () => {
    expect(doc).toContain("FilterValidationError");
    expect(doc).toContain("empty_args");
    expect(doc).toContain("not_a_filter");
    expect(doc).toContain("invalid_pattern");
    expect(doc).toContain("invalid_predicate");
    expect(doc).toContain("empty_substring");
  });

  test("documents sibling-kind safety (off-kind returns false, never throws)", () => {
    expect(doc).toMatch(/sibling[- ]kind/i);
    expect(doc).toMatch(/never throws?|does not throw/i);
  });

  test("documents predicate-exception propagation policy (no swallowing)", () => {
    expect(doc).toMatch(/propagat(e|ion)|not swallow|rethrow/i);
    expect(doc).toMatch(/router|dispatch|F-10/i);
  });

  test("contains a usage code sample in TypeScript", () => {
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("@switchbord/core/filtersTyped");
  });

  test("references ADR-004 and the F-9 scope", () => {
    expect(doc).toMatch(/ADR-004/);
    expect(doc).toMatch(/F-9/);
  });

  test("documents the type-narrowing guarantee", () => {
    expect(doc).toMatch(/narrow(ing|s)?|type[- ]guard/i);
    expect(doc).toContain("TypedUpdate");
  });
});

describe("F-9 core-consumer fixture coverage", () => {
  test("fixture imports from @switchbord/core/filtersTyped", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const verifyPath = join(
      repoRoot,
      "packages/testing/fixtures/core-consumer/verify-imports.ts"
    );
    const source = readFileSync(verifyPath, "utf8");
    expect(source).toContain('from "@switchbord/core/filtersTyped"');
    expect(source).toContain("createTypedFilter");
    expect(source).toContain("isTypedFilter");
    expect(source).toContain("FilterValidationError");
    expect(source).toContain("FILTER_BRAND");
    expect(source).toContain("message.textMatches");
    expect(source).toContain("status.delivered");
  });

  test("running the fixture entry still emits the core-consumer:ok sentinel", () => {
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
    };

    expect(parsed.ok).toBe(true);
    // F-9 checks must all be true.
    const labels = Object.keys(parsed.checks);
    expect(labels).toContain(
      "compound /hello/i filter matches exactly one message"
    );
    expect(labels).toContain(
      "status.delivered matches exactly one status update"
    );
    expect(labels).toContain(
      "message.text('') throws FilterValidationError(empty_substring)"
    );
    expect(labels).toContain(
      "and() with zero args throws FilterValidationError(empty_args)"
    );
    expect(labels).toContain(
      "status.sent returns false on message updates (sibling-kind)"
    );
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }
  });
});

describe("F-9 CHANGELOG", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

  test("contains a [0.2.0-f9] section header", () => {
    expect(changelog).toMatch(/\[0\.2\.0-f9\]/);
  });

  test("mentions the TypedFilter surface and its primary entry points", () => {
    expect(changelog).toContain("TypedFilter");
    expect(changelog).toContain("createTypedFilter");
    expect(changelog).toContain("FilterValidationError");
    expect(changelog).toContain("@switchbord/core/filtersTyped");
  });
});

describe("F-9 parity matrix", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const matrix = readFileSync(
    join(repoRoot, "docs/parity/pywa-parity-matrix.md"),
    "utf8"
  );

  test("WATS-21 typed filter row is marked addressed-by F-9", () => {
    expect(matrix).toMatch(/WATS-21/);
    expect(matrix).toMatch(/F-9/);
    // Must mention the new surface so readers can locate it.
    expect(matrix).toContain("TypedFilter");
  });
});
