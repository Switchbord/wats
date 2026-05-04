// WATS-84 RED — public policy/legal baseline for switchbord release readiness.

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

describe("WATS-84 public policy/legal baseline", () => {
  test("root policy files exist with public-release safe anchors", () => {
    for (const path of ["LICENSE", "CONTRIBUTING.md", "SECURITY.md"] as const) {
      expect(existsSync(join(repoRoot, path)), `${path} should exist`).toBe(true);
    }

    expectAll(read("LICENSE"), ["MIT License", "Copyright", "Permission is hereby granted"]);
    expectAll(read("CONTRIBUTING.md"), [
      "# Contributing to WATS",
      "Linear is the source of truth",
      "docs move with code",
      "credential-free by default",
      "Do not commit secrets",
      "bun test",
      "bun run typecheck",
      "bun run docs:check",
      "bun run docs:build"
    ]);
    expectAll(read("SECURITY.md"), [
      "# Security Policy",
      "Supported versions",
      "Reporting a vulnerability",
      "Do not open a public issue for suspected vulnerabilities",
      "No live Meta credentials",
      "redacted reproduction",
      "Webhook signature",
      "secret-bearing values"
    ]);
  });

  test("README and release policy no longer point public readers at internal handoff docs", () => {
    const readme = read("README.md");
    const releasePolicy = read("docs/architecture/release-policy.md");

    expect(readme).toContain("SECURITY.md");
    expect(readme).toContain("CONTRIBUTING.md");
    expect(readme).not.toContain("docs/handoff.md");

    expectAll(releasePolicy, [
      "WATS-84 public policy baseline",
      "MIT license",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "public repository visibility",
      "source-only `./src/*.ts` exports remain a package-release blocker"
    ]);
    expect(releasePolicy).not.toContain("release legal/community files (`LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`) remain a follow-up");
  });

  test("package manifests declare the MIT license while preserving private package guards", () => {
    const rootPackage = JSON.parse(read("package.json")) as { license?: string; private?: boolean };
    expect(rootPackage.private).toBe(true);
    expect(rootPackage.license).toBe("MIT");

    for (const path of [
      "packages/types/package.json",
      "packages/crypto/package.json",
      "packages/graph/package.json",
      "packages/core/package.json",
      "packages/http/package.json",
      "packages/config/package.json",
      "packages/service/package.json",
      "packages/cli/package.json",
      "packages/internal-utils/package.json"
    ] as const) {
      const manifest = JSON.parse(read(path)) as { license?: string; private?: boolean };
      expect(manifest.private, `${path} is publishable for 0.2.1 alpha`).toBe(false);
      expect(manifest.license, `${path} license`).toBe("MIT");
    }

    const testingManifest = JSON.parse(read("packages/testing/package.json")) as { license?: string; private?: boolean };
    expect(testingManifest.private).toBe(true);
    expect(testingManifest.license).toBe("MIT");
  });

  test("changelog records WATS-84 boundary and publication non-goals", () => {
    const changelog = read("CHANGELOG.md");
    expectAll(changelog, [
      "WATS-84 — Public policy and security baseline",
      "LICENSE",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "MIT license metadata",
      "no package publication",
      "no GitHub repository creation or push",
      "no release automation",
      "no live Meta calls"
    ]);
  });
});
