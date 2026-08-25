import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Trash2, CalendarOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { fmtDate } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"

// Table: agency_staff_unavailability. Routes (server.js, exact):
//   POST/GET /api/agencies/:agencyId/staff/:id/unavailability
//   DELETE   /api/agencies/:agencyId/staff/:id/unavailability/:unavailabilityId
// Note the DELETE path nests under .../staff/:id/... , NOT the flatter
// .../agencies/:agencyId/unavailability/:id the plan doc sketches — this
// matches the real route registered in server.js.
export interface UnavailabilityEntry {
  id: string
  agency_staff_id?: string
  date_from: string
  date_to: string
  reason?: string
  created_at?: string
}

interface UnavailabilityCalendarProps {
  agencyId: string
  staffId: string
  initialEntries?: UnavailabilityEntry[]
}

export function UnavailabilityCalendar({ agencyId, staffId, initialEntries }: UnavailabilityCalendarProps) {
  const [entries, setEntries] = useState<UnavailabilityEntry[]>(initialEntries ?? [])
  const [loading, setLoading] = useState(!initialEntries)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [reason, setReason] = useState("")
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (initialEntries) return
    let cancelled = false
    setLoading(true)
    api.get<{ ok: boolean; unavailability: UnavailabilityEntry[] }>(
      `/api/agencies/${agencyId}/staff/${staffId}/unavailability`
    ).then(d => { if (!cancelled) setEntries(d.unavailability ?? []) })
      .catch(() => { if (!cancelled) setError("Could not load unavailability dates.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agencyId, staffId, initialEntries])

  async function addRange() {
    setError("")
    if (!dateFrom || !dateTo) { setError("Both start and end dates are required."); return }
    if (dateTo < dateFrom) { setError("End date cannot be before start date."); return }
    setAdding(true)
    try {
      const res = await api.post<{ ok: boolean; unavailability: UnavailabilityEntry }>(
        `/api/agencies/${agencyId}/staff/${staffId}/unavailability`,
        { date_from: dateFrom, date_to: dateTo, reason: reason.trim() || undefined }
      )
      setEntries(prev => [...prev, res.unavailability].sort((a, b) => a.date_from.localeCompare(b.date_from)))
      setDateFrom(""); setDateTo(""); setReason("")
      toast.success("Unavailable dates added")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again.")
    } finally {
      setAdding(false)
    }
  }

  async function removeRange(id: string) {
    setDeletingId(id)
    try {
      await api.delete(`/api/agencies/${agencyId}/staff/${staffId}/unavailability/${id}`)
      setEntries(prev => prev.filter(e => e.id !== id))
      setConfirmId(null)
      toast.success("Removed")
    } catch {
      toast.error("Network error — could not remove")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="text-xs">Loading dates…</span>
        </div>
      ) : entries.length === 0 ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          <CalendarOff className="h-3.5 w-3.5 shrink-0" /> No unavailable dates on file.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{fmtDate(e.date_from)} – {fmtDate(e.date_to)}</p>
                {e.reason && <p className="truncate text-[11px] text-muted-foreground">{e.reason}</p>}
              </div>
              {confirmId === e.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => removeRange(e.id)} disabled={deletingId === e.id}
                    className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-white hover:bg-destructive/90 disabled:opacity-50">
                    {deletingId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                  </button>
                  <button onClick={() => setConfirmId(null)} className="rounded-md border px-2 py-1 text-[10px] hover:bg-muted">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(e.id)} title="Remove"
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed bg-muted/20 p-3">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">From</label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">To</label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="min-w-[120px] flex-1 space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Reason (optional)</label>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Annual leave" className="h-8 text-xs" />
        </div>
        <Button size="sm" onClick={addRange} disabled={adding} className="gap-1">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </Button>
      </div>
    </div>
  )
}
