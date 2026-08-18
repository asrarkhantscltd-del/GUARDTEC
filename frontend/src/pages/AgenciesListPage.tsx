import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  Building2, Plus, Search, ChevronRight, Users, ShieldCheck,
  AlertTriangle, Archive, RotateCcw, Loader2, Mail, Phone,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api"
import CreateAgencyModal, { type CreatedAgencySummary } from "./CreateAgencyModal"

// Real row shape from GET /api/agencies (server.js:3278) — plain SELECT +
// COUNT(...) FILTER, no camelCasing. staff_count comes back as a string from
// Postgres COUNT(), so it's cast with Number(...) wherever it's displayed.
interface AgencyRow {
  id: string
  name: string
  email: string
  phone?: string
  status: "active" | "archived"
  created_at?: string
  staff_count?: number | string
}

interface ComplianceBreakdown {
  COMPLIANT: number
  ACTION_NEEDED: number
  INCOMPLETE: number
  EXPIRED: number
}

interface OverviewData {
  total_agencies: number
  total_staff: number
  compliance_breakdown: ComplianceBreakdown
}

function StatCard({ icon, label, value, colorClass, strip, onClick }: {
  icon: React.ReactNode; label: string; value: number; colorClass: string; strip: string; onClick?: () => void
}) {
  return (
    <div onClick={onClick} className={`surface relative overflow-hidden p-4 pl-5 ${onClick ? "surface-hover cursor-pointer" : ""}`}>
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: strip }} />
      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${colorClass}`}>{icon}</div>
      </div>
      <p className="font-display text-3xl font-black tracking-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

export default function AgenciesListPage() {
  const navigate = useNavigate()
  const [agencies, setAgencies] = useState<AgencyRow[]>([])
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "archived">("active")
  const [createOpen, setCreateOpen] = useState(false)
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null)

  async function load() {
    try {
      const [agenciesRes, overviewRes] = await Promise.allSettled([
        api.get<{ ok: boolean; agencies: AgencyRow[] }>("/api/agencies"),
        api.get<{ ok: boolean } & OverviewData>("/api/admin/agencies/overview"),
      ])
      if (agenciesRes.status === "fulfilled") setAgencies(agenciesRes.value.agencies ?? [])
      if (overviewRes.status === "fulfilled") setOverview(overviewRes.value)
      if (agenciesRes.status === "rejected" && overviewRes.status === "rejected") {
        toast.error("Failed to load agencies")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleArchive(agency: AgencyRow) {
    setArchiveBusyId(agency.id)
    try {
      if (agency.status === "active") {
        await api.post(`/api/agencies/${agency.id}/archive`)
        toast.success(`${agency.name} archived`)
      } else {
        await api.post(`/api/agencies/${agency.id}/reactivate`)
        toast.success(`${agency.name} reactivated`)
      }
      setAgencies(prev => prev.map(a =>
        a.id === agency.id ? { ...a, status: agency.status === "active" ? "archived" : "active" } : a
      ))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setArchiveBusyId(null)
    }
  }

  function handleCreated(agency: CreatedAgencySummary) {
    setAgencies(prev => [...prev, agency])
    setOverview(prev => prev ? { ...prev, total_agencies: prev.total_agencies + 1 } : prev)
  }

  const filtered = agencies.filter(a => {
    if (filter !== "all" && a.status !== filter) return false
    const q = search.trim().toLowerCase()
    if (q && !a.name.toLowerCase().includes(q) && !a.email.toLowerCase().includes(q)) return false
    return true
  })

  const activeCt = agencies.filter(a => a.status === "active").length
  const archivedCt = agencies.filter(a => a.status === "archived").length
  const breakdown = overview?.compliance_breakdown
  const needsAttention = breakdown ? breakdown.ACTION_NEEDED + breakdown.INCOMPLETE + breakdown.EXPIRED : 0

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Agencies</h2>
          <p className="text-sm text-muted-foreground">{activeCt} active · {archivedCt} archived</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />Create agency
        </Button>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={<Building2 className="h-5 w-5" />} label="Total agencies" value={overview.total_agencies}
            colorClass="bg-blue-500/10 text-blue-500" strip="#3b82f6" />
          <StatCard icon={<Users className="h-5 w-5" />} label="Cover guards" value={overview.total_staff}
            colorClass="bg-purple-500/10 text-purple-500" strip="#a855f7" />
          <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="Compliant" value={breakdown?.COMPLIANT ?? 0}
            colorClass="bg-success/10 text-success" strip="#22c55e" />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Needs attention" value={needsAttention}
            colorClass={needsAttention > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}
            strip={needsAttention > 0 ? "#ef4444" : "#22c55e"} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {(["active", "all", "archived"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}>
              {f === "all" ? `All (${agencies.length})` : f === "active" ? `Active (${activeCt})` : `Archived (${archivedCt})`}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading agencies…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {agencies.length === 0 ? 'No agencies yet — click "Create agency" to add your first cover agency.' : "No agencies match your filters."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Agency</th>
                <th className="hidden sm:table-cell px-4 py-3">Contact</th>
                <th className="px-4 py-3">Guards</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(a => (
                <tr key={a.id} onClick={() => navigate(`/admin/agencies/${a.id}`)}
                  className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{a.name}
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{a.email}</div>
                    {a.phone && <div className="mt-0.5 flex items-center gap-1"><Phone className="h-3 w-3" />{a.phone}</div>}
                  </td>
                  <td className="px-4 py-3">{Number(a.staff_count ?? 0)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                      a.status === "active" ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground border-border"
                    }`}>
                      {a.status === "active" ? "Active" : "Archived"}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => toggleArchive(a)} disabled={archiveBusyId === a.id}
                        title={a.status === "active" ? "Archive agency" : "Reactivate agency"}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
                        {archiveBusyId === a.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : a.status === "active" ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      </button>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateAgencyModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
    </div>
  )
}
