import { describe, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

function windowsAroundNeedle(source: string, needle: string): string[] {
  const lines = source.split(/\r?\n/u);
  const lowerNeedle = needle.toLowerCase();
  return lines.flatMap((line, index) => {
    if (!line.toLowerCase().includes(lowerNeedle)) return [];
    const start = Math.max(0, index - 6);
    const end = Math.min(lines.length, index + 9);
    return [lines.slice(start, end).join("\n")];
  });
}

function hasWats97WebhookRetentionSemantics(window: string): boolean {
  const lower = window.toLowerCase();
  const hasSevenDays = /\b7\s+days?\b/u.test(lower);
  const hasCurrentBoundary = /\bcurrent\b|\bnow\b|\bas of\b|after\s+2025-10-09|since\s+2025-10-09/u.test(lower);
  const hasEvidenceDates = /2025-09-24/u.test(lower) && /2025-10-09/u.test(lower);
  const hasWebhookMediaIds =
    /webhook\s+media\s+ids?\b/u.test(lower) ||
    /media\s+ids?.{0,100}(?:received|delivered|included).{0,100}webhook/su.test(lower) ||
    /media\s+ids?.{0,100}(?:via|from)\s+(?:a\s+)?webhook/su.test(lower) ||
    /received\s+via\s+(?:a\s+)?webhook.{0,100}media\s+ids?/su.test(lower);
  const hasPromptDownload = /\b(prompt|promptly|immediate|immediately|as soon as)\b.{0,160}\b(download|fetch|retrieve|resolve)\b/su.test(lower);
  const hasPersistence = /\b(persist|persistence|store|storage|durable)\b/su.test(lower);
  return hasSevenDays && hasCurrentBoundary && hasEvidenceDates && hasWebhookMediaIds && hasPromptDownload && hasPersistence;
}

function expectWats97WebhookRetentionGuidance(path: string): void {
  const windows = windowsAroundNeedle(read(path), "WATS-97");
  if (windows.length === 0) {
    throw new Error(`${path} must mention WATS-97 webhook media-id retention guidance.`);
  }
  if (!windows.some(hasWats97WebhookRetentionSemantics)) {
    throw new Error(
      `${path} must document WATS-97 current webhook media ID retention as 7 days, cite the 2025-09-24 / 2025-10-09 changelog boundary, and recommend prompt download plus persistence.\n` +
        windows.join("\n--- WATS-97 window ---\n")
    );
  }
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
  return [join(repoRoot, "README.md"), join(repoRoot, "CHANGELOG.md"), ...docs]
    .filter((path) => existsSync(path))
    .map((path) => relative(repoRoot, path).replace(/\\/gu, "/"))
    .sort();
}

function isHistoricalThirtyDayContext(context: string): boolean {
  const lower = context.toLowerCase();
  return [
    /reduced\s+from\s+30\s+days?/u,
    /reduc(?:ed|tion).{0,120}30\s+days?.{0,120}7\s+days?/su,
    /30\s+days?.{0,120}reduc(?:ed|tion).{0,120}7\s+days?/su,
    /(?:previously|formerly|historically|historical|prior|legacy|old|older).{0,120}30\s+days?/su,
    /30\s+days?.{0,120}(?:previously|formerly|historically|historical|prior|legacy|old|older)/su,
    /(?:before|until|pre[-\s]?)\s*2025-10-09.{0,120}30\s+days?/su,
    /30\s+days?.{0,120}(?:before|until|pre[-\s]?)\s*2025-10-09/su,
    /changed\s+from\s+30\s+days?/u
  ].some((pattern) => pattern.test(lower));
}

function isWebhookMediaRetentionContext(context: string): boolean {
  const lower = context.toLowerCase();
  const mentionsMedia = /\bmedia\b|\bmedia\s+ids?\b|\bmediaid\b|\bmedia_id\b/u.test(lower);
  const mentionsWebhook = /\bwebhook\b/u.test(lower);
  const mentionsRetention = /\bretention\b|\bdownloadable\b|\bavailable\b|\bavailability\b|\bdownloadability\b|\bwindow\b/u.test(lower);
  return mentionsMedia && mentionsWebhook && mentionsRetention;
}

function thirtyDayViolations(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    const lines = read(path).split(/\r?\n/u);
    return lines.flatMap((line, index) => {
      if (!/30\s+days?/iu.test(line)) return [];
      const start = Math.max(0, index - 3);
      const end = Math.min(lines.length, index + 4);
      const context = lines.slice(start, end).join("\n");
      if (!isWebhookMediaRetentionContext(context)) return [];
      if (isHistoricalThirtyDayContext(context)) return [];
      return [`${path}:${index + 1}: ${line.trim()}`];
    });
  });
}

function extractComments(source: string): string[] {
  const comments: string[] = [];
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//gu)) comments.push(match[0]);
  for (const match of source.matchAll(/(^|[^:])\/\/[^\r\n]*/gmu)) comments.push(match[0]);
  return comments;
}

function sourceFilesForCommentScan(): string[] {
  const roots = [join(repoRoot, "packages"), join(repoRoot, "scripts")];
  return roots.flatMap((root) =>
    walkFiles(root, (path) => {
      const normalized = relative(repoRoot, path).replace(/\\/gu, "/");
      if (normalized.startsWith("packages/testing/")) return false;
      return /\.[cm]?[tj]sx?$/u.test(path);
    })
  );
}

function commentMentionsWebhookMediaRetention(comment: string): boolean {
  const lower = comment.toLowerCase();
  return /webhook/u.test(lower) && /media/u.test(lower) && /(?:retention|downloadable|available|availability|days?|window)/u.test(lower);
}

describe("WATS-97 webhook media-id retention docs", () => {
  test("required public docs lock current webhook media ID retention and persistence guidance", () => {
    for (const path of [
      "docs/reference/media.md",
      "docs/reference/webhook.md",
      "docs/parity/pywa-parity-matrix.md",
      "CHANGELOG.md"
    ]) {
      expectWats97WebhookRetentionGuidance(path);
    }
  });

  test("public docs do not claim current webhook media ID availability is 30 days", () => {
    const violations = thirtyDayViolations(publicMarkdownDocs());
    if (violations.length > 0) {
      throw new Error(`Unqualified 30-day webhook media retention claims found:\n${violations.join("\n")}`);
    }
  });

  test("source comments that mention webhook media retention follow the same 7-day current rule", () => {
    const offenders = sourceFilesForCommentScan().flatMap((path) => {
      const relativePath = relative(repoRoot, path).replace(/\\/gu, "/");
      return extractComments(readFileSync(path, "utf8")).flatMap((comment) => {
        if (!commentMentionsWebhookMediaRetention(comment)) return [];
        if (hasWats97WebhookRetentionSemantics(comment) || isHistoricalThirtyDayContext(comment)) return [];
        return [`${relativePath}: ${comment.trim().replace(/\s+/gu, " ")}`];
      });
    });

    if (offenders.length > 0) {
      throw new Error(`Webhook media retention comments must match the WATS-97 current 7-day rule:\n${offenders.join("\n")}`);
    }
  });
});
