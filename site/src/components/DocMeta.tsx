interface DocMetaProps {
  /**
   * Capability honesty tag for the documented surface. Closed set:
   * `live-validated` | `shape-only` | `planned`, each optionally suffixed
   * ` — <short reason>`. Stability/maintenance meaning lives in the
   * api-stability policy, not here. Pages with no capability claim omit it.
   * Defined canonically in /docs/meta/api-stability.
   */
  status?: string
  /** ISO date the page was last reviewed. */
  lastReviewed?: string
  /** Which release line / tooling the page applies to. */
  appliesTo?: string
}

// Subtle one-line metadata strip rendered under a doc title. Mirrors the
// status/lastReviewed/applies-to header block the source Markdown docs carried,
// without the LLM-y bullet list. Muted, mono, non-intrusive.
export function DocMeta({ status, lastReviewed, appliesTo }: DocMetaProps) {
  const parts: string[] = []
  if (status) parts.push(status)
  if (appliesTo) parts.push(`applies to ${appliesTo}`)
  if (lastReviewed) parts.push(`reviewed ${lastReviewed}`)
  if (parts.length === 0) return null

  return (
    <p className="mono mt-0 mb-6 text-xs text-fd-muted-foreground">
      {parts.join(' · ')}
    </p>
  )
}
