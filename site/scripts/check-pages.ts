/**
 * check-pages.ts — public page-manifest lock for the prerendered site.
 *
 * Philosophy ported from scripts/check-public-docs.ts at the repo root: the
 * set of publicly emitted pages is locked in site/public-pages-manifest.json.
 * Any page that is prerendered but not listed (accidental publication) or
 * listed but not emitted (broken route) fails the build with a diff.
 *
 * Only .html files count as pages; server routes like /api/search are not
 * prerendered and are out of scope here.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const clientRoot = join(siteRoot, "dist", "client");
const manifestPath = join(siteRoot, "public-pages-manifest.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { pages: string[] };
if (!Array.isArray(manifest.pages) || manifest.pages.some((p) => typeof p !== "string" || !p.startsWith("/"))) {
  console.error("check-pages: malformed manifest — \"pages\" must be an array of /-prefixed routes");
  process.exit(1);
}

if (!existsSync(clientRoot)) {
  console.error(`check-pages: build output missing at ${clientRoot} — run \`bun run build\` first`);
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

/** dist/client/index.html -> "/", dist/client/docs/index.html -> "/docs" */
function fileToRoute(file: string): string {
  const rel = relative(clientRoot, file).replace(/\\/gu, "/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"/index.html".length)}`;
  return `/${rel.slice(0, -".html".length)}`;
}

const emitted = new Set(walkHtml(clientRoot).map(fileToRoute));
const listed = new Set(manifest.pages);

const unlisted = [...emitted].filter((route) => !listed.has(route)).sort();
const missing = [...listed].filter((route) => !emitted.has(route)).sort();

if (unlisted.length > 0 || missing.length > 0) {
  console.error("check-pages: FAIL — prerendered pages do not match public-pages-manifest.json:");
  for (const route of unlisted) console.error(`  + ${route} (emitted but NOT in manifest — accidental publication?)`);
  for (const route of missing) console.error(`  - ${route} (in manifest but NOT emitted — broken route?)`);
  process.exit(1);
}

console.log(`check-pages: OK — ${emitted.size} prerendered page(s) exactly match the manifest: ${[...emitted].sort().join(", ")}`);
