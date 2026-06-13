// gen-depgraph.ts — renders the @wats/* dependency graph as an SVG from the
// REAL package manifests (dependencies + peerDependencies) plus a source scan
// for type-only imports. The previous hand-drawn ASCII diagram had drifted
// from the code (it showed core depending on crypto/http; actually http
// depends on core). Generated output cannot drift.
//
// Output: public/diagrams/package-graph.svg, referenced by
// content/docs/concepts/package-map.mdx.
//
// Layout is declarative (row/order below); EDGES are derived. A package
// missing from the layout map fails the build — forcing this file to be
// updated when the workspace gains a package.

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const PACKAGES_DIR = join(import.meta.dir, "..", "..", "packages")
const OUT = join(import.meta.dir, "..", "public", "diagrams", "package-graph.svg")

// Vercel builds from site/ as the root directory; packages/ may not be in the
// build context. The SVG is committed — regenerate when the workspace is
// present, fall back to the committed copy when it is not.
if (!existsSync(PACKAGES_DIR)) {
  if (!existsSync(OUT)) {
    console.error("gen-depgraph: FAIL — no packages/ workspace and no committed SVG")
    process.exit(1)
  }
  console.log("gen-depgraph: skipped (no packages/ in build context), using committed SVG")
  process.exit(0)
}

// ---- collect real edges -----------------------------------------------------

type Pkg = { name: string; deps: Set<string> }

function scanSrcImports(dir: string): Set<string> {
  const found = new Set<string>()
  const src = join(dir, "src")
  if (!existsSync(src)) return found
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const txt = readFileSync(p, "utf8")
        for (const m of txt.matchAll(/from\s+["'](@wats\/[a-z-]+)/g)) found.add(m[1])
      }
    }
  }
  walk(src)
  return found
}

const pkgs: Pkg[] = []
for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(PACKAGES_DIR, entry.name, "package.json")
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const name: string = manifest.name
  if (!name?.startsWith("@wats/")) continue
  const deps = new Set<string>()
  for (const k of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }))
    if (k.startsWith("@wats/")) deps.add(k)
  // type-only imports don't appear in manifests; the source is the truth
  for (const imp of scanSrcImports(join(PACKAGES_DIR, entry.name)))
    if (imp !== name) deps.add(imp)
  pkgs.push({ name, deps })
}

// ---- declarative layout -----------------------------------------------------
// row 0 = foundations (top). Arrows point dependent -> dependency (upward),
// matching the convention stated on the page.

type Style = "stable" | "experimental" | "internal" | "private"
const LAYOUT: Record<string, { row: number; col: number; style: Style }> = {
  "@wats/persistence":    { row: 0, col: 0, style: "experimental" },
  "@wats/graph":          { row: 0, col: 1, style: "stable" },
  "@wats/types":          { row: 0, col: 2, style: "stable" },
  "@wats/crypto":         { row: 0, col: 3, style: "stable" },
  "@wats/internal-utils": { row: 0, col: 4, style: "internal" },
  "@wats/core":           { row: 1, col: 1.5, style: "stable" },
  "@wats/config":         { row: 1, col: 3.5, style: "experimental" },
  "@wats/http":           { row: 2, col: 2,   style: "stable" },
  "@wats/service":        { row: 3, col: 2.5, style: "experimental" },
  "@wats/testing":        { row: 4, col: 1,   style: "private" },
  "@wats/cli":            { row: 4, col: 3.5, style: "experimental" },
}

const missing = pkgs.filter((p) => !(p.name in LAYOUT)).map((p) => p.name)
if (missing.length) {
  console.error(`gen-depgraph: FAIL — packages missing from layout map: ${missing.join(", ")}`)
  process.exit(1)
}

// ---- geometry ---------------------------------------------------------------

const W = 880
const NODE_W = 150
const NODE_H = 36
const ROW_GAP = 104
const TOP = 28
const COLS = 5
const colX = (c: number) => 24 + (c * (W - 48 - NODE_W)) / (COLS - 1)
const rowY = (r: number) => TOP + r * ROW_GAP
const H = rowY(4) + NODE_H + 64 // + legend strip

type Node = { name: string; x: number; y: number; style: Style }
const nodes = new Map<string, Node>()
for (const [name, l] of Object.entries(LAYOUT))
  nodes.set(name, { name, x: colX(l.col), y: rowY(l.row), style: l.style })

const COLORS: Record<Style, { border: string; text: string; dash?: string }> = {
  stable:       { border: "#25d366", text: "#e6edf3" },
  experimental: { border: "#d6a740", text: "#e6edf3" },
  internal:     { border: "#566273", text: "#8b98a5" },
  private:      { border: "#566273", text: "#8b98a5", dash: "4 3" },
}

