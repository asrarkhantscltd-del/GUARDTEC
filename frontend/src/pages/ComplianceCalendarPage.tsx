import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api"
import { daysUntil, formatDate } from "@/lib/utils"
import {
  CalendarDays, Plus, Pencil, Trash2, X, CheckCircle2,
  Mail, Repeat, StickyNote, List, ChevronLeft, ChevronRight, Lock, Link2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarItem {
  id: string
  title: string
  description: string
  responsible_email: string
  due_date: string | null
  recurrence_unit: "none" | "week" | "month"
  recurrence_value: number
  notes: string
}

const BLANK_ITEM: CalendarItem = {
  id: "", title: "", description: "", responsible_email: "",
  due_date: "", recurrence_unit: "none", recurrence_value: 0, notes: "",
}

// ── Recurrence presets ──────────────────────────────────────────────────────
// Generic (unit, value) pair under the hood — this maps it to the friendly
// labels the SharePoint "Compliance Calendar" list already used (Quarterly,
// Twice yearly, etc.) so editors don't have to think in weeks/months.

const RECURRENCE_PRESETS = [
  { label: "One-off",      unit: "none" as const,  value: 0 },
  { label: "Weekly",       unit: "week" as const,  value: 1 },
  { label: "Monthly",      unit: "month" as const, value: 1 },
  { label: "Quarterly",    unit: "month" as const, value: 3 },
  { label: "Twice yearly", unit: "month" as const, value: 6 },
  { label: "Annual",       unit: "month" as const, value: 12 },
]

function recurrenceLabel(unit: string, value: number): string {
  const preset = RECURRENCE_PRESETS.find((p) => p.unit === unit && p.value === value)
  if (preset) return preset.label
  return unit === "none" ? "One-off" : `Every ${value} ${unit}${value === 1 ? "" : "s"}`
}

// ── Urgency badge — same statusOf/chip pattern as CompliancePage.tsx's
// ExpiryCell, re-thresholded for a 3-day reminder window instead of 30 days.

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

  if (!dueDate) {
    return <span className="text-xs text-muted-foreground italic">No due date set</span>
  }

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

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${chipCls}`}>
      {chipText}
    </span>
  )
}

// ── Task row — shared by both List view and the Calendar view's month panel ──

function TaskRow({ item, index, completingId, onComplete, onEdit, onDelete, onShare }: {
  item: CalendarItem
  index: number
  completingId: string | null
  onComplete: (item: CalendarItem) => void
  onEdit: (item: CalendarItem) => void
  onDelete: (id: string) => void
  onShare: (email: string) => void
}) {
  const emails = item.responsible_email.split(",").map((e) => e.trim()).filter(Boolean)
  const urgency = urgencyOf(daysUntil(item.due_date))
  return (
    <div
      className={`surface surface-hover animate-fade-in-up flex items-start gap-3 p-4 ${
        urgency === "overdue" ? "bg-red-50/50 dark:bg-red-950/10" :
        urgency === "soon"    ? "bg-amber-50/40 dark:bg-amber-950/10" : ""
      }`}
      style={{ animationDelay: `${index * 30}ms` }}>

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
        {item.description && (
          <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {emails.map((email) => (
            <span key={email} className="flex items-center gap-1">
              <Mail className="h-2.5 w-2.5" />{email}
              <button onClick={() => onShare(email)} title={`Copy reminder link for ${email}`}
                className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-primary transition-colors">
                <Link2 className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {item.notes && (
            <span className="flex items-center gap-1 truncate">
              <StickyNote className="h-2.5 w-2.5 shrink-0" />{item.notes}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button onClick={() => onComplete(item)} disabled={completingId === item.id}
          className="flex items-center gap-1 rounded-md border border-success/30 bg-success/5 px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/10 transition-colors disabled:opacity-50">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {completingId === item.id ? "…" : "Complete"}
        </button>
        <button onClick={() => onEdit(item)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onDelete(item.id)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Calendar view — a 12-month grid; click a month to see its due tasks ──────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function itemsInMonth(items: CalendarItem[], year: number, month: number): CalendarItem[] {
  return items.filter((i) => {
    if (!i.due_date) return false
    const d = new Date(i.due_date)
    return d.getUTCFullYear() === year && d.getUTCMonth() === month
  })
}

function MonthGrid({ items, year, onYearChange, selectedMonth, onSelectMonth }: {
  items: CalendarItem[]
  year: number
  onYearChange: (year: number) => void
  selectedMonth: number | null
  onSelectMonth: (month: number | null) => void
}) {
  const todayReal = new Date()
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-3">
        <button onClick={() => onYearChange(year - 1)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold tabular-nums">{year}</p>
        <button onClick={() => onYearChange(year + 1)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {MONTH_NAMES.map((name, m) => {
          const monthItems = itemsInMonth(items, year, m)
          const overdueHere = monthItems.some((i) => urgencyOf(daysUntil(i.due_date)) === "overdue")
          const isCurrentMonth = todayReal.getFullYear() === year && todayReal.getMonth() === m
          const isSelected = selectedMonth === m
          return (
            <button key={name}
              onClick={() => onSelectMonth(isSelected ? null : m)}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                isSelected ? "border-primary bg-primary/10"
                  : isCurrentMonth ? "border-primary/40 bg-primary/5"
                  : "border-border hover:border-muted-foreground"
              }`}>
              <span className="text-sm font-medium">{name}</span>
              <span className={`text-xs ${
                overdueHere ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground"
              }`}>
                {monthItems.length === 0 ? "No tasks" : `${monthItems.length} task${monthItems.length !== 1 ? "s" : ""}`}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Day grid — the actual calendar-with-dates view for the selected month.
