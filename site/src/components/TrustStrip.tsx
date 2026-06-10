export interface TrustStripProps {
  items: string[]
}

// Single mono row, dot separators, wraps on mobile (03-design.md §4 / 04 §4).
export function TrustStrip({ items }: TrustStripProps) {
  return (
    <div className="mono flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-text-muted">
      {items.map((item, i) => (
        <span key={item} className="flex items-center gap-x-3">
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{item}</span>
        </span>
      ))}
    </div>
  )
}
