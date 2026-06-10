import { useState, type ReactNode } from "react"

export interface TerminalTab {
  label: string
  content: ReactNode
}

export interface TerminalPanelProps {
  tabs: TerminalTab[]
}

// Terminal chrome per 03-design.md §5: traffic-light dots, tab bar, bg-inset
// body, subtle accent-dim border. Motion budget: 150ms tab transition only.
export function TerminalPanel({ tabs }: TerminalPanelProps) {
  const [active, setActive] = useState(0)

  return (
    <div className="overflow-hidden rounded-lg border border-accent-dim/40 bg-bg-inset">
      <div className="flex items-center gap-3 border-b border-border bg-bg-raised px-3">
        <div aria-hidden="true" className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-accent/70" />
        </div>
        <div role="tablist" className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              role="tab"
              type="button"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`mono px-3 py-2 text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${
                i === active
                  ? "border-b-2 border-accent text-text"
                  : "border-b-2 border-transparent text-text-muted hover:text-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {tabs.map((tab, i) => (
          <div
            key={tab.label}
            role="tabpanel"
            hidden={i !== active}
            className="transition-opacity duration-150"
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  )
}
