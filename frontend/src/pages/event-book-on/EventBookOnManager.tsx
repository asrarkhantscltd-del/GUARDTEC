import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  X, Loader2, Plus, Trash2, Copy, Check, MessageCircle,
  FileSpreadsheet, FileText, Pencil, Camera, ShieldCheck, Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api"
import { fmtDate } from "@/lib/utils"

interface BookOn {
  id: string
  book_on_date: string
  booked_on_at: string
  sia_photo_path?: string
  gps_lat?: number | null
  gps_lng?: number | null
}
interface EventStaff {
  id: string
  name: string
  mobile?: string
  sia_number?: string
  assigned_dates: string[]
  book_ons: BookOn[]
  book_on_url: string
}

// Every day the event runs, inclusive — the pool of dates a guard can be
// rostered for.
function eventDays(from?: string, to?: string): string[] {
  if (!from || !to) return []
  const days: string[] = []
  const d = new Date(from.slice(0, 10) + "T00:00:00Z")
  const end = new Date(to.slice(0, 10) + "T00:00:00Z")
  let guard = 0
  while (d <= end && guard < 400) { days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); guard++ }
  return days
}

// UK mobile → wa.me international format (no +, leading 0 → 44).
function waNumber(mobile: string): string {
  let n = mobile.replace(/[^\d+]/g, "")
  if (n.startsWith("+")) n = n.slice(1)
  if (n.startsWith("0")) n = "44" + n.slice(1)
  return n
}

