import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Plus, X, ChevronLeft, ChevronRight, Loader2, MapPin,
  ShieldCheck, ClipboardCheck, MessageSquare, Pencil, CalendarDays,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  DeploymentForm,
  type AgencySite, type AgencyStaffRow, type AgencyDeployment, type DeploymentAssignment,
} from "@/components/agency/DeploymentForm"
import { DeploymentAcknowledgment } from "@/components/agency/DeploymentAcknowledgment"
import { AttendanceConfirmation, type AttendanceRow } from "@/components/agency/AttendanceConfirmation"
import { DeploymentNotes } from "@/components/agency/DeploymentNotes"

// ── Month helpers ────────────────────────────────────────────────────────

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function monthOptions(): { value: string; label: string }[] {
  const now = new Date()
  const opts: { value: string; label: string }[] = []
  for (let i = -6; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    opts.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    })
  }
  return opts
}

function monthRange(monthValue: string): { from: string; to: string } {
  const [y, m] = monthValue.split("-").map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return { from: `${monthValue}-01`, to: `${monthValue}-${String(lastDay).padStart(2, "0")}` }
}

function shiftMonth(monthValue: string, delta: number): string {
  const [y, m] = monthValue.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function calendarCells(monthValue: string): (number | null)[] {
  const [y, m] = monthValue.split("-").map(Number)
  const startWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7 // Monday = 0
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells: (number | null)[] = Array(startWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return cells
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

interface AgencyPortalDeploymentsPageProps {
  // Optional — lets a parent tab container pass the agency explicitly.
  // Falls back to the logged-in agency user's own id when omitted.
  agencyId?: string
}

// Tab 2 of the Agency Portal: month-dropdown calendar of deployments, with
// create/edit, acknowledgment, attendance confirmation and a notes thread
// per deployment.
export default function AgencyPortalDeploymentsPage({ agencyId: agencyIdProp }: AgencyPortalDeploymentsPageProps) {
  const { user } = useAuth()
  // `agency_id` isn't on the AuthContext `User` type yet (added in the
  // integration step alongside AgencyLayout) — read it defensively so this
  // page still compiles and works once that field lands.
  const authAgencyId = (user as unknown as { agency_id?: string } | null)?.agency_id
  const agencyId = agencyIdProp ?? authAgencyId ?? ""

  const [month, setMonth] = useState(currentMonthValue())
  const [deployments, setDeployments] = useState<AgencyDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<AgencySite[]>([])
  const [roster, setRoster] = useState<AgencyStaffRow[]>([])
  const [assignmentsCache, setAssignmentsCache] = useState<Record<string, DeploymentAssignment[]>>({})

  const [formOpen, setFormOpen] = useState(false)
  const [formDeployment, setFormDeployment] = useState<AgencyDeployment | null>(null)
  const [formInitialDate, setFormInitialDate] = useState("")

  const [detail, setDetail] = useState<AgencyDeployment | null>(null)
  const [detailTab, setDetailTab] = useState<"ack" | "attendance" | "notes">("ack")

  async function reloadDeployments() {
    if (!agencyId) return
    setLoading(true)
    const { from, to } = monthRange(month)
    try {
      const d = await api.get<{ ok: boolean; deployments: AgencyDeployment[] }>(
        `/api/agencies/${agencyId}/deployments?date_from=${from}&date_to=${to}`
      )
      setDeployments(d.deployments ?? [])
    } catch {
      toast.error("Failed to load deployments")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reloadDeployments() }, [agencyId, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!agencyId) return
    api.get<{ sites: AgencySite[] }>("/api/sites").then(d => setSites(d.sites ?? [])).catch(() => {})
    api.get<{ ok: boolean; staff: AgencyStaffRow[] }>(`/api/agencies/${agencyId}/staff`)
      .then(d => setRoster(d.staff ?? [])).catch(() => {})
  }, [agencyId])

  const deploymentsByDay = useMemo(() => {
    const map: Record<number, AgencyDeployment[]> = {}
    for (const dep of deployments) {
      const day = Number(dep.event_date.slice(8, 10))
      ;(map[day] ??= []).push(dep)
    }
    return map
  }, [deployments])

  function siteName(dep: AgencyDeployment): string {
    return dep.site?.name ?? sites.find(s => s.id === dep.site_id)?.name ?? "Unknown site"
  }

  function openCreate(dateStr?: string) {
    setFormDeployment(null)
    setFormInitialDate(dateStr ?? "")
    setFormOpen(true)
  }

  function openEdit(dep: AgencyDeployment) {
    setFormDeployment(dep)
    setFormInitialDate("")
    setFormOpen(true)
  }

  function handleFormSaved(deploymentId: string, assignments: DeploymentAssignment[]) {
    setAssignmentsCache(prev => ({ ...prev, [deploymentId]: assignments }))
    setFormOpen(false)
    setFormDeployment(null)
    reloadDeployments()
  }

  function openDetail(dep: AgencyDeployment) {
    setDetail(dep)
    setDetailTab("ack")
  }

  const detailAssignments = detail ? (assignmentsCache[detail.id] ?? []) : []
  const attendanceRows: AttendanceRow[] = detailAssignments.map(a => ({
    agency_staff_id: a.agency_staff_id,
    name: roster.find(r => r.id === a.agency_staff_id)?.name ?? "Unknown guard",
    scheduled_hours: a.scheduled_hours,
  }))
  // deployment_attendance has no GET-by-deployment endpoint yet — see report.
  // Assignments only exist client-side from this session's create/edit call,
  // so a page reload loses them until that endpoint exists.
  const assignmentsUnavailable = !!detail && detail.guard_count! > 0 && detailAssignments.length === 0

  if (!agencyId) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Unable to determine your agency. Please sign in as an agency account.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Deployments</h2>
          <p className="text-sm text-muted-foreground">{deployments.length} deployment{deployments.length !== 1 ? "s" : ""} this month</p>
        </div>
        <Button onClick={() => openCreate()} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New deployment
        </Button>
      </div>

      {/* Month dropdown + nav */}
      <div className="flex items-center gap-2">
        <button onClick={() => setMonth(m => shiftMonth(m, -1))} className="rounded-md border p-1.5 hover:bg-muted transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <select value={month} onChange={e => setMonth(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm">
          {monthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={() => setMonth(m => shiftMonth(m, 1))} className="rounded-md border p-1.5 hover:bg-muted transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Calendar */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading deployments…</span>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-7 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map(w => <div key={w} className="px-2 py-2 text-center">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {calendarCells(month).map((day, i) => {
              const dateStr = day ? `${month}-${String(day).padStart(2, "0")}` : ""
              const dayDeployments = day ? deploymentsByDay[day] ?? [] : []
              return (
                <div key={i} className={`min-h-[92px] border-b border-r p-1.5 ${day ? "hover:bg-muted/20" : "bg-muted/10"}`}>
                  {day && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">{day}</span>
                        <button onClick={() => openCreate(dateStr)} title="New deployment on this day"
                          className="rounded p-0.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground transition-colors">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1 space-y-1">
                        {dayDeployments.map(dep => (
                          <button key={dep.id} onClick={() => openDetail(dep)}
                            className="flex w-full items-center gap-1 truncate rounded bg-primary/10 px-1.5 py-0.5 text-left text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors">
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{siteName(dep)}</span>
                            {dep.guard_count != null && <span className="shrink-0 opacity-70">({dep.guard_count})</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Create / Edit deployment panel ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-semibold">{formDeployment ? "Edit deployment" : "New deployment"}</h2>
            <button onClick={() => setFormOpen(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <DeploymentForm
            agencyId={agencyId}
            sites={sites}
            roster={roster}
            deployment={formDeployment}
            initialAssignments={formDeployment ? assignmentsCache[formDeployment.id] ?? [] : []}
            initialDate={formInitialDate}
            onSaved={handleFormSaved}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      )}

      {/* ── Deployment detail drawer ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="border-b px-6 py-4">
            <div className="mx-auto flex w-full max-w-2xl items-center justify-between">
              <div>
                <h2 className="flex items-center gap-1.5 text-lg font-semibold">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />{siteName(detail)}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {detail.event_date.slice(0, 10)} · {detail.guard_count ?? 0} guard{detail.guard_count === 1 ? "" : "s"} · {detail.status}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(detail)} title="Edit assignment"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => setDetail(null)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="mx-auto mt-3 flex w-full max-w-2xl gap-1 rounded-lg border bg-muted/40 p-1">
              {([
                { id: "ack", label: "Acknowledgment", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
                { id: "attendance", label: "Attendance", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
                { id: "notes", label: "Notes", icon: <MessageSquare className="h-3.5 w-3.5" /> },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setDetailTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    detailTab === t.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5">
            {detailTab === "ack" && (
              <DeploymentAcknowledgment agencyId={agencyId} deployment={detail}
                onAcknowledged={d => { setDetail(d); reloadDeployments() }} />
            )}
            {detailTab === "attendance" && (
              <>
                {assignmentsUnavailable && (
                  <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                    Guard list unavailable after a page reload — reopen this from an Edit right after creating,
                    or add a GET assignments endpoint server-side (see notes to Asrar).
                  </p>
                )}
                {/* AttendanceConfirmation persists each row itself (POST .../attendance) —
                    it already owns its own display state, so the parent has nothing to
                    merge back into assignmentsCache (which only ever tracks
                    agency_staff_id + scheduled_hours, not attendance results). */}
                <AttendanceConfirmation agencyId={agencyId} deploymentId={detail.id}
                  assignments={attendanceRows} onUpdated={() => {}} />
              </>
            )}
            {detailTab === "notes" && (
              <DeploymentNotes agencyId={agencyId} deploymentId={detail.id} currentUserId={user?.id} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
