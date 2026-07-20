// WATS-195 — DocMeta status closed set.
//
// The `status` attribute on a page's <DocMeta> tag carries a capability
// honesty tag from a closed set: live-validated | shape-only | planned,
// each optionally suffixed " — <short reason>". Stability/maintenance
// meaning (stable-for-0.x / experimental / internal) lives in the
// api-stability policy, not in status. This test pins the closed set so
// retired values (active, canonical, stable, experimental, internal,
// "implemented credential-free; live validation pending", "active — ...")
// cannot silently return.

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

function docFiles(dir: string): string[] {
  const absolute = join(repoRoot, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return docFiles(path);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [path] : [];
  });
}

// Matches the DocMeta status attribute value, which may contain a " — "
// suffix and quoted sub-fragments. We capture everything up to the closing
// quote of the status attribute.
const STATUS_RE = /<DocMeta[^>]*\bstatus="([^"]*)"/u;

// Closed set: a base tag (live-validated | shape-only | planned) optionally
// followed by " — <short reason>". The base tag may appear alone.
const CLOSED_SET_RE = /^(live-validated|shape-only|planned)(\s+—\s+\S.*)?$/u;

// Retired values that must never return.
const RETIRED = [
  "active",
  "canonical",
  "stable",
  "experimental",
  "internal",
  "implemented credential-free; live validation pending"
];

describe("WATS-195 DocMeta status closed set", () => {
  test("every DocMeta status value is in the closed set or omitted", () => {
    const offenders: string[] = [];
    for (const path of docFiles("site/content/docs")) {
      const text = readFileSync(join(repoRoot, path), "utf8");
      const match = STATUS_RE.exec(text);
      if (!match) continue; // status omitted is valid
      const value = match[1] ?? "";
      // The base tag is the text before the first " — " suffix.
      const base = value.split(/\s+—\s+/u)[0] ?? value;
      if (!CLOSED_SET_RE.test(value)) {
        offenders.push(`${path}: status="${value}" (base="${base}")`);
      }
    }
    expect(offenders, `non-closed-set status values:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("no retired status value remains on any page", () => {
    const offenders: string[] = [];
    for (const path of docFiles("site/content/docs")) {
      const text = readFileSync(join(repoRoot, path), "utf8");
      const match = STATUS_RE.exec(text);
      if (!match) continue;
      const value = match[1] ?? "";
      for (const retired of RETIRED) {
        // Match retired base tags only (avoid substring false positives on
        // suffixes that legitimately contain e.g. "active" inside a reason).
        const base = value.split(/\s+—\s+/u)[0] ?? value;
        if (base === retired) {
          offenders.push(`${path}: retired status base "${retired}" (full="${value}")`);
        }
      }
    }
    expect(offenders, `retired status values still present:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("api-stability policy defines the closed set canonically", () => {
    const doc = readFileSync(join(repoRoot, "site/content/docs/meta/api-stability.mdx"), "utf8");
    expect(doc).toContain("Page honesty tags");
    expect(doc).toContain("`live-validated`");
    expect(doc).toContain("`shape-only`");
    expect(doc).toContain("`planned`");
    for (const retired of RETIRED) {
      expect(doc, `retired value "${retired}" not listed as retired`).toContain(retired);
    }
  });

  test("VOICE.md rule 6 points at the canonical closed-set definition", () => {
    const voice = readFileSync(join(repoRoot, "VOICE.md"), "utf8");
    expect(voice).toContain("/docs/meta/api-stability");
  });
});
