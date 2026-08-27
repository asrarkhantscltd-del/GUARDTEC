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
  start_time?: string
  end_time?: string
}

export interface AgencyDeployment {
  id: string
  agency_id: string
  site_id: string
  event_date: string
  agency_acknowledged: boolean
  agency_acknowledged_by?: string | null
  agency_acknowledged_at?: string | null
  informed_by?: string | null
  approved_by?: string | null
  status: "scheduled" | "completed" | "cancelled"
  guard_count?: number
  site?: AgencySite | null
  // Populated by GET .../deployments (list) directly — who's actually
  // assigned, not just a count. See DeploymentAssignedGuard for the shape.
  staff?: DeploymentAssignedGuard[]
}

export interface DeploymentAssignedGuard {
  id: string
  name: string
  job_role?: string
  scheduled_hours: number
  start_time?: string | null
  end_time?: string | null
  attended?: boolean | null
}

export function complianceBadgeStatus(status?: string): "green" | "amber" | "red" | "unknown" {
  if (status === "COMPLIANT") return "green"
  if (status === "ACTION_NEEDED") return "amber"
  if (status === "EXPIRED") return "red"
  return "unknown"
}

interface AgencyOption { id: string; name: string }

interface DeploymentFormProps {
  // Agency-portal usage passes a fixed agencyId (behaviour unchanged).
  // Admin usage (DeploymentsPage) omits it — the form shows an agency
  // picker first, then fetches that agency's roster once one is chosen.
  agencyId?: string
  sites: AgencySite[]
  roster?: AgencyStaffRow[] // full active roster — agency-portal fetches this once and passes it in; admin usage leaves this unset and the form fetches it itself after the agency picker
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
  agencyId: agencyIdProp, sites, roster: rosterProp, deployment, initialAssignments, initialDate, onSaved, onCancel,
}: DeploymentFormProps) {
  const isEdit = !!deployment

  // Admin picker state — unused (and un-fetched) when agencyIdProp is set.
  const [pickedAgencyId, setPickedAgencyId] = useState("")
  const [agencies, setAgencies] = useState<AgencyOption[]>([])
  const [loadingAgencies, setLoadingAgencies] = useState(false)
  const [roster, setRoster] = useState<AgencyStaffRow[]>(rosterProp ?? [])
  const [loadingRoster, setLoadingRoster] = useState(false)

  const agencyId = agencyIdProp ?? pickedAgencyId

  const [siteId, setSiteId] = useState(deployment?.site_id ?? sites[0]?.id ?? "")
  const [eventDate, setEventDate] = useState((deployment?.event_date ?? initialDate ?? "").slice(0, 10))
  // Shift entered as a start/end clock time on the single event_date (e.g.
  // 10:00 to 18:00), not a raw hours count — the server derives
  // scheduled_hours from this. Presence of a staff id in this record is what
  // "selected" means, same as the old `hours` record did.
  const [shifts, setShifts] = useState<Record<string, { start_time: string; end_time: string }>>(() => {
    const init: Record<string, { start_time: string; end_time: string }> = {}
    for (const a of initialAssignments ?? []) {
      init[a.agency_staff_id] = { start_time: a.start_time ?? "10:00", end_time: a.end_time ?? "18:00" }
    }
    return init
  })
  const [informedBy, setInformedBy] = useState(deployment?.informed_by ?? "")
  const [approvedBy, setApprovedBy] = useState(deployment?.approved_by ?? "")
  const [eligibleIds, setEligibleIds] = useState<Set<string> | null>(null)
  const [checkingEligibility, setCheckingEligibility] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Admin usage only: load the agency list for the picker.
  useEffect(() => {
    if (agencyIdProp) return
    setLoadingAgencies(true)
    api.get<{ ok: boolean; agencies: AgencyOption[] }>("/api/agencies")
      .then(d => setAgencies(d.agencies ?? []))
      .catch(() => toast.error("Failed to load agencies"))
      .finally(() => setLoadingAgencies(false))
  }, [agencyIdProp])

  // Admin usage only: once an agency is picked, fetch its roster the same
  // way the agency-portal call site already does (GET .../staff, once).
  useEffect(() => {
    if (agencyIdProp) return
    if (!pickedAgencyId) { setRoster([]); return }
    let cancelled = false
    setLoadingRoster(true)
    api.get<{ ok: boolean; staff: AgencyStaffRow[] }>(`/api/agencies/${pickedAgencyId}/staff`)
      .then(d => { if (!cancelled) setRoster(d.staff ?? []) })
      .catch(() => { if (!cancelled) toast.error("Failed to load agency roster") })
      .finally(() => { if (!cancelled) setLoadingRoster(false) })
    return () => { cancelled = true }
  }, [agencyIdProp, pickedAgencyId])

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
    setShifts(prev => {
      const next = { ...prev }
      if (id in next) delete next[id]
      else if (eligible || isEdit) next[id] = { start_time: "10:00", end_time: "18:00" } // sensible default shift
      return next
    })
  }

  function setGuardShift(id: string, field: "start_time" | "end_time", v: string) {
    setShifts(prev => ({ ...prev, [id]: { ...prev[id], [field]: v } }))
  }

  function ineligibleReason(staff: AgencyStaffRow): string {
    if (staff.compliance_status === "EXPIRED") return "Expired compliance — cannot be deployed"
    return "Marked unavailable on this date"
  }

  async function handleSave() {
    if (!agencyId) { setError("Select an agency."); return }
    if (!siteId) { setError("Select a site."); return }
    if (!eventDate) { setError("Select an event date."); return }
    const staffPayload: DeploymentAssignment[] = Object.entries(shifts).map(([agency_staff_id, t]) => {
      // Mirrors the server's own derivation (validateDeploymentStaff) purely
      // so the local assignments cache this feeds back into (via onSaved)
      // has a usable scheduled_hours immediately, without waiting on a
      // re-fetch — the server's own computed value is still the one that
      // actually gets persisted.
      const [sh, sm] = t.start_time.split(":").map(Number)
      const [eh, em] = t.end_time.split(":").map(Number)
      const scheduled_hours = Number.isFinite(sh) && Number.isFinite(eh)
        ? Math.round(((eh * 60 + em - (sh * 60 + sm)) / 60) * 100) / 100
        : 0
      return { agency_staff_id, start_time: t.start_time, end_time: t.end_time, scheduled_hours }
    })
    if (!staffPayload.length) { setError("Select at least one guard."); return }
    if (staffPayload.some(s => !s.start_time || !s.end_time)) {
      setError("Every selected guard needs a start and end time."); return
    }
    if (staffPayload.some(s => (s.end_time as string) <= (s.start_time as string))) {
      setError("End time must be after start time for every guard."); return
    }
    setSaving(true); setError("")
    try {
      if (isEdit && deployment) {
        await api.patch(`/api/agencies/${agencyId}/deployments/${deployment.id}`, {
          staff: staffPayload, informed_by: informedBy.trim(), approved_by: approvedBy.trim(),
        })
        onSaved(deployment.id, staffPayload)
        toast.success("Deployment updated")
      } else {
        const d = await api.post<{ ok: boolean; deployment_id: string }>(
          `/api/agencies/${agencyId}/deployments`,
          { site_id: siteId, event_date: eventDate, staff: staffPayload, informed_by: informedBy.trim(), approved_by: approvedBy.trim() }
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
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {!agencyIdProp && (
          <Field label="Agency *">
            <select value={pickedAgencyId} onChange={e => setPickedAgencyId(e.target.value)}
              disabled={isEdit || loadingAgencies}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60">
              <option value="">— Select agency —</option>
              {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}

        {!agencyId ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            Pick an agency to see their site, date and guard options.
          </p>
        ) : (
          <>
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
                Guards {(checkingEligibility || loadingRoster) && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
              </Label>
              {!eventDate ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Pick an event date to see who is eligible.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto rounded-lg border p-2">
                  {roster.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      {loadingRoster ? "Loading roster…" : "No guards on file for this agency yet."}
                    </p>
                  ) : roster.map(staff => {
                    const selected = staff.id in shifts
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
                          <div className="flex shrink-0 items-center gap-1">
                            <Input type="time" value={shifts[staff.id].start_time}
                              onChange={e => setGuardShift(staff.id, "start_time", e.target.value)}
                              className="h-7 w-24 text-xs" title="Start time" />
                            <span className="text-xs text-muted-foreground">to</span>
                            <Input type="time" value={shifts[staff.id].end_time}
                              onChange={e => setGuardShift(staff.id, "end_time", e.target.value)}
                              className="h-7 w-24 text-xs" title="End time" />
                          </div>
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

            {/* Free text, not looked up against a user account — a name
                relayed by phone or noted after the fact, not necessarily
                whoever happens to be logged in right now. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Informed by">
                <Input value={informedBy} onChange={e => setInformedBy(e.target.value)} placeholder="Manager's name" />
              </Field>
              <Field label="Approved by">
                <Input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} placeholder="Manager's name" />
              </Field>
            </div>
          </>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-6 py-4">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" onClick={handleSave} disabled={saving || !agencyId}>
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : isEdit ? "Save changes" : "Create deployment"}
        </Button>
      </div>
    </div>
  )
}
