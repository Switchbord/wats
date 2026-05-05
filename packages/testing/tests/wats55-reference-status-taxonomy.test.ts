// WATS-55 RED — docs-lock reference status taxonomy after WATS-37..54 consistency hardening.

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

function metadataValue(markdown: string, key: string): string {
  const match = markdown.match(new RegExp(`^- ${key}:\\s*(.+)$`, "mu"));
  if (!match) throw new Error(`Missing metadata key ${key}`);
  return match[1] ?? "";
}

function expectAll(source: string, needles: readonly string[], label: string): void {
  for (const needle of needles) {
    expect(source, `${label} must mention ${needle}`).toContain(needle);
  }
}

const graphEndpointSubpaths = [
  "@switchbord/graph/endpoints/media",
  "@switchbord/graph/endpoints/templates",
  "@switchbord/graph/endpoints/flows",
  "@switchbord/graph/endpoints/calling",
  "@switchbord/graph/endpoints/business-management"
] as const;

describe("WATS-55 reference status taxonomy and metadata", () => {
  test("package map metadata covers the current WATS-37..56 consistency line and api check", () => {
    const packageMap = read("docs/architecture/package-map.md");
    const appliesTo = metadataValue(packageMap, "applies-to");

    expectAll(appliesTo, [
      "WATS-37",
      "38",
      "39",
      "40",
      "41",
      "42A",
      "53",
      "54",
      "56"
    ], "package-map applies-to");
    expect(packageMap).toContain("bun run api:check");
    expect(packageMap).toContain("WATS-54 checks package exports");
  });

  test("reference index metadata includes the current consistency/test-hygiene line", () => {
    const referenceIndex = read("docs/reference/index.md");
    const appliesTo = metadataValue(referenceIndex, "applies-to");

    expectAll(appliesTo, ["WATS-53", "WATS-54", "WATS-56"], "reference-index applies-to");
    expect(referenceIndex).toContain("WATS-54 keeps these aligned with `bun run api:check`");
  });

  test("endpoints reference distinguishes defineEndpoint from first-class endpoint subpaths", () => {
    const endpoints = read("docs/reference/endpoints.md");

    expect(metadataValue(endpoints, "lastReviewed")).toBe("2026-05-02");
    expect(endpoints).toContain("## Primitive vs first-class endpoint families");
    expect(endpoints).toContain("`defineEndpoint` is the plumbing primitive");
    expect(endpoints).toContain("first-class Graph endpoint family subpaths");
    expect(endpoints).toContain("`@switchbord/graph/endpoints/messages`");
    expectAll(endpoints, graphEndpointSubpaths, "endpoints reference first-class subpaths");
    expect(endpoints).toContain("WATS-54");
    expect(endpoints).toContain("bun run api:check");
    expect(endpoints).not.toContain("its first consumer, the refactored `messages` endpoint");
    expect(endpoints).not.toContain("endpoint modules under ~10 lines each");
  });

  test("public API docs separate credential-free implementation status from live validation status", () => {
    const publicSurface = read("docs/architecture/public-api-surface.md");

    expect(publicSurface).toContain("Credential-free implementation status is separate from live Meta validation status");
    expect(publicSurface).toContain("WATS-44 live-testing campaign");
    expect(publicSurface).toContain("no live Meta checks");
  });

  test("migration import cheat sheet no longer carries stale root-only subpath warnings", () => {
    const migration = read("docs/migration/pywa-to-wats.md");

    expectAll(migration, [
      "@switchbord/graph/endpoints/media",
      "@switchbord/graph/endpoints/templates",
      "@switchbord/graph/endpoints/flows",
      "@switchbord/graph/endpoints/calling",
      "@switchbord/graph/endpoints/business-management",
      "Use consumer fixtures as the source of truth for supported package-specifier imports"
    ], "migration import cheat sheet");
    expect(migration).not.toMatch(/root[- ]only/i);
    expect(migration).not.toContain("Root `@switchbord/graph` exports only");
    expect(migration).not.toContain("Some root `@switchbord/graph` exports do not yet have dedicated package subpaths");
  });

  test("changelog records WATS-55 as docs-only status taxonomy work", () => {
    const changelog = read("CHANGELOG.md");

    expect(changelog).toContain("### WATS-55 — Reference status taxonomy refresh");
    expect(changelog).toContain("separate credential-free implementation status from live validation status");
    expect(changelog).toContain("Boundary: docs-lock/status metadata only; no runtime Graph behavior, no live Meta calls, and no package export changes");
  });
});
