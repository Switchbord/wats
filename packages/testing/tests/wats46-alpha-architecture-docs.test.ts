// WATS-46 RED — alpha CLI/runtime architecture decision docs lock.

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

describe("WATS-46 alpha CLI/runtime architecture docs", () => {
  test("ADR-007 records the monorepo decision and second-repo tradeoffs", () => {
    const adr = read("docs/architecture/decisions/ADR-007-alpha-cli-runtime-operator-layer.md");

    expectAll(adr, [
      "status: Accepted",
      "Keep the WATS alpha CLI/runtime/operator layer in the existing WATS monorepo.",
      "Do not create a second repository for alpha operations by default.",
      "Option A — Monorepo owns raw spine plus alpha operator layer",
      "Option B — Second repo imports WATS packages and owns operator layer",
      "Option C — Hybrid: monorepo contracts, second repo only for examples/templates",
      "Developer experience",
      "Versioning",
      "Package boundaries",
      "Deployment",
      "Documentation",
      "Release cadence",
      "Community value"
    ]);
  });

  test("ADR-007 documents alpha readiness features and WATS-47..52 sequencing", () => {
    const adr = read("docs/architecture/decisions/ADR-007-alpha-cli-runtime-operator-layer.md");

    expectAll(adr, [
      "WATS-47 — CLI UX completion for alpha",
      "WATS-48 — Persistence contract and adapters",
      "SQLite",
      "Postgres",
      "WATS-49 — Docker and deployment packaging",
      "WATS-50 — Release hygiene, semver, PR/release policy, reusable maintainer workflow",
      "WATS-51 — Config and environment templates",
      "`.env.example`",
      "WATS-52 — Community examples and alpha launch docs",
      "does not implement automation",
      "live Meta Graph calls"
    ]);
  });

  test("alpha operations plan summarizes WATS-47..52 without becoming an issue ledger", () => {
    const plan = read("docs/architecture/alpha-cli-runtime-operations-plan.md");

    expectAll(plan, [
      "Linear remains the source of truth for issue-level scope, status, and deferrals.",
      "ADR-007 decides that WATS alpha CLI/runtime/deployment work stays in the existing WATS monorepo.",
      "The operator layer is not split into a second repository for alpha.",
      "CLI UX",
      "Persistence: SQLite and Postgres",
      "Docker and deployment",
      "Config and environment templates",
      "Release hygiene and semver",
      "Community examples and alpha launch docs",
      "Do not create a second repo for WATS alpha operations."
    ]);
  });

  test("release policy records alpha semver/hygiene expectations without claiming automation", () => {
    const releasePolicy = read("docs/architecture/release-policy.md");

    expectAll(releasePolicy, [
      "### Alpha release hygiene",
      "this is policy/design only",
      "WATS-46 and WATS-50 do not implement version-bump automation",
      "package publication",
      "Docker image publication",
      "Docs-only, tests-only, and non-behavioral repository-hygiene changes are patch changes.",
      "New CLI behavior, config schema fields, service routes, persistence interfaces/adapters, Docker/deploy artifacts",
      "The alpha CLI/runtime/operator layer stays in this monorepo per ADR-007",
      "The WATS-46 alpha operations plan is such a summary for WATS-47..52; it is not a replacement issue tracker."
    ]);
  });

  test("changelog includes the WATS-46 design-only entry", () => {
    const changelog = read("CHANGELOG.md");

    expectAll(changelog, [
      "WATS-46 — alpha CLI/runtime packaging decision",
      "ADR-007",
      "monorepo",
      "second repository",
      "WATS-47..52",
      "design/docs only"
    ]);
  });
});
