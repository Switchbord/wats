// Status-tag mapping per 03-design.md §2 — THE honesty system.
//   live-validated → accent green  (filled dot)
//   shape-only     → warn amber    (hollow dot)
//   planned        → text-muted    (dashed dot)

export type Status = "live-validated" | "shape-only" | "planned"

export interface StatusTagProps {
  status: Status
  /** Optional visible text override (e.g. "implemented, live-validation pending"); dot keeps the status color. */
  label?: string
}

const STYLES: Record<Status, { dot: string; text: string }> = {
  "live-validated": {
    dot: "bg-accent",
    text: "text-accent",
  },
  "shape-only": {
    dot: "border border-warn bg-transparent",
    text: "text-warn",
  },
  planned: {
    dot: "border border-dashed border-text-muted bg-transparent",
    text: "text-text-muted",
  },
}

export function StatusTag({ status, label }: StatusTagProps) {
  const s = STYLES[status]
  return (
    <span className={`mono inline-flex items-center gap-1.5 text-xs ${s.text}`}>
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${s.dot}`} />
      {label ?? status}
    </span>
  )
}
