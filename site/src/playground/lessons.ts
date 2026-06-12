// Guided-mode lesson content + the pure assertion engine. Each step states a
// goal and a machine-checked assertion over the captured run output (console
// entries, Graph requests, typed updates) — the same signals the runner
// already emits. No new runtime surface; checkStep is pure so the CI script
// (scripts/check-playground.ts) can import and validate this file directly.

export interface LessonStep {
  title: string
  instruction: string
  /** Optional editor seed. Steps without a seed keep the current editor contents. */
  seed?: string
  check:
    | {
        kind: "request"
        method?: string
        pathIncludes?: string
        bodyIncludes?: string[]
      }
    | { kind: "console"; includes: string }
    | { kind: "update"; includes: string }
  passText: string
}

export interface Lesson {
  id: string
  title: string
  teaser: string
  steps: LessonStep[]
}

// What checkStep evaluates against — mirrors PlaygroundApp's captured state.
export interface CapturedRun {
  consoleEntries: readonly { level: string; text: string }[]
  requests: readonly { method: string; path: string; body: string }[]
  updates: readonly string[]
}

// Request bodies arrive pretty-printed (runner.html JSON.stringify(..., 2)),
// so body matching compares whitespace-stripped haystack and needle.
const compact = (s: string) => s.replace(/\s+/g, "")

export function checkStep(step: LessonStep, run: CapturedRun): boolean {
  const check = step.check
  switch (check.kind) {
    case "console":
      return run.consoleEntries.some((e) => e.text.includes(check.includes))
    case "update":
      return run.updates.some((u) => u.includes(check.includes))
    case "request":
      return run.requests.some((r) => {
        if (check.method && r.method.toUpperCase() !== check.method.toUpperCase())
          return false
        if (check.pathIncludes && !r.path.includes(check.pathIncludes))
          return false
        if (check.bodyIncludes) {
          const body = compact(r.body)
          for (const needle of check.bodyIncludes) {
            if (!body.includes(compact(needle))) return false
          }
        }
        return true
      })
  }
}

const FIRST_SEND_STEP_1_SEED = `import { GraphClient, PhoneNumberClient } from "@wats/graph"
import { createMockTransport } from "@wats/graph/testing"

// Step 1: construct the pieces. No send yet — prove the wiring runs.
const mock = createMockTransport({
  defaultResponse: {
    status: 200,
    body: { messages: [{ id: "wamid.DEMO_SENT" }] },
  },
})

const graphClient = new GraphClient({
  accessToken: "demo-token",
  apiVersion: "v25.0",
  baseUrl: "https://graph.facebook.com",
  transport: mock.transport,
})

const phone = new PhoneNumberClient({
  graphClient,
  phoneNumberId: "1234567890",
})

console.log("wired")`

export const LESSONS: readonly Lesson[] = [
  {
    id: "first-send",
    title: "Your first send",
    teaser:
      "Four steps from bare wiring to a typed 429 catch. Each step is checked against the captured run.",
    steps: [
      {
        title: "Wire the client",
        instruction:
          "The editor holds a MockTransport, a GraphClient, and a PhoneNumberClient — no send yet. Run it to confirm the wiring executes.",
        seed: FIRST_SEND_STEP_1_SEED,
        check: { kind: "console", includes: "wired" },
        passText: "Wired. The transport is fake; your competence is real.",
      },
      {
        title: "Send a text",
        instruction:
          'Add `await phone.sendText({ to: "15550001111", text: "hello" })` after the client setup, then `report(mock)`. Run it. The exact POST WATS would send to Meta lands in the requests pane.',
        check: {
          kind: "request",
          method: "POST",
          pathIncludes: "/messages",
          bodyIncludes: ['"type":"text"'],
        },
        passText: "One typed call, one captured POST. That is the whole loop.",
      },
      {
        title: "Make it interactive",
        instruction:
          'Swap the text send for buttons: `await phone.sendButtons({ to: "15550001111", bodyText: "pick one", buttons: [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }] })`. Keep `report(mock)`. The captured body changes to an interactive payload.',
        check: {
          kind: "request",
          bodyIncludes: ['"type":"interactive"'],
        },
        passText: "Interactive body captured, typed end to end.",
      },
      {
        title: "Catch the 429",
        instruction:
          'Make the mock answer with a rate limit: set the mock\'s defaultResponse to `{ status: 429, headers: { "retry-after": "30" }, body: { error: { message: "rate limit hit", type: "OAuthException", code: 130429 } } }`. Import `GraphRateLimitError` from `@wats/graph` and wrap the send: `try { await phone.sendText({ to: "15550001111", text: "hello" }) } catch (err) { if (err instanceof GraphRateLimitError) console.log("rate limited, retryAfter=", err.retryAfter) }`. Run it.',
        check: { kind: "console", includes: "rate limited" },
        passText: "Caught by class, not by parsing Meta's prose. retryAfter is a typed field.",
      },
    ],
  },
]

export function findLesson(id: string | undefined | null): Lesson | null {
  if (!id) return null
  return LESSONS.find((l) => l.id === id) ?? null
}

export default LESSONS
