import { useState } from "react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Modal from "./Modal"
import type { CrmEvent, EventDefaults } from "@/lib/crm"

const TEXTAREA = "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"

// Create or edit an event ("a CRM"). The advanced block holds everything that
// used to be hard-coded in the single-event Netlify CRM: the services list,
// lead sources and the follow-up email / text wording.
export default function EventModal({ event, defaults, isDirector, onClose, onSaved, onDeleted }: {
  event: CrmEvent | null
  defaults: EventDefaults
  isDirector: boolean
  onClose: () => void
  onSaved: (ev: CrmEvent) => void
  onDeleted?: () => void
}) {
  const [name, setName] = useState(event?.name ?? "")
  const [venue, setVenue] = useState(event?.venue ?? "")
  const [start, setStart] = useState(event?.start_date ?? "")
  const [end, setEnd] = useState(event?.end_date ?? "")
  const [services, setServices] = useState((event?.services ?? defaults.services).join("\n"))
  const [sources, setSources] = useState((event?.sources ?? defaults.sources).join("\n"))
  const [subject, setSubject] = useState(event?.email_subject ?? defaults.email_subject)
  const [body, setBody] = useState(event?.email_body ?? defaults.email_body)
  const [sms, setSms] = useState(event?.sms_body ?? defaults.sms_body)
  const [archived, setArchived] = useState(event?.archived ?? false)
  const [showAdv, setShowAdv] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean)

  async function save() {
    if (!name.trim()) { toast.error("Give the event a name"); return }
    if (start && end && end < start) { toast.error("End date can't be before the start date"); return }
    setSaving(true)
    const payload = {
      name, venue, start_date: start || null, end_date: end || null,
      services: lines(services), sources: lines(sources),
      email_subject: subject, email_body: body, sms_body: sms, archived,
    }
    try {
      const d = event
        ? await api.patch<{ event: CrmEvent }>(`/api/crm/events/${event.id}`, payload)
        : await api.post<{ event: CrmEvent }>("/api/crm/events", payload)
      toast.success(event ? "Event updated" : "Event created")
      onSaved(d.event)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save the event")
    }
    setSaving(false)
  }

  async function del() {
    try {
      await api.delete(`/api/crm/events/${event!.id}`)
      toast.success("Event deleted")
      onDeleted?.()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete the event")
    }
  }

  return (
    <Modal title={event ? "Event settings" : "New event"} subtitle={event ? undefined : "Each event gets its own pipeline"} onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          {event && isDirector ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 dark:text-red-400">Deletes all its leads. Sure?</span>
                <Button size="sm" variant="destructive" onClick={del}>Delete forever</Button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">Delete event…</button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : event ? "Save changes" : "Create event"}</Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ev-name">Event name</Label>
          <Input id="ev-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. UK Construction Week 2026" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-venue">Venue / location</Label>
          <Input id="ev-venue" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. NEC Birmingham" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ev-start">Starts</Label>
            <Input id="ev-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-end">Ends</Label>
            <Input id="ev-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">The dates decide the "Day 1, Day 2…" labels leads are tagged with.</p>

        <button type="button" onClick={() => setShowAdv((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
          {showAdv ? "− Hide advanced" : "+ Services, sources & follow-up messages"}
        </button>

        {showAdv && (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-services">Services you sell (one per line)</Label>
              <textarea id="ev-services" rows={5} value={services} onChange={(e) => setServices(e.target.value)} className={TEXTAREA} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-sources">How leads reach you (one per line)</Label>
              <textarea id="ev-sources" rows={4} value={sources} onChange={(e) => setSources(e.target.value)} className={TEXTAREA} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-subject">Follow-up email subject</Label>
              <Input id="ev-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-body">Follow-up email text</Label>
              <textarea id="ev-body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} className={TEXTAREA} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-sms">Follow-up text message</Label>
              <textarea id="ev-sms" rows={3} value={sms} onChange={(e) => setSms(e.target.value)} className={TEXTAREA} />
            </div>
            <p className="text-xs text-muted-foreground">
              Fill-ins you can use: <code>{"{firstName}"}</code> <code>{"{event}"}</code> <code>{"{services}"}</code> <code>{"{nextAction}"}</code> <code>{"{owner}"}</code>
            </p>
          </div>
        )}

        {event && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="h-4 w-4" />
            Archive this event (moves it to the bottom, keeps all leads)
          </label>
        )}
      </div>
    </Modal>
  )
}
