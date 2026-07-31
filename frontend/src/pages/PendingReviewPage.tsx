import { useEffect, useState } from "react"
import {
  ClipboardCheck, Check, X, Loader2, Clock, Camera,
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface Ref { name?: string; company?: string; email?: string; phone?: string }

interface PendingStaff {
  id: string
  name: string
  phone?: string
  address?: string
  emergencyContact?: { name?: string; phone?: string; relationship?: string }
  sia?:  { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
  references?: { ref1?: Ref; ref2?: Ref }
  pending_submission?: {
    submitted_at?: string
    phone?: string
    address?: string
    emergencyContact?: { name?: string; phone?: string; relationship?: string }
    sia?:  { number?: string; expiry?: string; type?: string }
    cscs?: { number?: string; expiry?: string }
    visa?: { type?: string; expiry?: string }
    references?: { ref1?: Ref; ref2?: Ref }
    photo_pending?: boolean
  }
}

function fmtDateTime(iso?: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

export default function PendingReviewPage() {
  const [list, setList] = useState<PendingStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/staff/pending-review", { credentials: "include" })
      const d = await r.json()
      setList(d.staff ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function approve(id: string) {
    setBusyId(id)
    try {
      await fetch(`/api/staff/${id}/approve`, { method: "POST", credentials: "include" })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    try {
      await fetch(`/api/staff/${id}/reject`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      setRejectingId(null)
      setReason("")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Pending Review</h2>
        <p className="text-sm text-muted-foreground">
          Staff-submitted profile changes waiting for approval — {list.length} pending
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <div className="surface rounded-xl border-dashed p-12 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">Nothing to review</p>
          <p className="mt-1 text-xs text-muted-foreground">Staff submissions will appear here for your approval.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((s) => {
            const p = s.pending_submission ?? {}
            return (
              <div key={s.id} className="surface p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />Submitted {fmtDateTime(p.submitted_at)}
                      {p.photo_pending && (
                        <span className="ml-2 flex items-center gap-1 text-primary">
                          <Camera className="h-3 w-3" />New photo
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:bg-destructive/10"
                      disabled={busyId === s.id} onClick={() => setRejectingId(rejectingId === s.id ? null : s.id)}>
                      <X className="h-3.5 w-3.5" />Reject
                    </Button>
                    <Button size="sm" className="gap-1.5" disabled={busyId === s.id} onClick={() => approve(s.id)}>
                      {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Approve
                    </Button>
                  </div>
                </div>

                {rejectingId === s.id && (
                  <div className="mb-4 rounded-lg border bg-muted/30 p-3">
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reason (shown to staff member)</label>
                    <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Please re-upload a clearer photo of your SIA card"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none" />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setRejectingId(null); setReason("") }}>Cancel</Button>
                      <Button size="sm" variant="destructive" disabled={busyId === s.id} onClick={() => reject(s.id)}>
                        Confirm reject
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <CompareField label="Phone" current={s.phone} proposed={p.phone} />
                  <CompareField label="Address" current={s.address} proposed={p.address} />
                  <CompareField label="SIA number" current={s.sia?.number} proposed={p.sia?.number} />
                  <CompareField label="SIA expiry" current={s.sia?.expiry} proposed={p.sia?.expiry} />
                  <CompareField label="CSCS number" current={s.cscs?.number} proposed={p.cscs?.number} />
                  <CompareField label="CSCS expiry" current={s.cscs?.expiry} proposed={p.cscs?.expiry} />
                  <CompareField label="Visa / RTW type" current={s.visa?.type} proposed={p.visa?.type} />
                  <CompareField label="Visa expiry" current={s.visa?.expiry} proposed={p.visa?.expiry} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompareField({ label, current, proposed }: { label: string; current?: string; proposed?: string }) {
  const changed = proposed !== undefined && proposed !== current && proposed !== ""
  if (!changed) return null
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground line-through opacity-60">{current || "—"}</p>
      <p className="text-sm font-medium text-primary">{proposed}</p>
    </div>
  )
}
