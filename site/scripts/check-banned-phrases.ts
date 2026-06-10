/**
 * check-banned-phrases.ts — copy QA over the prerendered HTML.
 *
 * Scans the VISIBLE text of every emitted .html file for the banned marketing
 * phrases from 04-content.md §10 (kept in scripts/banned-phrases.json,
 * case-insensitive), plus emoji and exclamation points.
 *
 * Only .html visible text is scanned: <script>, <style>, <pre> and <code>
 * blocks are stripped first, then remaining tags, then HTML entities are
 * decoded. This keeps fumadocs' bundled/inlined JS (which legitimately
 * contains words like "simply" and plenty of "!") from false-positiving.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const clientRoot = join(siteRoot, "dist", "client");
const phrasesPath = join(dirname(fileURLToPath(import.meta.url)), "banned-phrases.json");

const { phrases } = JSON.parse(readFileSync(phrasesPath, "utf8")) as { phrases: string[] };

if (!existsSync(clientRoot)) {
  console.error(`check-banned-phrases: build output missing at ${clientRoot} — run \`bun run build\` first`);
  process.exit(1);
}

function walkHtml(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkHtml(full, out);
    else if (st.isFile() && full.endsWith(".html")) out.push(full);
  }
  return out;
}

/** Reduce an HTML document to its visible text (regex-strip approach). */
function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<pre\b[\s\S]*?<\/pre>/giu, " ")
    .replace(/<code\b[\s\S]*?<\/code>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;|&#39;/gu, "'")
    .replace(/&nbsp;/gu, " ");
}

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

function context(text: string, index: number, span: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + span + 30);
  return text.slice(start, end).replace(/\s+/gu, " ").trim();
}

const findings: string[] = [];
const htmlFiles = walkHtml(clientRoot);

for (const file of htmlFiles) {
  const rel = relative(siteRoot, file);
  const text = visibleText(readFileSync(file, "utf8"));
  const lower = text.toLowerCase();
  for (const phrase of phrases) {
    let from = 0;
    let idx: number;
    while ((idx = lower.indexOf(phrase.toLowerCase(), from)) !== -1) {
      findings.push(`${rel}: banned phrase "${phrase}": ...${context(text, idx, phrase.length)}...`);
      from = idx + phrase.length;
    }
  }
  const exclamation = text.indexOf("!");
  if (exclamation !== -1) {
    findings.push(`${rel}: exclamation point in visible text: ...${context(text, exclamation, 1)}...`);
  }
  const emoji = EMOJI_PATTERN.exec(text);
  if (emoji !== null && emoji.index !== undefined) {
    findings.push(`${rel}: emoji in visible text: ...${context(text, emoji.index, emoji[0].length)}...`);
  }
}

if (findings.length > 0) {
  console.error(`check-banned-phrases: FAIL — ${findings.length} copy violation(s):`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`check-banned-phrases: OK — ${htmlFiles.length} HTML page(s) clean (${phrases.length} phrases + emoji + "!")`);
