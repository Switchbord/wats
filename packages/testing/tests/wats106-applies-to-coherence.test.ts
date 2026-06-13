// WATS-106 — docs must not advertise the stale 0.2.0 foundations line, and
// the DocMeta appliesTo prop on release-line docs must track the current minor.
// Repointed from the retired VitePress docs/ tree to site/content/docs.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function docFiles(dir: string): string[] {
  const absolute = join(repoRoot, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return docFiles(path);
    return entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) ? [path] : [];
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
    const offenders = docFiles("site/content/docs")
      .filter((path) => read(path).includes("0.2.0-foundations-complete"))
      .map((path) => relative(repoRoot, join(repoRoot, path)));

    expect(offenders).toEqual([]);
  });

  test("DocMeta appliesTo on tooling-line docs tracks the current root minor", () => {
    const expectedLine = rootMinorLine();
    // Docs that declare the alpha-tooling line via the DocMeta component must
    // use the current minor. Docs that omit appliesTo or scope to a narrower
    // line (e.g. 0.3.x-alpha) are out of scope for this coherence check.
    const toolingLineDocs = [
      "site/content/docs/concepts/overview.mdx",
      "site/content/docs/concepts/public-api-surface.mdx",
      "site/content/docs/concepts/package-map.mdx"
    ];

    for (const path of toolingLineDocs) {
      expect(read(path), `${path} appliesTo`).toContain(`appliesTo="${expectedLine}"`);
    }
  });
});
