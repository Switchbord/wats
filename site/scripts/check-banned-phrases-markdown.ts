/**
 * check-banned-phrases-markdown.ts — voice-rule-4 gate over tracked markdown.
 *
 * Scans SOURCE markdown (.md and .mdx) for internal archaeology: ticket IDs
 * (WATS-nn), phase labels (F-n, B1/B2, C1/C2, D1, Arch-X, T-nn), and
 * reviewer-gate jargon ("adversarial remediation"). Mirrors the patterns in
 * banned-phrases.json (shared with the prerendered-HTML check) but operates
 * on source files, so leaks are caught before the site is built.
 *
 * Scopes (tracked files only — uses `git ls-files`):
 *   - repo-root .md files
 *   - examples/     (.md and .mdx)
 *   - deploy/       (.md)
 *   - site/         (.md anywhere under site/)
 *   - site/content/docs/  (.md and .mdx)
 *
 * Exclusions (legitimate ticket references):
 *   - maintainers/**   — internal docs reference tickets by design
 *   - CHANGELOG.md     — historical release entries
 *   - VOICE.md         — the rule book; deliberately shows banned-pattern examples
 *   - site/public/**   — generated assets, not source prose
 *
 * Code blocks (fenced and inline) are stripped before scanning, matching
 * the HTML check's code/pre stripping, so code examples don't false-positive.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = dirname(scriptDir);
const repoRoot = dirname(siteRoot);
const phrasesPath = join(scriptDir, "banned-phrases.json");

const { patterns = [] } = JSON.parse(readFileSync(phrasesPath, "utf8")) as {
  phrases: string[];
  patterns?: { name: string; regex: string }[];
};
const compiled = patterns.map((p) => ({ name: p.name, re: new RegExp(p.regex, "gu") }));

export interface Finding {
  file: string;
  line: number;
  name: string;
  match: string;
  context: string;
}

/**
 * Strip fenced (```) and inline (`) code from markdown so code examples
 * don't false-positive. Mirrors the HTML check's <code>/<pre> stripping.
 */
function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`\n]+`/gu, " ");
}

/**
 * Scan a single markdown document's content for banned archaeology.
 * Exported for policy tests (see packages/testing/tests/wats183-banned-phrase-gate.test.ts).
 */
export function scanMarkdownContent(content: string, relPath: string): Finding[] {
  const text = stripCodeBlocks(content);
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of compiled) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        findings.push({
          file: relPath,
          line: i + 1,
          name,
          match: m[0],
          context: line.trim().slice(0, 120),
        });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  return findings;
}

// --- Scope / exclusion predicates ------------------------------------------

const EXCLUSIONS = [
  "maintainers/",
  "CHANGELOG.md",
  "VOICE.md",
  "site/public/",
  "site/node_modules/",
  "site/playground-build/bun.lock",
];

function isExcluded(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return EXCLUSIONS.some(
    (ex) => normalized === ex || normalized.startsWith(ex) || normalized.includes("/" + ex),
  );
}

function isInScope(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  const isMd = p.endsWith(".md");
  const isMdx = p.endsWith(".mdx");
  if (!isMd && !isMdx) return false;

  // repo-root *.md (no path separator)
  if (isMd && !p.includes("/")) return true;
  // examples/** (.md and .mdx)
  if (p.startsWith("examples/")) return true;
  // deploy/** (.md)
  if (p.startsWith("deploy/") && isMd) return true;
  // site/**/*.md
  if (p.startsWith("site/") && isMd) return true;
  // site/content/docs/** (.md and .mdx)
  if (p.startsWith("site/content/docs/")) return true;
  return false;
}

function getTrackedMarkdown(): string[] {
  const out = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" });
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((f) => isInScope(f) && !isExcluded(f));
}

// --- Main -------------------------------------------------------------------

if (import.meta.main) {
  const files = getTrackedMarkdown();
  const findings: Finding[] = [];

  for (const relPath of files) {
    const abs = join(repoRoot, relPath);
    const content = readFileSync(abs, "utf8");
    findings.push(...scanMarkdownContent(content, relPath));
  }

  if (findings.length > 0) {
    console.error(
      `check-banned-phrases-markdown: FAIL — ${findings.length} archaeology leak(s) in tracked markdown:`,
    );
    for (const f of findings) {
      console.error(`  - ${f.file}:${f.line} [${f.name}] "${f.match}": ${f.context}`);
    }
    process.exit(1);
  }

  console.log(
    `check-banned-phrases-markdown: OK — ${files.length} markdown file(s) clean (${patterns.length} pattern(s))`,
  );
}
