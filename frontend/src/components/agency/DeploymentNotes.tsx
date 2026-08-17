import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Send, MessageSquare } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"

interface DeploymentNote {
  id: string
  deployment_id: string
  author_id: string
  note: string
  created_at?: string
}

interface DeploymentNotesProps {
  agencyId: string
  deploymentId: string
  currentUserId?: string | number // used to label your own notes "You"
}

// Comment thread on a deployment — the one piece of this feature set with a
// real GET endpoint (GET .../deployments/:id/notes), so this component
// fetches its own data rather than taking it as a prop.
export function DeploymentNotes({ agencyId, deploymentId, currentUserId }: DeploymentNotesProps) {
  const [notes, setNotes] = useState<DeploymentNote[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<{ ok: boolean; notes: DeploymentNote[] }>(`/api/agencies/${agencyId}/deployments/${deploymentId}/notes`)
      .then(d => { if (!cancelled) setNotes(d.notes ?? []) })
      .catch(() => { if (!cancelled) toast.error("Failed to load notes") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agencyId, deploymentId])

  async function postNote() {
    const note = draft.trim()
    if (!note) return
    setPosting(true)
    try {
      const d = await api.post<{ ok: boolean; note: DeploymentNote }>(
        `/api/agencies/${agencyId}/deployments/${deploymentId}/notes`, { note }
      )
      setNotes(prev => [...prev, d.note])
      setDraft("")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading notes…
        </p>
      ) : notes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <MessageSquare className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">No notes yet on this deployment.</p>
        </div>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {notes.map(n => (
            <div key={n.id} className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="whitespace-pre-wrap text-sm">{n.note}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {currentUserId != null && String(n.author_id) === String(currentUserId) ? "You" : "Office"}
                {n.created_at ? ` · ${new Date(n.created_at).toLocaleString("en-GB")}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          placeholder="Add a note…"
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        <Button size="icon" onClick={postNote} disabled={!draft.trim() || posting}>
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
