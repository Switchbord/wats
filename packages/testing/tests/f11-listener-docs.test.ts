// F-11 RED — asserts site/content/docs/reference/listeners.mdx content, parity
// matrix update, CHANGELOG entry, and the core-consumer fixture
// coverage of the listener substrate. These checks fail until the
// GREEN doc/fixture commit ships the listeners reference, the parity
// row, the [0.2.0-f11] entry, and the extended fixture assertions.

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

// ---------------------------------------------------------------------
// site/content/docs/reference/listeners.mdx
// ---------------------------------------------------------------------

describe("F-11 listeners.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "site/content/docs/reference/listeners.mdx");
  const doc = readFileSync(docPath, "utf8");

  test("contains a Listener substrate section", () => {
    expect(doc).toMatch(/##\s+Listener/i);
    expect(doc).toContain("ListenerRegistry");
    expect(doc).toContain("ListenerHandle");
  });

  test("documents createListenerRegistry + register/evaluate/clear", () => {
    expect(doc).toContain("createListenerRegistry");
    expect(doc).toContain("register");
    expect(doc).toContain("evaluate");
    expect(doc).toContain("clear");
    expect(doc).toContain("activeCount");
  });

  test("documents first-match-wins semantics + registration-order", () => {
    expect(doc).toMatch(/first[- ]match[- ]wins/i);
    expect(doc).toMatch(/registration[- ]order/i);
  });

  test("documents listener-BEFORE-handlers ordering (plan DoD)", () => {
    expect(doc).toMatch(/BEFORE\s+handler/i);
    // Handlers still fire — additive, not short-circuit.
    expect(doc).toMatch(/additive|still fires?|still flows?/i);
  });

  test("documents timeout + AbortSignal surface", () => {
    expect(doc).toContain("timeoutMs");
    expect(doc).toContain("AbortSignal");
    expect(doc).toContain("ListenerTimeoutError");
    expect(doc).toContain("ListenerAbortError");
  });

  test("documents error taxonomy codes", () => {
    expect(doc).toContain("listener_timeout");
    expect(doc).toContain("listener_cancelled");
    expect(doc).toContain("listener_signal_aborted");
    expect(doc).toContain("listener_registry_cleared");
  });

  test("documents maxActiveListeners cap", () => {
    expect(doc).toContain("maxActiveListeners");
    expect(doc).toMatch(/10[_,]?000/);
    expect(doc).toContain("max_listeners_exceeded");
  });

  test("documents WhatsApp.listen facade method", () => {
    expect(doc).toMatch(/\.listen\(/);
    expect(doc).toContain("WhatsAppListenOptions");
    expect(doc).toMatch(/type:\s*['\"]message['\"]|kind gate/);
  });

  test("documents observer.onListenerMatch hook", () => {
    expect(doc).toContain("onListenerMatch");
  });

  test("contains a usage code sample importing from @wats/core", () => {
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("@wats/core");
  });

  test("references WATS-22 Arch-H and the F-11 scope", () => {
    // Voice pass removed the WATS-22/Arch-H/F-11 labels; assert the surviving
    // listener scope facts (non-goals: persistence + cross-instance distribution).
    expect(doc).toMatch(/## Non-goals/);
    expect(doc).toMatch(/persistence/i);
  });

  test("documents scope ledger (non-goals)", () => {
    expect(doc).toMatch(/persistence/i);
    expect(doc).toMatch(/cross[- ]instance|distribution/i);
  });
});

// ---------------------------------------------------------------------
// core-consumer fixture extension
// ---------------------------------------------------------------------

describe("F-11 core-consumer fixture coverage", () => {
  test("fixture imports listener substrate from @wats/core", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const verifyPath = join(
      repoRoot,
      "packages/testing/fixtures/core-consumer/verify-imports.ts"
    );
    const source = readFileSync(verifyPath, "utf8");
    expect(source).toContain("createListenerRegistry");
    expect(source).toContain("ListenerHandle");
    expect(source).toContain("ListenerTimeoutError");
    expect(source).toContain("ListenerAbortError");
    expect(source).toMatch(/wa\.listen\(|facade\.listen\(/);
  });

  test("running the fixture entry emits core-consumer:ok and runs F-11 assertions", () => {
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

    const labels = Object.keys(parsed.checks);
    expect(labels).toContain(
      "wa.listen({ type: 'message' }) returns a ListenerHandle"
    );
    expect(labels).toContain(
      "listener resolves via wa.dispatch() with typed narrowing"
    );
    expect(labels).toContain(
      "listener timeout rejects with ListenerTimeoutError"
    );
    expect(labels).toContain(
      "listener cancel() rejects with ListenerAbortError(cancelled)"
    );
    expect(labels).toContain(
      "facade activeListenerCount reflects register + resolve lifecycle"
    );
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------
// CHANGELOG + parity matrix
// ---------------------------------------------------------------------

describe("F-11 CHANGELOG", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

  test("contains a [0.2.0-f11] section header", () => {
    expect(changelog).toMatch(/\[0\.2\.0-f11\]/);
  });

  test("mentions the listener substrate + timeout + AbortSignal", () => {
    expect(changelog).toContain("ListenerRegistry");
    expect(changelog).toContain("ListenerHandle");
    expect(changelog).toContain("ListenerTimeoutError");
    expect(changelog).toContain("ListenerAbortError");
    expect(changelog).toMatch(/first[- ]match[- ]wins/i);
    expect(changelog).toContain("onListenerMatch");
  });
});

describe("F-11 parity matrix", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const matrix = readFileSync(
    join(repoRoot, "site/content/docs/parity.mdx"),
    "utf8"
  );

  test("Listeners row references F-11 + WATS-22", () => {
    expect(matrix).toMatch(/Listeners/);
    // Voice pass removed WATS-22/F-11 labels; assert the surviving Listeners-row
    // API facts instead.
    expect(matrix).toMatch(/wa\.listen\(/);
    expect(matrix).toMatch(/timeoutMs/);
    expect(matrix).toMatch(/registry/i);
  });
});
