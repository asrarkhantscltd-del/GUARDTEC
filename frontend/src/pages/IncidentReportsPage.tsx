import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import {
  Flag, Loader2, ChevronDown, ChevronUp, Paperclip,
  FileVideo, FileText, Image as ImageIcon, Download,
  EyeOff, User as UserIcon, ShieldAlert, ShieldOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface Attachment {
  id: string
  filename: string
  original_name: string
  mime_type: string
  size_bytes: number
}

interface Report {
  id: string
  reporter_name: string | null
  is_anonymous: boolean
  report_date: string
  site_location: string | null
  incident_type: string
  against_person: string | null
  description: string
  status: string
  resolution_notes: string | null
  created_at: string
  attachment_count: number
  attachments?: Attachment[]
  flagged_inappropriate: boolean
  flagged_reason: string | null
  flagged_by_name: string | null
  flagged_at: string | null
}

function fmtBytes(n: number) {
  if (n < 1024) return n + " B"
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB"
  return (n / 1024 / 1024).toFixed(1) + " MB"
}

function attachIcon(mime: string) {
  if (mime.startsWith("video/")) return <FileVideo className="h-3.5 w-3.5 text-primary shrink-0" />
  if (mime.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5 text-success shrink-0" />
  return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

const TYPE_LABELS: Record<string, string> = {
  harassment:    "Harassment",
  discrimination:"Discrimination",
  misconduct:    "Misconduct",
  safety:        "Safety",
  fraud:         "Fraud",
  other:         "Other",
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  open:         { label: "Report Received",  cls: "bg-success/15 text-success" },
  under_review: { label: "Decision Pending", cls: "bg-warning/15 text-warning" },
  resolved:     { label: "Closed",           cls: "bg-destructive/15 text-destructive" },
  closed:       { label: "Closed",           cls: "bg-destructive/15 text-destructive" },
}

export default function IncidentReportsPage() {
  const { user: me } = useAuth()
  const isDirector = me?.role === "director"

  const [reports, setReports]   = useState<Report[]>([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [updating, setUpdating] = useState<string | null>(null)
  // Director-only: flagged (inappropriate-content) reports are hidden from
  // the normal queue by default — this just toggles whether to also fetch
  // them, never anything about who submitted a report.
  const [showFlagged, setShowFlagged] = useState(false)

  async function load(includeFlagged = showFlagged) {
    setLoading(true)
    try {
      const url = isDirector && includeFlagged ? "/api/incident-reports?includeFlagged=true" : "/api/incident-reports"
      const d = await api.get<{ ok: boolean; reports: Report[] }>(url)
      if (d.ok) setReports(d.reports)
    } finally {
      setLoading(false)
    }
  }

  async function flagReport(id: string, reason: string) {
    setUpdating(id)
    try {
      await api.patch(`/api/incident-reports/${id}/flag`, { reason })
      toast.success("Report flagged and hidden from the queue.")
      await load()
    } catch {
      toast.error("Failed to flag report.")
    } finally {
      setUpdating(null)
    }
  }

  async function unflagReport(id: string) {
    setUpdating(id)
    try {
      await api.patch(`/api/incident-reports/${id}/unflag`, {})
      toast.success("Flag removed.")
      await load()
    } catch {
      toast.error("Failed to unflag report.")
    } finally {
      setUpdating(null)
    }
  }

  async function toggleExpand(id: string) {
    const next = !expanded[id]
    setExpanded(p => ({ ...p, [id]: next }))
    if (next) {
      const rep = reports.find(r => r.id === id)
      if (rep && !rep.attachments) {
        const d = await api.get<{ ok: boolean; attachments: Attachment[] }>(`/api/incident-reports/${id}/attachments`)
        if (d.ok) setReports(p => p.map(x => x.id === id ? { ...x, attachments: d.attachments } : x))
      }
    }
  }

  async function updateStatus(id: string, status: string, notes: string) {
    setUpdating(id)
    try {
      await api.patch(`/api/incident-reports/${id}`, { status, resolution_notes: notes })
      toast.success("Report updated.")
      await load()
    } catch {
      toast.error("Failed to update.")
    } finally {
      setUpdating(null)
    }
  }

  useEffect(() => { load(showFlagged) }, [showFlagged])

  const active        = reports.filter(r => !r.flagged_inappropriate)
  const flaggedList    = reports.filter(r => r.flagged_inappropriate)
  const open         = active.filter(r => r.status === "open")
  const under_review = active.filter(r => r.status === "under_review")
  const closed       = active.filter(r => r.status === "resolved" || r.status === "closed")

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Flag className="h-5 w-5 text-destructive" />
        <div className="flex-1">
          <h1 className="font-display text-xl font-semibold">Incident Reports</h1>
          <p className="text-sm text-muted-foreground">
            {active.length} total — {open.length} new, {under_review.length} pending, {closed.length} closed
          </p>
        </div>
        {isDirector && (
          <Button size="sm" variant="outline" onClick={() => setShowFlagged(v => !v)} className="gap-1.5">
            {showFlagged ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
            {showFlagged ? "Hide flagged" : "Show flagged"}
          </Button>
        )}
      </div>

      {reports.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No incident reports submitted yet.
        </div>
      )}

      {[
        { title: "New Reports", items: open,         emptyMsg: "No new reports." },
        { title: "Decision Pending", items: under_review, emptyMsg: "None pending." },
        { title: "Closed",     items: closed,         emptyMsg: "None closed." },
      ].map(group => group.items.length > 0 && (
        <section key={group.title} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h2>
          {group.items.map(rep => (
            <ReportCard
              key={rep.id}
              rep={rep}
              isOpen={!!expanded[rep.id]}
              updating={updating === rep.id}
              isDirector={isDirector}
              onToggle={() => toggleExpand(rep.id)}
              onUpdate={updateStatus}
              onFlag={flagReport}
              onUnflag={unflagReport}
            />
          ))}
        </section>
      ))}

      {isDirector && showFlagged && flaggedList.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-destructive">
            Flagged as inappropriate — hidden from the normal queue
          </h2>
          {flaggedList.map(rep => (
            <ReportCard
              key={rep.id}
              rep={rep}
              isOpen={!!expanded[rep.id]}
              updating={updating === rep.id}
              isDirector={isDirector}
              onToggle={() => toggleExpand(rep.id)}
              onUpdate={updateStatus}
              onFlag={flagReport}
              onUnflag={unflagReport}
            />
          ))}
        </section>
      )}
    </div>
  )
}

function ReportCard({ rep, isOpen, updating, isDirector, onToggle, onUpdate, onFlag, onUnflag }: {
  rep: Report
  isOpen: boolean
  updating: boolean
  isDirector: boolean
  onToggle: () => void
  onUpdate: (id: string, status: string, notes: string) => void
  onFlag: (id: string, reason: string) => void
  onUnflag: (id: string) => void
}) {
  const [notes, setNotes]   = useState(rep.resolution_notes ?? "")
  const [status, setStatus] = useState(rep.status)
  const [flagReason, setFlagReason] = useState("")
  const cfg = STATUS_CFG[rep.status] ?? STATUS_CFG.open

  return (
    <div className={`surface rounded-lg border bg-card shadow-sm overflow-hidden ${rep.flagged_inappropriate ? "border-destructive/40" : ""}`}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        {rep.flagged_inappropriate && (
          <span className="text-xs font-medium rounded-full px-2.5 py-0.5 shrink-0 bg-destructive/15 text-destructive flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> Flagged
          </span>
        )}
        <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 shrink-0 ${cfg.cls}`}>
          {cfg.label}
        </span>
        <span className="text-sm font-medium flex-1 truncate">
          {TYPE_LABELS[rep.incident_type] ?? rep.incident_type}
          {rep.against_person && <span className="text-muted-foreground font-normal"> — {rep.against_person}</span>}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{fmtDate(rep.report_date)}</span>
        {rep.attachment_count > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            <Paperclip className="h-3 w-3" />{rep.attachment_count}
          </span>
        )}
        {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {/* Expanded detail */}
      {isOpen && (
        <div className="border-t px-4 py-4 space-y-4">
          {/* Reporter */}
          <div className="flex items-center gap-2 text-sm">
            {rep.is_anonymous
              ? <><EyeOff className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Submitted anonymously</span></>
              : <><UserIcon className="h-4 w-4 text-muted-foreground" /><span>{rep.reporter_name ?? "Unknown"}</span></>
            }
            {rep.site_location && <span className="text-muted-foreground ml-2">· {rep.site_location}</span>}
          </div>

          {/* Description */}
          <p className="text-sm leading-relaxed">{rep.description}</p>

          {/* Content moderation — director only. Flags the report's CONTENT
              (e.g. abusive language) to hide it from the normal queue.
              Deliberately has no bearing on reporter_id/is_anonymous — an
              anonymous submitter's identity is never revealed by this. */}
          {isDirector && (
            rep.flagged_inappropriate ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 space-y-2">
                <p className="text-xs text-destructive font-medium flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" /> Flagged as inappropriate{rep.flagged_by_name ? ` by ${rep.flagged_by_name}` : ""}{rep.flagged_at ? ` on ${fmtDate(rep.flagged_at)}` : ""}
                </p>
                {rep.flagged_reason && <p className="text-xs text-muted-foreground">Reason: {rep.flagged_reason}</p>}
                <Button size="sm" variant="outline" disabled={updating} onClick={() => onUnflag(rep.id)} className="gap-1.5">
                  {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
                  Remove flag
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed px-3 py-2.5 space-y-2">
                <p className="text-xs text-muted-foreground">
                  If this report's content is abusive or clearly misuses the reporting channel, you can flag and hide
                  it — this never reveals who submitted it, even if it was anonymous.
                </p>
                <div className="flex items-center gap-2">
                  <input type="text" value={flagReason} onChange={e => setFlagReason(e.target.value)}
                    placeholder="Reason (optional, for your own records)"
                    className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                  <Button size="sm" variant="outline" disabled={updating} onClick={() => onFlag(rep.id, flagReason)} className="gap-1.5 shrink-0">
                    {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                    Flag as inappropriate
                  </Button>
                </div>
              </div>
            )
          )}

          {/* Attachments */}
          {rep.attachments && rep.attachments.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Attachments</p>
              <ul className="space-y-1">
                {rep.attachments.map(a => (
                  <li key={a.id} className="flex items-center gap-2 text-xs">
                    {attachIcon(a.mime_type)}
                    <span className="flex-1 truncate">{a.original_name}</span>
                    <span className="text-muted-foreground shrink-0">{fmtBytes(a.size_bytes)}</span>
                    <a
                      href={`/api/incident-attachments/${a.filename}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 shrink-0"
                    >
                      <Download className="h-3 w-3" /> View
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rep.attachments && rep.attachments.length === 0 && (
            <p className="text-xs text-muted-foreground">No attachments.</p>
          )}

          {/* Update status */}
          {rep.status !== "closed" && rep.status !== "resolved" && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update Status</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="open">Report Received</option>
                    <option value="under_review">Decision Pending</option>
                    <option value="resolved">Closed</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Resolution notes (optional)</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. Investigation complete, action taken"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={updating} onClick={() => onUpdate(rep.id, status, notes)}>
                  {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Save
                </Button>
              </div>
            </div>
          )}

          {rep.resolution_notes && (
            <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium">Resolution: </span>{rep.resolution_notes}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
