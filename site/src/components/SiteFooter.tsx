// Footer. Copy governed by VOICE.md — every line earns its place.

const linkClass =
  "text-info transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-bg">
      <div className="mx-auto max-w-[1152px] space-y-2 px-4 py-8 text-sm text-text-muted">
        <p>
          Status taxonomy:{" "}
          <span className="mono">live-validated / shape-only / planned</span> —{" "}
          <a href="/docs/parity" className={linkClass}>
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
            className={linkClass}
          >
            GitHub
          </a>{" "}
          ·{" "}
          <a
            href="https://www.npmjs.com/org/wats"
            rel="noreferrer"
            target="_blank"
            className={linkClass}
          >
            npm (@wats)
          </a>{" "}
          · No analytics, no telemetry, no cookies.
        </p>
      </div>
    </footer>
  )
}
