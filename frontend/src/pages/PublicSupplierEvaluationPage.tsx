import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { CheckCircle2, Link2Off, Loader2, Paperclip, ShieldCheck, Trash2, Upload, Clock } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { useTheme } from "@/contexts/ThemeContext"
import { fmtDate } from "@/lib/utils"
import {
  blankAnswers, reviewTypeLabel, uploadFile, fmtBytes, UPLOAD_ACCEPT,
  type Answers, type SectionKey, type YesNo,
} from "@/lib/procurement"
import { EvaluationSections } from "@/components/procurement/EvaluationSections"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// PUBLIC and UNAUTHENTICATED by design (same model as
// PublicComplianceCalendarPage): the 256-bit token in the URL is the security
// boundary. Never assume a session, never redirect to /login.

interface LinkData {
  state: "open" | "submitted" | "expired"
  expires_at: string
  supplier: { name: string; services: string; contract_number: string; contact_number: string }
  review_type: string
  reviewed_by: string
  documents: { id: string; section: string; original_name: string; size_bytes: number }[]
}

function Shell({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme()
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <img src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"} alt="GuardTec Security" className="h-8 w-auto sm:h-9" />
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Supplier Evaluation
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">{children}</main>
      <footer className="pb-8 text-center text-xs text-muted-foreground">© GuardTec Security Ltd · Approved Supplier Programme</footer>
    </div>
  )
}

function StateCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="surface mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
      {icon}
      <h1 className="font-display text-xl font-bold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

export default function PublicSupplierEvaluationPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<LinkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [done, setDone] = useState(false)

  const [answers, setAnswers] = useState<Answers>(blankAnswers)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [completedBy, setCompletedBy] = useState("")
  const [position, setPosition] = useState("")
  const [docs, setDocs] = useState<LinkData["documents"]>([])
  const [uploading, setUploading] = useState<SectionKey | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const fileRefs = useRef<Partial<Record<SectionKey, HTMLInputElement | null>>>({})

  useEffect(() => {
    api.get<LinkData>(`/api/public/supplier-evaluation/${token}`)
      .then(d => { setData(d); setDocs(d.documents ?? []) })
      .catch(err => {
        if (err instanceof ApiError && err.status === 404) setInvalid(true)
        else toast.error("Could not load the form. Check your connection and try again.")
      })
      .finally(() => setLoading(false))
  }, [token])

  const answeredCount = useMemo(() => Object.values(answers).flat().filter(Boolean).length, [answers])
  const total = 15

  function setAnswer(s: SectionKey, i: number, v: YesNo) {
    setAnswers(a => ({ ...a, [s]: a[s].map((x, idx) => (idx === i ? v : x)) }))
  }

  async function upload(section: SectionKey, file: File) {
    setUploading(section)
    try {
      const d = await uploadFile<{ document: LinkData["documents"][number] }>(
        `/api/public/supplier-evaluation/${token}/documents`, file, { "X-Doc-Section": section.toLowerCase() })
      setDocs(prev => [...prev, d.document])
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed")
    } finally { setUploading(null) }
  }

  async function removeDoc(id: string) {
    try {
      await api.delete(`/api/public/supplier-evaluation/${token}/documents/${id}`)
      setDocs(prev => prev.filter(d => d.id !== id))
    } catch { toast.error("Could not remove file") }
  }

  async function submit() {
    setError("")
    if (!completedBy.trim()) { setError("Please enter your name."); return }
    if (answeredCount < total) { setError(`Please answer all questions (${answeredCount}/${total} done).`); return }
    setSubmitting(true)
    try {
      await api.post(`/api/public/supplier-evaluation/${token}`, {
        header: { completed_by: completedBy, completed_by_position: position },
        answers, comments,
      })
      setDone(true)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not submit. Please try again.")
    } finally { setSubmitting(false) }
  }

  if (loading) return <Shell><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></Shell>
  if (invalid || !data) return <Shell><StateCard icon={<Link2Off className="h-10 w-10 text-muted-foreground" />} title="Link not valid" body="This evaluation link is not recognised. Please contact GuardTec Security for a new link." /></Shell>
  if (done || data.state === "submitted") return (
    <Shell>
      <StateCard icon={<div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15"><CheckCircle2 className="h-8 w-8 text-success" /></div>}
        title="Thank you — form submitted"
        body={`Your supplier evaluation for ${data.supplier.name} has been received. GuardTec Security will review it and be in touch if anything else is needed.`} />
    </Shell>
  )
  if (data.state === "expired") return <Shell><StateCard icon={<Clock className="h-10 w-10 text-muted-foreground" />} title="Link expired" body="This evaluation link has expired. Please contact GuardTec Security for a new link." /></Shell>

  return (
    <Shell>
      <div className="space-y-5">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Approved Supplier Evaluation</h1>
          <p className="text-sm text-muted-foreground">
            Please answer each question and, where you can, upload supporting certificates or policies. It takes about 5 minutes.
            This link expires on {fmtDate(data.expires_at)}.
          </p>
        </div>

        <div className="surface grid gap-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
          <div><p className="text-xs text-muted-foreground">Supplier name</p><p className="font-semibold">{data.supplier.name}</p></div>
          <div><p className="text-xs text-muted-foreground">Product / services supplied</p><p className="font-medium">{data.supplier.services || "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Contract number</p><p className="font-medium">{data.supplier.contract_number || "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Main contact number</p><p className="font-medium">{data.supplier.contact_number || "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Reviewed by</p><p className="font-medium">{data.reviewed_by}</p></div>
          <div><p className="text-xs text-muted-foreground">Type of review</p><p className="font-medium">{reviewTypeLabel(data.review_type)}</p></div>
        </div>

        <div className="surface grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div className="space-y-1.5">
            <Label>Your name *</Label>
            <Input value={completedBy} onChange={e => setCompletedBy(e.target.value)} autoComplete="name" />
          </div>
          <div className="space-y-1.5">
            <Label>Position</Label>
            <Input value={position} onChange={e => setPosition(e.target.value)} autoComplete="organization-title" />
          </div>
        </div>

        <EvaluationSections
          answers={answers} onAnswer={setAnswer}
          comments={comments} onComment={(k, v) => setComments(c => ({ ...c, [k]: v }))}
          renderSectionExtra={s => {
            const mine = docs.filter(d => d.section === s)
            return (
              <div className="mt-3 space-y-2">
                {mine.map(d => (
                  <div key={d.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{d.original_name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtBytes(d.size_bytes)}</span>
                    <button onClick={() => removeDoc(d.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <input ref={el => { fileRefs.current[s] = el }} type="file" accept={UPLOAD_ACCEPT} className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload(s, f); e.target.value = "" }} />
                <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={uploading !== null}
                  onClick={() => fileRefs.current[s]?.click()}>
                  {uploading === s ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload certificate / policy
                </Button>
              </div>
            )
          }}
        />

        <div className="surface sticky bottom-3 flex flex-col gap-3 p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground sm:justify-start">
              <span>{answeredCount} of {total} answered</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted sm:w-48">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(answeredCount / total) * 100}%` }} />
            </div>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>
          <Button onClick={submit} disabled={submitting} className="shrink-0">{submitting ? "Submitting…" : "Submit evaluation"}</Button>
        </div>
      </div>
    </Shell>
  )
}
