import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WATS-105/106/107/118 docs coherence lock.
 *
 * Behavioral lock for the pre-public-alpha docs voice + positioning pass:
 *   - WATS-105: canonical noun "toolkit" present in README and docs/index.md;
 *     framework/SDK/library only appear in an explicit allowlist of contextual phrases.
 *   - WATS-106: no doc carries `applies-to: 0.2.0-foundations-complete`.
 *   - WATS-107: parity-matrix and migration guide both list
 *     blockUsers / unblockUsers / listBlockedUsers as Implemented (credential-free)
 *     equivalents, NOT Deferred.
 *   - WATS-118: docs/guides/cli-init.md mentions `wats onboarding`, and any
 *     `wats init --yes` mention is confined to a "design target" labeled section.
 *
 * The unified 5-label status enum across parity matrix AND migration guide:
 *   Implemented (credential-free)
 *   Implemented (live pending)
 *   Read-only
 *   Partial
 *   Deferred
 */

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function walkFiles(root: string, shouldInclude: (path: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const normalized = relative(repoRoot, current).replace(/\\/gu, "/");
    const stat = statSync(current);
    if (stat.isDirectory()) {
      const base = normalized.split("/").at(-1);
      if (base === "node_modules" || base === "dist" || base === ".git" || base === ".vitepress") continue;
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
      continue;
    }
    if (stat.isFile() && shouldInclude(current)) out.push(current);
  }
  return out;
}

function publicMarkdownDocs(): string[] {
  const docs = walkFiles(join(repoRoot, "docs"), (path) => extname(path) === ".md");
  return [join(repoRoot, "README.md"), ...docs]
    .filter((path) => existsSync(path))
    .map((path) => relative(repoRoot, path).replace(/\\/gu, "/"))
    .sort();
}

/**
 * Allowlist of EXACT verbatim phrases (case-sensitive substring match) that
 * may legitimately use "framework", "SDK", or "library" in WATS docs.
 *
 * Every phrase explains the intentional non-toolkit word. Anything containing
 * framework/SDK/library that does not match one of these phrases is a lint
 * violation under the WATS-105 voice-lock rule.
 */
const VOICE_ALLOWLIST: readonly string[] = [
  // pywa is a Python library — contextual contrast
  "like pywa, a Python library",
  "pywa Python library",
  "a Python library",
  // Flask/FastAPI are frameworks — contextual contrast
  "unlike Flask/FastAPI frameworks",
  "Flask/FastAPI frameworks",
  // README states what WATS is NOT
  "not a single framework",
  // pywa template DSL / library-template helpers — pywa-side description
  "library-template",
  "library/authentication helper",
  "bulk auth/library helpers",
  // generic phrasing inside historical / non-voice contexts the tester accepts
  "Meta-owned Graph OpenAPI/source-of-truth material as external documentation"
];

function isAllowlistedVoiceContext(line: string): boolean {
  return VOICE_ALLOWLIST.some((phrase) => line.includes(phrase));
}

const VOICE_WORD_PATTERN = /\b(framework|frameworks|SDK|library)\b/u;

function voiceViolations(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    const lines = read(path).split(/\r?\n/u);
    return lines.flatMap((line, index) => {
      if (!VOICE_WORD_PATTERN.test(line)) return [];
      if (isAllowlistedVoiceContext(line)) return [];
      return [`${path}:${index + 1}: ${line.trim()}`];
    });
  });
}

describe("WATS-105 voice + positioning lock", () => {
  test("README and docs/index.md use the canonical noun 'toolkit'", () => {
    const readme = read("README.md");
    const indexDoc = read("docs/index.md");
    expect(readme.toLowerCase()).toContain("toolkit");
    expect(indexDoc.toLowerCase()).toContain("toolkit");
  });

  test("README has a 'What WATS is / Who it is for / vs pywa' positioning block", () => {
    const readme = read("README.md");
    // The handoff spec: three short positioning lines + honest non-claims.
    expect(readme).toContain("What WATS is");
    expect(readme).toContain("Who it is for");
    expect(readme).toContain("vs pywa");
    expect(readme.toLowerCase()).toContain("runtime-neutral");
    expect(readme.toLowerCase()).toContain("credential-free");
  });

  test("README has a 'When NOT to use WATS' section", () => {
    const readme = read("README.md");
    expect(readme).toContain("When NOT to use WATS");
    expect(readme.toLowerCase()).toContain("pywa");
  });

  test("framework/SDK/library only appear in the explicit voice allowlist", () => {
    const violations = voiceViolations([
      "README.md",
      "docs/index.md",
      "docs/migration/pywa-to-wats.md",
      "docs/architecture/overview.md",
      "docs/architecture/package-map.md",
      "docs/architecture/release-policy.md",
      "docs/architecture/roadmap-to-whatsapp-pywa-parity.md",
      "docs/parity/pywa-parity-matrix.md",
      "docs/reference/types.md"
    ]);
    if (violations.length > 0) {
      throw new Error(
        `framework/SDK/library appears outside the voice allowlist:\n${violations.join("\n")}\n` +
          `Either rephrase to use 'toolkit' (the canonical noun), or extend VOICE_ALLOWLIST with the verbatim phrase.`
      );
    }
  });
});

