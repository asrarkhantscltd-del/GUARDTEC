import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Mail, MessageSquare, Mic, ScanLine, Trash2, Loader2, AlertTriangle } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Modal from "./Modal"
import {
  BLANK_LEAD, STAGES, autoShowDay, emailLink, smsLink, normCompany, showDays, timeAgo,
  type CrmEvent, type CrmLead, type LeadDraft, type Rating, type Stage,
} from "@/lib/crm"

const TEXTAREA = "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
const SELECT = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"

const RATING_STYLE: Record<string, string> = {
  hot:  "border-orange-500 bg-orange-500 text-white",
  warm: "border-amber-500 bg-amber-500 text-white",
  cold: "border-sky-500 bg-sky-500 text-white",
}

const KIND_LABEL: Record<string, string> = {
  created: "Created", edit: "Edited", stage: "Stage", email: "Email", text: "Text", call: "Call", note: "Note",
}

// Minimal typing for the (vendor-prefixed) Web Speech API — not in lib.dom.
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function toDraft(l: CrmLead): LeadDraft {
  const { id: _i, event_id: _e, last_contact: _lc, deleted_at: _d, created_at: _c, updated_at: _u, activity: _a, ...rest } = l
  void [_i, _e, _lc, _d, _c, _u, _a]
  return { ...rest, value: Number(rest.value) ? String(Number(rest.value)) : "" }
}

