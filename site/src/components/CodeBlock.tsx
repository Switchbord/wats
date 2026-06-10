import { useState } from "react"

// TODO(T07/T08): switch to shiki highlight via fumadocs once T03 lands.
// Plain <pre><code> for now — code stays real, copyable text (03-design.md §8).

export interface CodeBlockProps {
  code: string
  lang: string
}

export function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (e.g. insecure context) — fail quietly
    }
  }

  return (
    <div className="relative rounded-lg border border-border bg-bg-raised">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="mono absolute top-2 right-2 rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        {copied ? "copied" : "copy"}
      </button>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-text">
        <code data-lang={lang}>{code}</code>
      </pre>
    </div>
  )
}