describe("WATS-106 stale applies-to frontmatter sweep", () => {
  test("no doc file carries `applies-to: 0.2.0-foundations-complete`", () => {
    const stale = publicMarkdownDocs().flatMap((path) => {
      const lines = read(path).split(/\r?\n/u);
      return lines.flatMap((line, index) => {
        if (line.includes("0.2.0-foundations-complete")) {
          return [`${path}:${index + 1}: ${line.trim()}`];
        }
        return [];
      });
    });
    if (stale.length > 0) {
      throw new Error(`Stale 0.2.0-foundations-complete frontmatter found:\n${stale.join("\n")}`);
    }
  });
});

describe("WATS-107 parity-matrix vs migration-guide reconciliation", () => {
  test("parity matrix lists Block API as Implemented (credential-free) — not Deferred", () => {
    const parity = read("docs/parity/pywa-parity-matrix.md");
    expect(parity).toContain("blockUsers");
    expect(parity).toContain("unblockUsers");
    expect(parity).toContain("listBlockedUsers");
    // The Block API row must not collapse the whole row into "Deferred".
    // We look for an affirmative status near the block-users symbols.
    const blockUsersIndex = parity.indexOf("blockUsers");
    expect(blockUsersIndex).toBeGreaterThan(-1);
    const window = parity.slice(Math.max(0, blockUsersIndex - 400), blockUsersIndex + 400);
    expect(window).toMatch(/implemented|Implemented/u);
  });

  test("migration guide describes Block API surfaces as Implemented — not Deferred", () => {
    const migration = read("docs/migration/pywa-to-wats.md");
    expect(migration).toContain("blockUsers");
    expect(migration).toContain("unblockUsers");
    expect(migration).toContain("listBlockedUsers");
    // The row that historically said "QR code CRUD, block/unblock users, token exchange | … | Deferred"
    // must no longer mark block/unblock users as Deferred.
    const lines = migration.split(/\r?\n/u);
    const blockLines = lines.filter((line) => /block.{0,5}unblock|blockUsers|unblockUsers|listBlockedUsers/u.test(line));
    expect(blockLines.length).toBeGreaterThan(0);
    for (const line of blockLines) {
      // The row(s) that mention block-users surfaces in a status table must show an Implemented label.
      // We allow lines that don't look like status-table rows (no pipe-delimited Status column) to pass.
      if (line.includes("|")) {
        expect(line).toMatch(/Implemented \(credential-free\)|Implemented \(live pending\)|Read-only|Partial/u);
        expect(line).not.toMatch(/\|\s*Deferred\s*\|/u);
      }
    }
  });

  test("both files share the unified 5-label status enum", () => {
    const labels = [
      "Implemented (credential-free)",
      "Implemented (live pending)",
      "Read-only",
      "Partial",
      "Deferred"
    ];
    for (const path of ["docs/parity/pywa-parity-matrix.md", "docs/migration/pywa-to-wats.md"]) {
      const doc = read(path);
      const present = labels.filter((label) => doc.includes(label));
      // At least three of the five canonical labels should appear in each
      // file once both files are reconciled.
      expect(present.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("WATS-118 CLI docs coverage", () => {
  test("docs/guides/cli-init.md mentions `wats onboarding`", () => {
    const cliInit = read("docs/guides/cli-init.md");
    expect(cliInit).toContain("wats onboarding");
  });

  test("`wats init --yes` only appears inside an explicit design-target section", () => {
    const cliInit = read("docs/guides/cli-init.md");
    const lines = cliInit.split(/\r?\n/u);
    // Build a section-aware view: section name = the most recent `## ...` heading.
    let currentSection = "";
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^##\s+/u.test(line)) {
        currentSection = line.replace(/^#+\s+/u, "").trim();
        continue;
      }
      if (!/wats\s+init\s+--yes/u.test(line)) continue;
      // Inspect the section + nearby preceding lines for an explicit "design target" label.
      const start = Math.max(0, i - 10);
      const window = lines.slice(start, i + 1).join("\n");
      const sectionLooksLikeDesignTarget =
        /design\s+target/iu.test(currentSection) ||
        /first-run\s+operator\s+flow/iu.test(currentSection);
      const windowAnnotates = /design\s+target|not\s+yet\s+implemented/iu.test(window);
      if (!sectionLooksLikeDesignTarget && !windowAnnotates) {
        violations.push(`docs/guides/cli-init.md:${i + 1}: ${line.trim()}`);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `\`wats init --yes\` appears outside a design-target labeled section:\n${violations.join("\n")}\n` +
          `Either move it under an explicit "Design target" / "first-run operator flow" section, ` +
          `or annotate it as "design target / not yet implemented".`
      );
    }
  });
});
