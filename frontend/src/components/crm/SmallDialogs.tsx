import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Copy, RotateCcw, Trash2 } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Modal from "./Modal"
import { autoShowDay, timeAgo, type CrmEvent, type CrmLead, type Rating } from "@/lib/crm"

// ── Quick capture ────────────────────────────────────────────────────────────
// For a busy stand: company + phone + rating + one line, save, next one.
export function QuickModal({ event, onClose, onAdded }: {
  event: CrmEvent
  onClose: () => void
  onAdded: (lead: CrmLead) => void
}) {
  const [company, setCompany] = useState("")
  const [phone, setPhone] = useState("")
  const [note, setNote] = useState("")
  const [rating, setRating] = useState<Rating>("")
  const [saving, setSaving] = useState(false)
  const [count, setCount] = useState(0)

  async function save() {
    if (!company.trim()) { toast.error("Company name is required"); return }
    setSaving(true)
    try {
      const res = await api.post<{ lead: CrmLead }>(`/api/crm/events/${event.id}/leads`, {
        company, phone, rating, notes: note, quick: true, show_day: autoShowDay(event),
      })
      onAdded(res.lead)
      setCount((c) => c + 1)
      setCompany(""); setPhone(""); setNote(""); setRating("")
      toast.success("Lead added — next one ready")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save the lead")
    }
    setSaving(false)
  }

  return (
    <Modal title="Quick capture" subtitle={count ? `${count} added this session` : "Add a lead in seconds"} onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save & next"}</Button>
        </div>
      }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="space-y-1.5">
          <Label htmlFor="q-company">Company *</Label>
          <Input id="q-company" value={company} onChange={(e) => setCompany(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-phone">Phone</Label>
          <Input id="q-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Rating</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["hot", "warm", "cold"] as Rating[]).map((r) => (
              <button key={r} type="button" aria-pressed={rating === r} onClick={() => setRating(rating === r ? "" : r)}
                className={`rounded-md border py-1.5 text-xs font-semibold uppercase ${rating === r ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-note">One-line note</Label>
          <Input id="q-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What do they need?" />
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}

// ── Trash ────────────────────────────────────────────────────────────────────
export function TrashModal({ event, isDirector, onClose, onChanged }: {
  event: CrmEvent
  isDirector: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<CrmLead[] | null>(null)

  async function load() {
    try {
      const d = await api.get<{ leads: CrmLead[] }>(`/api/crm/events/${event.id}/leads?trash=1`)
      setRows(d.leads)
    } catch { setRows([]) }
  }
  useEffect(() => { load() }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function restore(l: CrmLead) {
    try {
      await api.post(`/api/crm/leads/${l.id}/restore`)
      toast.success(`${l.company} restored`)
      await load(); onChanged()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't restore") }
  }

  async function wipe(l: CrmLead) {
    if (!window.confirm(`Permanently delete ${l.company}? This can't be undone.`)) return
    try {
      await api.delete(`/api/crm/leads/${l.id}`)
      toast.success("Deleted forever")
      await load()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't delete") }
  }

  return (
    <Modal title="Trash" subtitle="Deleted leads stay here until a Director removes them for good" onClose={onClose}>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Trash is empty.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{l.company}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[l.contact_name, l.deleted_at ? `deleted ${timeAgo(l.deleted_at)}` : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="outline" className="gap-1" onClick={() => restore(l)}><RotateCcw className="h-3.5 w-3.5" /> Restore</Button>
                {isDirector && (
                  <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-600 dark:text-red-400" onClick={() => wipe(l)} aria-label="Delete forever">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

// ── Share link + QR ──────────────────────────────────────────────────────────
// The link opens this event's pipeline; anyone using it still has to sign in
// and hold the CRM permission, so sharing the link shares nothing by itself.
export function QrModal({ event, onClose }: { event: CrmEvent; onClose: () => void }) {
  const url = `${window.location.origin}/crm/${event.id}`
  const [img, setImg] = useState("")

  useEffect(() => {
    let alive = true
    import("qrcode").then((q) => q.toDataURL(url, { width: 280, margin: 1 })).then((d) => { if (alive) setImg(d) }).catch(() => {})
    return () => { alive = false }
  }, [url])

  async function copy() {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied") }
    catch { toast.message("Copy this link", { description: url, duration: 12000 }) }
  }

  return (
    <Modal title="Team link" subtitle={event.name} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 text-center">
        {img ? <img src={img} alt="QR code for this event's CRM" className="h-56 w-56 rounded-lg border bg-white p-2" /> : <div className="h-56 w-56 rounded-lg border bg-muted" />}
        <p className="max-w-xs text-xs text-muted-foreground">
          Scan or share this link with colleagues. They sign in with their own GuardTec account, and only people with CRM access can open it.
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={copy}><Copy className="h-3.5 w-3.5" /> Copy link</Button>
      </div>
    </Modal>
  )
}
