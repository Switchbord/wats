// WATS-36A RED — public docs site scaffold/build lock.

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

function json(path: string): unknown {
  return JSON.parse(read(path));
}

describe("WATS-36A public docs-site scaffold", () => {
  test("root package exposes deterministic credential-free docs scripts and dependencies", () => {
    const pkg = json("package.json") as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["docs:build"]).toBe("bun run scripts/docs-build.ts");
    expect(pkg.scripts?.["docs:openapi"]).toBe("bun run scripts/generate-docs-openapi.ts");
    expect(pkg.scripts?.["docs:check"]).toBe("bun run scripts/check-public-docs.ts");
    expect(pkg.scripts?.["docs:api"]).toBe("bun run scripts/generate-docs-api.ts");
    expect(pkg.scripts?.["docs:dev"]).toContain("vitepress dev docs");

    expect(pkg.devDependencies?.vitepress).toBeDefined();
    expect(pkg.devDependencies?.typedoc).toBeDefined();
    expect(pkg.devDependencies?.["typedoc-plugin-markdown"]).toBeDefined();
    expect(pkg.devDependencies?.["@scalar/api-reference"]).toBeDefined();
  });

  test("site root, VitePress config, TypeDoc config, OpenAPI UI, and public manifest exist", () => {
    for (const path of [
      "docs/index.md",
      "docs/.vitepress/config.mts",
      "docs/.vitepress/theme/index.ts",
      "docs/.vitepress/theme/components/ScalarReference.vue",
      "docs/reference/openapi-ui.md",
      "docs/public-docs-manifest.json",
      "typedoc.json",
      "scripts/generate-docs-openapi.ts",
      "scripts/generate-docs-api.ts",
      "scripts/check-public-docs.ts",
      "scripts/docs-build.ts"
    ]) {
      expect(existsSync(join(repoRoot, path)), `${path} should exist`).toBe(true);
    }
  });

  test("public manifest includes public docs and excludes internal/private handoff docs", () => {
    const manifest = json("docs/public-docs-manifest.json") as {
      nav?: unknown;
      pages?: string[];
      exclude?: string[];
    };
    expect(Array.isArray(manifest.pages)).toBe(true);
    const pages = manifest.pages ?? [];
    expect(pages).toContain("getting-started.md");
    expect(pages).toContain("reference/index.md");
    expect(pages).toContain("reference/openapi-ui.md");
    expect(pages).toContain("api/index.md");
    expect(pages).toContain("migration/pywa-to-wats.md");
    expect(pages).toContain("parity/pywa-parity-matrix.md");
    expect(pages.some((p) => p.includes("handoff"))).toBe(false);
    expect(pages).toContain("reference/internal-utils.md");
    expect(manifest.exclude ?? []).toContain("handoff-context-compression-*.md");
  });

  test("OpenAPI docs generation is local, deterministic, and secret-safe", () => {
    const generator = read("scripts/generate-docs-openapi.ts");
    expect(generator).toContain("createWatsServiceOpenApiDocument");
    expect(generator).toContain("docs/public/openapi.json");
    expect(generator).toContain("FORBIDDEN_OPENAPI_STRINGS");
    expect(generator).toContain("WATS_ACCESS_TOKEN");
    expect(generator).not.toContain("process.env.WATS_ACCESS_TOKEN");
    expect(generator).not.toContain("fetch(");

    const openapiPage = read("docs/reference/openapi-ui.md");
    expect(openapiPage).toContain("<ClientOnly>");
    expect(openapiPage).toContain("ScalarReference");
    expect(openapiPage).toContain("/openapi.json");
  });

  test("docs-site safety checker rejects internal/private paths and stale public docs", () => {
    const checker = read("scripts/check-public-docs.ts");
    expect(checker).toContain("DISALLOWED_PUBLIC_PATH_PATTERNS");
    expect(checker).toContain("handoff-context-compression");
    expect(checker).not.toContain("reference/internal-utils.md");
    expect(checker).toContain("LINEAR_API_KEY");
    expect(checker).toContain("TODO(A2)");
    expect(checker).toContain("ADR-004-typed-updates-and-handler-model.md");
    expect(checker).toContain("validateMarkdownLinks");
    expect(checker).toContain("scanGeneratedOutputForSecrets");
  });

  test("CI and release docs run the docs build without credentials", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("bun run docs:check");
    expect(ci).toContain("bun run docs:build");

    const releasePolicy = read("docs/architecture/release-policy.md");
    expect(releasePolicy).toContain("bun run docs:build");
    expect(releasePolicy).toContain("credential-free");

    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("docs:build");
    expect(changelog).toContain("public docs site");
  });
});
