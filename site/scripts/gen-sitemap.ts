/**
 * gen-sitemap.ts — generates public/sitemap.xml from public-pages-manifest.json.
 *
 * The manifest is the single source of truth for public routes (locked by
 * check-pages.ts). Routes whose manifest note starts with "devOnly" are
 * excluded — they ship in dev builds but must not be advertised to crawlers.
 *
 * Runs in the check chain BEFORE `bun run build` so the generated file is
 * copied from public/ into dist/client/ by Vite.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(siteRoot, "public-pages-manifest.json");
const outPath = join(siteRoot, "public", "sitemap.xml");

const ORIGIN = "https://wats.sh";

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  pages: string[];
  notes?: Record<string, string>;
};

if (!Array.isArray(manifest.pages) || manifest.pages.some((p) => typeof p !== "string" || !p.startsWith("/"))) {
  console.error('gen-sitemap: malformed manifest — "pages" must be an array of /-prefixed routes');
  process.exit(1);
}

const isDevOnly = (route: string): boolean =>
  (manifest.notes?.[route] ?? "").trimStart().startsWith("devOnly");

const routes = manifest.pages.filter((route) => !isDevOnly(route)).sort();
const excluded = manifest.pages.filter(isDevOnly).sort();

const urls = routes
  .map((route) => `  <url><loc>${ORIGIN}${route === "/" ? "/" : route}</loc></url>`)
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

writeFileSync(outPath, xml);
console.log(
  `gen-sitemap: OK — wrote ${routes.length} route(s) to public/sitemap.xml` +
    (excluded.length > 0 ? ` (excluded devOnly: ${excluded.join(", ")})` : ""),
);
