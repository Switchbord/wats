import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const docsRoot = join(repoRoot, "docs");
const manifest = JSON.parse(readFileSync(join(docsRoot, "public-docs-manifest.json"), "utf8")) as {
  pages: string[];
  exclude: string[];
};

export const DISALLOWED_PUBLIC_PATH_PATTERNS = [
  "handoff-context-compression",
  "docs/handoff.md",
  ".hermes/",
  "packages/testing/",
  "/tmp/",
  "/root/"
] as const;

const DISALLOWED_PUBLIC_STRINGS = [
  "LINEAR_API_KEY",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "TODO(A2)",
  "ADR-004-typed-updates-handler-model.md"
] as const;

const ALLOWED_PUBLIC_LINK_TARGETS = ["ADR-004-typed-updates-and-handler-model.md"] as const;
void ALLOWED_PUBLIC_LINK_TARGETS;

const RAW_HTML_PATTERNS = [
  /<script\b/iu,
  /<iframe\b/iu,
  /<object\b/iu,
  /<embed\b/iu,
  /\son[a-z]+\s*=/iu,
  /javascript:/iu
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function ensureInside(base: string, target: string): void {
  const rel = relative(base, target);
  if (rel.startsWith("..") || rel === "" && target !== base || rel.includes("..")) {
    fail(`path escapes public docs root: ${target}`);
  }
}

function pagePath(page: string): string {
  if (page.startsWith("/") || page.includes("..") || /[\0\r\n]/u.test(page)) {
    fail(`unsafe public page path: ${page}`);
  }
  const full = join(docsRoot, page);
  ensureInside(docsRoot, full);
  return full;
}

function stripFencedCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/gu, "");
}

export function validateMarkdownLinks(page: string, content: string): void {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content)) !== null) {
    const raw = match[1]?.trim() ?? "";
    if (raw.length === 0 || raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("mailto:")) continue;
    if (raw.startsWith("#")) continue;
    if (/^(javascript|data):/iu.test(raw)) fail(`unsafe link scheme in ${page}: ${raw}`);
    const [target] = raw.split("#", 1);
    if (target === undefined || target.length === 0) continue;
    if (target.startsWith("/")) continue;
    const resolved = normalize(join(dirname(pagePath(page)), target));
    ensureInside(docsRoot, resolved);
    if (!existsSync(resolved)) fail(`broken local markdown link in ${page}: ${raw}`);
  }
}

function validatePage(page: string): void {
  const full = pagePath(page);
  if (!existsSync(full)) fail(`public docs page missing: ${page}`);
  const rel = `docs/${page}`;
  for (const pattern of DISALLOWED_PUBLIC_PATH_PATTERNS) {
    if (rel.includes(pattern) || page.includes(pattern)) fail(`disallowed public path: ${page}`);
  }
  const content = readFileSync(full, "utf8");
  const nonCode = stripFencedCode(content);
  for (const needle of DISALLOWED_PUBLIC_STRINGS) {
    if (nonCode.includes(needle)) fail(`disallowed public string ${needle} in ${page}`);
  }
  const nonCodeNoInline = nonCode.replace(/`[^`]*`/gu, "");
  for (const pattern of RAW_HTML_PATTERNS) {
    if (pattern.test(nonCodeNoInline) && !page.endsWith("openapi-ui.md")) fail(`unsafe raw HTML/link pattern ${pattern} in ${page}`);
  }
  validateMarkdownLinks(page, content);
}

export function scanGeneratedOutputForSecrets(): void {
  const outDirs = [join(docsRoot, ".vitepress", "dist"), join(docsRoot, "public")];
  const poisoned = [
    "SHOULD_NOT_APPEAR_WATS_ACCESS_TOKEN",
    "SHOULD_NOT_APPEAR_WATS_APP_SECRET",
    "SHOULD_NOT_APPEAR_LINEAR",
    "SHOULD_NOT_APPEAR_GITHUB",
    "SHOULD_NOT_APPEAR_NPM"
  ];
  const stack = outDirs.filter(existsSync);
  while (stack.length > 0) {
    const current = stack.pop()!;
    const st = statSync(current);
    if (st.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
      continue;
    }
    if (!st.isFile() || st.size > 2_000_000) continue;
    const text = readFileSync(current, "utf8");
    for (const secret of poisoned) {
      if (text.includes(secret)) fail(`generated output leaked poisoned secret ${secret}`);
    }
  }
}

for (const page of manifest.pages) validatePage(page);
if ((manifest.exclude ?? []).includes("handoff-context-compression-*.md") === false) fail("manifest must exclude context-compression handoffs");
scanGeneratedOutputForSecrets();

const distRoot = join(docsRoot, ".vitepress", "dist");
if (existsSync(distRoot)) {
  const allowedHtml = new Set(
    manifest.pages.map((page) => {
      const without = page.replace(/\.md$/u, "");
      return without === "index" ? "index.html" : `${without}.html`;
    })
  );
  const stack = [distRoot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const st = statSync(current);
    if (st.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
      continue;
    }
    const rel = relative(distRoot, current).replace(/\\/gu, "/");
    if (rel.endsWith(".html") && rel !== "404.html" && !allowedHtml.has(rel)) {
      fail(`generated public HTML is not in manifest: ${rel}`);
    }
  }
}

console.log(`checked ${manifest.pages.length} public docs pages`);
