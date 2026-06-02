// WATS-106 RED — docs must not advertise the stale 0.2.0 foundations line.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "docs"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function markdownFiles(dir: string): string[] {
  const absolute = join(repoRoot, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function rootMinorLine(): string {
  const version = JSON.parse(read("package.json")).version as string;
  const match = /^(\d+)\.(\d+)\./.exec(version);
  if (!match) throw new Error(`Unexpected root package version ${version}`);
  return `${match[1]}.${match[2]}.x-alpha-tooling`;
}

describe("WATS-106 applies-to coherence", () => {
  test("public docs do not advertise stale 0.2.0 foundations metadata", () => {
    const offenders = markdownFiles("docs")
      .filter((path) => read(path).includes("0.2.0-foundations-complete"))
      .map((path) => relative(repoRoot, join(repoRoot, path)));

    expect(offenders).toEqual([]);
  });

  test("frontmatter release-line docs use the current root minor line", () => {
    const expectedLine = rootMinorLine();
    const releaseLineDocs = [
      "docs/getting-started.md",
      "docs/reference/index.md",
      "docs/reference/webhook.md",
      "docs/reference/whatsapp-facade.md",
      "docs/architecture/overview.md",
      "docs/architecture/public-api-surface.md",
      "docs/architecture/package-map.md"
    ];

    for (const path of releaseLineDocs) {
      expect(read(path), `${path} applies-to`).toContain(`applies-to: \`${expectedLine}\``);
    }
  });

  test("OpenAPI reference describes the generated version as current package version", () => {
    const openapi = read("docs/reference/openapi.md");

    expect(openapi).toContain("`info.version`: current package version");
    expect(openapi).not.toContain("current package foundation version (`0.2.0`)");
  });

  test("getting-started package count matches the package table", () => {
    const gettingStarted = read("docs/getting-started.md");

    expect(gettingStarted).toContain("The foundations pivot shipped five packages of primitives:");
  });
});
