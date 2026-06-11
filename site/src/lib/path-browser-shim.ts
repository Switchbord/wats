// Minimal browser shim for `node:path`, POSIX semantics. fumadocs-core's loader
// does `import path from "node:path"` and calls path.join / path.dirname at
// module-eval (it builds the page tree eagerly). Vite externalizes node:path to
// `undefined` for the browser, which makes those calls throw `(void 0) is not a
// function` and rejects the entry module's top-level await — silently breaking
// client hydration (docs survive only because they're prerendered; the
// playground's lazy chunk hangs forever). This shim provides the handful of
// functions fumadocs actually uses so the browser build resolves cleanly.

function normalizeArray(parts: string[], allowAboveRoot: boolean): string[] {
  const res: string[] = []
  for (const p of parts) {
    if (!p || p === ".") continue
    if (p === "..") {
      if (res.length && res[res.length - 1] !== "..") res.pop()
      else if (allowAboveRoot) res.push("..")
    } else {
      res.push(p)
    }
  }
  return res
}

export function join(...segments: string[]): string {
  const joined = segments.filter((s) => typeof s === "string" && s.length > 0).join("/")
  if (!joined) return "."
  const isAbsolute = joined.charCodeAt(0) === 47 // '/'
  const parts = normalizeArray(joined.split("/"), !isAbsolute)
  let result = parts.join("/")
  if (!result && !isAbsolute) result = "."
  return (isAbsolute ? "/" : "") + result
}

export function dirname(p: string): string {
  if (typeof p !== "string" || p.length === 0) return "."
  const hadRoot = p.charCodeAt(0) === 47
  let end = -1
  let matchedSlash = true
  for (let i = p.length - 1; i >= 1; i--) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i
        break
      }
    } else {
      matchedSlash = false
    }
  }
  if (end === -1) return hadRoot ? "/" : "."
  if (hadRoot && end === 1) return "//"
  return p.slice(0, end)
}

export function basename(p: string, ext?: string): string {
  if (typeof p !== "string") return ""
  const segs = p.split("/").filter(Boolean)
  let base = segs.length ? segs[segs.length - 1]! : ""
  if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length)
  return base
}

export function extname(p: string): string {
  if (typeof p !== "string") return ""
  const base = basename(p)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot) : ""
}

export function resolve(...segments: string[]): string {
  const joined = join(...segments)
  return joined.charCodeAt(0) === 47 ? joined : "/" + joined
}

export function relative(from: string, to: string): string {
  const f = normalizeArray(from.split("/"), false)
  const t = normalizeArray(to.split("/"), false)
  let i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i++
  const up = f.slice(i).map(() => "..")
  return [...up, ...t.slice(i)].join("/")
}

export const sep = "/"
export const delimiter = ":"

const path = { join, dirname, basename, extname, resolve, relative, sep, delimiter }
export default path
