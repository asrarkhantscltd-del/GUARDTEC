import { useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ChevronLeft, Building2, Mail, Phone, Pencil, Archive, RotateCcw, Plus, X,
  Loader2, Users, CalendarDays, MapPin, ShieldCheck, AlertTriangle, UserX,
  BarChart3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fmtDate } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
// Reuse the sibling agency-portal stage's components rather than re-building
// the guard form / compliance pill a second time — same entity, same rules
// (calculateComplianceStatus, job_role/badge_type conditional certs).
import AgencyStaffForm, { type AgencyStaffRecord } from "@/components/agency/AgencyStaffForm"
import { ComplianceBadge } from "@/components/agency/ComplianceBadge"

// ── Types (mirror the real API responses read directly from server.js —
// snake_case Postgres rows passed straight through, NOT the camelCased shape
// sketched in types/agency.ts; see AgencyStaffForm.tsx's note on the same
// mismatch) ───────────────────────────────────────────────────────────────

interface AgencyDetail {
  id: string
  name: string
  email: string
  phone?: string
  status: "active" | "archived"
  created_at?: string
  archived_at?: string
  notes?: string
}

interface Site { id: string; name: string }

interface DeploymentRow {
  id: string
  agency_id: string
  site_id: string
  event_date: string
  status: "scheduled" | "completed" | "cancelled"
  guard_count?: number | string
  site?: Site | null
}

interface PerformanceData {
  compliance_pct: number
  no_show_rate: number
  incident_count: number
  deployments_count: number
}

const DEPLOYMENT_STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
}

