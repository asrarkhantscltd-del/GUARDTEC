import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { api, ApiError } from "@/lib/api"
import { fmtDate } from "@/lib/utils"
import {
  Search, Loader2, Plus, Pencil, Archive, X, Upload, FileSpreadsheet,
  Briefcase, ShieldAlert, UserX,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ComplianceBadge, type ComplianceStatusValue } from "@/components/agency/ComplianceBadge"
import AgencyStaffForm, { type AgencyStaffRecord } from "@/components/agency/AgencyStaffForm"

// AuthContext's User type (contexts/AuthContext.tsx) doesn't carry agency_id
// yet — that's added in the routing/layout integration step right after this
// stage (mirrors the existing `staff_id` field used for the 'staff' role).
// Cast locally rather than editing AuthContext.tsx, which is out of scope
// here.
function useAgencyId(): string {
  const { user } = useAuth()
  return String((user as unknown as { agency_id?: string } | null)?.agency_id ?? "")
}

type CompFilter = "all" | ComplianceStatusValue
const COMP_FILTERS: { key: CompFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "COMPLIANT", label: "Compliant" },
  { key: "ACTION_NEEDED", label: "Action Needed" },
  { key: "EXPIRED", label: "Expired" },
  { key: "INCOMPLETE", label: "Incomplete" },
]
const COMP_COLORS: Record<CompFilter, string> = {
  all:            "bg-secondary text-secondary-foreground",
  COMPLIANT:      "bg-success/15 text-success border border-success/30",
  ACTION_NEEDED:  "bg-warning/15 text-warning border border-warning/30",
  EXPIRED:        "bg-destructive/15 text-destructive border border-destructive/30",
  INCOMPLETE:     "bg-muted text-muted-foreground border border-border",
}

function roleLabel(s: AgencyStaffRecord): string {
  if (s.job_role === "Other" && s.custom_role) return s.custom_role
  return s.job_role
}

interface ImportError { row: number; error: string }

