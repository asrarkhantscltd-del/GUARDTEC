import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Check, X as XIcon } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Input } from "@/components/ui/input"

export interface AttendanceRow {
  agency_staff_id: string
  name: string
  scheduled_hours: number
  attended?: boolean | null // null/undefined = not yet confirmed
  actual_hours?: number | null
}

interface AttendanceConfirmationProps {
  agencyId: string
  deploymentId: string
  assignments: AttendanceRow[]
  onUpdated: (row: AttendanceRow) => void
}

// Mark who actually showed up, after the event — one row per guard, posted
// individually to POST .../deployments/:id/attendance (upserts deployment_attendance).
export function AttendanceConfirmation({ agencyId, deploymentId, assignments, onUpdated }: AttendanceConfirmationProps) {
  const [rows, setRows] = useState<AttendanceRow[]>(assignments)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => { setRows(assignments) }, [assignments])

  function setLocal(id: string, patch: Partial<AttendanceRow>) {
    setRows(prev => prev.map(r => r.agency_staff_id === id ? { ...r, ...patch } : r))
  }

  async function save(row: AttendanceRow) {
    if (row.attended === null || row.attended === undefined) {
      toast.error("Mark whether they attended before saving."); return
    }
    setSavingId(row.agency_staff_id)
    try {
      await api.post(`/api/agencies/${agencyId}/deployments/${deploymentId}/attendance`, {
        agency_staff_id: row.agency_staff_id,
        attended: row.attended,
        actual_hours: row.actual_hours ?? row.scheduled_hours,
        note: notes[row.agency_staff_id]?.trim() || undefined,
      })
      onUpdated(row)
      setNotes(prev => ({ ...prev, [row.agency_staff_id]: "" }))
      toast.success(`Attendance saved for ${row.name}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setSavingId(null)
    }
  }

  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No guards assigned to this deployment.</p>
  }

  return (
    <div className="space-y-2">
      {rows.map(row => (
        <div key={row.agency_staff_id} className="space-y-2 rounded-lg border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="flex-1 min-w-0 truncate text-sm font-medium">{row.name}</p>
            <span className="text-xs text-muted-foreground">Scheduled {row.scheduled_hours}h</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setLocal(row.agency_staff_id, { attended: true, actual_hours: row.actual_hours ?? row.scheduled_hours })}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                  row.attended === true ? "bg-success/15 text-success border-success/30" : "border-border text-muted-foreground hover:bg-muted"
                }`}>
                <Check className="h-3 w-3" /> Attended
              </button>
              <button onClick={() => setLocal(row.agency_staff_id, { attended: false, actual_hours: 0 })}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                  row.attended === false ? "bg-destructive/15 text-destructive border-destructive/30" : "border-border text-muted-foreground hover:bg-muted"
                }`}>
                <XIcon className="h-3 w-3" /> No-show
              </button>
            </div>
          </div>
          {row.attended === true && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Actual hours</span>
              <Input type="number" min={0} step={0.5} value={row.actual_hours ?? row.scheduled_hours}
                onChange={e => setLocal(row.agency_staff_id, { actual_hours: Number(e.target.value) || 0 })}
                className="h-7 w-20 text-xs" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input placeholder="Optional note (e.g. arrived late)…" value={notes[row.agency_staff_id] ?? ""}
              onChange={e => setNotes(prev => ({ ...prev, [row.agency_staff_id]: e.target.value }))}
              className="h-8 flex-1 text-xs" />
            <button onClick={() => save(row)} disabled={savingId === row.agency_staff_id}
              className="shrink-0 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50">
              {savingId === row.agency_staff_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
