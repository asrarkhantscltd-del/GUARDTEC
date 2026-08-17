import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, ShieldAlert, CalendarOff } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/profile/ProfileShared"

// ── Local types ──────────────────────────────────────────────────────────
// Mirrors the real Postgres row shape returned by server.js (snake_case,
// passed straight through from `SELECT * FROM agency_staff` /
// `agency_deployments`) — NOT the camelCase shape in types/agency.ts, which
// does not match what these live endpoints actually send over the wire.

export interface AgencySite { id: string; name: string; address?: string }

export interface AgencyStaffRow {
  id: string
  name: string
  job_role?: string
  compliance_status?: "COMPLIANT" | "ACTION_NEEDED" | "INCOMPLETE" | "EXPIRED"
}

export interface DeploymentAssignment {
  agency_staff_id: string
  scheduled_hours: number
}

export interface AgencyDeployment {
  id: string
  agency_id: string
  site_id: string
  event_date: string
  agency_acknowledged: boolean
  agency_acknowledged_by?: string | null
  agency_acknowledged_at?: string | null
  status: "scheduled" | "completed" | "cancelled"
  guard_count?: number
  site?: AgencySite | null
}

export function complianceBadgeStatus(status?: string): "green" | "amber" | "red" | "unknown" {
  if (status === "COMPLIANT") return "green"
  if (status === "ACTION_NEEDED") return "amber"
  if (status === "EXPIRED") return "red"
  return "unknown"
}

interface DeploymentFormProps {
  agencyId: string
  sites: AgencySite[]
  roster: AgencyStaffRow[] // full active roster — page fetches this once
  deployment?: AgencyDeployment | null // undefined/null = create mode
  initialAssignments?: DeploymentAssignment[] // edit-mode pre-fill; [] for create
  initialDate?: string // create-mode date prefill (e.g. clicked from a calendar day)
  onSaved: (deploymentId: string, assignments: DeploymentAssignment[]) => void
  onCancel: () => void
}

// Guard-matching suggestion: re-queries GET /api/agencies/:agencyId/staff/available
// (excludes expired-compliance + currently-unavailable guards, per the plan's
// §1.5 SQL) every time the event date changes, so the checkbox list always
// reflects who is actually eligible for THAT date — not just "active".
export function DeploymentForm({
  agencyId, sites, roster, deployment, initialAssignments, initialDate, onSaved, onCancel,
}: DeploymentFormProps) {
  const isEdit = !!deployment
  const [siteId, setSiteId] = useState(deployment?.site_id ?? sites[0]?.id ?? "")
  const [eventDate, setEventDate] = useState((deployment?.event_date ?? initialDate ?? "").slice(0, 10))
  const [hours, setHours] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const a of initialAssignments ?? []) init[a.agency_staff_id] = a.scheduled_hours
    return init
  })
  const [eligibleIds, setEligibleIds] = useState<Set<string> | null>(null)
  const [checkingEligibility, setCheckingEligibility] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!eventDate) { setEligibleIds(null); return }
    let cancelled = false
    setCheckingEligibility(true)
    api.get<{ ok: boolean; staff: AgencyStaffRow[] }>(
      `/api/agencies/${agencyId}/staff/available?event_date=${eventDate}`
    ).then(d => {
      if (cancelled) return
      setEligibleIds(new Set((d.staff ?? []).map(s => s.id)))
    }).catch(() => { if (!cancelled) setEligibleIds(null) })
      .finally(() => { if (!cancelled) setCheckingEligibility(false) })
    return () => { cancelled = true }
  }, [agencyId, eventDate])

  function toggleGuard(id: string, eligible: boolean) {
    setHours(prev => {
      const next = { ...prev }
      if (id in next) delete next[id]
      else if (eligible || isEdit) next[id] = 8 // default shift length
      return next
    })
  }

  function setGuardHours(id: string, v: number) {
    setHours(prev => ({ ...prev, [id]: v }))
  }

  function ineligibleReason(staff: AgencyStaffRow): string {
    if (staff.compliance_status === "EXPIRED") return "Expired compliance — cannot be deployed"
    return "Marked unavailable on this date"
  }

  async function handleSave() {
    if (!siteId) { setError("Select a site."); return }
    if (!eventDate) { setError("Select an event date."); return }
    const staffPayload = Object.entries(hours).map(([agency_staff_id, scheduled_hours]) => ({
      agency_staff_id, scheduled_hours,
    }))
    if (!staffPayload.length) { setError("Select at least one guard."); return }
    if (staffPayload.some(s => !s.scheduled_hours || s.scheduled_hours <= 0)) {
      setError("Every selected guard needs hours greater than 0."); return
    }
    setSaving(true); setError("")
    try {
      if (isEdit && deployment) {
        await api.patch(`/api/agencies/${agencyId}/deployments/${deployment.id}`, { staff: staffPayload })
        onSaved(deployment.id, staffPayload)
        toast.success("Deployment updated")
      } else {
        const d = await api.post<{ ok: boolean; deployment_id: string }>(
          `/api/agencies/${agencyId}/deployments`,
          { site_id: siteId, event_date: eventDate, staff: staffPayload }
        )
        onSaved(d.deployment_id, staffPayload)
        toast.success("Deployment created")
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <Field label="Site *">
          <select value={siteId} onChange={e => setSiteId(e.target.value)} disabled={isEdit}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60">
            <option value="">— Select site —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>

        <Field label="Event date *">
          <Input type="date" value={eventDate} disabled={isEdit}
            onChange={e => setEventDate(e.target.value)} className="disabled:opacity-60" />
        </Field>

        <div>
          <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Guards {checkingEligibility && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
          </Label>
          {!eventDate ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              Pick an event date to see who is eligible.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto rounded-lg border p-2">
              {roster.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No guards on file for this agency yet.</p>
              ) : roster.map(staff => {
                const selected = staff.id in hours
                const eligible = eligibleIds ? eligibleIds.has(staff.id) : true
                const blocked = !eligible && !selected
                return (
                  <div key={staff.id}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${selected ? "bg-primary/5" : ""} ${blocked ? "opacity-50" : ""}`}>
                    <input type="checkbox" checked={selected} disabled={blocked}
                      onChange={() => toggleGuard(staff.id, eligible)}
                      className="h-4 w-4 shrink-0 accent-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{staff.name}</p>
                      {!eligible && (
                        <p className="flex items-center gap-1 text-[11px] text-destructive">
                          <ShieldAlert className="h-3 w-3 shrink-0" />{ineligibleReason(staff)}
                        </p>
                      )}
                    </div>
                    {selected && (
                      <Input type="number" min={0.5} step={0.5} value={hours[staff.id]}
                        onChange={e => setGuardHours(staff.id, Number(e.target.value) || 0)}
                        className="h-7 w-16 shrink-0 text-xs" title="Scheduled hours" />
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {eligibleIds && eligibleIds.size === 0 && eventDate && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <CalendarOff className="h-3 w-3" /> No guards are eligible on this date (compliance or unavailability).
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-t px-6 py-4">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : isEdit ? "Save changes" : "Create deployment"}
        </Button>
      </div>
    </div>
  )
}
