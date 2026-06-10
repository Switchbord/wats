/**
 * check-canaries.ts — credential-shaped string scan over the site build output.
 *
 * Ported from the scanning half of scripts/docs-build.ts + check-public-docs.ts
 * (scanGeneratedOutputForSecrets) at the repo root: the docs build injects
 * REDACTION_CANARY_* env values and fails if they leak into generated output.
 * The site build reads no secrets at all, so here we scan for both the
 * poisoned canary markers AND real-credential shapes.
 *
 * Scans EVERY emitted text file (html/js/css/json/txt/xml/svg/map) under
 * dist/ for:
 *   - REDACTION_CANARY_* poisoned markers (mirrors docs:check)
 *   - Meta access tokens (EAA...)
 *   - PEM private key headers
 *   - ngrok tunnel URLs (must never be baked into the public site)
 *   - railway.app (the live service URL must not appear in the public site)
 *
 * JWT-ish three-segment blobs are scanned ONLY in .html/.json/.txt output:
 * minified JS bundles legitimately contain long dotted identifier chains and
 * base64-ish chunks that false-positive this pattern, and a real JWT leak
 * would come from prerendered data, not from fumadocs' vendored bundle code.
 *
 * Exit 1 with a per-file finding list on any hit.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(siteRoot, "dist");

const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".cjs", ".css", ".json", ".txt", ".xml", ".svg", ".map", ".webmanifest"]);
const JWT_EXTENSIONS = new Set([".html", ".json", ".txt"]);
const MAX_FILE_BYTES = 5_000_000;

interface CanaryPattern {
  name: string;
  pattern: RegExp;
  /** restrict to these extensions; undefined = all text files */
  extensions?: Set<string>;
}

const PATTERNS: CanaryPattern[] = [
  { name: "poisoned redaction canary", pattern: /REDACTION_CANARY_[A-Z_]+/gu },
  { name: "Meta access token (EAA...)", pattern: /EAA[A-Za-z0-9]{20,}/gu },
  { name: "PEM private key header", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
  { name: "ngrok tunnel URL", pattern: /https?:\/\/[a-z0-9-]+\.ngrok[^"' ]*/giu },
  { name: "railway.app reference", pattern: /railway\.app/giu },
  { name: "JWT-like three-segment blob", pattern: /[a-zA-Z0-9_-]{40,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/gu, extensions: JWT_EXTENSIONS }
];

/**
 * Fixture strings the docs deliberately use; mirrored from what docs:check
 * tolerates (repo docs use the bare word "ngrok" and placeholder commands,
 * never real tokens/URLs, so nothing needs allowlisting today). Add exact
 * matched strings here if a deliberate fixture ever trips a pattern.
 */
const ALLOWLIST: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

if (!existsSync(distRoot)) {
  console.error(`check-canaries: build output missing at ${distRoot} — run \`bun run build\` first`);
  process.exit(1);
}

const findings: string[] = [];
let scanned = 0;

for (const file of walk(distRoot)) {
  const ext = extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) continue;
  if (statSync(file).size > MAX_FILE_BYTES) continue;
  const text = readFileSync(file, "utf8");
  scanned += 1;
  const rel = relative(siteRoot, file);
  for (const { name, pattern, extensions } of PATTERNS) {
    if (extensions !== undefined && !extensions.has(ext)) continue;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const hit = match[0];
      if (ALLOWLIST.includes(hit)) continue;
      const preview = hit.length > 60 ? `${hit.slice(0, 57)}...` : hit;
      findings.push(`${rel}: ${name}: ${preview}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`check-canaries: FAIL — ${findings.length} credential-shaped finding(s):`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log(`check-canaries: OK — scanned ${scanned} text files under dist/, no credential-shaped strings`);
