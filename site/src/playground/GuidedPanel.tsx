import type { Lesson } from "./lessons"

// GuidedPanel — the step header for guided mode. Pure presentation: the
// assertion engine lives in lessons.ts and runs in PlaygroundApp when a run
// completes. Instruction text renders backtick spans as <code>.

function renderInstruction(text: string) {
  // Split on `code` spans. Odd indices are code, even are plain text.
  const parts = text.split("`")
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        className="mono rounded border border-border bg-bg-inset px-1 py-0.5 text-[11px] text-text"
      >
        {part}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

export interface GuidedPanelProps {
  lesson: Lesson
  stepIndex: number
  stepPassed: boolean
  onNext: () => void
  onPrev: () => void
  onSeed: () => void
}

export default function GuidedPanel({
  lesson,
  stepIndex,
  stepPassed,
  onNext,
  onPrev,
  onSeed,
}: GuidedPanelProps) {
  const step = lesson.steps[stepIndex]
  if (!step) return null
  const last = stepIndex === lesson.steps.length - 1

  return (
    <section className="rounded-lg border border-border bg-bg-raised px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="mono text-xs text-text-muted">
          {lesson.title} · step {stepIndex + 1}/{lesson.steps.length}
        </span>
        <span className="text-sm font-semibold text-text">{step.title}</span>
        <span
          className={`mono ml-auto text-xs ${stepPassed ? "text-accent" : "text-text-muted"}`}
        >
          {stepPassed ? `passed — ${step.passText}` : "not passed — run to check"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">
        {renderInstruction(step.instruction)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {step.seed !== undefined && (
          <button
            type="button"
            onClick={onSeed}
            className="mono rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            seed editor
          </button>
        )}
        <button
          type="button"
          onClick={onPrev}
          disabled={stepIndex === 0}
          className="mono rounded border border-border px-3 py-1 text-xs text-text-muted transition-colors duration-150 hover:border-accent-dim hover:text-text disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!stepPassed || last}
          className="mono rounded border border-accent px-3 py-1 text-xs text-text transition-colors duration-150 hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {last ? "Done" : "Next"}
        </button>
      </div>
    </section>
  )
}
