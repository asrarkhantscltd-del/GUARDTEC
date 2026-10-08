import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Target, Plus, Lock, MapPin, CalendarDays, Flame, Trophy, Archive } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import EventModal from "@/components/crm/EventModal"
import { eventDates, type CrmEvent, type EventDefaults } from "@/lib/crm"

// CRM landing page: one card per event (trade show / campaign). Each event is
// its own pipeline, so a new show = "New event" and a clean board.
export default function CrmPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [events, setEvents] = useState<CrmEvent[]>([])
  const [defaults, setDefaults] = useState<EventDefaults | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const d = await api.get<{ events: CrmEvent[]; defaults: EventDefaults }>("/api/crm/events")
      setEvents(d.events)
      setDefaults(d.defaults)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-16 text-center">
        <Lock className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">You are not authorized to view this</p>
        <p className="max-w-sm text-xs text-muted-foreground">Ask a Director to grant you the "CRM" permission under Manage Roles.</p>
      </div>
    )
  }

  const active = events.filter((e) => !e.archived)
  const archived = events.filter((e) => e.archived)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">CRM</h2>
          <p className="text-sm text-muted-foreground">Capture leads at each event and follow them up. Every event has its own pipeline.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)} disabled={!defaults}>
          <Plus className="h-4 w-4" /> New event
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No events yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Click "New event" to start your first CRM — for example a trade show you're attending.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((ev) => <EventCard key={ev.id} ev={ev} onOpen={() => navigate(`/crm/${ev.id}`)} />)}
          </div>
          {archived.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Archive className="h-3.5 w-3.5" /> Archived
              </p>
              <div className="grid gap-3 opacity-75 sm:grid-cols-2 xl:grid-cols-3">
                {archived.map((ev) => <EventCard key={ev.id} ev={ev} onOpen={() => navigate(`/crm/${ev.id}`)} />)}
              </div>
            </div>
          )}
        </>
      )}

      {creating && defaults && (
        <EventModal event={null} defaults={defaults} isDirector={user?.role === "director"}
          onClose={() => setCreating(false)}
          onSaved={(ev) => { setCreating(false); navigate(`/crm/${ev.id}`) }} />
      )}
    </div>
  )
}

function EventCard({ ev, onOpen }: { ev: CrmEvent; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="min-w-0">
        <p className="truncate font-display text-base font-bold tracking-tight group-hover:text-primary">{ev.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {ev.venue && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{ev.venue}</span>}
          <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{eventDates(ev)}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 border-t pt-3 text-sm">
        <span><b className="tabular-nums">{ev.lead_count ?? 0}</b> <span className="text-xs text-muted-foreground">leads</span></span>
        <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400"><Flame className="h-3.5 w-3.5" /><b className="tabular-nums">{ev.hot_count ?? 0}</b> <span className="text-xs">hot</span></span>
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Trophy className="h-3.5 w-3.5" /><b className="tabular-nums">{ev.won_count ?? 0}</b> <span className="text-xs">won</span></span>
      </div>
    </button>
  )
}