export default function EventBookOnManager({
  instructionId, title, eventFrom, eventTo, onClose,
}: {
  instructionId: string
  title: string
  eventFrom?: string
  eventTo?: string
  onClose: () => void
}) {
  const [staff, setStaff] = useState<EventStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: "", mobile: "", sia_number: "", dates: new Set<string>() })

  const days = useMemo(() => eventDays(eventFrom, eventTo), [eventFrom, eventTo])

  async function load() {
    setLoading(true)
    try {
      const d = await api.get<{ ok: boolean; staff: EventStaff[] }>(`/api/event-instructions/${instructionId}/event-staff`)
      setStaff(d.staff ?? [])
    } catch {
      toast.error("Failed to load event staff")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() {
    setEditingId(null)
    setForm({ name: "", mobile: "", sia_number: "", dates: new Set(days) })
    setShowForm(true)
  }
  function openEdit(s: EventStaff) {
    setEditingId(s.id)
    setForm({ name: s.name, mobile: s.mobile ?? "", sia_number: s.sia_number ?? "", dates: new Set(s.assigned_dates) })
    setShowForm(true)
  }
  function toggleDay(d: string) {
    setForm(p => {
      const next = new Set(p.dates)
      if (next.has(d)) next.delete(d); else next.add(d)
      return { ...p, dates: next }
    })
  }

  async function save() {
    if (!form.name.trim()) { toast.error("Name is required"); return }
    if (form.dates.size === 0) { toast.error("Select at least one day"); return }
    setSaving(true)
    const body = {
      name: form.name.trim(),
      mobile: form.mobile.trim() || undefined,
      sia_number: form.sia_number.trim() || undefined,
      assigned_dates: [...form.dates].sort(),
    }
    try {
      if (editingId) {
        await api.patch(`/api/event-instructions/${instructionId}/event-staff/${editingId}`, body)
        toast.success("Updated")
      } else {
        await api.post(`/api/event-instructions/${instructionId}/event-staff`, body)
        toast.success("Event staff added")
      }
      setShowForm(false)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setSaving(false)
    }
  }

  async function remove(s: EventStaff) {
    if (!confirm(`Remove ${s.name} from this event?`)) return
    try {
      await api.delete(`/api/event-instructions/${instructionId}/event-staff/${s.id}`)
      toast.success("Removed")
      await load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error")
    }
  }

  function copy(s: EventStaff) {
    navigator.clipboard.writeText(s.book_on_url).then(() => {
      setCopiedId(s.id); setTimeout(() => setCopiedId(null), 1500)
    }).catch(() => toast.error("Couldn't copy"))
  }
  function whatsapp(s: EventStaff) {
    const msg = `Hi ${s.name}, please read your event assignment instructions and book on here: ${s.book_on_url}`
    const base = s.mobile ? `https://wa.me/${waNumber(s.mobile)}` : "https://wa.me/"
    window.open(`${base}?text=${encodeURIComponent(msg)}`, "_blank", "noopener")
  }

  const bookedByDate = (s: EventStaff) => {
    const m: Record<string, BookOn> = {}
    s.book_ons.forEach(b => { m[b.book_on_date] = b })
    return m
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />Event Book-On
          </h2>
          <p className="truncate text-xs text-muted-foreground">{title}
            {eventFrom && eventTo && <> · {fmtDate(eventFrom)} – {fmtDate(eventTo)}</>}
          </p>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
      </div>

      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {!eventFrom || !eventTo ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Set the event's From and Till dates first (edit the instruction) — book-on needs the date range.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <a href={`/api/event-instructions/${instructionId}/attendance.pdf`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                  <FileText className="h-3.5 w-3.5" />Attendance PDF
                </a>
                <a href={`/api/event-instructions/${instructionId}/attendance.xlsx`}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                  <FileSpreadsheet className="h-3.5 w-3.5" />Attendance Excel
                </a>
              </div>
              <Button size="sm" onClick={openAdd}><Plus className="mr-1 h-4 w-4" />Add staff</Button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
              </div>
            ) : staff.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No event staff yet. Add the external/agency guards working this event — each gets their own book-on link.
              </div>
            ) : (
              <div className="space-y-3">
                {staff.map(s => {
                  const booked = bookedByDate(s)
                  return (
                    <div key={s.id} className="surface p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm">{s.name}
                            {s.sia_number && <span className="ml-2 text-xs font-normal text-muted-foreground">SIA {s.sia_number}</span>}
                          </p>
                          {s.mobile && <p className="text-xs text-muted-foreground">{s.mobile}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button onClick={() => copy(s)} title="Copy link"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors">
                            {copiedId === s.id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                          </button>
                          <button onClick={() => whatsapp(s)} title="Share on WhatsApp"
                            className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-500/10 transition-colors">
                            <MessageCircle className="h-4 w-4" />
                          </button>
                          <button onClick={() => openEdit(s)} title="Edit"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => remove(s)} title="Remove"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {/* Per-day attendance pills */}
                      <div className="flex flex-wrap gap-1.5">
                        {s.assigned_dates.map(d => {
                          const b = booked[d]
                          const t = b ? new Date(b.booked_on_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null
                          return (
                            <span key={d} title={b ? `Booked on at ${t}` : "Not booked on"}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                b ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"
                              }`}>
                              {b ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                              {fmtDate(d)}{b && t ? ` · ${t}` : ""}
                              {b && (
                                <a href={`/api/event-instructions/${instructionId}/book-on-photo/${b.id}/selfie`} target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()} className="ml-0.5 hover:opacity-70" title="View selfie">
                                  <Camera className="h-3 w-3" />
                                </a>
                              )}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add/edit staff form */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-xl border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editingId ? "Edit staff" : "Add event staff"}</h3>
              <button onClick={() => setShowForm(false)} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Guard full name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Mobile</Label>
                <Input value={form.mobile} onChange={e => setForm(p => ({ ...p, mobile: e.target.value }))} placeholder="07…" />
              </div>
              <div className="space-y-1.5">
                <Label>SIA number</Label>
                <Input value={form.sia_number} onChange={e => setForm(p => ({ ...p, sia_number: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned days *</Label>
              <div className="flex flex-wrap gap-1.5">
                {days.map(d => (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      form.dates.has(d) ? "border-primary bg-primary text-white" : "border-border hover:bg-muted"
                    }`}>
                    {fmtDate(d)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{editingId ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
