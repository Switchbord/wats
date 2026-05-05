// F-10 RED — asserts docs/reference/router.md + whatsapp-facade.md
// content, parity matrix update, CHANGELOG entry, and the core-
// consumer fixture coverage of the TypedRouter + WhatsApp facade
// surface. These checks fail until the GREEN doc/fixture commit
// ships the references, the parity row, the [0.2.0-f10] entry, and
// the extended fixture assertions.

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
// docs/reference/router.md
// ---------------------------------------------------------------------

describe("F-10 router.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "docs/reference/router.md");
  const doc = readFileSync(docPath, "utf8");

  test("contains a TypedRouter section", () => {
    expect(doc).toMatch(/##\s+TypedRouter/i);
    expect(doc).toContain("TypedRouter");
    expect(doc).toContain("RegistrationHandle");
  });

  test("documents handle-based registration + unregister", () => {
    expect(doc).toMatch(/##\s+Handle-based registration/i);
    expect(doc).toContain("unregister");
    expect(doc).toMatch(/idempotent/i);
  });

  test("documents registration-order dispatch guarantee (WATS-10 L4)", () => {
    expect(doc).toMatch(/registration[- ]order/i);
    expect(doc).toContain("WATS-10");
    expect(doc).toMatch(/L4/);
  });

  test("documents DispatchReport + error collection contract", () => {
    expect(doc).toContain("DispatchReport");
    expect(doc).toContain("matchedHandlers");
    expect(doc).toContain("errors");
    expect(doc).toContain("stopped");
    expect(doc).toContain("capped");
    expect(doc).toMatch(/never rejects?|always resolves?/i);
  });

  test("documents observer seams (WATS-15 A3)", () => {
    expect(doc).toContain("WATS-15");
    expect(doc).toContain("onBeforeDispatch");
    expect(doc).toContain("onAfterDispatch");
    expect(doc).toContain("onHandlerMatch");
    expect(doc).toContain("onHandlerError");
  });

  test("documents concurrency modes (sequential + parallel)", () => {
    expect(doc).toMatch(/##\s+Concurrency/i);
    expect(doc).toContain("sequential");
    expect(doc).toContain("parallel");
  });

  test("documents snapshot semantics for unregister during dispatch", () => {
    expect(doc).toMatch(/snapshot/i);
    expect(doc).toMatch(/unregister/i);
  });

  test("documents stop semantics", () => {
    expect(doc).toMatch(/\"stop\"|'stop'/);
    expect(doc).toMatch(/halts|halt/i);
  });

  test("documents maxHandlersPerDispatch cap", () => {
    expect(doc).toContain("maxHandlersPerDispatch");
    expect(doc).toMatch(/10[_,]?000/);
  });

  test("contains a usage code sample importing from @switchbord/core", () => {
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("@switchbord/core");
  });

  test("references ADR-004 and the F-10 scope", () => {
    expect(doc).toMatch(/ADR-004/);
    expect(doc).toMatch(/F-10/);
  });
});

// ---------------------------------------------------------------------
// docs/reference/whatsapp-facade.md
// ---------------------------------------------------------------------

describe("F-10 whatsapp-facade.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "docs/reference/whatsapp-facade.md");
  const doc = readFileSync(docPath, "utf8");

  test("contains a WhatsApp facade section", () => {
    expect(doc).toMatch(/##\s+WhatsApp/i);
    expect(doc).toContain("WhatsApp");
    expect(doc).toContain("WhatsAppFacadeConfig");
  });

  test("documents delegation to GraphClient + optional sub-clients", () => {
    expect(doc).toContain("GraphClient");
    expect(doc).toContain("PhoneNumberClient");
    expect(doc).toContain("WABAClient");
    expect(doc).toMatch(/optional/i);
  });

  test("documents router delegation (on / dispatch)", () => {
    expect(doc).toMatch(/\.on\(/);
    expect(doc).toMatch(/\.dispatch\(/);
    expect(doc).toContain("TypedRouter");
  });

  test("documents construction-time validation", () => {
    expect(doc).toContain("WhatsAppFacadeConfigError");
    expect(doc).toMatch(/construction[- ]time/i);
  });

  test("documents absent-id sub-client returns undefined (not empty object)", () => {
    expect(doc).toMatch(/undefined/);
    expect(doc).toMatch(/phoneNumberClient/);
    expect(doc).toMatch(/wabaClient/);
  });

  test("contains a usage code sample", () => {
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("new WhatsApp");
  });

  test("references WATS-26 Arch-L and the F-10 scope", () => {
    expect(doc).toMatch(/WATS-26/);
    expect(doc).toMatch(/Arch-L/);
    expect(doc).toMatch(/F-10/);
  });
});

// ---------------------------------------------------------------------
// core-consumer fixture extension
// ---------------------------------------------------------------------

describe("F-10 core-consumer fixture coverage", () => {
  test("fixture imports TypedRouter + WhatsApp from @switchbord/core", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const verifyPath = join(
      repoRoot,
      "packages/testing/fixtures/core-consumer/verify-imports.ts"
    );
    const source = readFileSync(verifyPath, "utf8");
    expect(source).toContain("TypedRouter");
    expect(source).toContain("WhatsApp");
    expect(source).toContain("DispatchReport");
    expect(source).toContain("RegistrationHandle");
    expect(source).toMatch(/@switchbord\/core/);
  });

  test("running the fixture entry still emits the core-consumer:ok sentinel and runs F-10 assertions", () => {
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
      "WhatsApp facade exposes GraphClient + router + sub-clients"
    );
    expect(labels).toContain(
      "router dispatches 3 handlers in registration order"
    );
    expect(labels).toContain(
      "non-matching handler does not fire (sibling-kind)"
    );
    expect(labels).toContain(
      "throwing handler is captured in DispatchReport.errors"
    );
    expect(labels).toContain(
      "unregister() during dispatch preserves snapshot"
    );
    expect(labels).toContain("WhatsApp.sendImage returns parsed response");
    expect(labels).toContain(
      "WhatsApp.sendImage sends exact media payload through @switchbord/core"
    );
    expect(labels).toContain(
      "WhatsApp.sendLocation sends exact location payload through @switchbord/core"
    );
    expect(labels).toContain(
      "WhatsApp.sendButtons sends interactive payload through @switchbord/core"
    );
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------
// CHANGELOG + parity matrix
// ---------------------------------------------------------------------

describe("F-10 CHANGELOG", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

  test("contains a [0.2.0-f10] section header", () => {
    expect(changelog).toMatch(/\[0\.2\.0-f10\]/);
  });

  test("mentions the TypedRouter + WhatsApp facade + observer seams", () => {
    expect(changelog).toContain("TypedRouter");
    expect(changelog).toContain("WhatsApp");
    expect(changelog).toContain("DispatchReport");
    expect(changelog).toContain("RegistrationHandle");
    expect(changelog).toMatch(/observer|onBeforeDispatch/);
  });
});

describe("F-10 parity matrix", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const matrix = readFileSync(
    join(repoRoot, "docs/parity/pywa-parity-matrix.md"),
    "utf8"
  );

  test("WATS-10, WATS-15, WATS-26 rows all reference F-10", () => {
    expect(matrix).toMatch(/WATS-10/);
    expect(matrix).toMatch(/WATS-15/);
    expect(matrix).toMatch(/WATS-26/);
    expect(matrix).toMatch(/F-10/);
    expect(matrix).toContain("TypedRouter");
    expect(matrix).toContain("WhatsApp");
  });
});