function StatTile({ icon, label, value, colorClass }: { icon: React.ReactNode; label: string; value: string | number; colorClass: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>{icon}</div>
      <div className="mt-3 text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

type TabId = "staff" | "deployments" | "performance"

export default function AgencyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get("tab") as TabId | null) ?? "staff"

  const [agency, setAgency] = useState<AgencyDetail | null>(null)
  const [staff, setStaff] = useState<AgencyStaffRecord[]>([])
  const [deployments, setDeployments] = useState<DeploymentRow[]>([])
  const [performance, setPerformance] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)

  // Edit agency panel
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState("")
  const [archiveBusy, setArchiveBusy] = useState(false)

  // Add/edit guard (AgencyStaffForm handles its own drawer chrome + submit)
  const [staffFormOpen, setStaffFormOpen] = useState(false)
  const [editingStaff, setEditingStaff] = useState<AgencyStaffRecord | undefined>(undefined)
  const [guardArchiveConfirm, setGuardArchiveConfirm] = useState<string | null>(null)
  const [guardArchiving, setGuardArchiving] = useState(false)

  async function load() {
    if (!id) return
    setLoading(true)
    try {
      const [detailRes, depRes, perfRes] = await Promise.allSettled([
        api.get<{ ok: boolean; agency: AgencyDetail; staff: AgencyStaffRecord[] }>(`/api/agencies/${id}`),
        api.get<{ ok: boolean; deployments: DeploymentRow[] }>(`/api/agencies/${id}/deployments`),
        api.get<{ ok: boolean } & PerformanceData>(`/api/admin/agencies/${id}/performance`),
      ])
      if (detailRes.status === "fulfilled") {
        setAgency(detailRes.value.agency)
        setStaff(detailRes.value.staff ?? [])
      } else {
        toast.error("Failed to load agency")
      }
      if (depRes.status === "fulfilled") setDeployments(depRes.value.deployments ?? [])
      if (perfRes.status === "fulfilled") setPerformance(perfRes.value)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  function switchTab(tab: TabId) { setSearchParams({ tab }) }

  // ── Agency edit ──────────────────────────────────────────────────────────
  function openEditAgency() {
    if (!agency) return
    setEditForm({ name: agency.name, email: agency.email, phone: agency.phone ?? "" })
    setEditError(""); setEditOpen(true)
  }

  async function saveAgency() {
    if (!id) return
    if (!editForm.name.trim()) { setEditError("Agency name is required."); return }
    if (!editForm.email.trim()) { setEditError("Agency email is required."); return }
    setEditSaving(true); setEditError("")
    try {
      const res = await api.patch<{ ok: boolean; agency: AgencyDetail }>(`/api/agencies/${id}`, {
        name: editForm.name.trim(), email: editForm.email.trim(), phone: editForm.phone.trim(),
      })
      setAgency(prev => prev ? { ...prev, ...res.agency } : res.agency)
      setEditOpen(false)
      toast.success("Agency updated")
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setEditSaving(false)
    }
  }

  async function toggleAgencyArchive() {
    if (!id || !agency) return
    setArchiveBusy(true)
    try {
      if (agency.status === "active") {
        await api.post(`/api/agencies/${id}/archive`)
        toast.success("Agency archived")
      } else {
        await api.post(`/api/agencies/${id}/reactivate`)
        toast.success("Agency reactivated")
      }
      setAgency(prev => prev ? { ...prev, status: prev.status === "active" ? "archived" : "active" } : prev)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setArchiveBusy(false)
    }
  }

  // ── Guard CRUD (delegated to AgencyStaffForm for add/edit) ──────────────
  function openAddGuard() { setEditingStaff(undefined); setStaffFormOpen(true) }
  function openEditGuard(g: AgencyStaffRecord) { setEditingStaff(g); setStaffFormOpen(true) }
  function closeStaffForm() { setStaffFormOpen(false); setEditingStaff(undefined) }
  function handleStaffSaved(s: AgencyStaffRecord) {
    setStaff(prev => (editingStaff ? prev.map(x => (x.id === s.id ? s : x)) : [...prev, s]))
    closeStaffForm()
  }

  async function archiveGuard(guardId: string) {
    if (!id) return
    setGuardArchiving(true)
    try {
      await api.post(`/api/agencies/${id}/staff/${guardId}/archive`)
      setStaff(prev => prev.filter(s => s.id !== guardId))
      toast.success("Guard archived")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setGuardArchiving(false); setGuardArchiveConfirm(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading agency…
      </div>
    )
  }

  if (!agency) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Agency not found.
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/agencies")}>Back to Agencies</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <button onClick={() => navigate("/admin/agencies")}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-3.5 w-3.5" />Back to Agencies
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-2xl font-bold tracking-tight">{agency.name}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${
              agency.status === "active" ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground border-border"
            }`}>
              {agency.status === "active" ? "Active" : "Archived"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{agency.email}</span>
            {agency.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{agency.phone}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openEditAgency}
            className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />Edit
          </button>
          <button onClick={toggleAgencyArchive} disabled={archiveBusy}
            className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
            {archiveBusy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : agency.status === "active" ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {agency.status === "active" ? "Archive" : "Reactivate"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex w-fit gap-0 rounded-lg border bg-muted/40 p-1">
        {([
          { id: "staff", label: `Cover Guards (${staff.length})`, icon: <Users className="h-3.5 w-3.5" /> },
          { id: "deployments", label: `Deployments (${deployments.length})`, icon: <CalendarDays className="h-3.5 w-3.5" /> },
          { id: "performance", label: "Performance", icon: <BarChart3 className="h-3.5 w-3.5" /> },
        ] as { id: TabId; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.id} onClick={() => switchTab(t.id)}
            className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
              activeTab === t.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Staff tab */}
      {activeTab === "staff" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={openAddGuard} size="sm" className="gap-1.5"><Plus className="h-4 w-4" />Add guard</Button>
          </div>
          {staff.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No cover guards registered yet.
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="hidden sm:table-cell px-4 py-3">Badge</th>
                    <th className="hidden sm:table-cell px-4 py-3">DBS Expiry</th>
                    <th className="px-4 py-3">Compliance</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {staff.map(g => (
                    <tr key={g.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{g.name}</td>
                      <td className="px-4 py-3">{g.job_role === "Other" ? (g.custom_role || "Other") : g.job_role}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-muted-foreground">{g.badge_type || "—"}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-muted-foreground">{fmtDate(g.dbs_expiry)}</td>
                      <td className="px-4 py-3"><ComplianceBadge status={g.compliance_status} /></td>
                      <td className="px-4 py-3">
                        {guardArchiveConfirm === g.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => archiveGuard(g.id)} disabled={guardArchiving}
                              className="rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-white hover:bg-destructive/90 disabled:opacity-50">
                              {guardArchiving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                            </button>
                            <button onClick={() => setGuardArchiveConfirm(null)}
                              className="rounded-md border px-2 py-1 text-[10px] hover:bg-muted">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => openEditGuard(g)} title="Edit"
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setGuardArchiveConfirm(g.id)} title="Archive"
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <UserX className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Deployments tab — read-only here; deployments are created from the
          agency's own login (AgencyPortalDeploymentsPage), matching the
          plan's Admin vs Agency Admin UI split. */}
      {activeTab === "deployments" && (
        deployments.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No deployments booked yet. Deployments are created from the agency's own login.
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">Event date</th>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Guards</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {deployments.map(d => (
                  <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">{fmtDate(d.event_date)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{d.site?.name ?? d.site_id}</span>
                    </td>
                    <td className="px-4 py-3">{Number(d.guard_count ?? 0)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium border capitalize ${DEPLOYMENT_STATUS_STYLE[d.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Performance tab */}
      {activeTab === "performance" && (
        performance ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={<ShieldCheck className="h-5 w-5" />} label="Compliance rate" value={`${performance.compliance_pct}%`}
              colorClass="bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400" />
            <StatTile icon={<AlertTriangle className="h-5 w-5" />} label="No-show rate" value={`${performance.no_show_rate}%`}
              colorClass={performance.no_show_rate > 0
                ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                : "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400"} />
            <StatTile icon={<AlertTriangle className="h-5 w-5" />} label="Logged incidents" value={performance.incident_count}
              colorClass="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400" />
            <StatTile icon={<CalendarDays className="h-5 w-5" />} label="Total deployments" value={performance.deployments_count}
              colorClass="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Performance data unavailable.</p>
        )
      )}

      {/* Edit agency panel */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setEditOpen(false)} />
          <div className="flex h-full w-full max-w-md flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Edit agency</h2>
              <button onClick={() => setEditOpen(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {editError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{editError}</p>}
              <div className="space-y-1.5">
                <Label>Agency name *</Label>
                <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input type="tel" value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 border-t px-6 py-4">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={saveAgency} disabled={editSaving}>
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add/edit guard — delegated entirely to the shared AgencyStaffForm */}
      {staffFormOpen && id && (
        <AgencyStaffForm agencyId={id} initialStaff={editingStaff} onSaved={handleStaffSaved} onCancel={closeStaffForm} />
      )}
    </div>
  )
}
