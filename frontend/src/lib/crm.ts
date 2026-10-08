// Shared types + pure helpers for the CRM pages (events → leads → activity).
// Backend: crm.js. Dates arrive as plain 'YYYY-MM-DD' strings (the server casts
// DATE columns with to_char so no timezone shifting happens on the way here).

export type Stage = "new" | "qualified" | "quote" | "won" | "lost"
export type Rating = "" | "hot" | "warm" | "cold"

export const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "new",       label: "New",        color: "#94a3b8" },
  { key: "qualified", label: "Qualified",  color: "#3b82f6" },
  { key: "quote",     label: "Quote sent", color: "#f59e0b" },
  { key: "won",       label: "Won",        color: "#22c55e" },
  { key: "lost",      label: "Lost",       color: "#ef4444" },
]

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New", qualified: "Qualified", quote: "Quote sent", won: "Won", lost: "Lost",
}

export interface CrmEvent {
  id: string
  name: string
  venue: string
  start_date: string | null
  end_date: string | null
  services: string[]
  sources: string[]
  email_subject: string
  email_body: string
  sms_body: string
  archived: boolean
  lead_count?: number
  hot_count?: number
  won_count?: number
}

export interface CrmActivity {
  id: string
  kind: "created" | "edit" | "stage" | "email" | "text" | "call" | "note"
  text: string
  by: string
  ts: string
}

export interface CrmLead {
  id: string
  event_id: string
  company: string
  contact_name: string
  job_title: string
  email: string
  phone: string
  source: string
  services: string[]
  site_type: string
  region: string
  value: string | number
  start_expected: string
  rating: Rating
  stage: Stage
  show_day: string
  follow_up: string | null
  owner: string
  next_action: string
  tags: string[]
  notes: string
  last_contact: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  activity: CrmActivity[]
}

export type LeadDraft = Omit<CrmLead, "id" | "event_id" | "last_contact" | "deleted_at" | "created_at" | "updated_at" | "activity">

export const BLANK_LEAD: LeadDraft = {
  company: "", contact_name: "", job_title: "", email: "", phone: "", source: "", services: [], site_type: "",
  region: "", value: "", start_expected: "", rating: "", stage: "new", show_day: "pre", follow_up: null,
  owner: "", next_action: "", tags: [], notes: "",
}

export interface EventDefaults {
  services: string[]
  sources: string[]
  email_subject: string
  email_body: string
  sms_body: string
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function num(v: string | number | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function fmtMoney(n: number): string {
  return "£" + Math.round(n).toLocaleString("en-GB")
}

export function fmtShort(n: number): string {
  if (n >= 1_000_000) return "£" + (n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0) + "m"
  if (n >= 1_000) return "£" + (n / 1_000).toFixed(n % 1_000 ? 1 : 0) + "k"
  return "£" + Math.round(n)
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function fmtDay(iso: string | null | undefined, withYear = false): string {
  if (!iso) return ""
  return parseIso(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })
}

export function eventDates(ev: Pick<CrmEvent, "start_date" | "end_date">): string {
  if (!ev.start_date) return "Dates not set"
  if (!ev.end_date || ev.end_date === ev.start_date) return fmtDay(ev.start_date, true)
  return `${fmtDay(ev.start_date)} – ${fmtDay(ev.end_date, true)}`
}

export function timeAgo(iso: string | number | Date): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return Math.floor(s / 60) + " min ago"
  if (s < 86400) return Math.floor(s / 3600) + " h ago"
  if (s < 86400 * 7) return Math.floor(s / 86400) + " d ago"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ── Show days (derived from the event's own date range) ──────────────────────

export interface ShowDay { key: string; label: string; short: string; sub: string }

export function showDays(ev: Pick<CrmEvent, "start_date" | "end_date"> | null): ShowDay[] {
  const out: ShowDay[] = [{ key: "pre", label: "Pre-event", short: "Pre", sub: "" }]
  if (ev?.start_date && ev.end_date) {
    const start = parseIso(ev.start_date)
    const days = Math.min(14, Math.round((parseIso(ev.end_date).getTime() - start.getTime()) / 86400000) + 1)
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000)
      const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
      const dm = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
      out.push({ key: "d" + (i + 1), label: `Day ${i + 1} · ${wd} ${dm}`, short: "D" + (i + 1), sub: dm })
    }
  }
  out.push({ key: "post", label: "Post-event", short: "Post", sub: "" })
  return out
}

export function autoShowDay(ev: Pick<CrmEvent, "start_date" | "end_date"> | null): string {
  if (!ev?.start_date || !ev.end_date) return "pre"
  const t = todayIso()
  if (t < ev.start_date) return "pre"
  if (t > ev.end_date) return "post"
  return "d" + (Math.round((parseIso(t).getTime() - parseIso(ev.start_date).getTime()) / 86400000) + 1)
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function computeStats(leads: CrmLead[]) {
  const t = todayIso()
  const s = { total: leads.length, hot: 0, fudue: 0, quotes: 0, won: 0, openval: 0, wonval: 0, lost: 0 }
  for (const l of leads) {
    if (l.rating === "hot") s.hot++
    if (l.stage === "quote") s.quotes++
    if (l.stage === "won") { s.won++; s.wonval += num(l.value) }
    if (l.stage === "lost") s.lost++
    if (l.stage === "new" || l.stage === "qualified" || l.stage === "quote") s.openval += num(l.value)
    if (l.follow_up && l.follow_up <= t && l.stage !== "won" && l.stage !== "lost") s.fudue++
  }
  return s
}

export function topServices(leads: CrmLead[], limit = 6): [string, number][] {
  const m: Record<string, number> = {}
  leads.forEach((l) => l.services.forEach((s) => { m[s] = (m[s] || 0) + 1 }))
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, limit)
}

// ── Follow-up message templates ──────────────────────────────────────────────
// Placeholders: {firstName} {event} {services} {nextAction} {owner}. {nextAction}
// collapses to nothing when the lead has no next action, so the sentence flow
// never leaves an empty gap.

function firstName(l: CrmLead): string {
  const n = (l.contact_name || "").trim().split(/\s+/)[0]
  if (!n) return "there"
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()
}

function fill(tpl: string, l: CrmLead, ev: CrmEvent, nextAction: string): string {
  const svc = l.services.length ? l.services.slice(0, 2).join(" and ").toLowerCase() : "our security services"
  return tpl
    .replace(/\{firstName\}/g, firstName(l))
    .replace(/\{event\}/g, ev.name)
    .replace(/\{services\}/g, svc)
    .replace(/\{nextAction\}/g, nextAction)
    .replace(/\{owner\}/g, l.owner || "The GuardTec team")
}

export function emailLink(l: CrmLead, ev: CrmEvent): string {
  const next = l.next_action ? `As discussed, ${l.next_action}.\n\n` : ""
  return "mailto:" + encodeURIComponent(l.email) + "?subject=" + encodeURIComponent(fill(ev.email_subject, l, ev, "")) +
    "&body=" + encodeURIComponent(fill(ev.email_body, l, ev, next))
}

export function smsLink(l: CrmLead, ev: CrmEvent): string {
  const next = l.next_action ? `${l.next_action}. ` : ""
  return "sms:" + (l.phone || "").replace(/\s+/g, "") + "?&body=" + encodeURIComponent(fill(ev.sms_body, l, ev, next))
}

// Loose "same company" test, used for the duplicate warning on New lead.
export function normCompany(s: string): string {
  return (s || "").toLowerCase().replace(/\b(ltd|limited|plc|llp|uk|group|services|security)\b/g, "").replace(/[^a-z0-9]/g, "")
}
