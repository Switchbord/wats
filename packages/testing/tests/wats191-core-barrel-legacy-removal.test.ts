// WATS-191 RED — core barrel legacy removal.
//
// Consumer-fixture export-surface test (adversarial battery section 7).
// Spawns the core-consumer fixture `verify-legacy-removal.ts`, which
// imports ONLY through the published package specifiers `@wats/core`
// and `@wats/core/filtersTyped` (never via relative paths). The fixture
// asserts:
//   1) the deprecated WATS-176 untyped parser/router/filters symbols are
//      ABSENT from the @wats/core root namespace, and
//   2) the typed replacements (TypedRouter, normalizeWebhookEnvelope,
//      filtersTyped namespace + subpath) are PRESENT with the documented
//      runtime shape (typeof / constructor identity / function signatures).
//
// RED state (before removal): the legacy symbols are still exported by
// @wats/core, so the "absent" checks fail and the fixture exits 1.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      if (isJsonRecord(parsed) && parsed.name === "wats" && parsed.private === true) {
        return current;
      }
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
const fixtureDir = join(repoRoot, "packages/testing/fixtures/core-consumer");
const fixtureScript = join(fixtureDir, "verify-legacy-removal.ts");

describe("WATS-191 core barrel legacy removal (consumer fixture)", () => {
  test("fixture script exists in the core-consumer fixture", () => {
    expect(existsSync(fixtureScript)).toBe(true);
  });

  test("fixture imports via @wats/core package specifiers, never relative", () => {
    const source = readFileSync(fixtureScript, "utf8");
    expect(source).toContain('from "@wats/core"');
    expect(source).toContain('from "@wats/core/filtersTyped"');
    // Must NOT import via relative paths into packages/core.
    expect(source).not.toContain("../packages/core");
    expect(source).not.toContain("../../packages/core");
  });

  test("fixture asserts the full deprecated WATS-176 symbol set is absent", () => {
    const source = readFileSync(fixtureScript, "utf8");
    // Representative legacy symbols — the fixture's full list is enumerated
    // in `legacyRootSymbols`; this assertion keeps the surface anchored.
    for (const symbol of [
      "createUpdateRouter",
      "parseWebhookUpdate",
      "DEFAULT_UPDATE_ROUTER_LIMITS",
      "hasMessageText",
      "messageTextContains",
      "messageFromWaId",
      "hasMessageStatus",
      "messageStatusIn",
      "UpdateRouter",
      "UpdateFilter",
      "ParsedUpdateEvent",
      "MessageTextContainsOptions",
      "DispatchSummary"
    ]) {
      expect(source).toContain(`"${symbol}"`);
    }
  });

  test("fixture asserts typed replacements are present with runtime shape", () => {
    const source = readFileSync(fixtureScript, "utf8");
    for (const symbol of [
      "TypedRouter",
      "normalizeWebhookEnvelope",
      "WebhookNormalizationError",
      "DEFAULT_MAX_EVENTS_PER_ENVELOPE",
      "filtersTyped",
      "createListenerRegistry",
      "WhatsApp",
      "createTypedFilter",
      "isTypedFilter",
      "FILTER_BRAND",
      "FilterValidationError"
    ]) {
      expect(source).toContain(symbol);
    }
  });

  test("running the fixture emits the success sentinel (legacy absent, typed present)", () => {
    const result = runBun(["run", "./verify-legacy-removal.ts"], fixtureDir);

    const stdout = result.stdout.trim();
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const lastLine = lines.at(-1);
    const jsonLine = lines.at(-2);

    expect(
      result.exitCode,
      `fixture verify-legacy-removal failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    ).toBe(0);

    expect(lastLine).toBe("wats191-legacy-removal:ok");

    expect(typeof jsonLine).toBe("string");
    const parsed = JSON.parse(jsonLine as string) as {
      ok: boolean;
      sentinel: string;
      checks: Record<string, boolean>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.sentinel).toBe("wats191-legacy-removal:ok");
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }
  });
});
