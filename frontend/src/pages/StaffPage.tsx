import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Search,
  ChevronRight,
  Loader2,
  LayoutList,
  LayoutGrid,
  Table2,
  StretchHorizontal,
  Grid2x2,
} from "lucide-react"

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
}

type ViewMode = "details" | "list" | "tiles" | "icons" | "small"

function fmtDate(iso?: string) {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
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

function InitialsAvatar({ name, status, size = "md" }: { name: string; status: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()
  const bg: Record<string, string> = {
    green: "bg-success/20 text-success border border-success/30",
    amber: "bg-warning/20 text-warning border border-warning/30",
    red: "bg-destructive/20 text-destructive border border-destructive/30",
    unknown: "bg-muted text-muted-foreground border border-border",
  }
  const sz = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-11 w-11 text-sm"
  return (
    <div className={`rounded-full flex items-center justify-center font-semibold shrink-0 ${sz} ${bg[status] ?? bg.unknown}`}>
      {initials}
    </div>
  )
}

const viewButtons: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: "details", icon: <Table2 className="h-4 w-4" />, label: "Details" },
  { mode: "tiles",   icon: <StretchHorizontal className="h-4 w-4" />, label: "Tiles" },
  { mode: "icons",   icon: <Grid2x2 className="h-4 w-4" />, label: "Icons" },
  { mode: "small",   icon: <LayoutGrid className="h-4 w-4" />, label: "Small icons" },
  { mode: "list",    icon: <LayoutList className="h-4 w-4" />, label: "List" },
]

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<string>("all")
  const [view, setView] = useState<ViewMode>("details")
  const navigate = useNavigate()

  useEffect(() => {
    fetch("/api/staff", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setStaff(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = staff.filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === "all" || s.overall === filter
    return matchSearch && matchFilter
  })

  const counts = {
    all: staff.length,
    green: staff.filter((s) => s.overall === "green").length,
    amber: staff.filter((s) => s.overall === "amber").length,
    red: staff.filter((s) => s.overall === "red").length,
    unknown: staff.filter((s) => s.overall === "unknown").length,
  }

  function goToStaff(id: string) {
    navigate(`/staff/${id}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Staff</h2>
        <p className="text-muted-foreground text-sm">{staff.length} active staff members</p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {(["all", "green", "amber", "red", "unknown"] as const).map((f) => {
          const labels: Record<string, string> = {
            all: "All", green: "Compliant", amber: "Action Needed", red: "Expired", unknown: "Incomplete",
          }
          const colours: Record<string, string> = {
            all: "bg-secondary text-secondary-foreground",
            green: "bg-success/15 text-success border border-success/30",
            amber: "bg-warning/15 text-warning border border-warning/30",
            red: "bg-destructive/15 text-destructive border border-destructive/30",
            unknown: "bg-muted text-muted-foreground",
          }
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity ${colours[f]} ${
                filter === f ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
              }`}>
              {labels[f]} ({counts[f]})
            </button>
          )
        })}
      </div>

      {/* Search + View toggles */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        {/* View toggle buttons */}
        <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
          {viewButtons.map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => setView(mode)} title={label}
              className={`rounded p-1.5 transition-colors ${
                view === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
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
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No staff found.
        </div>
      ) : (

        /* ── DETAILS VIEW ── */
        view === "details" ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
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
                  <StatusBadge status={s.overall} />
                  <div className="mt-1.5 grid grid-cols-3 gap-1 text-xs text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground/60">SIA</p>
                      <p className={daysUntil(s.sia?.expiry) !== null && daysUntil(s.sia?.expiry)! < 0 ? "text-destructive" : daysUntil(s.sia?.expiry) !== null && daysUntil(s.sia?.expiry)! < 91 ? "text-warning" : ""}>
                        {fmtDate(s.sia?.expiry)}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground/60">CSCS</p>
                      <p>{fmtDate(s.cscs?.expiry)}</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground/60">RTW</p>
                      <p>{s.visa?.expiry ? fmtDate(s.visa.expiry) : "✓"}</p>
                    </div>
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
                <StatusBadge status={s.overall} />
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
