import { useEffect, useState, useMemo } from "react"
import { motion } from "framer-motion"
import { api, ApiError } from "@/lib/api"
import { daysUntil, formatDate } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  Search, ArrowUpDown, ArrowUp, ArrowDown, ArrowUpRight,
  CheckCircle2, AlertTriangle, XCircle, FileQuestion,
  Users, ShieldX, ShieldAlert, ShieldCheck,
} from "lucide-react"

interface StaffMember {
  id: string
  name: string
  overall: string
  jobRole?: string
  nationality?: string
  sia?: { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
}

type FilterMode = "all" | "expired" | "expiring" | "good"
type SortKey = "name" | "sia" | "cscs" | "rtw"
type ComplianceStatus = "expired" | "expiring" | "good" | "missing"

function statusOf(days: number | null): ComplianceStatus {
  if (days === null) return "missing"
  if (days < 0) return "expired"
  if (days <= 30) return "expiring"
  return "good"
}

// British/Irish nationals and anyone with Indefinite Leave to Remain (or an
// EU Settlement Scheme settled/pre-settled grant, which is also indefinite)
// have no RTW expiry to track — a blank expiry there is a valid state, not
// a missing document.
function isRtwExempt(s: { nationality?: string; visa?: { type?: string } }): boolean {
  if ((s.nationality ?? "").toLowerCase().includes("british")) return true
  return /ilr|indefinite leave|settled status|euss/i.test(s.visa?.type ?? "")
}

function worstStatus(...statuses: ComplianceStatus[]): ComplianceStatus {
  if (statuses.includes("expired")) return "expired"
  if (statuses.includes("expiring")) return "expiring"
  if (statuses.includes("missing")) return "missing"
  return "good"
}

function ExpiryCell({ number, expiry }: { number?: string; expiry?: string }) {
  const days = daysUntil(expiry)
  const status = statusOf(days)

  if (!number && !expiry) {
    return <span className="text-xs text-muted-foreground italic">Not on file</span>
  }

  const chipCls =
    status === "expired"  ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" :
    status === "expiring" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" :
                            "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"

  const chipText =
    days === null    ? "" :
    days < 0         ? `Exp ${Math.abs(days)}d ago` :
    days === 0       ? "Expires today" :
    days <= 30       ? `${days}d left` :
                       `${formatDate(expiry)}`

  return (
    <div className="space-y-0.5">
      {number && <div className="text-xs font-mono text-muted-foreground">{number}</div>}
      {expiry && (
        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${chipCls}`}>
          {chipText}
        </span>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: ComplianceStatus }) {
  const cfg = {
    expired:  { label: "Expired",       cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",           Icon: XCircle },
    expiring: { label: "Expiring Soon", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",   Icon: AlertTriangle },
    good:     { label: "Compliant",     cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",   Icon: CheckCircle2 },
    missing:  { label: "Incomplete",    cls: "bg-muted text-muted-foreground",                                          Icon: FileQuestion },
  }[status]

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.cls}`}>
      <cfg.Icon className="h-3 w-3" />{cfg.label}
    </span>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-35" />
  return dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

export default function CompliancePage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<FilterMode>("all")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    api.get<StaffMember[]>("/api/staff")
      .then(data => setStaff(Array.isArray(data) ? data : []))
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) setError("Your session has expired — please log out and back in.")
        else if (err instanceof ApiError && err.status === 403) setError("Access denied — contact your administrator.")
        else setError("Could not load compliance data. Check your connection and try again.")
      })
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    let expired = 0, expiring = 0, good = 0, incomplete = 0
    staff.forEach(s => {
      const rtwStatus: ComplianceStatus = isRtwExempt(s) ? "good" : statusOf(daysUntil(s.visa?.expiry))
      const worst = worstStatus(statusOf(daysUntil(s.sia?.expiry)), statusOf(daysUntil(s.cscs?.expiry)), rtwStatus)
      if (worst === "expired") expired++
      else if (worst === "expiring") expiring++
      else if (worst === "good") good++
      else incomplete++
    })
    return { total: staff.length, expired, expiring, good, incomplete }
  }, [staff])

  const rows = useMemo(() => {
    const filtered = staff.filter(s => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false
      const rtwStatus: ComplianceStatus = isRtwExempt(s) ? "good" : statusOf(daysUntil(s.visa?.expiry))
      const worst = worstStatus(statusOf(daysUntil(s.sia?.expiry)), statusOf(daysUntil(s.cscs?.expiry)), rtwStatus)
      if (filter === "expired"  && worst !== "expired")  return false
      if (filter === "expiring" && worst !== "expiring") return false
      if (filter === "good"     && worst !== "good")     return false
      return true
    })

    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name)
      } else if (sortKey === "sia") {
        const da = daysUntil(a.sia?.expiry) ?? Infinity
        const db = daysUntil(b.sia?.expiry) ?? Infinity
        cmp = da - db
      } else if (sortKey === "cscs") {
        const da = daysUntil(a.cscs?.expiry) ?? Infinity
        const db = daysUntil(b.cscs?.expiry) ?? Infinity
        cmp = da - db
      } else if (sortKey === "rtw") {
        const da = daysUntil(a.visa?.expiry) ?? Infinity
        const db = daysUntil(b.visa?.expiry) ?? Infinity
        cmp = da - db
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [staff, search, filter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const filterLabels: Record<FilterMode, string> = {
    all:      `All (${stats.total})`,
    expired:  `Expired (${stats.expired})`,
    expiring: `Expiring Soon (${stats.expiring})`,
    good:     `Compliant (${stats.good})`,
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Compliance Overview</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          SIA licences · CSCS cards · Right to Work — {stats.total} staff
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />}    label="Total Staff"     value={stats.total}
          colorClass="bg-blue-500/10 text-blue-500" strip="#3b82f6" />
        <StatCard icon={<ShieldX className="h-5 w-5" />}  label="Expired"         value={stats.expired}
          colorClass={stats.expired > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}
          strip={stats.expired > 0 ? "#ef4444" : "var(--color-border)"} />
        <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="Expiring (30d)" value={stats.expiring}
          colorClass={stats.expiring > 0 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}
          strip={stats.expiring > 0 ? "#f59e0b" : "var(--color-border)"} />
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="Fully Compliant" value={stats.good}
          colorClass="bg-success/10 text-success" strip="#22c55e" />
      </div>

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border bg-muted/40 p-1 gap-0.5">
          {(["all", "expired", "expiring", "good"] as FilterMode[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                filter === f
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}>
              {filterLabels[f]}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name…" value={search}
            onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/25" />
          <p className="text-sm font-medium text-muted-foreground">No staff match this filter</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <Th onClick={() => toggleSort("name")}  label="Staff"         sortKey="name"  activeSortKey={sortKey} sortDir={sortDir} />
                <Th onClick={() => toggleSort("sia")}   label="SIA Licence"   sortKey="sia"   activeSortKey={sortKey} sortDir={sortDir} />
                <Th onClick={() => toggleSort("cscs")}  label="CSCS Card"     sortKey="cscs"  activeSortKey={sortKey} sortDir={sortDir} />
                <Th onClick={() => toggleSort("rtw")}   label="Right to Work" sortKey="rtw"   activeSortKey={sortKey} sortDir={sortDir} />
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s, i) => {
                const rtwExempt = isRtwExempt(s)
                const rtwStatus: ComplianceStatus = rtwExempt ? "good" : statusOf(daysUntil(s.visa?.expiry))
                const worst = worstStatus(statusOf(daysUntil(s.sia?.expiry)), statusOf(daysUntil(s.cscs?.expiry)), rtwStatus)
                const rowBg =
                  worst === "expired"  ? "bg-red-50/50 dark:bg-red-950/10" :
                  worst === "expiring" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""

                return (
                  <motion.tr
                    key={s.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                    className={`transition-colors hover:bg-muted/40 ${rowBg}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.name}</div>
                      {s.jobRole && <div className="text-xs text-muted-foreground">{s.jobRole}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryCell number={s.sia?.number} expiry={s.sia?.expiry} />
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryCell number={s.cscs?.number} expiry={s.cscs?.expiry} />
                    </td>
                    <td className="px-4 py-3">
                      {rtwExempt ? (
                        <span className="text-xs font-medium text-green-700 dark:text-green-400">
                          {s.visa?.type || s.nationality} — No expiry
                        </span>
                      ) : (
                        <ExpiryCell number={s.visa?.type} expiry={s.visa?.expiry} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={worst} />
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ onClick, label, sortKey, activeSortKey, sortDir }: {
  onClick: () => void
  label: string
  sortKey: SortKey
  activeSortKey: SortKey
  sortDir: "asc" | "desc"
}) {
  return (
    <th className="px-4 py-3 text-left">
      <button onClick={onClick}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
        {label}
        <SortIcon active={activeSortKey === sortKey} dir={sortDir} />
      </button>
    </th>
  )
}

function StatCard({ icon, label, value, colorClass, strip, onClick }: {
  icon: React.ReactNode; label: string; value: number; colorClass: string; strip: string; onClick?: () => void
}) {
  return (
    <div onClick={onClick} className={`surface relative overflow-hidden p-4 pl-5 ${onClick ? "surface-hover cursor-pointer" : ""}`}>
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: strip }} />
      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${colorClass}`}>{icon}</div>
        {onClick && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <p className="font-display text-3xl font-black tracking-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}
