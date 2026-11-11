import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { MessageSquare, Search, Loader2, PenSquare, X, CornerUpLeft } from "lucide-react"
import { api } from "@/lib/api"

interface Conversation {
  staffId: string
  name: string
  jobRole: string | null
  lastMessage: string
  lastAt: string
  lastFromStaff: boolean
  unread: number
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()
}

function when(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

export default function MessagesPage() {
  const navigate = useNavigate()
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [composing, setComposing] = useState(false)
  const [allStaff, setAllStaff] = useState<{ id: string; name: string; jobRole?: string }[]>([])
  const [pickSearch, setPickSearch] = useState("")

  useEffect(() => {
    function load() {
      api.get<{ ok: boolean; conversations: Conversation[] }>("/api/messages/inbox")
        .then(d => setConvos(d?.conversations ?? []))
        .catch(() => setConvos([]))
    }
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!composing || allStaff.length) return
    api.get<{ id: string; name: string; jobRole?: string }[]>("/api/staff")
      .then(d => setAllStaff((d ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [composing, allStaff.length])

  const rows = useMemo(() => (convos ?? []).filter(c =>
    (filter === "all" || c.unread > 0) &&
    (!search || c.name.toLowerCase().includes(search.toLowerCase()))
  ), [convos, search, filter])

  const totalUnread = (convos ?? []).reduce((n, c) => n + c.unread, 0)
  const open = (staffId: string) => navigate(`/staff/${staffId}?tab=messages`)

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold tracking-wide">Messages</h1>
          <p className="text-sm text-muted-foreground">
            {totalUnread > 0
              ? <span className="font-medium text-primary">{totalUnread} unread from staff</span>
              : "All conversations with your staff"}
          </p>
        </div>
        <button onClick={() => setComposing(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_14px_-2px_rgba(228,6,19,0.4)] hover:bg-primary/90 transition-colors">
          <PenSquare className="h-4 w-4" />New message
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff…"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="flex rounded-lg border border-border p-0.5 text-sm">
          {(["all", "unread"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${filter === f ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {f}{f === "unread" && totalUnread > 0 ? ` (${totalUnread})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation list */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {convos === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading conversations…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {filter === "unread" ? "No unread messages — you're all caught up." : "No conversations yet. Start one with “New message”."}
          </div>
        ) : rows.map(c => (
          <button key={c.staffId} onClick={() => open(c.staffId)}
            className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 transition-colors hover:bg-muted/60 ${c.unread > 0 ? "bg-primary/[0.04]" : ""}`}>
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.unread > 0 ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
              {initials(c.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className={`truncate text-sm ${c.unread > 0 ? "font-bold" : "font-medium"}`}>{c.name}</p>
                {c.jobRole && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{c.jobRole}</span>}
              </div>
              <p className={`flex items-center gap-1 truncate text-sm ${c.unread > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                {!c.lastFromStaff && <CornerUpLeft className="h-3 w-3 shrink-0 opacity-60" />}
                <span className="truncate">{!c.lastFromStaff && "You: "}{c.lastMessage}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`text-xs tabular-nums ${c.unread > 0 ? "font-semibold text-primary" : "text-muted-foreground"}`}>{when(c.lastAt)}</span>
              {c.unread > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">{c.unread}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* New message — pick a staff member */}
      {composing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]" onClick={() => setComposing(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">New message — choose staff member</p>
              <button onClick={() => setComposing(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-3">
              <input autoFocus value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder="Type a name…"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-2 pb-2">
              {allStaff.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Loading staff…</p>}
              {allStaff.filter(s => !pickSearch || s.name.toLowerCase().includes(pickSearch.toLowerCase())).map(s => (
                <button key={s.id} onClick={() => open(s.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[11px] font-bold">{initials(s.name)}</div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    {s.jobRole && <p className="truncate text-xs text-muted-foreground">{s.jobRole}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
