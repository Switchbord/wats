// Ordered scenario manifest for the playground. `source` is the raw text of
// each scenario module (Vite `?raw`), seeded verbatim into the editor and
// compiled at run time. Keep this list in the order scenarios should appear.
import sendAText from "./send-a-text.ts?raw"
import typedErrors from "./typed-errors.ts?raw"
import webhookNormalize from "./webhook-normalize.ts?raw"
import routeWithFilters from "./route-with-filters.ts?raw"
import groups from "./groups.ts?raw"
import webhookSimulator from "./webhook-simulator.ts?raw"

export interface Scenario {
  readonly id: string
  readonly title: string
  readonly teaser: string
  readonly source: string
  /** Optional maturity flag the UI surfaces as a banner. */
  readonly status?: "shape-only"
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "send-a-text",
    title: "Send a text",
    teaser: "Build a Graph send and capture the exact request to Meta.",
    source: sendAText.trimEnd(),
  },
  {
    id: "typed-errors",
    title: "Typed errors",
    teaser: "A 429 becomes a typed GraphRateLimitError with retryAfter.",
    source: typedErrors.trimEnd(),
  },
  {
    id: "webhook-normalize",
    title: "Normalize a webhook",
    teaser: "Turn a raw Meta envelope into typed, discriminated updates.",
    source: webhookNormalize.trimEnd(),
  },
  {
    id: "route-with-filters",
    title: "Route with filters",
    teaser: "Dispatch updates through a TypedRouter with composable filters.",
    source: routeWithFilters.trimEnd(),
  },
  {
    id: "groups",
    title: "Groups",
    teaser: "Create a group and send a message into it.",
    source: groups.trimEnd(),
    status: "shape-only",
  },
  {
    id: "webhook-simulator",
    title: "Webhook simulator",
    teaser: "A three-entry envelope: two updates dispatched, one skipped with a reason.",
    source: webhookSimulator.trimEnd(),
  },
]

export const DEFAULT_SCENARIO_ID = SCENARIOS[0]!.id

export function findScenario(id: string | undefined | null): Scenario {
  if (id) {
    const match = SCENARIOS.find((s) => s.id === id)
    if (match) return match
  }
  return SCENARIOS[0]!
}
