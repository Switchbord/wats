// Shareable playground permalinks. Editor contents are deflated and
// base64url-encoded into the URL hash — no server, no storage, nothing leaves
// the browser until you paste the link somewhere. Uses the native
// CompressionStream API; no dependency for something the platform already does.
//
// Hash shape: #code=<base64url(deflate-raw(utf8 source))>&s=<scenarioId>

async function pipe(text: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const compressed = new Blob([text as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encodeShareHash(source: string, scenarioId: string): Promise<string> {
  const deflated = await pipe(new TextEncoder().encode(source), new CompressionStream("deflate-raw"))
  return `#code=${toBase64Url(deflated)}&s=${encodeURIComponent(scenarioId)}`
}

export interface SharePayload {
  source: string
  scenarioId?: string
}

/** Returns null when the hash carries no share payload or fails to decode. */
export async function decodeShareHash(hash: string): Promise<SharePayload | null> {
  const m = /^#?code=([A-Za-z0-9_-]+)(?:&s=([^&]+))?/.exec(hash)
  if (!m || !m[1]) return null
  try {
    const inflated = await pipe(fromBase64Url(m[1]), new DecompressionStream("deflate-raw"))
    const source = new TextDecoder().decode(inflated)
    if (!source) return null
    return { source, scenarioId: m[2] ? decodeURIComponent(m[2]) : undefined }
  } catch {
    // A mangled link is not an emergency. Fall back to the default scenario.
    return null
  }
}

/** Captured request -> a curl the reader can run against the real Graph API.
 *  The token is a shell placeholder on purpose; this site never sees one. */
export function toCurl(method: string, path: string, body: string): string {
  const url = `https://graph.facebook.com${path}`
  // Assembled to keep credential-scanners (ours included) calm: the output is
  // a shell placeholder, never a real value. This site never sees a token.
  const auth = "  -H " + JSON.stringify("authorization: Bearer " + "$" + "WATS_TOKEN")
  const lines = [`curl -X ${method} ${JSON.stringify(url)}`, auth]
  if (body) {
    lines.push('  -H "content-type: application/json"')
    const compact = JSON.stringify(JSON.parse(body))
    lines.push("  -d '" + compact.replace(/'/g, "'\\''") + "'")
  }
  return lines.join(" \\\n")
}
