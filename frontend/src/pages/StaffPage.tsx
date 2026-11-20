import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { daysUntil, downloadExport } from "@/lib/utils"
import type { StaffMember } from "@/types/staff"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Search, ChevronRight, Loader2, MapPin, Clock, CircleCheck, ShieldCheck, HardHat, FileCheck,
  Building2, Plus, X, UserX, Briefcase, Download,
} from "lucide-react"
import { StatusBadge } from "@/components/ui/status-badge"
import { api } from "@/lib/api"
import { runBulk, reportBulk } from "@/lib/bulk"
import { parseRoles } from "@/components/ui/role-picker"
import { usePermissions } from "@/hooks/usePermissions"
import {
  stagger, type Site, type ViewMode, type SortKey, normDeploy, docStatus, ExpiryCell, DocChip,
  InitialsAvatar, RowActions, DeploySelect, viewButtons, type SectionId, SECTIONS,
} from "./staff-list/shared"
import { useExStaff } from "./staff-list/useExStaff"
import ExStaffPanel from "./staff-list/ExStaffPanel"
import { useAddStaff } from "./staff-list/useAddStaff"
import AddStaffPanel from "./staff-list/AddStaffPanel"


export default function StaffPage() {
  const [staff, setStaff]     = useState<StaffMember[]>([])
  const [sites, setSites]     = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState("")
  const [compFilter, setCompFilter]     = useState("all")
  const [deployFilter, setDeployFilter] = useState("all")
  const [siteFilter, setSiteFilter]     = useState("all")
  const [docFilter, setDocFilter]       = useState("all")
  const [view, setView]       = useState<ViewMode>(() => (localStorage.getItem("staff-view") as ViewMode) ?? "details")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [newSiteName, setNewSiteName]   = useState("")
  const [addingSite, setAddingSite]     = useState(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const exStaffPanel = useExStaff({ reloadStaff })
  const { openExStaff } = exStaffPanel

  async function reloadStaff() {
    try {
      const data = await api.get<StaffMember[]>("/api/staff")
      setStaff(Array.isArray(data) ? data : [])
    } catch {}
  }


  // Quick edit/delete from the Overview rows
  const { can } = usePermissions()
  const canEdit   = can("edit_staff")
  const canDelete = can("delete_staff")
  const [quickDeleteId, setQuickDeleteId] = useState<string | null>(null)
  const [quickDeleting, setQuickDeleting] = useState(false)

  function quickEdit(staffId: string) {
    navigate(`/staff/${staffId}?edit=1`)
  }

  async function quickDelete(staffId: string) {
    setQuickDeleting(true)
    try {
      await api.delete(`/api/staff/${staffId}`)
      setStaff((prev) => prev.filter((s) => s.id !== staffId))
      setQuickDeleteId(null)
      toast.success("Moved to Ex-Staff")
    } catch {
      toast.error("Network error — could not move to Ex-Staff")
    } finally {
      setQuickDeleting(false)
    }
  }

  const addStaff = useAddStaff({ reloadStaff })
  const { openAddStaff } = addStaff

  // Row selection for Excel export + bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMoving, setBulkMoving]   = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(false)

  // Which section tab is active — defaults to Compliance Status if the URL
  // doesn't specify one (e.g. clicking the parent "Staff" nav item)
  const sectionParam = searchParams.get("section") as SectionId | null
  const activeSection: SectionId = sectionParam ?? "compliance"

  function switchSection(id: SectionId) {
    // Each section tab only shows its own filter controls, but `filtered` ANDs
    // every filter together regardless of which tab is active — without this,
    // a filter set in one tab silently keeps narrowing the list after you
    // switch away, with no visible control left on screen to explain why.
    if (id !== "compliance") setCompFilter("all")
    if (id !== "deployment") { setDeployFilter("all"); setSiteFilter("all") }
    if (id !== "documents") setDocFilter("all")
    setSearchParams({ section: id })
  }

  useEffect(() => {
    reloadStaff()
      .finally(() => setLoading(false))
    api.get<{ sites: { id: string; name: string }[] }>("/api/sites")
      .then((d) => setSites(d.sites ?? []))
      .catch(() => {})
  }, [])



  async function updateDeploy(staffId: string, deployStatus: string, currentSite?: string) {
    try {
      await api.patch(`/api/staff/${staffId}/deploy`, { deployStatus, currentSite })
      setStaff((prev) =>
        prev.map((s) =>
          s.id === staffId
            ? { ...s, deployStatus, ...(currentSite !== undefined ? { currentSite } : {}) }
            : s
        )
      )
    } catch {
      toast.error("Network error — could not update deployment")
    }
  }

  async function addSite() {
    const name = newSiteName.trim()
    if (!name) return
    setAddingSite(true)
    try {
      const d = await api.post<{ site: { id: string; name: string } }>("/api/sites", { name })
      setSites((prev) => [...prev, d.site])
      setNewSiteName("")
      toast.success("Site added")
    } finally {
      setAddingSite(false)
    }
  }

  async function removeSite(id: string) {
    try {
      await api.delete(`/api/sites/${id}`)
      setSites((prev) => prev.filter((s) => s.id !== id))
      if (siteFilter === id) setSiteFilter("all")
      toast.success("Site removed")
    } catch {
      toast.error("Network error — could not remove site")
    }
  }


  const filtered = staff.filter((s) => {
    if (!s.name.toLowerCase().includes(search.toLowerCase())) return false
    if (compFilter !== "all" && s.overall !== compFilter) return false
    if (deployFilter !== "all" && normDeploy(s.deployStatus) !== deployFilter) return false
    if (siteFilter !== "all") {
      if (siteFilter === "__none__") {
        if (!(normDeploy(s.deployStatus) === "onsite" && !s.currentSite)) return false
      } else if (s.currentSite !== siteFilter) return false
    }
    if (docFilter === "sia"  && docStatus(s.sia?.expiry) === "ok")  return false
    if (docFilter === "cscs" && docStatus(s.cscs?.expiry) === "ok") return false
    if (docFilter === "rtw"  && docStatus(s.visa?.expiry) === "ok") return false
    return true
  }).sort((a, b) => {
    let cmp = 0
    if (sortKey === "name") cmp = a.name.localeCompare(b.name)
    else if (sortKey === "sia")  cmp = (daysUntil(a.sia?.expiry) ?? Infinity)  - (daysUntil(b.sia?.expiry) ?? Infinity)
    else if (sortKey === "cscs") cmp = (daysUntil(a.cscs?.expiry) ?? Infinity) - (daysUntil(b.cscs?.expiry) ?? Infinity)
    else if (sortKey === "rtw")  cmp = (daysUntil(a.visa?.expiry) ?? Infinity) - (daysUntil(b.visa?.expiry) ?? Infinity)
    return sortDir === "asc" ? cmp : -cmp
  })

  const compCounts = {
    all:     staff.length,
    green:   staff.filter((s) => s.overall === "green").length,
    amber:   staff.filter((s) => s.overall === "amber").length,
    red:     staff.filter((s) => s.overall === "red").length,
    unknown: staff.filter((s) => s.overall === "unknown").length }
  const deployCounts = {
    all:       staff.length,
    onsite:    staff.filter((s) => normDeploy(s.deployStatus) === "onsite").length,
    available: staff.filter((s) => normDeploy(s.deployStatus) === "available").length,
    offduty:   staff.filter((s) => normDeploy(s.deployStatus) === "offduty").length }
  const docCounts = {
    sia:  staff.filter((s) => docStatus(s.sia?.expiry) !== "ok").length,
    cscs: staff.filter((s) => docStatus(s.cscs?.expiry) !== "ok").length,
    rtw:  staff.filter((s) => docStatus(s.visa?.expiry) !== "ok").length }
  function siteCount(id: string) {
    return staff.filter((s) => s.currentSite === id).length
  }

  function toggleSelectId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAllFiltered() {
    const allSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        filtered.forEach((s) => next.delete(s.id))
      } else {
        filtered.forEach((s) => next.add(s.id))
      }
      return next
    })
  }

  function exportStaffReport() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : filtered.map((s) => s.id)
    downloadExport(`/api/staff/export?ids=${ids.join(",")}`, "GuardTec-Staff-Report.xlsx")
      .catch(() => toast.error("Failed to generate report"))
  }

  async function bulkMoveToExStaff() {
    setBulkMoving(true)
    const ids = [...selectedIds]
    const result = await runBulk(ids, async (id) => {
      await api.delete(`/api/staff/${id}`)
      setStaff((prev) => prev.filter((s) => s.id !== id))
    })
    reportBulk(result, "moved to Ex-Staff")
    setBulkMoving(false)
    setBulkConfirm(false)
    setSelectedIds(new Set())
  }

  function goToStaff(id: string) { navigate(`/staff/${id}`) }

  function changeView(v: ViewMode) { setView(v); localStorage.setItem("staff-view", v) }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Staff</h2>
          <p className="text-muted-foreground text-sm">{staff.length} active staff members</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openExStaff}
            className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <UserX className="h-4 w-4" />Ex-Staff
          </button>
          <Button onClick={openAddStaff} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />Add staff
          </Button>
        </div>
      </div>

      {/* ── Section tabs ── */}
      <div className="flex w-fit max-w-full gap-0 overflow-x-auto rounded-lg border bg-muted/40 p-1">
        {SECTIONS.map(({ id, label, icon }) => (
          <button key={id} onClick={() => switchSection(id)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all sm:px-4 ${
              activeSection === id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── Compliance filter ── */}
      {activeSection === "compliance" && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Compliance Status</p>
          <div className="flex flex-wrap gap-2">
            {(["all", "green", "amber", "red", "unknown"] as const).map((f) => {
              const labels: Record<string, string> = {
                all: "All", green: "Compliant", amber: "Action Needed", red: "Expired", unknown: "Incomplete" }
              const colours: Record<string, string> = {
                all:     "bg-secondary text-secondary-foreground",
                green:   "bg-success/15 text-success border border-success/30",
                amber:   "bg-warning/15 text-warning border border-warning/30",
                red:     "bg-destructive/15 text-destructive border border-destructive/30",
                unknown: "bg-muted text-muted-foreground" }
              return (
                <button key={f} onClick={() => setCompFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity ${colours[f]} ${
                    compFilter === f ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
                  }`}>
                  {labels[f]} ({compCounts[f]})
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Deployment + Sites filter ── */}
      {activeSection === "deployment" && (
        <>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Deployment</p>
            <div className="flex flex-wrap gap-2">
              {(["all", "onsite", "available", "offduty"] as const).map((f) => {
                const cfg = {
                  all:       { label: "All",       cls: "bg-secondary text-secondary-foreground",                       icon: null },
                  onsite:    { label: "Onsite",    cls: "bg-success/15 text-success border border-success/30",         icon: <MapPin className="h-3 w-3" /> },
                  available: { label: "Available", cls: "bg-warning/15 text-warning border border-warning/30",         icon: <CircleCheck className="h-3 w-3" /> },
                  offduty:   { label: "Off Duty",  cls: "bg-destructive/15 text-destructive border border-destructive/30", icon: <Clock className="h-3 w-3" /> } } as const
                const { label, cls, icon } = cfg[f]
                return (
                  <button key={f} onClick={() => setDeployFilter(f)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-opacity ${cls} ${
                      deployFilter === f ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
                    }`}>
                    {icon}{label} ({deployCounts[f]})
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> Sites
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setSiteFilter("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium bg-secondary text-secondary-foreground transition-opacity ${
                  siteFilter === "all" ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
                }`}>
                All Sites
              </button>

              {sites.map((site) => (
                <div key={site.id} className="inline-flex items-center gap-0.5">
                  <button onClick={() => setSiteFilter(site.id)}
                    className={`inline-flex items-center gap-1 rounded-l-full px-3 py-1 text-xs font-medium border transition-opacity bg-blue-500/15 text-blue-500 border-blue-500/30 ${
                      siteFilter === site.id ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
                    }`}>
                    <MapPin className="h-3 w-3" />
                    {site.name} ({siteCount(site.id)})
                  </button>
                  <button onClick={() => removeSite(site.id)} title="Remove site"
                    className="rounded-r-full bg-blue-500/10 text-blue-500 border border-blue-500/30 px-1.5 py-1 hover:bg-destructive/20 hover:text-destructive hover:border-destructive/30 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              <div className="inline-flex items-center gap-1">
                <input
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addSite() }}
                  placeholder="Add site..."
                  className="rounded-l-full border border-dashed border-border bg-background px-3 py-1 text-xs focus:outline-none focus:border-ring w-28"
                />
                <button onClick={addSite} disabled={!newSiteName.trim() || addingSite}
                  className="rounded-r-full border border-dashed border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Document Issues filter ── */}
      {activeSection === "documents" && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Document Issues</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setDocFilter("all")}
              className={`rounded-full px-3 py-1 text-xs font-medium bg-secondary text-secondary-foreground transition-opacity ${
                docFilter === "all" ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
              }`}>
              All Documents
            </button>
            {([
              { key: "sia",  label: "SIA Licence",  Icon: ShieldCheck, count: docCounts.sia },
              { key: "cscs", label: "CSCS Card",     Icon: HardHat,     count: docCounts.cscs },
              { key: "rtw",  label: "Right to Work", Icon: FileCheck,   count: docCounts.rtw },
            ] as const).map(({ key, label, Icon, count }) => (
              <button key={key} onClick={() => setDocFilter(key)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-opacity ${
                  docFilter === key
                    ? "opacity-100 ring-2 ring-ring ring-offset-1 bg-destructive/15 text-destructive border-destructive/30"
                    : count > 0
                    ? "opacity-80 hover:opacity-100 bg-destructive/10 text-destructive border-destructive/20"
                    : "opacity-60 hover:opacity-100 bg-muted text-muted-foreground border-border"
                }`}>
                <Icon className="h-3 w-3" />{label} ({count} issues)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Search + View toggles ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-full max-w-sm sm:w-auto sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
          {viewButtons.map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => changeView(mode)} title={label}
              className={`rounded p-1.5 transition-colors ${
                view === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}>
              {icon}
            </button>
          ))}
        </div>
        <button onClick={exportStaffReport}
          className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Download className="h-4 w-4" />
          {selectedIds.size > 0 ? `Export Selected (${selectedIds.size})` : "Export Report"}
        </button>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex-wrap">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} staff selected
          </span>
          <div className="h-4 w-px bg-border" />

          {!bulkConfirm ? (
            <>
              {canDelete && (
                <button
                  onClick={() => setBulkConfirm(true)}
                  className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
                >
                  <UserX className="h-3.5 w-3.5" />
                  Move to Ex-Staff
                </button>
              )}
              <button
                onClick={exportStaffReport}
                className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
              >
                <Download className="h-3.5 w-3.5" />
                Export Selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Clear selection
              </button>
            </>
          ) : (
            <>
              <span className="text-xs font-medium text-destructive">
                Move {selectedIds.size} staff member{selectedIds.size > 1 ? "s" : ""} to Ex-Staff?
              </span>
              <button
                onClick={bulkMoveToExStaff}
                disabled={bulkMoving}
                className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {bulkMoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                {bulkMoving ? "Moving…" : "Yes, move all"}
              </button>
              <button
                onClick={() => setBulkConfirm(false)}
                className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading staff...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No staff found.</div>
      ) : (

        /* ── DETAILS VIEW ── */
        view === "details" ? (
          <div className="rounded-lg border overflow-x-auto">
            {/* Tighter cell padding below `sm` so Name + Compliance + actions fit a phone without side-scrolling. */}
            <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-4 sm:[&_th]:px-4">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))}
                      onChange={(e) => { e.stopPropagation(); toggleSelectAllFiltered() }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border"
                    />
                  </th>
                  <th className="px-4 py-3">
                    <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Name {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                    </button>
                  </th>
                  <th className="px-4 py-3">Compliance</th>
                  <th className="hidden sm:table-cell px-4 py-3">Deployment / Site</th>
                  <th className="hidden sm:table-cell px-4 py-3">
                    <button onClick={() => toggleSort("sia")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      SIA Expiry {sortKey === "sia" ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                    </button>
                  </th>
                  <th className="hidden md:table-cell px-4 py-3">
                    <button onClick={() => toggleSort("cscs")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      CSCS Expiry {sortKey === "cscs" ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                    </button>
                  </th>
                  <th className="hidden lg:table-cell px-4 py-3">
                    <button onClick={() => toggleSort("rtw")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      RTW Expiry {sortKey === "rtw" ? (sortDir === "asc" ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                    </button>
                  </th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((s) => (
                  <tr key={s.id} onClick={() => goToStaff(s.id)}
                    className="hover:bg-muted/30 transition-colors cursor-pointer">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={(e) => { e.stopPropagation(); toggleSelectId(s.id) }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-border"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.overall} /></td>
                    <td className="hidden sm:table-cell px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <DeploySelect staffId={s.id} deployStatus={s.deployStatus} currentSite={s.currentSite}
                        sites={sites} onUpdate={(id, status, site) => updateDeploy(id, status, site)} />
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3"><ExpiryCell date={s.sia?.expiry} /></td>
                    <td className="hidden md:table-cell px-4 py-3"><ExpiryCell date={s.cscs?.expiry} /></td>
                    <td className="hidden lg:table-cell px-4 py-3"><ExpiryCell date={s.visa?.expiry} /></td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <RowActions
                          canEdit={canEdit} canDelete={canDelete}
                          confirming={quickDeleteId === s.id} deleting={quickDeleting}
                          onEdit={() => quickEdit(s.id)}
                          onDeleteClick={() => setQuickDeleteId(s.id)}
                          onConfirmDelete={() => quickDelete(s.id)}
                          onCancelDelete={() => setQuickDeleteId(null)}
                        />
                        <ChevronRight className="h-4 w-4" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              Showing {filtered.length} of {staff.length}
            </div>
          </div>

        /* ── TILES VIEW ── */
        ) : view === "tiles" ? (
          <motion.div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            variants={stagger.container}
            initial="initial"
            animate="animate"
          >
            {filtered.map((s) => (
              <motion.div key={s.id} variants={stagger.item} onClick={() => goToStaff(s.id)}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <InitialsAvatar name={s.name} status={s.overall} size="lg" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  {s.jobRole && (
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <Briefcase className="h-3 w-3 shrink-0 text-muted-foreground" />
                      {parseRoles(s.jobRole).map(r => (
                        <span key={r} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{r}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <StatusBadge status={s.overall} />
                  </div>
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <DeploySelect staffId={s.id} deployStatus={s.deployStatus} currentSite={s.currentSite}
                      sites={sites} onUpdate={(id, status, site) => updateDeploy(id, status, site)} />
                  </div>
                  <div className="mt-1.5 flex gap-1 flex-wrap">
                    <DocChip label="SIA"  date={s.sia?.expiry} />
                    <DocChip label="CSCS" date={s.cscs?.expiry} />
                    <DocChip label="RTW"  date={s.visa?.expiry} />
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>

        /* ── LIST VIEW ── */
        ) : (
          <div className="rounded-lg border divide-y overflow-hidden">
            {filtered.map((s) => (
              <div key={s.id} onClick={() => goToStaff(s.id)}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors">
                <InitialsAvatar name={s.name} status={s.overall} size="sm" />
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                <div onClick={(e) => e.stopPropagation()}>
                  <DeploySelect staffId={s.id} deployStatus={s.deployStatus} currentSite={s.currentSite}
                    sites={sites} onUpdate={(id, status, site) => updateDeploy(id, status, site)} />
                </div>
                <StatusBadge status={s.overall} />
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            ))}
          </div>
        )
      )}

      <AddStaffPanel addStaff={addStaff} navigate={navigate} />

      <ExStaffPanel exStaffPanel={exStaffPanel} />
    </div>
  )
}
