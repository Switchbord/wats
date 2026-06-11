// Copies the playground's large binary assets into public/playground/ at build
// time so they don't bloat git. The wasm (14MB) ships from the pinned
// esbuild-wasm dep; the SDK bundle + types are produced by playground-build's
// bundle.ts (committed, regenerated when @wats/* bumps).
import { existsSync } from "node:fs"
import { cp } from "node:fs/promises"

const wasmSrc = "node_modules/esbuild-wasm/esbuild.wasm"
const wasmDest = "public/playground/esbuild.wasm"

if (!existsSync(wasmSrc)) {
  console.error(`gen-playground-assets: FAIL — ${wasmSrc} not found (run bun install)`)
  process.exit(1)
}
await cp(wasmSrc, wasmDest)
console.log(`gen-playground-assets: OK — copied esbuild.wasm -> ${wasmDest}`)

for (const f of ["public/playground/wats-bundle.js", "public/playground/wats-types.d.ts", "public/playground/runner.html"]) {
  if (!existsSync(f)) {
    console.error(`gen-playground-assets: FAIL — ${f} missing (run playground-build/bundle.ts)`)
    process.exit(1)
  }
}
console.log("gen-playground-assets: OK — bundle, types, runner present")
