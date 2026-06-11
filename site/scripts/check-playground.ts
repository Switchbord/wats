// Playground CI gate. Two jobs, both run against the BUILT artifacts so they
// catch regressions the typecheck can't:
//   1. Sandbox invariants — static assertions on runner.html + PlaygroundApp.tsx
//      (the network boundary and the no-credential rule are load-bearing).
//   2. Scenario execution — transpile each scenario, rewrite @wats/* to the
//      built bundle, run it, and assert it produced the expected signals.
// Exits non-zero on any failure so `bun run check` fails loudly.

const fail: string[] = []
const ok: string[] = []

// ---------------------------------------------------------------------------
// 1. Sandbox invariants
// ---------------------------------------------------------------------------
const runner = await Bun.file("public/playground/runner.html").text()
if (!/connect-src\s+'none'/.test(runner)) fail.push("runner.html: connect-src 'none' missing (network boundary)")
else ok.push("runner.html enforces connect-src 'none'")
if (!/default-src\s+'none'/.test(runner)) fail.push("runner.html: default-src 'none' missing")
else ok.push("runner.html default-src 'none'")

const app = await Bun.file("src/playground/PlaygroundApp.tsx").text()
// iframe must be sandbox=allow-scripts WITHOUT allow-same-origin (opaque origin).
const sandboxMatch = app.match(/sandbox=("|')([^"']*)\1/)
if (!sandboxMatch) fail.push("PlaygroundApp: runner iframe missing sandbox attribute")
else {
  const val = sandboxMatch[2]
  if (!/allow-scripts/.test(val)) fail.push("PlaygroundApp: iframe sandbox lacks allow-scripts")
  else if (/allow-same-origin/.test(val)) fail.push("PlaygroundApp: iframe sandbox has allow-same-origin (breaks opaque origin / CSP isolation)")
  else ok.push("PlaygroundApp iframe sandbox=allow-scripts (no allow-same-origin)")
}
// No token / credential input anywhere in the playground UI.
const playgroundSrc = [app]
for (const f of ["src/playground/scenarios/index.ts"]) {
  try { playgroundSrc.push(await Bun.file(f).text()) } catch {}
}
const credLeak = playgroundSrc.join("\n").match(/type=("|')password\1|name=("|')(token|accessToken|access_token)\2/i)
if (credLeak) fail.push(`PlaygroundApp: credential-shaped input found (${credLeak[0]})`)
else ok.push("no credential input field in playground UI")
// Parent must validate message source.
if (!/\b\w+\.source\s*!==\s*\w*\.?contentWindow/.test(app)) fail.push("PlaygroundApp: missing event.source validation on postMessage handler")
else ok.push("PlaygroundApp validates message event.source")

// ---------------------------------------------------------------------------
// 2. Scenario execution against the built bundle
// ---------------------------------------------------------------------------
const BUNDLE = new URL("../public/playground/wats-bundle.js", import.meta.url).href
const { Transpiler } = await import("bun")
const transpiler = new Transpiler({ loader: "ts", target: "browser" })
const rewrite = (code: string) =>
  code.replace(/(from\s+|import\s*\(\s*)(["'])@wats\/[^"']+\2/g, (_m, pre, q) => `${pre}${q}${BUNDLE}${q}`)

// Expected signal per scenario: [minConsole, minRequests, minUpdates]
const expect: Record<string, [number, number, number]> = {
  "send-a-text": [1, 1, 0],
  "typed-errors": [1, 1, 0],
  "webhook-normalize": [1, 0, 1],
  "route-with-filters": [2, 0, 0],
  "groups": [2, 2, 0],
}

for (const [name, [minC, minR, minU]] of Object.entries(expect)) {
  const src = await Bun.file(`src/playground/scenarios/${name}.ts`).text()
  const js = rewrite(transpiler.transformSync(src))
  let c = 0
  const reqs: unknown[] = []
  let u = 0
  ;(globalThis as any).report = (m: any) => { for (const r of m?.requests ?? []) reqs.push(r) }
  ;(globalThis as any).reportUpdate = () => { u++ }
  const orig = console.log
  console.log = () => { c++ }
  try {
    const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }))
    await import(url)
    URL.revokeObjectURL(url)
    console.log = orig
    const r = reqs.length
    if (c < minC || r < minR || u < minU) {
      fail.push(`scenario ${name}: signals console=${c}/${minC} requests=${r}/${minR} updates=${u}/${minU}`)
    } else {
      ok.push(`scenario ${name} ran (console=${c} requests=${r} updates=${u})`)
    }
  } catch (err) {
    console.log = orig
    fail.push(`scenario ${name} threw: ${err}`)
  }
}

for (const o of ok) console.log(`  ok  ${o}`)
if (fail.length) {
  console.error(`\ncheck-playground: FAIL`)
  for (const f of fail) console.error(`  FAIL ${f}`)
  process.exit(1)
}
console.log(`\ncheck-playground: OK — ${ok.length} assertions passed (sandbox invariants + 5 scenarios)`)
