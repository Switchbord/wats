// Footer copy verbatim from 04-content.md §8.
// Plain <a> links for now — /docs/parity may not exist yet.

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-bg">
      <div className="mx-auto max-w-[1152px] space-y-2 px-4 py-8 text-sm text-text-muted">
        <p>wats — WhatsApp Cloud API toolkit for TypeScript. Alpha software.</p>
        <p>
          Status taxonomy:{" "}
          <span className="mono">live-validated / shape-only / planned</span> —{" "}
          <a
            href="/docs/parity"
            className="text-info transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            see parity
          </a>
          .
        </p>
        <p className="mono text-xs">
          MIT ·{" "}
          <a
            href="https://github.com/Switchbord/wats"
            rel="noreferrer"
            target="_blank"
            className="text-info transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            GitHub
          </a>{" "}
          ·{" "}
          <a
            href="https://www.npmjs.com/org/wats"
            rel="noreferrer"
            target="_blank"
            className="text-info transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            npm (@wats)
          </a>{" "}
          · No analytics, no telemetry, no cookies.
        </p>
      </div>
    </footer>
  )
}
