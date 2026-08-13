import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { daysUntil, fmtDate, downloadExport } from "@/lib/utils"
import type { StaffMember } from "@/types/staff"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Search, ChevronRight, Loader2,
  Table2, StretchHorizontal, MapPin, Clock,
  CircleCheck, ShieldCheck, HardHat, FileCheck, Building2, Plus, X,
  BarChart3, FileWarning, UserX, RotateCcw, Archive, Briefcase, Trash2, Download,
} from "lucide-react"
import { StatusBadge } from "@/components/ui/status-badge"


const stagger = {
  container: { animate: { transition: { staggerChildren: 0.05 } } },
  item: {
    initial: { opacity: 0, y: 16, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
  },
}

interface Site {
  id: string
  name: string
  address?: string
}

interface ExStaffMember {
  folderId: string
  name: string
  nationality?: string
  gender?: string
  overall: string
}

type ViewMode = "details" | "tiles"
type SortKey = "name" | "sia" | "cscs" | "rtw"

function normDeploy(raw?: string): "onsite" | "available" | "offduty" | "unknown" {
  const v = (raw ?? "").toLowerCase().replace(/[\s_-]/g, "")
  if (v.includes("onsite") || v.includes("site") || v.includes("deployed")) return "onsite"
  if (v.includes("available") || v.includes("standby")) return "available"
  if (v.includes("off") || v.includes("leave") || v.includes("rest") || v.includes("inactive")) return "offduty"
  return "unknown"
}

function DeployBadge({ raw }: { raw?: string }) {
  const key = normDeploy(raw)
  const map = {
    onsite:    { label: "Onsite",    cls: "bg-success/15 text-success border border-success/30",     Icon: MapPin },
    available: { label: "Available", cls: "bg-warning/15 text-warning border border-warning/30",      Icon: CircleCheck },
    offduty:   { label: "Off Duty",  cls: "bg-destructive/15 text-destructive border border-destructive/30", Icon: Clock },
    unknown:   { label: "—",         cls: "",                                                         Icon: Clock },
  } as const
  const { label, cls, Icon } = map[key]
  if (key === "unknown") return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  )
}

function docStatus(iso?: string): "missing" | "expired" | "expiring" | "ok" {
  if (!iso) return "missing"
  const d = daysUntil(iso)
  if (d === null) return "missing"
  if (d < 0)  return "expired"
  if (d < 91) return "expiring"
  return "ok"
}

function ExpiryCell({ date }: { date?: string }) {
  const days = daysUntil(date)
  if (!date) return <span className="text-muted-foreground text-sm">—</span>
  const colour =
    days === null ? "text-muted-foreground"
    : days < 0   ? "text-destructive font-medium"
    : days < 91  ? "text-warning font-medium"
    : "text-foreground"
  return <span className={`text-sm ${colour}`}>{fmtDate(date)}</span>
}

