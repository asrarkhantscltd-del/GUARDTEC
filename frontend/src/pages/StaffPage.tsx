import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Input } from "@/components/ui/input"
import {
  Search, ChevronRight, Loader2, LayoutList, LayoutGrid,
  Table2, StretchHorizontal, Grid2x2, MapPin, Clock,
  CircleCheck, ShieldCheck, HardHat, FileCheck, Building2, Plus, X,
  BarChart3, FileWarning,
} from "lucide-react"
import { StatusBadge } from "@/components/ui/status-badge"

interface Site {
  id: string
  name: string
  address?: string
}

interface StaffMember {
  id: string
  name: string
  overall: string
  email?: string
  phone?: string
  sia?: { number?: string; expiry?: string }
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
  deployStatus?: string
  currentSite?: string
}

type ViewMode = "details" | "list" | "tiles" | "icons" | "small"

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
    onsite:    { label: "Onsite",    cls: "bg-blue-500/15 text-blue-500 border border-blue-500/30", Icon: MapPin },
    available: { label: "Available", cls: "bg-success/15 text-success border border-success/30",    Icon: CircleCheck },
    offduty:   { label: "Off Duty",  cls: "bg-muted text-muted-foreground border border-border",     Icon: Clock },
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

function fmtDate(iso?: string) {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
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

// Inline site selector — shown when staff is onsite; updates immediately on change
function SiteSelect({
  staffId, currentSite, sites, onUpdate,
}: {
  staffId: string; currentSite?: string; sites: Site[]; onUpdate: (id: string, site: string) => void
}) {
  return (
    <select
      value={currentSite ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onUpdate(staffId, e.target.value)}
      className="rounded border border-border bg-background text-xs px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring max-w-[160px]"
    >
      <option value="">— Select site —</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  )
}

const viewButtons: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: "details", icon: <Table2 className="h-4 w-4" />,           label: "Details" },
  { mode: "tiles",   icon: <StretchHorizontal className="h-4 w-4" />, label: "Tiles" },
  { mode: "icons",   icon: <Grid2x2 className="h-4 w-4" />,           label: "Icons" },
  { mode: "small",   icon: <LayoutGrid className="h-4 w-4" />,         label: "Small icons" },
  { mode: "list",    icon: <LayoutList className="h-4 w-4" />,         label: "List" },
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
  const [view, setView]       = useState<ViewMode>("details")
  const [newSiteName, setNewSiteName]   = useState("")
  const [addingSite, setAddingSite]     = useState(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

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

  async function updateDeploy(staffId: string, deployStatus: string, currentSite?: string) {
    await fetch(`/api/staff/${staffId}/deploy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ deployStatus, currentSite }),
    })
    setStaff((prev) =>
      prev.map((s) =>
        s.id === staffId
          ? { ...s, deployStatus, ...(currentSite !== undefined ? { currentSite } : {}) }
          : s
      )
    )
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
      }
    } finally {
      setAddingSite(false)
    }
  }

  async function removeSite(id: string) {
    await fetch(`/api/sites/${id}`, { method: "DELETE", credentials: "include" })
    setSites((prev) => prev.filter((s) => s.id !== id))
    if (siteFilter === id) setSiteFilter("all")
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
      if (siteFilter === "__none__") return normDeploy(s.deployStatus) === "onsite" && !s.currentSite
      return s.currentSite === siteFilter
    }
    if (docFilter === "sia")  return docStatus(s.sia?.expiry) !== "ok"
    if (docFilter === "cscs") return docStatus(s.cscs?.expiry) !== "ok"
    if (docFilter === "rtw")  return docStatus(s.visa?.expiry) !== "ok"
    return true
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

  function goToStaff(id: string) { navigate(`/staff/${id}`) }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Staff</h2>
        <p className="text-muted-foreground text-sm">{staff.length} active staff members</p>
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
                  all:       { label: "All",       cls: "bg-secondary text-secondary-foreground",                 icon: null },
                  onsite:    { label: "Onsite",    cls: "bg-blue-500/15 text-blue-500 border border-blue-500/30", icon: <MapPin className="h-3 w-3" /> },
                  available: { label: "Available", cls: "bg-success/15 text-success border border-success/30",    icon: <CircleCheck className="h-3 w-3" /> },
                  offduty:   { label: "Off Duty",  cls: "bg-muted text-muted-foreground",                          icon: <Clock className="h-3 w-3" /> },
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
            <button key={mode} onClick={() => setView(mode)} title={label}
              className={`rounded p-1.5 transition-colors ${
                view === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}>
              {icon}
            </button>
          ))}
        </div>
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
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Compliance</th>
                  <th className="hidden sm:table-cell px-4 py-3">Deployment</th>
                  <th className="hidden sm:table-cell px-4 py-3">Site</th>
                  <th className="hidden sm:table-cell px-4 py-3">SIA Expiry</th>
                  <th className="hidden md:table-cell px-4 py-3">CSCS Expiry</th>
                  <th className="hidden lg:table-cell px-4 py-3">RTW Expiry</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((s) => (
                  <tr key={s.id} onClick={() => goToStaff(s.id)}
                    className="hover:bg-muted/30 transition-colors cursor-pointer">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.overall} /></td>
                    <td className="hidden sm:table-cell px-4 py-3"><DeployBadge raw={s.deployStatus} /></td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      {normDeploy(s.deployStatus) === "onsite" ? (
                        <SiteSelect staffId={s.id} currentSite={s.currentSite} sites={sites}
                          onUpdate={(id, site) => updateDeploy(id, s.deployStatus ?? "onsite", site)} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => (
              <div key={s.id} onClick={() => goToStaff(s.id)}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <InitialsAvatar name={s.name} status={s.overall} size="lg" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <StatusBadge status={s.overall} />
                    <DeployBadge raw={s.deployStatus} />
                  </div>
                  {normDeploy(s.deployStatus) === "onsite" && (
                    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                      <SiteSelect staffId={s.id} currentSite={s.currentSite} sites={sites}
                        onUpdate={(id, site) => updateDeploy(id, s.deployStatus ?? "onsite", site)} />
                    </div>
                  )}
                  {normDeploy(s.deployStatus) !== "onsite" && s.currentSite && (
                    <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {getSiteName(s.currentSite)}
                    </p>
                  )}
                  <div className="mt-1.5 flex gap-1 flex-wrap">
                    <DocChip label="SIA"  date={s.sia?.expiry} />
                    <DocChip label="CSCS" date={s.cscs?.expiry} />
                    <DocChip label="RTW"  date={s.visa?.expiry} />
                  </div>
                </div>
              </div>
            ))}
          </div>

        /* ── ICONS (MEDIUM) VIEW ── */
        ) : view === "icons" ? (
          <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {filtered.map((s) => (
              <div key={s.id} onClick={() => goToStaff(s.id)}
                className="flex flex-col items-center gap-2 rounded-lg p-3 cursor-pointer hover:bg-muted/40 transition-colors text-center">
                <InitialsAvatar name={s.name} status={s.overall} size="lg" />
                <p className="text-xs font-medium leading-tight line-clamp-2">{s.name}</p>
                <DeployBadge raw={s.deployStatus} />
                {s.currentSite && (
                  <p className="text-xs text-muted-foreground line-clamp-1">{getSiteName(s.currentSite)}</p>
                )}
              </div>
            ))}
          </div>

        /* ── SMALL ICONS VIEW ── */
        ) : view === "small" ? (
          <div className="grid gap-2 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {filtered.map((s) => (
              <div key={s.id} onClick={() => goToStaff(s.id)}
                className="flex flex-col items-center gap-1.5 rounded-lg p-2 cursor-pointer hover:bg-muted/40 transition-colors text-center">
                <InitialsAvatar name={s.name} status={s.overall} size="sm" />
                <p className="text-xs leading-tight line-clamp-1 w-full">{s.name.split(" ")[0]}</p>
              </div>
            ))}
          </div>

        /* ── LIST VIEW ── */
        ) : (
          <div className="rounded-lg border divide-y overflow-hidden">
            {filtered.map((s) => (
              <div key={s.id} onClick={() => goToStaff(s.id)}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors">
                <InitialsAvatar name={s.name} status={s.overall} size="sm" />
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                {normDeploy(s.deployStatus) === "onsite" && s.currentSite && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {getSiteName(s.currentSite)}
                  </span>
                )}
                <DeployBadge raw={s.deployStatus} />
                <StatusBadge status={s.overall} />
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