export default function LeadModal({ event, lead, leads, onClose, onSaved, onTrashed, onLeadUpdated }: {
  event: CrmEvent
  lead: CrmLead | null
  leads: CrmLead[]
  onClose: () => void
  onSaved: (lead: CrmLead) => void
  onTrashed: (id: string) => void
  onLeadUpdated: (lead: CrmLead) => void
}) {
  const days = useMemo(() => showDays(event), [event])
  const [d, setD] = useState<LeadDraft>(() => lead ? toDraft(lead) : { ...BLANK_LEAD, show_day: autoShowDay(event), source: event.sources[0] ?? "" })
  const [tagsText, setTagsText] = useState((lead?.tags ?? []).join(", "))
  const [tab, setTab] = useState<"details" | "activity">("details")
  const [more, setMore] = useState(!!lead)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<Recognition | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof LeadDraft>(k: K, v: LeadDraft[K]) => setD((p) => ({ ...p, [k]: v }))
  const live = lead ? leads.find((l) => l.id === lead.id) ?? lead : null

  const dup = useMemo(() => {
    if (lead) return []
    const n = normCompany(d.company)
    if (d.company.trim().length < 3 || !n) return []
    return leads.filter((l) => { const ln = normCompany(l.company); return ln && (ln === n || ln.includes(n) || n.includes(ln)) }).slice(0, 2)
  }, [d.company, leads, lead])

  function toggleService(s: string) {
    set("services", d.services.includes(s) ? d.services.filter((x) => x !== s) : [...d.services, s])
  }

  async function save() {
    if (!d.company.trim()) { toast.error("Company name is required"); return }
    setSaving(true)
    const payload = {
      ...d, value: Number(d.value) || 0, follow_up: d.follow_up || null,
      tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
    }
    try {
      const res = lead
        ? await api.patch<{ lead: CrmLead }>(`/api/crm/leads/${lead.id}`, payload)
        : await api.post<{ lead: CrmLead }>(`/api/crm/events/${event.id}/leads`, payload)
      toast.success(lead ? "Lead updated" : "Lead added")
      onSaved(res.lead)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save the lead")
    }
    setSaving(false)
  }

  async function trash() {
    if (!lead) return
    try {
      await api.post(`/api/crm/leads/${lead.id}/trash`)
      toast.success("Moved to trash")
      onTrashed(lead.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't move to trash")
    }
  }

  // Logs the follow-up on the lead's timeline, then hands off to the phone's
  // own mail / messages app with the message pre-filled.
  async function followUp(kind: "email" | "text") {
    if (!live) return
    const link = kind === "email" ? emailLink(live, event) : smsLink(live, event)
    try {
      const res = await api.post<{ lead: CrmLead }>(`/api/crm/leads/${live.id}/activity`, {
        kind, text: kind === "email" ? "Follow-up email started" : "Follow-up text started",
      })
      onLeadUpdated(res.lead)
    } catch { /* logging is best-effort — still open the message */ }
    window.location.href = link
  }

  function dictate() {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) { toast.error("Dictation isn't supported in this browser"); return }
    if (listening) { recRef.current?.stop(); return }
    const rec = new Ctor()
    rec.lang = "en-GB"; rec.continuous = true; rec.interimResults = false
    rec.onresult = (e) => {
      let text = ""
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript
      if (text) setD((p) => ({ ...p, notes: (p.notes ? p.notes.replace(/\s+$/, "") + " " : "") + text.trim() }))
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => { setListening(false); toast.error("Couldn't hear that — check the microphone permission") }
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  // Business-card scan: OCR runs in the browser (the photo never leaves the
  // device); only the text it reads is put into the form for the user to check.
  async function scanCard(file: File | undefined) {
    if (!file) return
    setScanning(true)
    try {
      const { recognize } = await import("tesseract.js")
      const res = await recognize(file, "eng")
      const text = res.data.text || ""
      const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean)
      const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? ""
      const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0] ?? ""
      const person = lines.find((l) => /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(l)) ?? ""
      const companyLine = lines.find((l) => l !== person && !l.includes("@") && !/\d{5,}/.test(l) && l.length > 2) ?? ""
      setD((p) => ({
        ...p,
        email: p.email || email,
        phone: p.phone || phone.replace(/\s{2,}/g, " ").trim(),
        company: p.company || companyLine,
        contact_name: p.contact_name || person,
        notes: (p.notes ? p.notes + "\n\n" : "") + "From scanned card:\n" + text.trim(),
      }))
      setMore(true)
      toast.success("Card scanned — please check the details")
    } catch {
      toast.error("Couldn't read that card — try better light")
    }
    setScanning(false)
    if (fileRef.current) fileRef.current.value = ""
  }

  const activity = live?.activity ?? []

  return (
    <Modal wide title={lead ? lead.company : "New lead"} subtitle={lead ? [lead.contact_name, lead.job_title].filter(Boolean).join(" · ") : event.name}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          {lead ? (
            <button onClick={trash} className="flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : lead ? "Save changes" : "Add lead"}</Button>
          </div>
        </div>
      }>
      {lead && (
        <div className="-mt-1 mb-4 flex gap-1 border-b">
          {(["details", "activity"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t}{t === "activity" && activity.length ? ` (${activity.length})` : ""}
            </button>
          ))}
        </div>
      )}

      {tab === "activity" && lead ? (
        <ol className="space-y-3">
          {activity.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
          {activity.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
              <div className="min-w-0">
                <p className="break-words">{a.text}</p>
                <p className="text-xs text-muted-foreground">{KIND_LABEL[a.kind] ?? a.kind}{a.by ? ` · ${a.by}` : ""} · {timeAgo(a.ts)}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-4">
          {lead ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow up</span>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!d.email} onClick={() => followUp("email")}
                title={d.email ? "Opens your email app with a ready message" : "Add an email address first"}>
                <Mail className="h-3.5 w-3.5" /> Email
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!d.phone} onClick={() => followUp("text")}
                title={d.phone ? "Opens your messages app with a ready text" : "Add a phone number first"}>
                <MessageSquare className="h-3.5 w-3.5" /> Text
              </Button>
            </div>
          ) : (
            <div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => scanCard(e.target.files?.[0])} />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={scanning} onClick={() => fileRef.current?.click()}>
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                {scanning ? "Reading card…" : "Scan a business card"}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">Take a photo of a card and the details fill in for you to check.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="l-company">Company *</Label>
              <Input id="l-company" value={d.company} onChange={(e) => set("company", e.target.value)} autoFocus={!lead} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-contact">Contact name</Label>
              <Input id="l-contact" value={d.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </div>
          </div>
          {dup.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Possible duplicate: {dup.map((l) => l.company).join(", ")} is already in this pipeline.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="l-phone">Phone</Label>
              <Input id="l-phone" type="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-email">Email</Label>
              <Input id="l-email" type="email" value={d.email} onChange={(e) => set("email", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Services of interest</Label>
            <div className="flex flex-wrap gap-2">
              {event.services.map((s) => (
                <button key={s} type="button" onClick={() => toggleService(s)} aria-pressed={d.services.includes(s)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${d.services.includes(s) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Lead rating</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["hot", "warm", "cold"] as Rating[]).map((r) => (
                  <button key={r} type="button" aria-pressed={d.rating === r} onClick={() => set("rating", d.rating === r ? "" : r)}
                    className={`rounded-md border py-1.5 text-xs font-semibold uppercase ${d.rating === r ? RATING_STYLE[r] : "text-muted-foreground hover:text-foreground"}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-day">Event day</Label>
              <select id="l-day" value={d.show_day} onChange={(e) => set("show_day", e.target.value)} className={SELECT}>
                {days.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Pipeline stage</Label>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((s) => (
                <button key={s.key} type="button" aria-pressed={d.stage === s.key} onClick={() => set("stage", s.key as Stage)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase ${d.stage === s.key ? "border-transparent text-white" : "text-muted-foreground hover:text-foreground"}`}
                  style={d.stage === s.key ? { background: s.color } : undefined}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="l-notes">Conversation notes</Label>
              <button type="button" onClick={dictate}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${listening ? "border-red-500 bg-red-500/10 text-red-600" : "text-muted-foreground hover:text-foreground"}`}>
                <Mic className="h-3 w-3" /> {listening ? "Listening… tap to stop" : "Dictate"}
              </button>
            </div>
            <textarea id="l-notes" rows={3} value={d.notes} onChange={(e) => set("notes", e.target.value)} className={TEXTAREA}
              placeholder="What did they need? Key requirements, timelines, decision-makers, next step…" />
          </div>

          <button type="button" onClick={() => setMore((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
            {more ? "− Fewer details" : "+ More details"}
          </button>

          {more && (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="l-title">Job title</Label>
                <Input id="l-title" value={d.job_title} onChange={(e) => set("job_title", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-source">How they reached us</Label>
                <select id="l-source" value={d.source} onChange={(e) => set("source", e.target.value)} className={SELECT}>
                  <option value="">—</option>
                  {[...event.sources, ...(d.source && !event.sources.includes(d.source) ? [d.source] : [])].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-site">Site / project type</Label>
                <Input id="l-site" value={d.site_type} onChange={(e) => set("site_type", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-region">Region / location</Label>
                <Input id="l-region" value={d.region} onChange={(e) => set("region", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-value">Est. contract value (£)</Label>
                <Input id="l-value" type="number" inputMode="decimal" min={0} value={String(d.value)} onChange={(e) => set("value", e.target.value)} placeholder="e.g. 36000" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-start">Expected start</Label>
                <Input id="l-start" value={d.start_expected} onChange={(e) => set("start_expected", e.target.value)} placeholder="e.g. Jan 2027 / Q1 2027" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-fu">Follow-up date</Label>
                <Input id="l-fu" type="date" value={d.follow_up ?? ""} onChange={(e) => set("follow_up", e.target.value || null)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-owner">Owner / captured by</Label>
                <Input id="l-owner" value={d.owner} onChange={(e) => set("owner", e.target.value)} placeholder="Initials" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="l-next">Next action</Label>
                <Input id="l-next" value={d.next_action} onChange={(e) => set("next_action", e.target.value)} placeholder="e.g. Send capability pack + quote" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="l-tags">Tags (comma separated)</Label>
                <Input id="l-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="e.g. multi-site, framework, urgent" />
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
