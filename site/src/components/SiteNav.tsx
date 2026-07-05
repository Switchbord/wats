import { useEffect, useRef, useState } from "react"
import meta from "../generated/meta.json"

// Top nav: [menu] wats_ ... Docs Playground Parity GitHub↗ [version → npm].
// The menu button opens a slide-over with the docs sections so the docs tree
// is reachable from the landing page without loading fumadocs-ui out here.

const LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "Playground", href: "/playground" },
  { label: "Parity", href: "/docs/parity" },
] as const

// Static section map — mirrors content/docs/meta.json. Cheap on purpose:
// the landing page must not pay for the fumadocs page tree.
const MENU = [
  {
    heading: "Start here",
    items: [
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Guide", href: "/docs/guide" },
      { label: "Playground", href: "/playground" },
    ],
  },
  {
    heading: "Docs",
    items: [
      { label: "Concepts", href: "/docs/concepts/overview" },
      { label: "Reference", href: "/docs/reference" },
      { label: "Guides", href: "/docs/guides/transport-and-testing" },
      { label: "Migrating from pywa", href: "/docs/guides/migrating-from-pywa" },
      { label: "Capability status", href: "/docs/parity" },
    ],
  },
  {
    heading: "Project",
    items: [
      { label: "API stability", href: "/docs/meta/api-stability" },
      { label: "Release policy", href: "/docs/meta/release-policy" },
      { label: "Roadmap", href: "/docs/meta/roadmap" },
      { label: "Privacy", href: "/docs/meta/privacy" },
      { label: "GitHub", href: "https://github.com/Switchbord/wats" },
      { label: "npm (@wats)", href: "https://www.npmjs.com/org/wats" },
    ],
  },
] as const

const linkClass =
  "text-sm text-text-muted transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"

// Self-contained theme toggle: no React provider on the landing chunk. Reads and
// writes the same localStorage "theme" key next-themes uses on docs routes, and
// toggles the `dark` class + color-scheme directly. The inline script in
// __root.tsx applies the stored choice on first paint.
function ThemeToggle() {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    document.documentElement.style.colorScheme = next ? "dark" : "light"
    document.documentElement.style.backgroundColor = next ? "#0a0e12" : "#f7f8fa"
    try {
      localStorage.setItem("theme", next ? "dark" : "light")
    } catch {
      /* storage unavailable — toggle still applies for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="mono rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {dark ? "light" : "dark"}
    </button>
  )
}

function MenuDrawer({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    panelRef.current?.querySelector("a")?.focus()
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-bg-inset/70"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Site menu"
        className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-border bg-bg-raised p-6"
      >
        <div className="mb-6 flex items-center justify-between">
          <a href="/" className="mono text-lg font-semibold text-text">
            wats<span className="text-accent">_</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="mono rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:border-accent-dim hover:text-text"
          >
            esc
          </button>
        </div>
        {MENU.map((section) => (
          <div key={section.heading} className="mb-6">
            <p className="mono mb-2 text-xs uppercase tracking-wide text-text-muted">
              {section.heading}
            </p>
            <ul className="space-y-1.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    {...(item.href.startsWith("http")
                      ? { rel: "noreferrer", target: "_blank" }
                      : {})}
                    className="block text-sm text-text transition-colors duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SiteNav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="border-b border-border bg-bg">
      <nav
        aria-label="Site"
        className="mx-auto flex h-14 max-w-[1152px] items-center justify-between px-4"
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="mono rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            menu
          </button>
          <a
            href="/"
            className="mono text-lg font-semibold text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            wats<span className="text-accent">_</span>
          </a>
        </div>
        <div className="flex items-center gap-5">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className={`${linkClass} max-sm:hidden`}>
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/Switchbord/wats"
            rel="noreferrer"
            target="_blank"
            className={`${linkClass} max-sm:hidden`}
          >
            GitHub<span aria-hidden="true">↗</span>
          </a>
          <ThemeToggle />
          <a
            href="https://www.npmjs.com/org/wats"
            rel="noreferrer"
            target="_blank"
            className="mono rounded border border-border px-2 py-0.5 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            v{meta.version}
          </a>
        </div>
      </nav>
      {open && <MenuDrawer onClose={() => setOpen(false)} />}
    </header>
  )
}
