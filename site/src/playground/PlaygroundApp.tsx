import { javascript } from "@codemirror/lang-javascript"
import { EditorState } from "@codemirror/state"
import { oneDark } from "@codemirror/theme-one-dark"
import { EditorView, keymap } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import * as esbuild from "esbuild-wasm"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_SCENARIO_ID,
  findScenario,
  SCENARIOS,
  type Scenario,
} from "./scenarios"
import { decodeShareHash, encodeShareHash, toCurl } from "./share"
import GuidedPanel from "./GuidedPanel"
import LESSONS, { checkStep, findLesson, type Lesson } from "./lessons"

// PlaygroundApp — the interactive playground body. Lazily imported by the
// /playground route so CodeMirror + esbuild-wasm stay out of the landing entry
// chunk (06-playground-spec.md §2). Runs the real published @wats/* SDK inside
// a sandboxed iframe (public/playground/runner.html) against MockTransport;
// connect-src 'none' in the runner CSP is the hard no-network boundary.

const BUNDLE_URL = new URL("/playground/wats-bundle.js", window.location.origin)
  .href
const WASM_URL = "/playground/esbuild.wasm"

// Rewrite every `@wats/<x>` / `@wats/<x>/<sub>` import specifier in the compiled
// output to the placeholder specifier "wats:bundle". The bundle re-exports every
// subpath, so all specifiers collapse to one module. The sandboxed runner (which
// runs at an opaque origin where CSP `script-src 'self'` cannot match our origin)
// swaps "wats:bundle" for a blob: URL built from the bundle source we hand it —
// keeping connect-src 'none' intact (nothing is fetched from inside the sandbox).
const SPECIFIER = /(['"])@wats\/[^'"]+\1/g
function rewriteImports(code: string): string {
  return code.replace(SPECIFIER, (_m, quote: string) => `${quote}wats:bundle${quote}`)
}

// Fetch the SDK bundle source once (same-origin, parent context — allowed). The
// runner can't fetch it itself (opaque origin + connect-src 'none'), so we pass
// the text in and it materializes a blob: module.
let bundleSourcePromise: Promise<string> | null = null
function loadBundleSource(): Promise<string> {
  if (!bundleSourcePromise) {
    bundleSourcePromise = fetch(BUNDLE_URL).then((r) => {
      if (!r.ok) throw new Error(`failed to load SDK bundle (${r.status})`)
      return r.text()
    })
  }
  return bundleSourcePromise
}

type ConsoleEntry = { level: string; text: string }
type RequestEntry = { method: string; path: string; body: string }

// One esbuild init across the whole app; guard against double-initialize (which
// throws). Resolves to the shared singleton once ready.
let esbuildReady: Promise<void> | null = null
function ensureEsbuild(): Promise<void> {
  if (!esbuildReady) {
    esbuildReady = esbuild.initialize({ wasmURL: WASM_URL })
  }
  return esbuildReady
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    fontFamily:
      'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
    overflow: "auto",
  },
  "&.cm-focused": { outline: "none" },
})

interface PaneProps {
  title: string
  count: number
  children: React.ReactNode
}

function Pane({ title, count, children }: PaneProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border last:border-b-0">
      <header className="mono flex items-center justify-between border-b border-border bg-bg-inset px-3 py-2 text-xs text-text-muted">
        <span>{title}</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-text">
          {count}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </section>
  )
}

