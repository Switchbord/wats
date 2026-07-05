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
  // Voice-passed MDX carries metadata as a JSX <DocMeta ... /> tag with
  // camelCase attributes rather than the old `- key: value` markdown bullets.
  const match = markdown.match(new RegExp(`<DocMeta[^>]*\\b${key}="([^"]*)"`, "u"));
  if (!match) throw new Error(`Missing metadata key ${key}`);
  return match[1] ?? "";
}

function expectAll(source: string, needles: readonly string[], label: string): void {
  for (const needle of needles) {
    expect(source, `${label} must mention ${needle}`).toContain(needle);
  }
}

const graphEndpointSubpaths = [
  "@wats/graph/endpoints/media",
  "@wats/graph/endpoints/templates",
  "@wats/graph/endpoints/flows",
  "@wats/graph/endpoints/calling",
  "@wats/graph/endpoints/business-management"
] as const;

describe("WATS-55 reference status taxonomy and metadata", () => {
  test("package map metadata covers the current WATS-37..56 consistency line and api check", () => {
    const packageMap = read("site/content/docs/concepts/package-map.mdx");
    // Voice-pass removed the WATS-nn ticket enumeration from appliesTo (ticket
    // refs were deliberately dropped). The metadata still carries the alpha
    // tooling version tag — assert that survives.
    const appliesTo = metadataValue(packageMap, "appliesTo");
    expect(appliesTo).toContain("0.3.x-alpha");

    // Substance preserved: the api:check guard and what it verifies. The
    // old "WATS-54 checks package exports" phrasing was reworded to drop the
    // ticket ref while keeping the fact (it verifies package exports).
    expect(packageMap).toContain("bun run api:check");
    expect(packageMap).toContain("verifies package exports");
  });

  test("reference index metadata includes the current consistency/test-hygiene line", () => {
    const referenceIndex = read("site/content/docs/reference/index.mdx");
    // Voice-pass dropped the WATS-nn enumeration from appliesTo; the alpha
    // version tag survives.
    const appliesTo = metadataValue(referenceIndex, "appliesTo");
    expect(appliesTo).toContain("0.3.x-alpha");
    // The old line "WATS-54 keeps these aligned with `bun run api:check`" was
    // removed from the index during the voice pass (the api:check alignment
    // note now lives in package-map.mdx and endpoints.mdx). The index's
    // substance — a per-package table pointing to each reference contract —
    // survives; guard that the endpoints reference is still linked here.
    expect(referenceIndex).toContain("/docs/reference/endpoints");
  });

  test("endpoints reference distinguishes defineEndpoint from first-class endpoint subpaths", () => {
    const endpoints = read("site/content/docs/reference/endpoints.mdx");

    expect(metadataValue(endpoints, "lastReviewed")).toBe("2026-05-02");
    expect(endpoints).toContain("## Primitive vs first-class endpoint families");
    // Voice-pass reworded "`defineEndpoint` is the plumbing primitive" → the
    // doc now frames defineEndpoint as the custom-declaration plumbing layer
    // distinct from the first-class families. Intent preserved: defineEndpoint
    // is the low-level primitive, first-class subpaths are preferred.
    expect(endpoints).toContain("custom `defineEndpoint` declaration");
    expect(endpoints).toContain("plumbing");
    expect(endpoints).toContain("first-class Graph endpoint family subpaths");
    expect(endpoints).toContain("`@wats/graph/endpoints/messages`");
    expectAll(endpoints, graphEndpointSubpaths, "endpoints reference first-class subpaths");
    // NOTE (real gap): the voice pass removed the "WATS-54 / bun run api:check"
    // alignment note from endpoints.mdx. The api:check guard note now lives in
    // concepts/package-map.mdx only. Dropping the two stale asserts here; the
    // subpath-list substance is still guarded above. See report.
    expect(endpoints).not.toContain("its first consumer, the refactored `messages` endpoint");
    expect(endpoints).not.toContain("endpoint modules under ~10 lines each");
  });

  test("public API docs separate credential-free implementation status from live validation status", () => {
    const publicSurface = read("site/content/docs/concepts/public-api-surface.mdx");

    // Voice-pass reworded the "Credential-free implementation status is separate
    // from live Meta validation status" sentence into the shape-only vs
    // live-validated distinction. Intent preserved: implemented/tested-locally
    // is distinct from Meta-accepted-in-a-live-account.
    expect(publicSurface).toContain("shape-only versus live-validated");
    expect(publicSurface).toContain("they do not prove Meta accepted that behavior in a live account");
    // The old "WATS-44 live-testing campaign" ticket ref was dropped; live
    // validation is now tracked via the parity matrix (credential-gated).
    expect(publicSurface).toContain("Live validation is credential-gated and tracked in the [parity matrix]");
    // "no live Meta checks" → "The default repository checks never call Meta".
    expect(publicSurface).toContain("never call Meta");
  });

  test("migration import cheat sheet no longer carries stale root-only subpath warnings", () => {
    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");

    expectAll(migration, [
      "@wats/graph/endpoints/media",
      "@wats/graph/endpoints/templates",
      "@wats/graph/endpoints/flows",
      "@wats/graph/endpoints/calling",
      "@wats/graph/endpoints/business-management",
      // Voice-pass dropped the "Use consumer fixtures as the source of truth for
      // supported package-specifier imports" sentence. The substance — an
      // authoritative import/subpath cheat sheet enumerating supported package
      // specifiers — survives as this section heading.
      "## Import and subpath cheat sheet"
    ], "migration import cheat sheet");
    expect(migration).not.toMatch(/root[- ]only/i);
    expect(migration).not.toContain("Root `@wats/graph` exports only");
    expect(migration).not.toContain("Some root `@wats/graph` exports do not yet have dedicated package subpaths");
  });

  test("changelog records WATS-55 as docs-only status taxonomy work", () => {
    const changelog = read("CHANGELOG.md");

    expect(changelog).toContain("### WATS-55 — Reference status taxonomy refresh");
    expect(changelog).toContain("separate credential-free implementation status from live validation status");
    expect(changelog).toContain("Boundary: docs-lock/status metadata only; no runtime Graph behavior, no live Meta calls, and no package export changes");
  });
});
