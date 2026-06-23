// Docs-lock: current shipped surface must not be described as planned/future.
// Guards the Tranche 1 accuracy fixes: Postgres adapter shipped (shape-only),
// `wats messages list/show` shipped (read-only local projection), Groups live
// entitlement blocker stated, and no WATS-nn ticket archaeology in example
// READMEs.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS docs current surface accuracy", () => {
  test("public-api-surface describes Postgres as shipped shape-only, not planned", () => {
    const doc = read("site/content/docs/concepts/public-api-surface.mdx");
    expect(doc).toContain("`@wats/persistence/postgres`");
    expect(doc).toContain("shape-only, mock-client tested");
    // Stale phrasing removed.
    expect(doc).not.toMatch(/Postgres[^.\n]* (are|is) later work/iu);
    expect(doc).not.toContain("Postgres persistence, config persistence schema");
  });

  test("public-api-surface lists wats messages list/show as shipped CLI commands", () => {
    const doc = read("site/content/docs/concepts/public-api-surface.mdx");
    expect(doc).toContain("`wats messages list");
    expect(doc).toContain("`wats messages show");
    expect(doc).not.toContain("CLI navigation, status UI wiring");
  });

  test("package-map lists @wats/persistence/postgres as a published subpath", () => {
    const doc = read("site/content/docs/concepts/package-map.mdx");
    expect(doc).toContain("Published subpaths: `@wats/persistence`, `@wats/persistence/sqlite`, `@wats/persistence/postgres`.");
    // No longer a future subpath.
    expect(doc).not.toMatch(/Future subpaths:[^\n]*@wats\/persistence\/postgres/iu);
  });

  test("roadmap lists the Postgres adapter under Shipped, not Planned", () => {
    const doc = read("site/content/docs/meta/roadmap.mdx");
    const shipped = doc.slice(0, doc.indexOf("## Planned"));
    const planned = doc.slice(doc.indexOf("## Planned"));
    expect(shipped).toContain("@wats/persistence/postgres");
    expect(shipped).toContain("shape-only, mock-client tested");
    expect(planned).not.toMatch(/Postgres persistence adapter/iu);
    expect(planned).toContain("Live Postgres validation");
  });

  test("persistence reference documents wats messages list/show and does not claim no CLI navigation", () => {
    const doc = read("site/content/docs/reference/persistence.mdx");
    expect(doc).toContain("`wats messages list`");
    expect(doc).toContain("`wats messages show`");
    expect(doc).not.toContain("The CLI has no database navigation commands yet.");
  });

  test("groups reference states the live entitlement blocker for mutations", () => {
    const doc = read("site/content/docs/reference/groups.mdx");
    expect(doc).toContain("`listGroups` is live-validated");
    expect(doc).toMatch(/Groups-entitled phone number/iu);
    expect(doc).toMatch(/shape-only/iu);
  });

  test("parity message-projection row mentions Postgres adapter and messages CLI", () => {
    const doc = read("site/content/docs/parity.mdx");
    const row = doc.split("\n").find((line) => line.includes("Message event-store projection"));
    expect(row).toBeDefined();
    expect(row).toContain("@wats/persistence/postgres");
    expect(row).toContain("`wats messages list/show`");
  });

  test("api-stability no longer lists the Postgres adapter as not exported yet", () => {
    const doc = read("site/content/docs/meta/api-stability.mdx");
    expect(doc).toContain("`@wats/persistence/postgres` is an experimental shape-only adapter");
    const internal = doc.slice(doc.indexOf("## Internal and unsupported surfaces"));
    expect(internal).not.toMatch(/Postgres persistence adapter[^.]*not exported yet/iu);
  });

  test("example READMEs carry no WATS-nn ticket archaeology", () => {
    const examples = read("examples/README.md");
    const minimal = read("examples/minimal-bot/README.md");
    for (const doc of [examples, minimal]) {
      expect(doc).not.toMatch(/\bWATS-\d+\b/iu);
    }
    // Substance survives: examples are described by what they do.
    expect(examples).toContain("`examples/minimal-bot/`");
    expect(examples).toContain("`examples/groups/`");
    expect(minimal).toContain("`createWatsServiceApp`");
  });
});
