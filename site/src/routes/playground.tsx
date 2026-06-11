import { createFileRoute } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { SiteFooter } from "../components/SiteFooter"
import { SiteNav } from "../components/SiteNav"

// The interactive playground body (CodeMirror + esbuild-wasm + the @wats/*
// runner orchestration) is lazily imported so it never lands in the landing
// entry chunk — landing JS budget is ≤110KB gz (06-playground-spec.md §1/§2).
const PlaygroundApp = lazy(() => import("../playground/PlaygroundApp"))

interface PlaygroundSearch {
  scenario?: string
}

export const Route = createFileRoute("/playground")({
  validateSearch: (search: Record<string, unknown>): PlaygroundSearch => {
    const scenario = search.scenario
    return typeof scenario === "string" ? { scenario } : {}
  },
  component: Playground,
})

function Playground() {
  const { scenario } = Route.useSearch()

  return (
    <main className="flex min-h-screen flex-col bg-bg text-text">
      <SiteNav />
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center px-6 py-24">
            <p className="mono text-sm text-text-muted">loading playground…</p>
          </div>
        }
      >
        <PlaygroundApp initialScenarioId={scenario} />
      </Suspense>
      <SiteFooter />
    </main>
  )
}