function DocChip({ label, date }: { label: string; date?: string }) {
  const st = docStatus(date)
  const cfg = {
    missing:  "bg-muted text-muted-foreground",
    expired:  "bg-destructive/15 text-destructive border border-destructive/30",
    expiring: "bg-warning/15 text-warning border border-warning/30",
    ok:       "bg-success/15 text-success border border-success/30",
  } as const
  const suffix = st === "expired" ? " ✕" : st === "expiring" ? " !" : st === "ok" ? " ✓" : " —"
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cfg[st]}`}>{label}{suffix}</span>
}

function InitialsAvatar({ name, status, size = "md" }: { name: string; status: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()
  const bg: Record<string, string> = {
    green:   "bg-success/20 text-success border border-success/30",
    amber:   "bg-warning/20 text-warning border border-warning/30",
    red:     "bg-destructive/20 text-destructive border border-destructive/30",
    unknown: "bg-muted text-muted-foreground border border-border",
  }
  const sz = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-11 w-11 text-sm"
  return (
    <div className={`rounded-full flex items-center justify-center font-semibold shrink-0 ${sz} ${bg[status] ?? bg.unknown}`}>
      {initials}
    </div>
  )
}

// Combined deployment status + site selector (editable inline, local state for instant feedback)
function DeploySelect({
  staffId, deployStatus, currentSite, sites, onUpdate,
}: {
  staffId: string; deployStatus?: string; currentSite?: string; sites: Site[]
  onUpdate: (id: string, status: string, site?: string) => void
}) {
  const [localStatus, setLocalStatus] = useState(() => {
    const n = normDeploy(deployStatus); return n === "unknown" ? "" : n
  })
  useEffect(() => {
    const n = normDeploy(deployStatus); setLocalStatus(n === "unknown" ? "" : n)
  }, [deployStatus])

  const statusCls: Record<string, string> = {
    onsite:    "border-success/40 bg-success/5 text-success",
    available: "border-warning/40 bg-warning/5 text-warning",
    offduty:   "border-destructive/40 bg-destructive/5 text-destructive",
    "":        "border-border bg-background text-muted-foreground",
  }

  function handleStatusChange(val: string) {
    setLocalStatus(val)
    if (val !== "onsite") onUpdate(staffId, val || "unknown")
    // if onsite: wait for site selection before calling onUpdate
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <select
        value={localStatus}
        onChange={(e) => handleStatusChange(e.target.value)}
        className={`rounded border text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring ${statusCls[localStatus] ?? statusCls[""]}`}
      >
        <option value="">— Status —</option>
        <option value="onsite">Onsite</option>
        <option value="available">Available</option>
        <option value="offduty">Off Duty</option>
      </select>
      {localStatus === "onsite" && (
        <select
          value={currentSite ?? ""}
          onChange={(e) => onUpdate(staffId, "onsite", e.target.value)}
          className="rounded border border-success/30 bg-success/5 text-success text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring max-w-[150px]"
        >
          <option value="">— Location —</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}

const viewButtons: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: "details", icon: <Table2 className="h-4 w-4" />,           label: "Table" },
  { mode: "tiles",   icon: <StretchHorizontal className="h-4 w-4" />, label: "Cards" },
]

type SectionId = "compliance" | "deployment" | "documents"

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: "compliance", label: "Compliance Status", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "deployment", label: "Deployment",         icon: <MapPin className="h-3.5 w-3.5" /> },
  { id: "documents",  label: "Document Issues",    icon: <FileWarning className="h-3.5 w-3.5" /> },
]

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

  // Ex-Staff panel
  const [exPanel, setExPanel]         = useState(false)
  const [exStaff, setExStaff]         = useState<ExStaffMember[]>([])
  const [exLoading, setExLoading]     = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [exError, setExError]         = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [permDeleting, setPermDeleting]       = useState(false)

  // Add Staff panel
  const [addPanel, setAddPanel]   = useState(false)
  const [addForm, setAddForm]     = useState({ name: "", jobRole: "", email: "", phone: "", nationality: "" })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError]   = useState("")

  // Row selection for Excel export
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Which section tab is active — defaults to Compliance Status if the URL
  // doesn't specify one (e.g. clicking the parent "Staff" nav item)
  const sectionParam = searchParams.get("section") as SectionId | null
  const activeSection: SectionId = sectionParam ?? "compliance"

  function switchSection(id: SectionId) {
    setSearchParams({ section: id })
  }

  useEffect(() => {
    fetch("/api/staff", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setStaff(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
    fetch("/api/sites", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setSites(d.sites ?? []))
      .catch(() => {})
  }, [])

  async function openExStaff() {
    setExPanel(true); setExLoading(true); setExError("")
    try {
      const r = await fetch("/api/exstaff", { credentials: "include" })
      const d = await r.json()
      setExStaff(Array.isArray(d) ? d : [])
    } catch {
      setExError("Failed to load ex-staff.")
    } finally {
      setExLoading(false)
    }
  }

  async function permanentDelete(folderId: string) {
    setPermDeleting(true); setExError("")
    try {
      const r = await fetch("/api/exstaff/permanent", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ folderId }),
      })
      const d = await r.json()
      if (!d.ok) { setExError(d.error ?? "Delete failed."); return }
      setExStaff(prev => prev.filter(e => e.folderId !== folderId))
      setConfirmDeleteId(null)
    } catch {
      setExError("Network error.")
    } finally {
      setPermDeleting(false)
    }
  }

  async function restoreExStaff(folderId: string) {
    setRestoringId(folderId); setExError("")
    try {
      const r = await fetch("/api/exstaff/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ folderId }),
      })
      const d = await r.json()
      if (!d.ok) { setExError(d.error ?? "Failed to restore."); return }
      setExStaff((prev) => prev.filter((e) => e.folderId !== folderId))
      fetch("/api/staff", { credentials: "include" })
        .then((r2) => r2.json())
        .then((data) => setStaff(Array.isArray(data) ? data : []))
        .catch(() => {})
    } catch {
      setExError("Network error.")
    } finally {
      setRestoringId(null)
    }
  }

  function openAddStaff() {
    setAddForm({ name: "", jobRole: "", email: "", phone: "", nationality: "" })
    setAddError("")
    setAddPanel(true)
  }

  async function handleAddStaff() {
    if (!addForm.name.trim()) { setAddError("Full name is required."); return }
    setAddSaving(true); setAddError("")
    try {
      const r = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name:        addForm.name.trim(),
          jobRole:     addForm.jobRole || undefined,
          email:       addForm.email.trim() || undefined,
          phone:       addForm.phone.trim() || undefined,
          nationality: addForm.nationality.trim() || undefined,
          overall:     "unknown",
        }),
      })
      const d = await r.json()
      if (!d.ok) { setAddError(d.error ?? "Failed to add staff."); setAddSaving(false); return }
      fetch("/api/staff", { credentials: "include" })
        .then((r2) => r2.json())
        .then((data) => setStaff(Array.isArray(data) ? data : []))
        .catch(() => {})
      setAddPanel(false)
      toast.success("Staff member added successfully")
    } catch {
      setAddError("Network error.")
    } finally {
      setAddSaving(false)
    }
  }

  async function updateDeploy(staffId: string, deployStatus: string, currentSite?: string) {
    try {
      const res = await fetch(`/api/staff/${staffId}/deploy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deployStatus, currentSite }),
      })
      if (!res.ok) { toast.error("Failed to update deployment status"); return }
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
      const r = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      })
      const d = await r.json()
      if (d.ok) {
        setSites((prev) => [...prev, d.site])
        setNewSiteName("")
        toast.success("Site added")
      } else {
        toast.error("Failed to add site")
      }
    } finally {
      setAddingSite(false)
    }
  }

  async function removeSite(id: string) {
    try {
      const res = await fetch(`/api/sites/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) { toast.error("Failed to remove site"); return }
      setSites((prev) => prev.filter((s) => s.id !== id))
      if (siteFilter === id) setSiteFilter("all")
      toast.success("Site removed")
    } catch {
      toast.error("Network error — could not remove site")
    }
  }

  function getSiteName(id?: string) {
    if (!id) return null
    return sites.find((s) => s.id === id)?.name ?? null
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
    unknown: staff.filter((s) => s.overall === "unknown").length,
  }
  const deployCounts = {
    all:       staff.length,
    onsite:    staff.filter((s) => normDeploy(s.deployStatus) === "onsite").length,
    available: staff.filter((s) => normDeploy(s.deployStatus) === "available").length,
    offduty:   staff.filter((s) => normDeploy(s.deployStatus) === "offduty").length,
  }
  const docCounts = {
    sia:  staff.filter((s) => docStatus(s.sia?.expiry) !== "ok").length,
    cscs: staff.filter((s) => docStatus(s.cscs?.expiry) !== "ok").length,
    rtw:  staff.filter((s) => docStatus(s.visa?.expiry) !== "ok").length,
  }
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

  function goToStaff(id: string) { navigate(`/staff/${id}`) }

  function changeView(v: ViewMode) { setView(v); localStorage.setItem("staff-view", v) }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Staff</h2>
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
      <div className="flex w-fit gap-0 rounded-lg border bg-muted/40 p-1">
        {SECTIONS.map(({ id, label, icon }) => (
          <button key={id} onClick={() => switchSection(id)}
            className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
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
                all: "All", green: "Compliant", amber: "Action Needed", red: "Expired", unknown: "Incomplete",
              }
              const colours: Record<string, string> = {
                all:     "bg-secondary text-secondary-foreground",
                green:   "bg-success/15 text-success border border-success/30",
                amber:   "bg-warning/15 text-warning border border-warning/30",
                red:     "bg-destructive/15 text-destructive border border-destructive/30",
                unknown: "bg-muted text-muted-foreground",
              }
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
                  offduty:   { label: "Off Duty",  cls: "bg-destructive/15 text-destructive border border-destructive/30", icon: <Clock className="h-3 w-3" /> },
                } as const
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
        <div className="relative flex-1 max-w-sm">
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
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
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
                    <td className="px-4 py-3 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
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
                    <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 truncate">
                      <Briefcase className="h-3 w-3 shrink-0" />{s.jobRole}
                    </p>
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

      {/* ── Add Staff panel ── */}
      {addPanel && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setAddPanel(false)} />
          <div className="flex h-full w-full max-w-md flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">Add new staff member</h2>
                <p className="text-xs text-muted-foreground">Basic details — full compliance data is added from their profile page</p>
              </div>
              <button onClick={() => setAddPanel(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {addError && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{addError}</p>
              )}

              <div className="space-y-1.5">
                <Label>Full name *</Label>
                <Input
                  value={addForm.name}
                  onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. James Okafor"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  Job role
                </Label>
                <select
                  value={addForm.jobRole}
                  onChange={(e) => setAddForm((p) => ({ ...p, jobRole: e.target.value }))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Select role —</option>
                  <option value="Security Officer">Security Officer</option>
                  <option value="Door Supervisor">Door Supervisor</option>
                  <option value="CCTV Operator">CCTV Operator</option>
                  <option value="Patrol Officer">Patrol Officer</option>
                  <option value="Mobile Patrol">Mobile Patrol</option>
                  <option value="Supervisor">Supervisor</option>
                  <option value="Team Leader">Team Leader</option>
                  <option value="Key Holder">Key Holder</option>
                  <option value="Receptionist / Concierge">Receptionist / Concierge</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={addForm.email}
                    onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="email@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    type="tel"
                    value={addForm.phone}
                    onChange={(e) => setAddForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+44 7700 000000"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Nationality</Label>
                <Input
                  value={addForm.nationality}
                  onChange={(e) => setAddForm((p) => ({ ...p, nationality: e.target.value }))}
                  placeholder="e.g. British"
                />
              </div>

              <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                SIA licence, CSCS, Right to Work, documents and training are added from the staff member's profile page after creation.
              </p>
            </div>

            <div className="flex gap-2 border-t px-6 py-4">
              <Button variant="outline" className="flex-1" onClick={() => setAddPanel(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleAddStaff} disabled={addSaving}>
                {addSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</> : "Add staff member"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ex-Staff panel ── */}
      {exPanel && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setExPanel(false)} />
          <div className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Archive className="h-4 w-4 text-muted-foreground" />Ex-Staff
                </h2>
                <p className="text-xs text-muted-foreground">Restore a returning employee back to Active Staff</p>
              </div>
              <button onClick={() => setExPanel(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {exError && (
                <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{exError}</p>
              )}

              {exLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading ex-staff…</span>
                </div>
              ) : exStaff.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 text-center">
                  <UserX className="mb-4 h-12 w-12 text-muted-foreground/25" />
                  <h3 className="font-semibold text-muted-foreground">No ex-staff found</h3>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground/70">
                    Staff moved out of Active Staff will appear here — nothing is ever permanently deleted.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {exStaff.map((e) => (
                    <div key={e.folderId} className="rounded-lg border bg-card px-4 py-3 space-y-2">
                      <div className="flex items-center gap-3">
                        <InitialsAvatar name={e.name} status={e.overall} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{e.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[e.nationality, e.gender].filter(Boolean).join(" · ") || "No details on file"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => restoreExStaff(e.folderId)} disabled={restoringId === e.folderId}
                            className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50">
                            {restoringId === e.folderId
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <RotateCcw className="h-3.5 w-3.5" />}
                            Restore
                          </button>
                          <button onClick={() => setConfirmDeleteId(e.folderId)}
                            className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20">
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Inline confirmation */}
                      {confirmDeleteId === e.folderId && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex items-center justify-between gap-3">
                          <p className="text-xs text-destructive font-medium">Permanently delete {e.name.split(" ")[0]}'s record? This cannot be undone.</p>
                          <div className="flex gap-2 shrink-0">
                            <button onClick={() => setConfirmDeleteId(null)}
                              className="rounded px-2.5 py-1 text-xs border hover:bg-muted transition-colors">Cancel</button>
                            <button onClick={() => permanentDelete(e.folderId)} disabled={permDeleting}
                              className="rounded px-2.5 py-1 text-xs bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center gap-1">
                              {permDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                              Yes, Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
