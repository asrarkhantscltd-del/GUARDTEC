import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { CalendarDays, MapPin, Building2, Loader2, X, Filter, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { fmtDate } from "@/lib/utils"
import { api } from "@/lib/api"
import { DeploymentForm } from "@/components/agency/DeploymentForm"

interface Site { id: string; name: string }
interface AgencyOption { id: string; name: string }

// GET /api/admin/deployments (server.js:4207) — joins agencies.name in and
// carries the JSON-backed site resolved server-side via getSiteById(site_id).
interface DeploymentRow {
  id: string
  agency_id: string
  agency_name: string
  site_id: string
  event_date: string
  status: "scheduled" | "completed" | "cancelled"
  guard_count?: number | string
  site?: Site | null
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
}

export default function DeploymentsPage() {
  const navigate = useNavigate()
  const [deployments, setDeployments] = useState<DeploymentRow[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [agencies, setAgencies] = useState<AgencyOption[]>([])
  const [loading, setLoading] = useState(true)

  const [siteFilter, setSiteFilter] = useState("")
  const [agencyFilter, setAgencyFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    api.get<{ sites: Site[] }>("/api/sites").then(d => setSites(d.sites ?? [])).catch(() => {})
    api.get<{ ok: boolean; agencies: AgencyOption[] }>("/api/agencies").then(d => setAgencies(d.agencies ?? [])).catch(() => {})
  }, [])

  async function loadDeployments() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (siteFilter) params.set("site_id", siteFilter)
      if (agencyFilter) params.set("agency_id", agencyFilter)
      if (dateFrom) params.set("date_from", dateFrom)
      if (dateTo) params.set("date_to", dateTo)
      const qs = params.toString()
      const d = await api.get<{ ok: boolean; deployments: DeploymentRow[] }>(`/api/admin/deployments${qs ? `?${qs}` : ""}`)
      setDeployments(d.deployments ?? [])
    } catch {
      toast.error("Failed to load deployments")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDeployments() }, [siteFilter, agencyFilter, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearFilters() { setSiteFilter(""); setAgencyFilter(""); setDateFrom(""); setDateTo("") }
  const hasFilters = !!(siteFilter || agencyFilter || dateFrom || dateTo)

  function handleCreated() {
    setCreateOpen(false)
    loadDeployments()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Deployments</h2>
          <p className="text-sm text-muted-foreground">Cross-agency cover guard bookings, filterable by site, agency and date</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New deployment
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Site</label>
          <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
            className="h-9 min-w-40 rounded-md border bg-background px-3 text-sm">
            <option value="">All sites</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Agency</label>
          <select value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)}
            className="h-9 min-w-40 rounded-md border bg-background px-3 text-sm">
            <option value="">All agencies</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
            <X className="h-3.5 w-3.5" />Clear filters
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading deployments…</span>
        </div>
      ) : deployments.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {hasFilters ? (
            <span className="flex flex-col items-center gap-2">
              <Filter className="h-6 w-6 text-muted-foreground/40" />No deployments match your filters.
            </span>
          ) : "No deployments booked yet."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Event date</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Agency</th>
                <th className="px-4 py-3">Guards</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deployments.map(d => (
                <tr key={d.id} onClick={() => navigate(`/admin/agencies/${d.agency_id}?tab=deployments`)}
                  className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{fmtDate(d.event_date)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{d.site?.name ?? d.site_id}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{d.agency_name}</span>
                  </td>
                  <td className="px-4 py-3">{Number(d.guard_count ?? 0)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium border capitalize ${STATUS_STYLE[d.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── New deployment panel (admin, cross-agency) ── */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-semibold">New deployment</h2>
            <button onClick={() => setCreateOpen(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <DeploymentForm
            sites={sites}
            onSaved={handleCreated}
            onCancel={() => setCreateOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
