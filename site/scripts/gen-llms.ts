// gen-llms.ts — emits public/llms.txt (index) and public/llms-full.txt (full
// corpus) from content/docs/*.mdx. Half the readership is now coding agents;
// feeding them the real docs beats letting them hallucinate from pywa's.
//
// MDX -> text: strip frontmatter (keep title/description), drop JSX component
// lines (<DocMeta .../> etc.), keep markdown body verbatim. Code fences stay —
// agents read those better than prose.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, dirname, extname } from "node:path"
import { fileURLToPath } from "node:url"

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const docsRoot = join(siteRoot, "content", "docs")
const ORIGIN = "https://wats.sh"

interface Page {
  route: string
  title: string
  description: string
  body: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith(".mdx")) out.push(full)
  }
  return out
}

function parse(file: string): Page {
  const raw = readFileSync(file, "utf8")
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
  const meta = fm?.[1] ?? ""
  const title = /^title:\s*["']?(.*?)["']?\s*$/m.exec(meta)?.[1] ?? ""
  const description = /^description:\s*["']?(.*?)["']?\s*$/m.exec(meta)?.[1] ?? ""
  let body = raw.slice(fm?.[0].length ?? 0)
  // Resolve <include>relative/path.ext</include> tags by inlining the file
  // contents (relative to the mdx file) as a fenced code block. The site
  // renders these via an MDX component; for the LLM corpus we inline the raw
  // source so agents see the actual code instead of an unresolved tag.
  body = body.replace(/<include>([^<]+)<\/include>/g, (_match, rel: string) => {
    const target = join(dirname(file), rel.trim())
    if (!existsSync(target)) return `<!-- include not found: ${rel.trim()} -->`
    const lang = extname(target).replace(/^\./, "") || ""
    const content = readFileSync(target, "utf8").replace(/\s+$/, "\n")
    return "```" + lang + "\n" + content + "```"
  })
  // Drop standalone JSX component lines (DocMeta, Callout wrappers) but keep
  // everything inside code fences untouched.
  const lines = body.split("\n")
  const kept: string[] = []
  let inFence = false
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) inFence = !inFence
    if (!inFence && /^\s*<\/?[A-Z][A-Za-z]*([\s>]|\/>|$)/.test(line)) continue
    kept.push(line)
  }
  body = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()

  const rel = relative(docsRoot, file).replace(/\.mdx$/, "")
  const route =
    rel === "index" ? "/docs" : `/docs/${rel.replace(/\/index$/, "")}`
  return { route, title, description, body }
}

const ORDER = ["quickstart", "guide", "concepts/", "reference/", "guides/", "migration/", "parity", "meta/"]
function rank(route: string): number {
  const p = route.replace(/^\/docs\/?/, "")
  const i = ORDER.findIndex((prefix) => p === prefix.replace(/\/$/, "") || p.startsWith(prefix))
  return i === -1 ? ORDER.length : i
}

const pages = walk(docsRoot)
  .map(parse)
  .filter((p) => p.title)
  .sort((a, b) => rank(a.route) - rank(b.route) || a.route.localeCompare(b.route))

const header = `# wats

> TypeScript toolkit for the WhatsApp Cloud API. Bun-first, zero runtime
> dependencies, typed end to end. Capability status is tagged honestly:
> live-validated / shape-only / planned.

Packages: @wats/core, @wats/graph, @wats/http, @wats/types, @wats/crypto,
@wats/config, @wats/cli, @wats/service (npm). Source: https://github.com/Switchbord/wats
Playground (runs the real SDK in-browser, no credentials): ${ORIGIN}/playground

## Docs
`

const index =
  header +
  pages.map((p) => `- [${p.title}](${ORIGIN}${p.route}): ${p.description}`).join("\n") +
  "\n"

const full =
  header +
  pages
    .map((p) => `\n---\n\n# ${p.title}\nURL: ${ORIGIN}${p.route}\n\n${p.body}\n`)
    .join("") +
  "\n"

writeFileSync(join(siteRoot, "public", "llms.txt"), index)
writeFileSync(join(siteRoot, "public", "llms-full.txt"), full)
console.log(
  `gen-llms: OK — llms.txt (${pages.length} pages, ${(index.length / 1024).toFixed(1)}KB) + llms-full.txt (${(full.length / 1024).toFixed(1)}KB)`,
)
