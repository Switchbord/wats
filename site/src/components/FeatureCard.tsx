import { StatusTag, type Status } from "./StatusTag"

export interface FeatureCardProps {
  title: string
  body: string
  href: string
  /** Optional status tag; omit when the card doesn't need a badge. */
  status?: Status
  /** Optional visible text override for the status tag. */
  statusLabel?: string
}

// 1px border, bg-raised, hover border-accent-dim (T04 spec).
// Plain <a> for now — target routes may not exist yet; router Link in later tasks.
export function FeatureCard({ title, body, href, status, statusLabel }: FeatureCardProps) {
  return (
    <a
      href={href}
      className="block rounded-lg border border-border bg-bg-raised p-5 transition-colors duration-150 hover:border-accent-dim focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-text">{title}</h3>
        {status !== undefined && <StatusTag status={status} label={statusLabel} />}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{body}</p>
    </a>
  )
}
