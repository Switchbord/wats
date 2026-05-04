// WATS-48 RED — persistence contract design docs lock.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectAll(text: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe("WATS-48 persistence contract design docs", () => {
  test("design doc records persistence contract, safety boundaries, and package ownership", () => {
    const design = read("docs/architecture/wats48-persistence-contract-design.md");

    expectAll(design, [
      "status: design",
      "applies-to: WATS-48",
      "ADR-007",
      "Linear remains the source of truth",
      "no second repository",
      "design/docs/test-planner only",
      "@wats/persistence",
      "PersistenceStore",
      "PersistenceAdapter",
      "PersistenceTransaction",
      "SQLite",
      "Postgres",
      "schemaVersion",
      "migrate",
      "transaction",
      "webhook event idempotency",
      "service request idempotency",
      "no raw webhook payload persistence by default",
      "no secrets in persistence diagnostics",
      "no live Meta calls"
    ]);
  });

  test("persistence reference exposes public design target without claiming implementation", () => {
    const reference = read("docs/reference/persistence.md");

    expectAll(reference, [
      "status: design",
      "applies-to: WATS-48",
      "Design target",
      "Current implementation status",
      "@wats/persistence is not exported yet",
      "no package export yet",
      "no adapters implemented in this slice",
      "PersistenceStore",
      "SQLite adapter target",
      "Postgres adapter target",
      "schema migration contract",
      "credential-free tests",
      "Non-goals"
    ]);

    expect(reference).not.toContain("status: active");
    expect(reference).not.toContain("implemented adapter");
    expect(reference).not.toContain("production-ready persistence");
    expect(reference).not.toContain("process.env.WATS_DATABASE_URL");
  });

  test("service, config, package-map, and public surface docs keep implementation boundary explicit", () => {
    const service = read("docs/reference/service.md");
    const config = read("docs/reference/config.md");
    const packageMap = read("docs/architecture/package-map.md");
    const publicSurface = read("docs/architecture/public-api-surface.md");

    expectAll(service, [
      "WATS-48",
      "injected PersistenceStore",
      "no persistence integration in current @wats/service runtime",
      "must not log secrets or raw webhook bodies"
    ]);

    expectAll(config, [
      "WATS-48",
      "current @wats/config schema has no persistence field",
      "WATS_DATABASE_URL",
      "raw database credentials must not be committed"
    ]);

    expectAll(packageMap, [
      "WATS-48 planned package boundary",
      "@wats/persistence",
      "@wats/persistence/sqlite",
      "@wats/persistence/postgres",
      "not current package surface until implementation lands"
    ]);

    expectAll(publicSurface, [
      "@wats/persistence package and SQLite/Postgres adapters are WATS-48 design targets only",
      "No current package export",
      "no service persistence integration",
      "no config persistence schema"
    ]);
  });

  test("alpha plan and release policy classify WATS-48 correctly", () => {
    const plan = read("docs/architecture/alpha-cli-runtime-operations-plan.md");
    const releasePolicy = read("docs/architecture/release-policy.md");

    expectAll(plan, [
      "docs/architecture/wats48-persistence-contract-design.md",
      "docs/reference/persistence.md",
      "WATS-48 docs-lock coverage",
      "design/docs/test-planner only",
      "storage contract tests",
      "migration/adversarial tests",
      "SQLite adapter contract tests",
      "Postgres adapter contract tests",
      "no raw webhook payload persistence by default",
      "no secrets in diagnostics"
    ]);

    expectAll(releasePolicy, [
      "WATS-48 persistence contract design",
      "design/docs/test-planner only",
      "patch-class",
      "Implemented persistence interfaces",
      "package exports",
      "config schema fields",
      "service integration",
      "migration runner",
      "SQLite adapter",
      "Postgres adapter",
      "minor changes on `0.x`"
    ]);
  });

  test("public docs manifest, reference index, roadmap, and changelog include WATS-48 artifacts", () => {
    const manifest = read("docs/public-docs-manifest.json");
    const referenceIndex = read("docs/reference/index.md");
    const roadmap = read("docs/architecture/roadmap-to-whatsapp-pywa-parity.md");
    const changelog = read("CHANGELOG.md");

    expectAll(manifest, [
      "reference/persistence.md",
      "architecture/wats48-persistence-contract-design.md"
    ]);

    expectAll(referenceIndex, [
      "reference/persistence.md",
      "WATS-48"
    ]);

    expectAll(roadmap, [
      "WATS-48",
      "persistence contract design",
      "SQLite/Postgres",
      "No runtime adapter implementation in the design slice"
    ]);

    expectAll(changelog, [
      "WATS-48 — persistence contract design",
      "design/docs/test-planner only",
      "no @wats/persistence package export",
      "no adapters",
      "no config schema changes",
      "no service persistence integration",
      "no second repository"
    ]);
  });
});
