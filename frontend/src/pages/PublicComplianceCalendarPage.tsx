import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api"
import { daysUntil, formatDate } from "@/lib/utils"
import { CalendarDays, CheckCircle2, Link2Off, Loader2, Mail, Repeat, StickyNote } from "lucide-react"

// ─────────────────────────────────────────────────────────────────────────
// This page is PUBLIC and UNAUTHENTICATED by design, same reasoning as
// AcknowledgmentFormPage.tsx: the 256-bit token in the URL IS the security
// boundary, not a login session (server.js — compliance_calendar_share_links
// table + the public /api/public/compliance-calendar/:token routes). It must
// never assume a logged-in user and never redirect to /login. Unlike an
// acknowledgment link, this one never expires — it's a standing reminder
// view a responsible person (who may have no GuardTec login at all) is
// meant to revisit repeatedly, not a one-time signature action.
// ─────────────────────────────────────────────────────────────────────────

interface SharedItem {
  id: string
  title: string
  description: string
  due_date: string | null
  recurrence_unit: "none" | "week" | "month"
  recurrence_value: number
  notes: string
}

const RECURRENCE_LABELS: Record<string, string> = {
  "week:1": "Weekly", "month:1": "Monthly", "month:3": "Quarterly",
  "month:6": "Twice yearly", "month:12": "Annual",
}
function recurrenceLabel(unit: string, value: number): string {
  return RECURRENCE_LABELS[`${unit}:${value}`] ?? (unit === "none" ? "One-off" : `Every ${value} ${unit}s`)
}

type Urgency = "overdue" | "soon" | "ok" | "none"
function urgencyOf(days: number | null): Urgency {
  if (days === null) return "none"
  if (days < 0) return "overdue"
  if (days <= 3) return "soon"
  return "ok"
}

function DueBadge({ dueDate }: { dueDate: string | null }) {
  const days = daysUntil(dueDate)
  const urgency = urgencyOf(days)
  if (!dueDate) return <span className="text-xs text-muted-foreground italic">No due date set</span>
  const chipCls =
    urgency === "overdue" ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" :
    urgency === "soon"    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" :
                             "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
  const chipText =
    days === null ? "" :
    days < 0      ? `Overdue ${Math.abs(days)}d` :
    days === 0    ? "Due today" :
    days <= 3     ? `${days}d left` :
                    formatDate(dueDate)
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${chipCls}`}>{chipText}</span>
}

export default function PublicComplianceCalendarPage() {
  const { token } = useParams<{ token: string }>()
  const [email, setEmail] = useState("")
  const [items, setItems] = useState<SharedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [completingId, setCompletingId] = useState<string | null>(null)

  async function load() {
    try {
      const d = await api.get<{ email: string; items: SharedItem[] }>(`/api/public/compliance-calendar/${token}`)
      setEmail(d.email); setItems(d.items ?? [])
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setInvalid(true)
      else toast.error("Could not load your reminders. Check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token])

  async function markComplete(item: SharedItem) {
    setCompletingId(item.id)
    try {
      await api.post(`/api/public/compliance-calendar/${token}/${item.id}/complete`)
      await load()
      toast.success(
        item.recurrence_unit !== "none"
          ? `"${item.title}" marked complete — next due date set`
          : `"${item.title}" marked complete`
      )
    } catch {
      toast.error("Failed to mark complete")
    }
    setCompletingId(null)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (invalid) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <Link2Off className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">This reminder link isn't valid</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It may have been regenerated. Ask GuardTec for a fresh link.
        </p>
      </div>
    )
  }

  const overdueCt = items.filter((i) => urgencyOf(daysUntil(i.due_date)) === "overdue").length
  const soonCt    = items.filter((i) => urgencyOf(daysUntil(i.due_date)) === "soon").length

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-background px-4 py-8 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="font-display text-lg font-bold tracking-tight">Your compliance reminders</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {email} · {items.length} task{items.length !== 1 ? "s" : ""}
          {overdueCt > 0 && <span className="text-red-600 dark:text-red-400"> · {overdueCt} overdue</span>}
          {soonCt > 0 && <span className="text-amber-600 dark:text-amber-400"> · {soonCt} due soon</span>}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">Nothing assigned to you right now</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const urgency = urgencyOf(daysUntil(item.due_date))
            return (
              <div key={item.id}
                className={`surface flex items-start gap-3 p-4 ${
                  urgency === "overdue" ? "bg-red-50/50 dark:bg-red-950/10" :
                  urgency === "soon"    ? "bg-amber-50/40 dark:bg-amber-950/10" : ""
                }`}
                style={{ animationDelay: `${i * 30}ms` }}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <DueBadge dueDate={item.due_date} />
                    {item.recurrence_unit !== "none" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <Repeat className="h-2.5 w-2.5" />{recurrenceLabel(item.recurrence_unit, item.recurrence_value)}
                      </span>
                    )}
                  </div>
                  {item.description && <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>}
                  {item.notes && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <StickyNote className="h-2.5 w-2.5 shrink-0" />{item.notes}
                    </p>
                  )}
                </div>
                <button onClick={() => markComplete(item)} disabled={completingId === item.id}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-success/30 bg-success/5 px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/10 transition-colors disabled:opacity-50">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {completingId === item.id ? "…" : "Complete"}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-4 text-[11px] text-muted-foreground">
        <Mail className="h-3 w-3" /> GuardTec Compliance — this link is just for you, don't need to sign in
      </p>
    </div>
  )
}
