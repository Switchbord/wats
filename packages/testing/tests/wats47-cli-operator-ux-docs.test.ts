// WATS-47 RED — CLI operator UX design docs lock.

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

interface PublicDocsManifest {
  pages: string[];
  exclude: string[];
}

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function expectAll(text: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe("WATS-47 CLI operator UX design docs", () => {
  test("design doc records command surface, safety defaults, and package boundaries", () => {
    const design = read("docs/architecture/wats47-cli-operator-ux-design.md");

    expectAll(design, [
      "status: design",
      "applies-to: WATS-47",
      "ADR-007",
      "wats init",
      "wats doctor",
      "wats serve",
      "wats config validate",
      "wats openapi",
      "wats webhook token",
      "no live Meta calls by default",
      "no overwrite by default",
      "env-secret references",
      "@switchbord/config",
      "@switchbord/service",
      "SecretResolutionError",
      "LiveGuardError",
      "side-effect matrix",
      "WATS-48",
      "WATS-49",
      "WATS-50",
      "WATS-51",
      "WATS-52"
    ]);
  });

  test("CLI reference exposes WATS-47 design target without claiming implementation", () => {
    const cli = read("docs/reference/cli.md");

    expectAll(cli, [
      "applies-to: WATS-33, WATS-47, and WATS-69",
      "## WATS-47 design target",
      "wats init [dir]",
      "wats doctor",
      "wats serve",
      "no-live-credentials default",
      "no live Meta calls by default",
      "no overwrite by default",
      "credential-gated live validation",
      "OpenAPI export remains service-only",
      "WATS-72 adds the live-mode guard contract",
      "WATS_LIVE_ENABLE=1",
      "fails closed before env-secret resolution",
      "Design-only note"
    ]);
  });

  test("CLI onboarding guide documents first-run flow, doctor, serve, and troubleshooting", () => {
    const guide = read("docs/guides/cli-init.md");

    expectAll(guide, [
      "applies-to: WATS-33, WATS-47, and WATS-69",
      "## WATS-47 first-run operator flow",
      "wats init --dry-run",
      "env placeholder policy",
      "doctor offline diagnostics",
      "serve local flow",
      "troubleshooting matrix",
      "no raw secrets",
      "live guard",
      "WATS_LIVE_ENABLE=1",
      "current build only ships the guard contract",
      "WATS_ACCESS_TOKEN"
    ]);
  });

  test("alpha operations plan and release policy point at WATS-47 docs and classify release impact", () => {
    const plan = read("docs/architecture/alpha-cli-runtime-operations-plan.md");
    const releasePolicy = read("docs/architecture/release-policy.md");

    expectAll(plan, [
      "docs/architecture/wats47-cli-operator-ux-design.md",
      "WATS-47 docs-lock coverage",
      "init no-overwrite/no-secret generation tests",
      "doctor offline/no-secret diagnostics tests",
      "serve process-wrapper tests",
      "cli-consumer fixture coverage"
    ]);

    expectAll(releasePolicy, [
      "WATS-47 CLI operator UX design",
      "design/docs/test-planner only",
      "patch changes",
      "implemented `wats init`, `wats doctor`, or `wats serve` behavior",
      "minor changes on `0.x`"
    ]);
  });

  test("public docs manifest keeps WATS-47 guide public and planning design excluded", () => {
    const manifest = readJson<PublicDocsManifest>("docs/public-docs-manifest.json");
    const roadmap = read("docs/architecture/roadmap-to-whatsapp-pywa-parity.md");
    const changelog = read("CHANGELOG.md");

    expect(manifest.pages).toContain("guides/cli-init.md");
    expect(manifest.pages).toContain("reference/cli.md");
    expect(manifest.pages).not.toContain("architecture/wats47-cli-operator-ux-design.md");
    expect(manifest.exclude).toContain("architecture/wats47-cli-operator-ux-design.md");

    expectAll(roadmap, [
      "WATS-47",
      "CLI operator UX design",
      "no live Meta calls by default"
    ]);

    expectAll(changelog, [
      "WATS-47 — CLI operator UX design",
      "design/docs only",
      "no live Meta validation",
      "no second repository"
    ]);
  });
});
