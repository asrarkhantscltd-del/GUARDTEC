import type { ReactNode } from "react"
import { Check, X as XIcon } from "lucide-react"
import { EVAL_SECTIONS, GRADE_META, type Answers, type Grades, type SectionKey, type YesNo, type Grade } from "@/lib/procurement"

const SECTION_ACCENT: Record<SectionKey, string> = {
  A: "#3b82f6", B: "#22c55e", C: "#f59e0b", D: "#8b5cf6", E: "#ef4444",
}

function YesNoToggle({ value, onChange, disabled }: { value: YesNo; onChange?: (v: YesNo) => void; disabled?: boolean }) {
  const btn = (v: "yes" | "no") => {
    const on = value === v
    const onCls = v === "yes" ? "bg-success text-white border-success" : "bg-destructive text-white border-destructive"
    return (
      <button type="button" disabled={disabled} onClick={() => onChange?.(on ? "" : v)} aria-pressed={on}
        className={`flex h-9 min-w-[64px] items-center justify-center gap-1 rounded-md border px-3 text-sm font-semibold transition-colors disabled:cursor-default ${
          on ? onCls : "bg-background text-muted-foreground hover:bg-muted"}`}>
        {v === "yes" ? <Check className="h-3.5 w-3.5" /> : <XIcon className="h-3.5 w-3.5" />}
        {v === "yes" ? "Yes" : "No"}
      </button>
    )
  }
  return <div className="flex shrink-0 gap-1.5">{btn("yes")}{btn("no")}</div>
}

function GradePicker({ value, onChange, disabled }: { value: Grade; onChange?: (g: Grade) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(GRADE_META) as Exclude<Grade, "">[]).map(g => {
        const on = value === g
        return (
          <button key={g} type="button" disabled={disabled} onClick={() => onChange?.(on ? "" : g)} aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-default ${
              on ? GRADE_META[g].cls : "border-border bg-background text-muted-foreground hover:bg-muted"}`}>
            {GRADE_META[g].label}
          </button>
        )
      })}
    </div>
  )
}

export interface EvaluationSectionsProps {
  answers: Answers
  onAnswer?: (section: SectionKey, index: number, v: YesNo) => void
  comments?: Record<string, string>
  onComment?: (key: string, v: string) => void
  commentPlaceholder?: string
  grades?: Grades
  onGrade?: (section: SectionKey, g: Grade) => void
  showGrades?: boolean
  readOnlyAnswers?: boolean
  showReviewerNotes?: boolean
  renderSectionExtra?: (section: SectionKey) => ReactNode
}

export function EvaluationSections({
  answers, onAnswer, comments = {}, onComment, commentPlaceholder = "Optional comments or evidence details",
  grades, onGrade, showGrades, readOnlyAnswers, showReviewerNotes, renderSectionExtra,
}: EvaluationSectionsProps) {
  return (
    <div className="space-y-4">
      {EVAL_SECTIONS.map(s => {
        const answered = answers[s.key].filter(Boolean).length
        return (
          <section key={s.key} className="surface relative p-4 pl-5 sm:p-5 sm:pl-6">
            <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: SECTION_ACCENT[s.key] }} />
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="flex min-w-0 items-center gap-2 font-semibold">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-black text-white" style={{ background: SECTION_ACCENT[s.key] }}>{s.key}</span>
                <span className="truncate">{s.title}</span>
              </h3>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{answered}/3</span>
            </div>
            <ol className="space-y-3">
              {s.questions.map((q, i) => (
                <li key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <p className="text-sm leading-snug">{q}</p>
                  <YesNoToggle value={answers[s.key][i]} disabled={readOnlyAnswers || !onAnswer}
                    onChange={v => onAnswer?.(s.key, i, v)} />
                </li>
              ))}
            </ol>
            {(onComment || comments[s.key]) && (
              onComment && !readOnlyAnswers ? (
                <textarea value={comments[s.key] ?? ""} onChange={e => onComment(s.key, e.target.value)} rows={2}
                  placeholder={commentPlaceholder}
                  className="mt-3 w-full rounded-md border bg-background px-3 py-2 text-sm" />
              ) : comments[s.key] ? (
                <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm"><span className="text-xs font-semibold text-muted-foreground">Supplier comment: </span>{comments[s.key]}</p>
              ) : null
            )}
            {renderSectionExtra?.(s.key)}
            {showGrades && grades && (
              <div className="mt-4 space-y-2 border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grade</p>
                <GradePicker value={grades[s.key]} disabled={!onGrade} onChange={g => onGrade?.(s.key, g)} />
                {showReviewerNotes && onComment && (
                  <textarea value={comments[`${s.key}_reviewer`] ?? ""} onChange={e => onComment(`${s.key}_reviewer`, e.target.value)} rows={2}
                    placeholder="Reviewer notes (internal)" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