export default function AgencyPortalStaffPage() {
  const agencyId = useAgencyId()
  const [searchParams, setSearchParams] = useSearchParams()

  const [staff, setStaff] = useState<AgencyStaffRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [compFilter, setCompFilter] = useState<CompFilter>("all")

  // Add/Edit drawer
  const [formOpen, setFormOpen] = useState(false)
  const [editingStaff, setEditingStaff] = useState<AgencyStaffRecord | undefined>(undefined)

  // Archive confirm (inline swap, same RowActions convention as StaffPage.tsx)
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)

  // Archived guards panel (read-only — see note below on why there's no restore action)
  const [archivedPanel, setArchivedPanel] = useState(false)
  const [archivedStaff, setArchivedStaff] = useState<AgencyStaffRecord[]>([])
  const [archivedLoading, setArchivedLoading] = useState(false)

  // CSV bulk import
  const [importPanel, setImportPanel] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<ImportError[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadStaff() {
    if (!agencyId) return
    setLoading(true)
    try {
      const res = await api.get<{ ok: boolean; staff: AgencyStaffRecord[] }>(`/api/agencies/${agencyId}/staff`)
      setStaff(Array.isArray(res.staff) ? res.staff : [])
    } catch {
      toast.error("Failed to load cover guards")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStaff() }, [agencyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link from the dashboard's stat tiles: /agency/staff?filter=EXPIRED
  useEffect(() => {
    const filterParam = searchParams.get("filter") as CompFilter | null
    if (!filterParam) return
    if (COMP_FILTERS.some(f => f.key === filterParam)) setCompFilter(filterParam)
    const next = new URLSearchParams(searchParams)
    next.delete("filter")
    setSearchParams(next, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link from the dashboard's "needs attention" list: /agency/staff?edit=<id>
  useEffect(() => {
    const editId = searchParams.get("edit")
    if (!editId || loading || staff.length === 0) return
    const match = staff.find(s => s.id === editId)
    if (match) {
      setEditingStaff(match)
      setFormOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete("edit")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, staff, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() {
    setEditingStaff(undefined)
    setFormOpen(true)
  }

  function openEdit(s: AgencyStaffRecord) {
    setEditingStaff(s)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingStaff(undefined)
    // Cert uploads and unavailability inside the form can change compliance
    // fields that this list needs but doesn't otherwise refetch — reload
    // unconditionally on close, same as the parent list refresh pattern
    // used after any add/edit elsewhere in this app.
    loadStaff()
  }

  async function archiveGuard(id: string) {
    setArchivingId(id)
    try {
      await api.post(`/api/agencies/${agencyId}/staff/${id}/archive`)
      setStaff(prev => prev.filter(s => s.id !== id))
      setConfirmArchiveId(null)
      toast.success("Guard archived")
    } catch {
      toast.error("Network error — could not archive")
    } finally {
      setArchivingId(null)
    }
  }

  async function openArchived() {
    setArchivedPanel(true)
    setArchivedLoading(true)
    try {
      const res = await api.get<{ ok: boolean; staff: AgencyStaffRecord[] }>(`/api/agencies/${agencyId}/staff?status=all`)
      setArchivedStaff((res.staff ?? []).filter(s => s.status === "archived"))
    } catch {
      toast.error("Failed to load archived guards")
    } finally {
      setArchivedLoading(false)
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true)
    setImportErrors([])
    try {
      const res = await api.post<{ ok: boolean; imported_count: number; errors: ImportError[] }>(
        `/api/agencies/${agencyId}/staff/import-csv`, file
      )
      setImportErrors(res.errors ?? [])
      if (res.imported_count > 0) toast.success(`Imported ${res.imported_count} guard${res.imported_count === 1 ? "" : "s"}`)
      if (!res.errors?.length) setImportPanel(false)
      await loadStaff()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import failed — network error")
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const filtered = staff.filter(s => {
    if (!s.name.toLowerCase().includes(search.toLowerCase())) return false
    if (compFilter !== "all" && (s.compliance_status ?? "INCOMPLETE") !== compFilter) return false
    return true
  })

  const compCounts: Record<CompFilter, number> = {
    all: staff.length,
    COMPLIANT: staff.filter(s => s.compliance_status === "COMPLIANT").length,
    ACTION_NEEDED: staff.filter(s => s.compliance_status === "ACTION_NEEDED").length,
    EXPIRED: staff.filter(s => s.compliance_status === "EXPIRED").length,
    INCOMPLETE: staff.filter(s => (s.compliance_status ?? "INCOMPLETE") === "INCOMPLETE").length,
  }

  if (!agencyId) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No agency linked to this account.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Cover Guards</h2>
          <p className="text-muted-foreground text-sm">{staff.length} active guard{staff.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openArchived}
            className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <UserX className="h-4 w-4" />Archived
          </button>
          <button onClick={() => setImportPanel(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <FileSpreadsheet className="h-4 w-4" />Import CSV
          </button>
          <Button onClick={openAdd} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />Add guard
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {COMP_FILTERS.map(({ key, label }) => (
          <button key={key} onClick={() => setCompFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity ${COMP_COLORS[key]} ${
              compFilter === key ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
            }`}>
            {label} ({compCounts[key]})
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by name..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading cover guards...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No cover guards found.</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="hidden sm:table-cell px-4 py-3">Badge</th>
                <th className="px-4 py-3">Compliance</th>
                <th className="hidden md:table-cell px-4 py-3">DBS Expiry</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(s => (
                <tr key={s.id} onClick={() => openEdit(s)} className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Briefcase className="h-3 w-3" />{roleLabel(s)}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-muted-foreground">{s.badge_type || "—"}</td>
                  <td className="px-4 py-3"><ComplianceBadge status={s.compliance_status} /></td>
                  <td className="hidden md:table-cell px-4 py-3 text-muted-foreground">{fmtDate(s.dbs_expiry)}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {confirmArchiveId === s.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => archiveGuard(s.id)} disabled={archivingId === s.id}
                          className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-white hover:bg-destructive/90 disabled:opacity-50">
                          {archivingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                        </button>
                        <button onClick={() => setConfirmArchiveId(null)} className="rounded-md border px-2 py-1 text-[10px] hover:bg-muted">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => openEdit(s)} title="Edit"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setConfirmArchiveId(s.id)} title="Archive guard"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            Showing {filtered.length} of {staff.length}
          </div>
        </div>
      )}

      {/* ── Add/Edit drawer ── */}
      {formOpen && (
        <AgencyStaffForm
          agencyId={agencyId}
          initialStaff={editingStaff}
          onCancel={closeForm}
          onSaved={() => closeForm()}
        />
      )}

      {/* ── CSV Import panel ── */}
      {importPanel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">Bulk import cover guards</h2>
              <p className="text-xs text-muted-foreground">Upload a CSV or Excel file</p>
            </div>
            <button onClick={() => setImportPanel(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                Expected columns (any casing/spacing): <strong>name</strong>, <strong>job_role</strong> (or "role"),
                custom_role, badge_type, email, phone, nationality, dbs_expiry (or "dbs expiry date").
                Every field is sanitised against Excel formula injection before it's stored.
              </p>
              <label className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors hover:bg-muted/30 ${importing ? "pointer-events-none opacity-50" : ""}`}>
                {importing ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
                <span className="text-sm font-medium">{importing ? "Importing…" : "Click to choose a file"}</span>
                <span className="text-xs text-muted-foreground">.csv, .xlsx</span>
                <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f) }} />
              </label>

              {importErrors.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                    <ShieldAlert className="h-3.5 w-3.5" />{importErrors.length} row{importErrors.length === 1 ? "" : "s"} skipped
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border divide-y text-xs">
                    {importErrors.map((e, i) => (
                      <div key={i} className="px-3 py-1.5 flex gap-2">
                        <span className="font-medium text-muted-foreground shrink-0">Row {e.row}</span>
                        <span className="text-destructive">{e.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
        </div>
      )}

      {/* ── Archived guards panel (read-only) ── */}
      {archivedPanel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <UserX className="h-4 w-4 text-muted-foreground" />Archived Guards
              </h2>
              <p className="text-xs text-muted-foreground">
                Soft-deleted only — history is preserved for past deployments and acknowledgment records.
              </p>
            </div>
            <button onClick={() => setArchivedPanel(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5">
              {archivedLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
                </div>
              ) : archivedStaff.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No archived guards.
                </div>
              ) : (
                <div className="space-y-2">
                  {archivedStaff.map(s => (
                    <div key={s.id} className="surface rounded-lg border bg-card px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{s.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {roleLabel(s)}{s.archived_at ? ` · Archived ${fmtDate(s.archived_at)}` : ""}
                          </p>
                        </div>
                        <ComplianceBadge status={s.compliance_status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </div>
      )}
    </div>
  )
}