// ---- edges ------------------------------------------------------------------
// Anchor fanning: spread each node's outgoing edges across its top edge and
// incoming edges across the target's bottom edge, sorted by horizontal
// direction so curves don't cross at the anchor point.

const outgoing = new Map<string, string[]>()
const incoming = new Map<string, string[]>()
for (const pkg of pkgs) {
  for (const dep of pkg.deps) {
    if (!nodes.has(dep)) continue
    outgoing.set(pkg.name, [...(outgoing.get(pkg.name) ?? []), dep])
    incoming.set(dep, [...(incoming.get(dep) ?? []), pkg.name])
  }
}
const fanX = (node: Node, others: string[]) => {
  // order counterpart nodes left-to-right, assign evenly spaced anchors
  const sorted = [...others].sort(
    (a, b) => nodes.get(a)!.x - nodes.get(b)!.x || a.localeCompare(b),
  )
  const xs = new Map<string, number>()
  const pad = 18
  sorted.forEach((other, i) => {
    const t = sorted.length === 1 ? 0.5 : i / (sorted.length - 1)
    xs.set(other, node.x + pad + t * (NODE_W - 2 * pad))
  })
  return xs
}

let edgePaths = ""
for (const pkg of pkgs.sort((a, b) => a.name.localeCompare(b.name))) {
  const from = nodes.get(pkg.name)!
  const dim = from.style === "private"
  const outX = fanX(from, outgoing.get(pkg.name) ?? [])
  for (const dep of [...pkg.deps].sort()) {
    const to = nodes.get(dep)
    if (!to) continue
    const inX = fanX(to, incoming.get(dep) ?? [])
    const x1 = outX.get(dep) ?? from.x + NODE_W / 2
    const y1 = from.y
    const x2 = inX.get(pkg.name) ?? to.x + NODE_W / 2
    const y2 = to.y + NODE_H
    const bend = Math.min(56, Math.abs(y1 - y2) * 0.45)
    const d = `M ${x1} ${y1} C ${x1} ${y1 - bend}, ${x2} ${y2 + bend}, ${x2} ${y2 + 7}`
    edgePaths += `  <path d="${d}" fill="none" stroke="${dim ? "#2a3340" : "#3b4654"}" stroke-width="1.3" marker-end="url(#arrow${dim ? "-dim" : ""})"/>\n`
  }
}

// ---- nodes ------------------------------------------------------------------

let nodeRects = ""
for (const n of [...nodes.values()]) {
  const c = COLORS[n.style]
  const dash = c.dash ? ` stroke-dasharray="${c.dash}"` : ""
  const label = n.name.replace("@wats/", "")
  nodeRects += `  <g>
    <rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="#11161c" stroke="${c.border}" stroke-width="1.4"${dash}/>
    <text x="${n.x + NODE_W / 2}" y="${n.y + NODE_H / 2 + 4}" text-anchor="middle" fill="${c.text}" font-size="13">${label}</text>
  </g>\n`
}

// ---- legend -----------------------------------------------------------------

const legendY = H - 26
const legend = [
  { label: "foundations-complete", border: "#25d366" },
  { label: "experimental", border: "#d6a740" },
  { label: "internal / private", border: "#566273" },
]
let legendSvg = ""
let lx = 24
for (const item of legend) {
  legendSvg += `  <rect x="${lx}" y="${legendY - 9}" width="14" height="14" rx="3" fill="#11161c" stroke="${item.border}" stroke-width="1.4"/>
  <text x="${lx + 20}" y="${legendY + 3}" fill="#8b98a5" font-size="11.5">${item.label}</text>\n`
  lx += 20 + item.label.length * 6.6 + 28
}
legendSvg += `  <text x="${W - 24}" y="${legendY + 3}" text-anchor="end" fill="#566273" font-size="11.5">generated from package manifests</text>\n`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dependency graph of the @wats packages. Arrows point from dependent package to dependency." font-family="'JetBrains Mono', ui-monospace, monospace">
  <defs>
    <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 8 4 L 0 8 z" fill="#3b4654"/>
    </marker>
    <marker id="arrow-dim" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 8 4 L 0 8 z" fill="#2a3340"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="#0a0e12"/>
${edgePaths}${nodeRects}${legendSvg}</svg>
`

mkdirSync(join(import.meta.dir, "..", "public", "diagrams"), { recursive: true })
writeFileSync(OUT, svg)

const edgeCount = (svg.match(/marker-end/g) ?? []).length
console.log(`gen-depgraph: OK — ${nodes.size} packages, ${edgeCount} edges -> public/diagrams/package-graph.svg`)