export default function PlaygroundApp({
  initialScenarioId,
  initialLessonId,
}: {
  initialScenarioId?: string
  initialLessonId?: string
}) {
  const [active, setActive] = useState<Scenario>(() =>
    findScenario(initialScenarioId ?? DEFAULT_SCENARIO_ID),
  )
  const [guidedLesson, setGuidedLesson] = useState<Lesson | null>(() =>
    findLesson(initialLessonId),
  )
  const [guidedStep, setGuidedStep] = useState(0)
  const [stepPassed, setStepPassed] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [updates, setUpdates] = useState<string[]>([])
  const [hasRun, setHasRun] = useState(false)
  const [status, setStatus] = useState<"idle" | "compiling" | "running">("idle")

  const editorHost = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const readyRef = useRef(false)
  // Latest run callback, so the keymap (bound once) always calls current state.
  const runRef = useRef<() => void>(() => {})

  const clearPanes = useCallback(() => {
    setConsoleEntries([])
    setRequests([])
    setUpdates([])
  }, [])

  const run = useCallback(async () => {
    const view = viewRef.current
    const iframe = iframeRef.current
    if (!view || !iframe || !readyRef.current) return
    clearPanes()
    setHasRun(true)
    const source = view.state.doc.toString()
    try {
      setStatus("compiling")
      const [, bundle] = await Promise.all([ensureEsbuild(), loadBundleSource()])
      const result = await esbuild.transform(source, {
        loader: "ts",
        format: "esm",
        target: "es2022",
      })
      const code = rewriteImports(result.code)
      setStatus("running")
      iframe.contentWindow?.postMessage({ type: "wats-run", code, bundle }, "*")
    } catch (err) {
      setStatus("idle")
      const message = err instanceof Error ? err.message : String(err)
      setConsoleEntries((prev) => [
        ...prev,
        { level: "error", text: `compile error: ${message}` },
      ])
    }
  }, [clearPanes])

  useEffect(() => {
    runRef.current = run
  }, [run])

  // Mount the CodeMirror editor once.
  useEffect(() => {
    if (!editorHost.current || viewRef.current) return
    const view = new EditorView({
      parent: editorHost.current,
      state: EditorState.create({
        // ?lesson= deep links start on the lesson's first step seed.
        doc: guidedLesson?.steps[0]?.seed ?? active.source,
        extensions: [
          history(),
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => {
                void runRef.current()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          javascript({ typescript: true }),
          // oneDark only in dark mode; light mode uses CodeMirror's default
          // light highlighting (no extra dependency). Theme is read at mount.
          ...(typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark")
            ? [oneDark]
            : []),
          editorTheme,
          EditorView.lineWrapping,
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-seed the editor whenever the active scenario changes.
  const seedEditor = useCallback((scenario: Scenario) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: scenario.source },
    })
  }, [])

  // Replace the editor contents with arbitrary text (guided-mode step seeds).
  const seedText = useCallback((text: string) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    })
  }, [])

  function selectScenario(scenario: Scenario) {
    setActive(scenario)
    seedEditor(scenario)
    clearPanes()
    setHasRun(false)
    setStatus("idle")
    // Picking a scenario leaves guided mode; one driver at a time.
    setGuidedLesson(null)
    setGuidedStep(0)
    setStepPassed(false)
  }

  function enterGuided(lesson: Lesson) {
    setGuidedLesson(lesson)
    setGuidedStep(0)
    setStepPassed(false)
    const seed = lesson.steps[0]?.seed
    if (seed !== undefined) seedText(seed)
    clearPanes()
    setHasRun(false)
    setStatus("idle")
  }

  function leaveGuided() {
    setGuidedLesson(null)
    setGuidedStep(0)
    setStepPassed(false)
    seedEditor(active)
    clearPanes()
    setHasRun(false)
    setStatus("idle")
  }

  function guidedGo(nextIndex: number) {
    if (!guidedLesson) return
    if (nextIndex < 0 || nextIndex >= guidedLesson.steps.length) return
    setGuidedStep(nextIndex)
    setStepPassed(false)
    const seed = guidedLesson.steps[nextIndex]?.seed
    if (seed !== undefined) seedText(seed)
    clearPanes()
    setHasRun(false)
  }

  // Guided-mode assertion engine. State fed by postMessage lands async, so the
  // 'done' handler can't evaluate inline (stale closures). Instead: when the
  // run settles (status back to idle after a run), check the current step
  // against everything captured.
  useEffect(() => {
    if (!guidedLesson || !hasRun || status !== "idle") return
    const step = guidedLesson.steps[guidedStep]
    if (!step) return
    if (checkStep(step, { consoleEntries, requests, updates })) {
      setStepPassed(true)
    }
  }, [status, hasRun, consoleEntries, requests, updates, guidedLesson, guidedStep])

  function reset() {
    seedEditor(active)
    clearPanes()
    setHasRun(false)
    setStatus("idle")
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    }
  }

  // Restore a shared snippet from the URL hash, once, after the editor mounts.
  useEffect(() => {
    if (!window.location.hash.includes("code=")) return
    let cancelled = false
    void decodeShareHash(window.location.hash).then((payload) => {
      if (cancelled || !payload) return
      if (payload.scenarioId) setActive(findScenario(payload.scenarioId))
      const view = viewRef.current
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: payload.source },
        })
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [shareLabel, setShareLabel] = useState("Share")
  const share = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    const hash = await encodeShareHash(view.state.doc.toString(), active.id)
    const url = `${window.location.origin}${window.location.pathname}${hash}`
    window.history.replaceState(null, "", hash)
    try {
      await navigator.clipboard.writeText(url)
      setShareLabel("copied")
    } catch {
      // Clipboard denied (permissions / non-secure context). The hash is in
      // the address bar; the reader can copy it the old way.
      setShareLabel("link in URL bar")
    }
    setTimeout(() => setShareLabel("Share"), 1600)
  }, [active.id])

  const [copiedCurl, setCopiedCurl] = useState<number | null>(null)
  const copyCurl = useCallback(async (req: RequestEntry, i: number) => {
    try {
      await navigator.clipboard.writeText(toCurl(req.method, req.path, req.body))
      setCopiedCurl(i)
      setTimeout(() => setCopiedCurl(null), 1600)
    } catch {
      // Clipboard blocked; nothing useful to do beyond not pretending.
    }
  }, [])

  // Listen for runner messages. Reject any event not from our iframe window.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const iframe = iframeRef.current
      if (!iframe || ev.source !== iframe.contentWindow) return
      const data = ev.data
      if (!data || typeof data.kind !== "string") return
      switch (data.kind) {
        case "ready":
          readyRef.current = true
          break
        case "console":
          setConsoleEntries((prev) => [
            ...prev,
            {
              level: String(data.level ?? "log"),
              text: Array.isArray(data.args) ? data.args.join(" ") : "",
            },
          ])
          break
        case "request":
          setRequests((prev) => [
            ...prev,
            {
              method: String(data.method ?? "GET"),
              path: String(data.path ?? ""),
              body: String(data.body ?? ""),
            },
          ])
          break
        case "update":
          setUpdates((prev) => [...prev, String(data.update ?? "")])
          break
        case "error":
          setConsoleEntries((prev) => [
            ...prev,
            {
              level: "error",
              text: `${data.name ?? "Error"}: ${data.message ?? ""}`,
            },
          ])
          setStatus("idle")
          break
        case "done":
          setStatus("idle")
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const runLabel = useMemo(() => {
    if (status === "compiling") return "compiling…"
    if (status === "running") return "running…"
    return "Run"
  }, [status])

  const busy = status !== "idle"

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-8">
      {/* Scenario picker */}
      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((scenario) => {
          const isActive = !guidedLesson && scenario.id === active.id
          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => selectScenario(scenario)}
              aria-pressed={isActive}
              title={scenario.teaser}
              className={`mono rounded border px-3 py-1.5 text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${
                isActive
                  ? "border-accent bg-bg-raised text-text"
                  : "border-border text-text-muted hover:border-accent-dim hover:text-text"
              }`}
            >
              {scenario.title}
            </button>
          )
        })}
        {LESSONS.map((lesson) => {
          const isActive = guidedLesson?.id === lesson.id
          return (
            <button
              key={lesson.id}
              type="button"
              onClick={() => (isActive ? leaveGuided() : enterGuided(lesson))}
              aria-pressed={isActive}
              title={lesson.teaser}
              className={`mono rounded border px-3 py-1.5 text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${
                isActive
                  ? "border-accent bg-bg-raised text-text"
                  : "border-border text-text-muted hover:border-accent-dim hover:text-text"
              }`}
            >
              Guided: {lesson.title}
            </button>
          )
        })}
      </div>

      {!guidedLesson && (
        <p className="text-sm leading-relaxed text-text-muted">{active.teaser}</p>
      )}

      {guidedLesson && (
        <GuidedPanel
          lesson={guidedLesson}
          stepIndex={guidedStep}
          stepPassed={stepPassed}
          onNext={() => guidedGo(guidedStep + 1)}
          onPrev={() => guidedGo(guidedStep - 1)}
          onSeed={() => {
            const seed = guidedLesson.steps[guidedStep]?.seed
            if (seed !== undefined) seedText(seed)
          }}
        />
      )}

      {!guidedLesson && active.status === "shape-only" && (
        <div className="mono rounded border border-warn/40 bg-bg-raised px-3 py-2 text-xs text-warn">
          shape-only: request shape implemented, live-validation against Meta
          pending.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="mono rounded border border-accent bg-accent px-4 py-1.5 text-xs font-semibold text-bg-inset transition-colors duration-150 hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {runLabel}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="mono rounded border border-border px-4 py-1.5 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => void share()}
          className="mono rounded border border-border px-4 py-1.5 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          title="Copy a permalink carrying this code in the URL hash. No server involved."
        >
          {shareLabel}
        </button>
        <span className="mono text-xs text-text-muted">Cmd/Ctrl+Enter to run</span>
        <span className="mono ml-auto rounded border border-border bg-bg-inset px-2.5 py-1 text-xs text-text-muted">
          runs locally · no network
        </span>
      </div>

      {/* Editor + panes */}
      <div className="flex min-h-[28rem] flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-[20rem] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised lg:w-[55%]">
          <div ref={editorHost} className="min-h-0 flex-1 overflow-auto" />
        </div>

        <div className="flex min-h-[20rem] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised lg:w-[45%]">
          {!hasRun ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="max-w-xs text-center text-sm leading-relaxed text-text-muted">
                Press Run. The exact request WATS would send to Meta appears
                here, captured by MockTransport.
              </p>
            </div>
          ) : (
            <>
              <Pane title="Console" count={consoleEntries.length}>
                {consoleEntries.length === 0 ? (
                  <p className="mono text-xs text-text-muted">no output</p>
                ) : (
                  <ul className="space-y-1">
                    {consoleEntries.map((entry, i) => (
                      <li
                        key={i}
                        className={`mono whitespace-pre-wrap break-words text-xs ${
                          entry.level === "error"
                            ? "text-danger"
                            : entry.level === "warn"
                              ? "text-warn"
                              : "text-text"
                        }`}
                      >
                        {entry.text}
                      </li>
                    ))}
                  </ul>
                )}
              </Pane>

              <Pane title="Captured Graph requests" count={requests.length}>
                {requests.length === 0 ? (
                  <p className="mono text-xs text-text-muted">none</p>
                ) : (
                  <ul className="space-y-3">
                    {requests.map((req, i) => (
                      <li key={i} className="mono text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-accent">
                            {req.method} {req.path}
                          </span>
                          <button
                            type="button"
                            onClick={() => void copyCurl(req, i)}
                            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
                            title="Copy as curl. Token is a $WATS_TOKEN placeholder; bring your own."
                          >
                            {copiedCurl === i ? "copied" : "copy as curl"}
                          </button>
                        </div>
                        {req.body && (
                          <pre className="mt-1 whitespace-pre-wrap break-words text-text-muted">
                            {req.body}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Pane>

              <Pane title="Typed updates" count={updates.length}>
                {updates.length === 0 ? (
                  <p className="mono text-xs text-text-muted">none</p>
                ) : (
                  <ul className="space-y-3">
                    {updates.map((update, i) => (
                      <li
                        key={i}
                        className="mono whitespace-pre-wrap break-words text-xs text-text"
                      >
                        <pre className="whitespace-pre-wrap break-words">
                          {update}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </Pane>
            </>
          )}
        </div>
      </div>

      {/* Sandboxed runner. allow-scripts WITHOUT allow-same-origin: the frame
          executes at an opaque origin, and its CSP enforces connect-src 'none'. */}
      <iframe
        ref={iframeRef}
        src="/playground/runner.html"
        sandbox="allow-scripts"
        title="wats playground runner"
        className="h-0 w-0 border-0"
        aria-hidden="true"
      />
    </div>
  )
}
