import meta from "../generated/meta.json"

// Top nav per 05-information-architecture.md §1:
//   wats_   Docs   Playground   Parity   GitHub↗   [v0.3.26 badge → npm]
// Plain <a> links for now — /docs, /playground, /docs/parity may not exist
// yet; swap to router Links once those routes land.

const LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "Playground", href: "/playground" },
  { label: "Parity", href: "/docs/parity" },
] as const

const linkClass =
  "text-sm text-text-muted transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"

export function SiteNav() {
  return (
    <nav className="border-b border-border bg-bg">
      <div className="mx-auto flex h-14 max-w-[1152px] items-center justify-between px-4">
        <a href="/" className="mono text-lg font-semibold text-text focus-visible:outline-2 focus-visible:outline-accent">
          wats<span className="text-accent">_</span>
        </a>
        <div className="flex items-center gap-5">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/Switchbord/wats"
            rel="noreferrer"
            target="_blank"
            className={linkClass}
          >
            GitHub<span aria-hidden="true">↗</span>
          </a>
          <a
            href="https://www.npmjs.com/org/wats"
            rel="noreferrer"
            target="_blank"
            className="mono rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            v{meta.version}
          </a>
        </div>
      </div>
    </nav>
  )
}
