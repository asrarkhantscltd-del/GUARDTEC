import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowLeft, Columns3, List as ListIcon, BarChart3, Search, Download, Trash2, Zap, Plus, Settings, QrCode,
  FileSpreadsheet, FileText, Copy, Lock, MapPin, CalendarDays, Loader2, BellRing,
} from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { downloadExport } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import EventModal from "@/components/crm/EventModal"
import LeadModal from "@/components/crm/LeadModal"
import { QuickModal, TrashModal, QrModal } from "@/components/crm/SmallDialogs"
import {
  STAGES, STAGE_LABEL, computeStats, eventDates, fmtDay, fmtMoney, fmtShort, num, showDays, timeAgo, todayIso, topServices,
  type CrmEvent, type CrmLead, type EventDefaults, type Stage,
} from "@/lib/crm"

type View = "pipeline" | "list" | "insights"
const POLL_MS = 15000

const RATING_CHIP: Record<string, string> = {
  hot:  "bg-orange-500 text-white",
  warm: "bg-amber-500 text-white",
  cold: "bg-sky-500 text-white",
}

export default function CrmEventPage() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isDirector = user?.role === "director"

  const [event, setEvent] = useState<CrmEvent | null>(null)
  const [defaults, setDefaults] = useState<EventDefaults | null>(null)
  const [leads, setLeads] = useState<CrmLead[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [syncFailed, setSyncFailed] = useState(false)

  const [view, setView] = useState<View>("pipeline")
  const [q, setQ] = useState("")
  const [fService, setFService] = useState("")
  const [fRating, setFRating] = useState("")

  const [editing, setEditing] = useState<CrmLead | "new" | null>(null)
  const [showQuick, setShowQuick] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const loadAll = useCallback(async (initial = false) => {
    if (!eventId) return
    try {
      if (initial) {
        const ev = await api.get<{ events: CrmEvent[]; defaults: EventDefaults }>("/api/crm/events")
        const found = ev.events.find((e) => e.id === eventId)
        if (!found) { setNotFound(true); setLoading(false); return }
        setEvent(found); setDefaults(ev.defaults)
      }
      const d = await api.get<{ leads: CrmLead[] }>(`/api/crm/events/${eventId}/leads`)
      setLeads(d.leads)
      setSyncedAt(Date.now()); setSyncFailed(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true)
      else if (initial) setNotFound(true)
      else setSyncFailed(true)
    }
    if (initial) setLoading(false)
  }, [eventId])

  useEffect(() => { loadAll(true) }, [loadAll])

  // Keeps everyone looking at the same board: refresh every 15 s while the tab
  // is visible (and immediately when it comes back to the foreground).
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") loadAll() }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener("visibilitychange", tick)
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick) }
  }, [loadAll])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [menuOpen])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return leads.filter((l) => {
      if (fService && !l.services.includes(fService)) return false
      if (fRating && l.rating !== fRating) return false
      if (needle) {
        const hay = [l.company, l.contact_name, l.notes, l.region, l.job_title, l.email, l.tags.join(" ")].join(" ").toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [leads, q, fService, fRating])

  const stats = useMemo(() => computeStats(filtered), [filtered])
  const filtersOn = !!(q || fService || fRating)

  function upsert(l: CrmLead) {
    setLeads((prev) => prev.some((x) => x.id === l.id) ? prev.map((x) => x.id === l.id ? l : x) : [l, ...prev])
  }

  async function moveStage(l: CrmLead, stage: Stage) {
    if (l.stage === stage) return
    const before = leads
    setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, stage } : x))
    try {
      const res = await api.post<{ lead: CrmLead }>(`/api/crm/leads/${l.id}/stage`, { stage })
      upsert(res.lead)
      toast.success(`Moved to ${STAGE_LABEL[stage]}`)
    } catch (e) {
      setLeads(before)
      toast.error(e instanceof ApiError ? e.message : "Couldn't update the stage")
    }
  }

  async function doExport(format: "xlsx" | "csv") {
    setMenuOpen(false); setExporting(true)
    try { await downloadExport(`/api/crm/events/${eventId}/export?format=${format}`, `crm.${format}`) }
    catch { toast.error("Export failed") }
    setExporting(false)
  }

  async function doPdf() {
    setMenuOpen(false)
    if (!event || leads.length === 0) { toast.error("No leads to report yet"); return }
    try { const m = await import("@/components/crm/report"); await m.savePdfReport(event, leads); toast.success("Report saved") }
    catch { toast.error("Couldn't create the report") }
  }

  async function doCopy() {
    setMenuOpen(false)
    try {
      const m = await import("@/components/crm/report")
      await navigator.clipboard.writeText(m.leadsToTsv(leads))
      toast.success("Copied — paste into Excel or Sheets")
    } catch { toast.error("Couldn't copy to the clipboard") }
  }

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-16 text-center">
        <Lock className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">You are not authorized to view this</p>
        <p className="max-w-sm text-xs text-muted-foreground">Ask a Director to grant you the "CRM" permission under Manage Roles.</p>
      </div>
    )
  }
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (notFound || !event) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed p-12 text-center">
        <p className="text-sm font-medium">This event doesn't exist (or was deleted)</p>
        <Link to="/crm" className="text-sm font-semibold text-primary hover:underline">Back to all events</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <Link to="/crm" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All events
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold tracking-tight">{event.name}{event.archived && <span className="ml-2 align-middle text-xs font-medium text-muted-foreground">(archived)</span>}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {event.venue && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{event.venue}</span>}
              <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{eventDates(event)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${syncFailed ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
              title={syncedAt ? `Last synced ${timeAgo(syncedAt)}` : ""}>
              <span className={`h-1.5 w-1.5 rounded-full ${syncFailed ? "bg-red-500" : "bg-green-500"}`} />
              {syncFailed ? "Offline — retrying" : "Live · synced"}
            </span>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowQr(true)}><QrCode className="h-3.5 w-3.5" /> Team link</Button>
            <Button variant="outline" size="icon-sm" onClick={() => setShowSettings(true)} aria-label="Event settings" title="Event settings"><Settings className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          {([["pipeline", "Pipeline", Columns3], ["list", "List", ListIcon], ["insights", "Insights", BarChart3]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, contact, notes…" aria-label="Search leads"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm" />
        </div>
        <select value={fService} onChange={(e) => setFService(e.target.value)} aria-label="Filter by service"
          className="h-9 min-w-0 max-w-full rounded-md border border-input bg-transparent px-2 text-base outline-none md:text-sm dark:bg-input/30">
          <option value="">All services</option>
          {event.services.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fRating} onChange={(e) => setFRating(e.target.value)} aria-label="Filter by rating"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-base outline-none md:text-sm dark:bg-input/30">
          <option value="">All ratings</option>
          <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
        </select>
        {filtersOn && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setFService(""); setFRating("") }}>Clear</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New lead</Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowQuick(true)}><Zap className="h-3.5 w-3.5" /> Quick</Button>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative" ref={menuRef}>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMenuOpen((v) => !v)} disabled={exporting}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-30 w-52 overflow-hidden rounded-xl border bg-popover p-1 shadow-xl">
                {([
                  [FileSpreadsheet, "Excel (.xlsx)", () => doExport("xlsx")],
                  [FileText, "CSV", () => doExport("csv")],
                  [FileText, "PDF report", doPdf],
                  [Copy, "Copy to clipboard", doCopy],
                ] as const).map(([Icon, label, fn]) => (
                  <button key={label} onClick={fn} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowTrash(true)}><Trash2 className="h-3.5 w-3.5" /> Trash</Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Total leads" value={String(stats.total)} accent="#ff4a1c" />
        <Tile label="Hot" value={String(stats.hot)} accent="#f97316" />
        <Tile label="Follow-ups due" value={String(stats.fudue)} accent={stats.fudue ? "#ef4444" : "#94a3b8"} />
        <Tile label="Quotes out" value={String(stats.quotes)} accent="#f59e0b" />
        <Tile label="Won" value={String(stats.won)} accent="#22c55e" />
        <Tile label="Open pipeline" value={fmtMoney(stats.openval)} accent="#ff4a1c" />
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <Zap className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No leads yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Tap "Quick" to capture someone in seconds, or "New lead" for the full form.</p>
        </div>
      ) : view === "pipeline" ? (
        <Board leads={filtered} onOpen={setEditing} onMove={moveStage} />
      ) : view === "list" ? (
        <ListView leads={filtered} event={event} onOpen={setEditing} />
      ) : (
        <Insights leads={filtered} event={event} />
      )}

      {editing && (
        <LeadModal event={event} lead={editing === "new" ? null : editing} leads={leads}
          onClose={() => setEditing(null)}
          onSaved={(l) => { upsert(l); setEditing(null) }}
          onTrashed={(id) => { setLeads((p) => p.filter((x) => x.id !== id)); setEditing(null) }}
          onLeadUpdated={upsert} />
      )}
      {showQuick && <QuickModal event={event} onClose={() => setShowQuick(false)} onAdded={upsert} />}
      {showTrash && <TrashModal event={event} isDirector={isDirector} onClose={() => setShowTrash(false)} onChanged={() => loadAll()} />}
      {showQr && <QrModal event={event} onClose={() => setShowQr(false)} />}
      {showSettings && defaults && (
        <EventModal event={event} defaults={defaults} isDirector={isDirector}
          onClose={() => setShowSettings(false)}
          onSaved={(ev) => { setEvent((p) => ({ ...(p as CrmEvent), ...ev })); setShowSettings(false) }}
          onDeleted={() => navigate("/crm")} />
      )}
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5" style={{ borderLeft: `3px solid ${accent}` }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function followUpDue(l: CrmLead): boolean {
  return !!l.follow_up && l.follow_up <= todayIso() && l.stage !== "won" && l.stage !== "lost"
}

function Board({ leads, onOpen, onMove }: { leads: CrmLead[]; onOpen: (l: CrmLead) => void; onMove: (l: CrmLead, s: Stage) => void }) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<Stage | null>(null)

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {STAGES.map((st) => {
        const col = leads.filter((l) => l.stage === st.key)
        const total = col.reduce((a, l) => a + num(l.value), 0)
        return (
          <section key={st.key}
            onDragOver={(e) => { e.preventDefault(); setOverStage(st.key) }}
            onDragLeave={() => setOverStage((s) => (s === st.key ? null : s))}
            onDrop={(e) => {
              e.preventDefault(); setOverStage(null)
              const l = leads.find((x) => x.id === dragId)
              if (l) onMove(l, st.key)
              setDragId(null)
            }}
            className={`flex w-[17.5rem] shrink-0 flex-col gap-2 rounded-xl border bg-muted/20 p-2.5 transition-colors ${overStage === st.key ? "border-primary bg-primary/5" : ""}`}>
            <header className="flex items-center justify-between border-b px-1 pb-2" style={{ borderBottomColor: st.color }}>
              <h3 className="text-[11px] font-bold uppercase tracking-wider">{st.label}</h3>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {total > 0 && <span className="tabular-nums">{fmtShort(total)}</span>}
                <span className="rounded-full border px-1.5 tabular-nums">{col.length}</span>
              </span>
            </header>
            {col.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No leads</p>
            ) : col.map((l) => (
              <article key={l.id} draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => { setDragId(null); setOverStage(null) }}
                className="cursor-grab rounded-lg border bg-card p-3 shadow-sm active:cursor-grabbing">
                <button onClick={() => onOpen(l)} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-2">
                    <p className="break-words text-sm font-bold uppercase leading-tight">{l.company}</p>
                    {l.rating && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${RATING_CHIP[l.rating]}`}>{l.rating}</span>}
                  </div>
                  {(l.contact_name || l.job_title) && (
                    <p className="mt-1 break-words text-xs text-muted-foreground">{[l.contact_name, l.job_title].filter(Boolean).join(" · ")}</p>
                  )}
                  {l.services.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {l.services.slice(0, 3).map((s) => <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{s}</span>)}
                      {l.services.length > 3 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">+{l.services.length - 3}</span>}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    {l.region && <span>{l.region}</span>}
                    {num(l.value) > 0 && <span className="font-medium text-foreground">{fmtMoney(num(l.value))}</span>}
                    {followUpDue(l) && <span className="flex items-center gap-1 font-semibold text-red-600 dark:text-red-400"><BellRing className="h-3 w-3" />Follow up</span>}
                  </div>
                </button>
                <select value={l.stage} onChange={(e) => onMove(l, e.target.value as Stage)} aria-label={`Move ${l.company} to stage`}
                  className="mt-2 h-8 w-full rounded-md border border-input bg-transparent px-1.5 text-base outline-none md:text-xs dark:bg-input/30">
                  {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </article>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function ListView({ leads, event, onOpen }: { leads: CrmLead[]; event: CrmEvent; onOpen: (l: CrmLead) => void }) {
  const days = useMemo(() => showDays(event), [event])
  const dayShort = (k: string) => days.find((d) => d.key === k)?.short ?? k
  if (leads.length === 0) return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No leads match these filters.</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2">
        <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th>Company</th><th>Contact</th><th>Stage</th><th>Rating</th><th className="text-right">Value</th><th>Day</th><th>Follow-up</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {leads.map((l) => (
            <tr key={l.id} onClick={() => onOpen(l)} className="cursor-pointer hover:bg-muted/40">
              <td className="font-semibold">{l.company}</td>
              <td className="text-muted-foreground">{[l.contact_name, l.job_title].filter(Boolean).join(" · ") || "—"}</td>
              <td><span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: STAGES.find((s) => s.key === l.stage)?.color }}>{STAGE_LABEL[l.stage]}</span></td>
              <td>{l.rating ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${RATING_CHIP[l.rating]}`}>{l.rating}</span> : "—"}</td>
              <td className="text-right tabular-nums">{num(l.value) ? fmtMoney(num(l.value)) : "—"}</td>
              <td className="text-muted-foreground">{dayShort(l.show_day)}</td>
              <td className={followUpDue(l) ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground"}>{l.follow_up ? fmtDay(l.follow_up) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function Insights({ leads, event }: { leads: CrmLead[]; event: CrmEvent }) {
  const s = computeStats(leads)
  const days = showDays(event)
  const byStage = STAGES.map((st) => {
    const items = leads.filter((l) => l.stage === st.key)
    return { ...st, count: items.length, value: items.reduce((a, l) => a + num(l.value), 0) }
  })
  const maxV = Math.max(1, ...byStage.map((x) => x.value))
  const dayCounts = days.map((d) => ({ ...d, n: leads.filter((l) => l.show_day === d.key).length }))
  const maxD = Math.max(1, ...dayCounts.map((d) => d.n))
  const svc = topServices(leads)
  const maxS = Math.max(1, svc[0]?.[1] ?? 1)
  const closed = s.won + s.lost
  const winRate = closed ? Math.round((s.won / closed) * 100) : 0
  const avg = leads.length ? leads.reduce((a, l) => a + num(l.value), 0) / leads.length : 0

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Pipeline value by stage">
        <div className="space-y-2">
          {byStage.map((x) => (
            <div key={x.key} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-xs">
              <span className="truncate">{x.label} <span className="text-muted-foreground">({x.count})</span></span>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.round((x.value / maxV) * 100)}%`, background: x.color }} /></div>
              <span className="text-right tabular-nums">{fmtShort(x.value)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Win rate">
        <div className="flex items-center gap-5">
          <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#22c55e ${winRate * 3.6}deg, var(--muted) 0)` }}>
            <div className="grid h-[4.75rem] w-[4.75rem] place-items-center rounded-full bg-card text-center">
              <div><p className="font-display text-xl font-bold leading-none tabular-nums">{winRate}%</p><p className="text-[9px] uppercase text-muted-foreground">win rate</p></div>
            </div>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-green-500" />Won <b className="tabular-nums">{s.won}</b></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" />Lost <b className="tabular-nums">{s.lost}</b></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" />Won value <b className="tabular-nums">{fmtShort(s.wonval)}</b></div>
            <div className="flex items-center gap-2 text-muted-foreground">Avg deal size <b className="tabular-nums text-foreground">{fmtShort(avg)}</b></div>
          </dl>
        </div>
      </Panel>

      <Panel title="Leads by event day">
        <div className="flex h-32 items-end gap-2">
          {dayCounts.map((d) => (
            <div key={d.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[11px] font-semibold tabular-nums">{d.n}</span>
              <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(4, Math.round((d.n / maxD) * 80))}%` }} />
              <span className="text-[10px] font-bold">{d.short}</span>
              <span className="h-3 truncate text-[9px] text-muted-foreground">{d.sub}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Most-wanted services">
        {svc.length === 0 ? <p className="text-xs text-muted-foreground">No service data yet</p> : (
          <div className="space-y-2">
            {svc.map(([name, n]) => (
              <div key={name} className="grid grid-cols-[9rem_1fr_1.5rem] items-center gap-2 text-xs">
                <span className="truncate" title={name}>{name}</span>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((n / maxS) * 100)}%` }} /></div>
                <span className="text-right tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

