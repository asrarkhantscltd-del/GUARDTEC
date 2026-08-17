import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  Building2, Users, ShieldCheck, AlertTriangle, Loader2, ChevronRight,
  TrendingDown, CalendarDays, FileWarning,
} from "lucide-react"
import { api } from "@/lib/api"

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

// GET /api/agencies row (server.js:3278)
interface AgencyRow {
  id: string
  name: string
  status: "active" | "archived"
  staff_count?: number | string
}

// Merged with GET /api/admin/agencies/:id/performance (server.js:4166)
interface AgencyPerformanceRow extends AgencyRow {
  compliance_pct?: number
  no_show_rate?: number
  incident_count?: number
  deployments_count?: number
}

function StatCard({ icon, label, value, colorClass }: { icon: React.ReactNode; label: string; value: number; colorClass: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>{icon}</div>
      <div className="mt-3 text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export default function AgenciesDashboardPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [rows, setRows] = useState<AgencyPerformanceRow[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [overviewRes, agenciesRes] = await Promise.allSettled([
          api.get<{ ok: boolean } & OverviewData>("/api/admin/agencies/overview"),
          api.get<{ ok: boolean; agencies: AgencyRow[] }>("/api/agencies"),
        ])
        if (cancelled) return
        if (overviewRes.status === "fulfilled") setOverview(overviewRes.value)

        const activeAgencies = agenciesRes.status === "fulfilled"
          ? (agenciesRes.value.agencies ?? []).filter(a => a.status === "active")
          : []

        // Per-agency performance is its own endpoint — no bulk version exists
        // (server.js has no GET /api/admin/agencies/performance-all), so this
        // is N+1 by design, bounded by however many active agencies exist.
        const perf = await Promise.allSettled(
          activeAgencies.map(a =>
            api.get<{ ok: boolean; compliance_pct: number; no_show_rate: number; incident_count: number; deployments_count: number }>(
              `/api/admin/agencies/${a.id}/performance`
            )
          )
        )
        if (cancelled) return
        setRows(activeAgencies.map((a, i) => {
          const p = perf[i]
          return p.status === "fulfilled" ? { ...a, ...p.value } : a
        }))
      } catch {
        toast.error("Failed to load dashboard")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const breakdown = overview?.compliance_breakdown
  const needsAttention = breakdown ? breakdown.ACTION_NEEDED + breakdown.INCOMPLETE + breakdown.EXPIRED : 0

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading dashboard…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Agencies Dashboard</h2>
        <p className="text-sm text-muted-foreground">Cross-agency compliance and deployment performance</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Building2 className="h-5 w-5" />} label="Active agencies" value={overview?.total_agencies ?? 0}
          colorClass="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400" />
        <StatCard icon={<Users className="h-5 w-5" />} label="Total cover guards" value={overview?.total_staff ?? 0}
          colorClass="bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400" />
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="Compliant" value={breakdown?.COMPLIANT ?? 0}
          colorClass="bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400" />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Needs attention" value={needsAttention}
          colorClass={needsAttention > 0
            ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
            : "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400"} />
      </div>

      {breakdown && (
        <div className="flex flex-wrap gap-2">
          {([
            { key: "COMPLIANT", label: "Compliant", cls: "bg-success/15 text-success border-success/30" },
            { key: "ACTION_NEEDED", label: "Action needed", cls: "bg-warning/15 text-warning border-warning/30" },
            { key: "INCOMPLETE", label: "Incomplete", cls: "bg-muted text-muted-foreground border-border" },
            { key: "EXPIRED", label: "Expired", cls: "bg-destructive/15 text-destructive border-destructive/30" },
          ] as const).map(b => (
            <span key={b.key} className={`rounded-full border px-3 py-1 text-xs font-medium ${b.cls}`}>
              {b.label}: {breakdown[b.key]}
            </span>
          ))}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Agency performance</p>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No active agencies yet.</div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">Agency</th>
                  <th className="px-4 py-3">Guards</th>
                  <th className="px-4 py-3">Compliance</th>
                  <th className="px-4 py-3">No-show rate</th>
                  <th className="hidden sm:table-cell px-4 py-3">Incidents</th>
                  <th className="hidden sm:table-cell px-4 py-3">Deployments</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => (
                  <tr key={r.id} onClick={() => navigate(`/admin/agencies/${r.id}`)}
                    className="hover:bg-muted/30 transition-colors cursor-pointer">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3">{Number(r.staff_count ?? 0)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        (r.compliance_pct ?? 100) >= 90 ? "bg-success/15 text-success"
                        : (r.compliance_pct ?? 100) >= 70 ? "bg-warning/15 text-warning"
                        : "bg-destructive/15 text-destructive"
                      }`}>
                        {r.compliance_pct ?? 100}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1 text-xs">
                        {(r.no_show_rate ?? 0) > 0 && <TrendingDown className="h-3 w-3 text-destructive" />}
                        {r.no_show_rate ?? 0}%
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <FileWarning className="h-3 w-3" />{r.incident_count ?? 0}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarDays className="h-3 w-3" />{r.deployments_count ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
