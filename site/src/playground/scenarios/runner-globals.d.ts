// Ambient declarations for the playground runner API (06-playground-spec.md §3).
// The sandbox runner (site/public/playground/runner.html) injects these globals
// before a scenario module executes. Declared here so scenarios typecheck as real
// code against the published @wats/* packages without importing a runner module.

import type { MockTransportHandle } from "@wats/graph/testing"
import type { TypedUpdate } from "@wats/core"

declare global {
  /** Surface every Graph request MockTransport captured into the Captured-requests pane. */
  function report(mock: MockTransportHandle): void
  /** Surface a typed update into the Typed-updates pane. */
  function reportUpdate(update: TypedUpdate): void
}

export {}
