import { createFileRoute } from "@tanstack/react-router"
import { SiteFooter } from "../components/SiteFooter"
import { SiteNav } from "../components/SiteNav"

// Stub route so landing CTAs don't 404. Real playground lands in Phase D (T14+).

export const Route = createFileRoute("/playground")({
  component: Playground,
})

function Playground() {
  return (
    <main className="flex min-h-screen flex-col bg-bg text-text">
      <SiteNav />
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="max-w-md text-center leading-relaxed text-text-muted">
          Playground arrives with Phase D. Meanwhile:{" "}
          <a
            href="/docs/quickstart"
            className="text-accent transition-colors duration-150 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            Quickstart →
          </a>
        </p>
      </div>
      <SiteFooter />
    </main>
  )
}