// due_date comes back as a plain "YYYY-MM-DD" string; `new Date(...)` on that
// parses as UTC midnight, so every date part here reads via getUTC* to avoid
// a timezone shift landing a task on the wrong day.

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function DayGrid({ items, year, month, selectedDay, onSelectDay }: {
  items: CalendarItem[]
  year: number
  month: number
  selectedDay: number | null
  onSelectDay: (day: number | null) => void
}) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const todayReal = new Date()
  const isCurrentMonthReal = todayReal.getFullYear() === year && todayReal.getMonth() === month

  const itemsByDay: Record<number, CalendarItem[]> = {}
  for (const item of items) {
    if (!item.due_date) continue
    const d = new Date(item.due_date)
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
      const day = d.getUTCDate()
      if (!itemsByDay[day]) itemsByDay[day] = []
      itemsByDay[day].push(item)
    }
  }

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className="rounded-xl border p-3">
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{w}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />
          const dayItems = itemsByDay[day] ?? []
          const worstUrgency = dayItems.reduce<Urgency>((worst, it) => {
            const u = urgencyOf(daysUntil(it.due_date))
            if (u === "overdue" || worst === "overdue") return u === "overdue" ? "overdue" : worst
            if (u === "soon" || worst === "soon") return "soon"
            return worst
          }, "none")
          const isToday = isCurrentMonthReal && todayReal.getDate() === day
          const isSelected = selectedDay === day
          return (
            <button key={day}
              onClick={() => onSelectDay(isSelected ? null : day)}
              className={`flex min-h-[3.5rem] flex-col items-center gap-0.5 rounded-md border p-1 text-left transition-colors ${
                isSelected ? "border-primary bg-primary/10" : isToday ? "border-primary/40" : "border-transparent hover:border-border"
              }`}>
              <span className={`text-xs tabular-nums ${isToday ? "font-bold text-primary" : "text-foreground"}`}>{day}</span>
              {dayItems.length > 0 && (
                <span className={`h-1.5 w-1.5 rounded-full ${
                  worstUrgency === "overdue" ? "bg-red-500" : worstUrgency === "soon" ? "bg-amber-500" : "bg-green-500"
                }`} title={`${dayItems.length} task${dayItems.length !== 1 ? "s" : ""}`} />
              )}
              {dayItems.length > 0 && (
                <span className="text-[9px] leading-tight text-muted-foreground">{dayItems.length}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ComplianceCalendarPage() {
  const [items, setItems]     = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(true)

  const [viewMode, setViewMode] = useState<"list" | "calendar">("list")
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number | null>(() => new Date().getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const [panelOpen, setPanelOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null)
  const [draft, setDraft]     = useState<CalendarItem>(BLANK_ITEM)
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState("")

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  async function loadItems() {
    try {
      const d = await api.get<{ items: CalendarItem[] }>("/api/compliance-calendar")
      setItems(d.items ?? [])
    } catch (err) {
      // A 403 here means the sidebar link was reached directly (typed URL,
      // bookmark, back-button) by someone whose role isn't granted
      // "Compliance Calendar" in Manage Roles — that's an expected,
      // explainable state, not a network failure, so it gets its own screen
      // instead of a generic error toast (same 401/403 split CompliancePage
      // uses at CompliancePage.tsx:106-108).
      if (err instanceof ApiError && err.status === 403) setForbidden(true)
      else toast.error("Failed to load compliance calendar")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadItems() }, [])

  function openAdd() {
    setEditingItem(null); setDraft(BLANK_ITEM); setFormError(""); setPanelOpen(true)
  }
  function openEdit(item: CalendarItem) {
    setEditingItem(item)
    setDraft({ ...item, due_date: item.due_date ? item.due_date.slice(0, 10) : "" })
    setFormError(""); setPanelOpen(true)
  }
  function closePanel() { setPanelOpen(false); setEditingItem(null); setFormError("") }
  function setF<K extends keyof CalendarItem>(f: K, v: CalendarItem[K]) {
    setDraft((d) => ({ ...d, [f]: v }))
  }

  async function saveItem() {
    if (!draft.title.trim()) { setFormError("Title is required"); return }
    setSaving(true); setFormError("")
    try {
      if (editingItem) {
        await api.patch(`/api/compliance-calendar/${editingItem.id}`, draft)
      } else {
        await api.post("/api/compliance-calendar", draft)
      }
      await loadItems(); closePanel()
      toast.success(editingItem ? "Calendar item updated" : "Calendar item added")
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Network error")
    }
    setSaving(false)
  }

  async function deleteItem() {
    if (!deleteId) return
    setDeleteBusy(true)
    try {
      await api.delete(`/api/compliance-calendar/${deleteId}`)
      setDeleteId(null); await loadItems()
      toast.success("Calendar item deleted")
    } catch {
      toast.error("Failed to delete calendar item")
    }
    setDeleteBusy(false)
  }

  async function markComplete(item: CalendarItem) {
    setCompletingId(item.id)
    try {
      await api.post(`/api/compliance-calendar/${item.id}/complete`)
      await loadItems()
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

  async function shareLink(email: string) {
    let url: string
    try {
      const d = await api.post<{ url: string }>("/api/compliance-calendar/share-link", { email })
      url = d.url
    } catch {
      toast.error("Failed to generate share link")
      return
    }
    // Clipboard write can fail independently of link generation (blocked
    // permission, non-secure context, etc.) — the link itself is already
    // valid at this point, so surface it instead of a misleading failure.
    try {
      await navigator.clipboard.writeText(url)
      toast.success(`Reminder link copied for ${email}`)
    } catch {
      toast.message(`Reminder link for ${email}`, { description: url, duration: 15000 })
    }
  }

  const overdueCt = items.filter((i) => urgencyOf(daysUntil(i.due_date)) === "overdue").length
  const soonCt    = items.filter((i) => urgencyOf(daysUntil(i.due_date)) === "soon").length

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-16 text-center">
        <Lock className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">You are not authorized to view this</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Ask a Director to grant you the "Compliance Calendar" permission under Manage Roles.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Compliance Calendar</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} task{items.length !== 1 ? "s" : ""}
            {overdueCt > 0 && <span className="text-red-600 dark:text-red-400"> · {overdueCt} overdue</span>}
            {soonCt > 0 && <span className="text-amber-600 dark:text-amber-400"> · {soonCt} due soon</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <button onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              <CalendarDays className="h-3.5 w-3.5" /> Calendar
            </button>
          </div>
          <Button onClick={openAdd} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> Add task
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No compliance tasks yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Click "Add task" to add your first recurring compliance task.</p>
        </div>
      ) : viewMode === "list" ? (
        /* List view — due-date sorted, to-do style */
        <div className="space-y-2">
          {items.map((item, i) => (
            <TaskRow key={item.id} item={item} index={i} completingId={completingId}
              onComplete={markComplete} onEdit={openEdit} onDelete={(id) => setDeleteId(id)} onShare={shareLink} />
          ))}
        </div>
      ) : (
        /* Calendar view — 12-month grid → day grid (with actual dates) → task list */
        <div className="space-y-4">
          <MonthGrid items={items} year={calendarYear} onYearChange={setCalendarYear}
            selectedMonth={selectedMonth}
            onSelectMonth={(m) => { setSelectedMonth(m); setSelectedDay(null) }} />

          {selectedMonth !== null && (() => {
            const monthItems = itemsInMonth(items, calendarYear, selectedMonth)
            const shownItems = selectedDay !== null
              ? monthItems.filter((it) => it.due_date && new Date(it.due_date).getUTCDate() === selectedDay)
              : monthItems
            return (
              <div className="space-y-3">
                <DayGrid items={items} year={calendarYear} month={selectedMonth}
                  selectedDay={selectedDay} onSelectDay={setSelectedDay} />

                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {selectedDay !== null
                    ? `${selectedDay} ${MONTH_NAMES[selectedMonth]} ${calendarYear}`
                    : `${MONTH_NAMES[selectedMonth]} ${calendarYear}`}
                </p>
                {shownItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No tasks due {selectedDay !== null ? "on this day" : `in ${MONTH_NAMES[selectedMonth]}`}.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {shownItems.map((item, i) => (
                      <TaskRow key={item.id} item={item} index={i} completingId={completingId}
                        onComplete={markComplete} onEdit={openEdit} onDelete={(id) => setDeleteId(id)} onShare={shareLink} />
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          ADD / EDIT PANEL
      ═════════════════════════════════════════════════════════════════════════ */}
      {panelOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">{editingItem ? "Edit task" : "Add compliance task"}</h3>
            <button onClick={closePanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {formError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}

            <div className="space-y-1.5">
              <Label>Task name *</Label>
              <Input value={draft.title} onChange={(e) => setF("title", e.target.value)}
                placeholder="e.g. Site File Audit" />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={draft.description} onChange={(e) => setF("description", e.target.value)}
                placeholder="What this task covers" />
            </div>

            <div className="space-y-1.5">
              <Label>Responsible person(s)</Label>
              <Input value={draft.responsible_email} onChange={(e) => setF("responsible_email", e.target.value)}
                placeholder="name@company.co.uk (comma-separate for more than one)" />
            </div>

            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" value={draft.due_date ?? ""} onChange={(e) => setF("due_date", e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Recurrence</Label>
              <div className="grid grid-cols-3 gap-2">
                {RECURRENCE_PRESETS.map((p) => {
                  const active = draft.recurrence_unit === p.unit && draft.recurrence_value === p.value
                  return (
                    <button key={p.label} type="button"
                      onClick={() => setDraft((d) => ({ ...d, recurrence_unit: p.unit, recurrence_value: p.value }))}
                      className={`rounded-lg border py-2 text-xs font-medium transition-colors ${
                        active ? "border-primary bg-primary/10 text-primary"
                               : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                      }`}>
                      {p.label}
                    </button>
                  )
                })}
              </div>
              {draft.recurrence_unit !== "none" && (
                <p className="text-xs text-muted-foreground">
                  On "Mark Complete", the due date automatically advances to the next {recurrenceLabel(draft.recurrence_unit, draft.recurrence_value).toLowerCase()} cycle.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <textarea value={draft.notes} onChange={(e) => setF("notes", e.target.value)}
                placeholder="Any additional context…" rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-5 py-4">
            <Button variant="outline" className="flex-1" onClick={closePanel}>Cancel</Button>
            <Button className="flex-1" onClick={saveItem} disabled={saving}>
              {saving ? "Saving…" : editingItem ? "Save changes" : "Add task"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Delete task?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {items.find((i) => i.id === deleteId)?.title ?? "This task"} will be permanently removed, including its completion history.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={deleteItem} disabled={deleteBusy}>
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
