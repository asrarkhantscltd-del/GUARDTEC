import { Fragment, useEffect, useState } from "react"
import { History, ChevronDown, ChevronUp } from "lucide-react"
import { api } from "@/lib/api"

interface AuditEvent {
  id: string
  action: string
  object_type: string
  object_id: string | null
  object_name: string | null
  metadata: Record<string, unknown>
  created_at: string
  actor_email: string | null
  actor_name: string | null
  actor_role: string | null
}

const OBJECT_TYPES = [
  "employee", "site", "vehicle", "agency", "agency_staff",
  "agency_deployment", "incident_report", "user", "role",
]

const ACTION_LABELS: Record<string, string> = {
  STAFF_CREATED: "Created staff record",
  STAFF_UPDATED: "Updated staff record",
  STAFF_ARCHIVED: "Moved staff to Ex-Staff",
  STAFF_PERMANENTLY_DELETED: "Permanently deleted staff record",
  SITE_CREATED: "Created site",
  SITE_UPDATED: "Updated site",
  SITE_DELETED: "Deleted site",
  VEHICLE_CREATED: "Created vehicle",
  VEHICLE_UPDATED: "Updated vehicle",
  VEHICLE_DELETED: "Deleted vehicle",
  AGENCY_CREATED: "Created agency",
  AGENCY_UPDATED: "Updated agency",
  AGENCY_DELETED: "Deleted agency",
  AGENCY_STAFF_DELETED: "Deleted agency cover guard",
  DEPLOYMENT_DELETED: "Deleted agency deployment",
  INCIDENT_REPORT_DELETED: "Deleted incident report",
  USER_CREATED: "Created user account",
  USER_UPDATED: "Updated user account",
  USER_DELETED: "Deleted user account",
  USER_PASSWORD_RESET: "Reset user password",
  ROLE_CREATED: "Created role",
  ROLE_UPDATED: "Updated role",
  ROLE_DELETED: "Deleted role",
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export default function AuditTrailPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [objectType, setObjectType] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 50

  async function load(nextOffset: number, replace: boolean) {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) })
      if (objectType) params.set("object_type", objectType)
      const d = await api.get<{ ok: boolean; events: AuditEvent[] }>(`/api/audit-events?${params}`)
      setEvents(prev => replace ? d.events : [...prev, ...d.events])
      setHasMore(d.events.length === PAGE_SIZE)
      setOffset(nextOffset)
    } catch {
      setError("Failed to load audit trail.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(0, true) }, [objectType])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" /> Audit Trail
          </h2>
          <p className="text-sm text-muted-foreground">Who created, edited, or deleted Staff, Sites, Vehicles, Agencies, and Users</p>
        </div>
        <select value={objectType} onChange={e => setObjectType(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
          <option value="">All record types</option>
          {OBJECT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="surface overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">When</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actor</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Record</th>
              <th className="px-3 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map(ev => (
              <Fragment key={ev.id}>
                <tr className="transition-colors hover:bg-muted/20 cursor-pointer"
                  onClick={() => setExpandedId(id => id === ev.id ? null : ev.id)}>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{fmtWhen(ev.created_at)}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium">{ev.actor_name || ev.actor_email || "Unknown"}</p>
                    {ev.actor_role && <p className="text-xs text-muted-foreground">{ev.actor_role}</p>}
                  </td>
                  <td className="px-3 py-3">{actionLabel(ev.action)}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground mr-1.5">{ev.object_type}</span>
                    {ev.object_name || ev.object_id}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {expandedId === ev.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </td>
                </tr>
                {expandedId === ev.id && Object.keys(ev.metadata || {}).length > 0 && (
                  <tr>
                    <td colSpan={5} className="bg-muted/10 px-5 py-3">
                      <pre className="text-xs text-muted-foreground overflow-x-auto">{JSON.stringify(ev.metadata, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!loading && events.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No audit events recorded yet.</p>
        )}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && hasMore && (
        <button onClick={() => load(offset + PAGE_SIZE, false)}
          className="w-full rounded-md border border-border py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">
          Load more
        </button>
      )}
    </div>
  )
}
