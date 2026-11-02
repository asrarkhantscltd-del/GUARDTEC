import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Plus, Pencil, Trash2, X, Search, BadgeCheck, Clock, AlertTriangle, XCircle, ArrowUpRight,
  Link2, Copy, ClipboardList, Printer, Paperclip, Upload, Loader2, ChevronRight, Building2, Phone, Mail,
  CalendarClock, FileText,
} from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { fmtDate, daysUntil } from "@/lib/utils"
import {
  EVAL_SECTIONS, GRADE_META, SUPPLIER_STATUS_META, REVIEW_TYPES, blankAnswers, blankGrades, reviewTypeLabel,
  uploadFile, openBlobInNewTab, fmtBytes, UPLOAD_ACCEPT,
  type Answers, type Grades, type Grade, type SectionKey, type YesNo,
} from "@/lib/procurement"
import { EvaluationSections } from "@/components/procurement/EvaluationSections"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Supplier {
  id: string
  name: string
  services: string
  contract_number: string
  contact_name: string
  contact_phone: string
  contact_email: string
  address: string
  status: string
  review_date: string | null
  next_review_due: string | null
  notes: string
  latest_overall?: string | null
  latest_submitted_at?: string | null
  latest_graded_at?: string | null
  latest_submitted_via?: string | null
  eval_count?: number
  po_count?: number
}
interface Evaluation {
  id: string
  header: { supplier_name?: string; services?: string; contract_number?: string; contact_number?: string; completed_by?: string; completed_by_position?: string }
  answers: Answers
  comments: Record<string, string>
  grades: Grades
  overall: string
  reviewed_by: string
  review_type: string
  submitted_via: "supplier" | "internal"
  submitted_at: string
  graded_at: string | null
  graded_by: string | null
}
interface SupplierDoc { id: string; evaluation_id: string | null; section: string; original_name: string; size_bytes: number; uploaded_via: string; created_at: string }
interface OpenLink { url: string; review_type: string; created_at: string; expires_at: string }
interface Detail { supplier: Supplier; evaluations: Evaluation[]; documents: SupplierDoc[]; open_links: OpenLink[] }

type Filter = "all" | "approved" | "pending" | "under_review" | "rejected" | "due"

const BLANK = {
  name: "", services: "", contract_number: "", contact_name: "", contact_phone: "", contact_email: "",
  address: "", status: "pending", review_date: "", next_review_due: "", notes: "",
}

function StatusPill({ status }: { status: string }) {
  const m = SUPPLIER_STATUS_META[status] ?? SUPPLIER_STATUS_META.pending
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
}
function GradePill({ grade }: { grade: string }) {
  if (!grade) return <span className="inline-flex whitespace-nowrap rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground">Not graded</span>
  const m = GRADE_META[grade as Exclude<Grade, "">]
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
}

function StatCard({ icon, label, value, colorClass, strip, onClick, active }: {
  icon: React.ReactNode; label: string; value: number; colorClass: string; strip: string; onClick?: () => void; active?: boolean
}) {
  return (
    <div onClick={onClick} className={`surface relative overflow-hidden p-4 pl-5 ${onClick ? "surface-hover cursor-pointer" : ""} ${active ? "ring-2 ring-primary/40" : ""}`}>
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: strip }} />
      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${colorClass}`}>{icon}</div>
        {active
          ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colorClass}`}>Filtered</span>
          : onClick && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <p className="font-display text-3xl font-black tracking-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

function reviewDue(s: Supplier) {
  const d = daysUntil(s.next_review_due)
  return d !== null && d <= 30
}

// ── Print view ────────────────────────────────────────────────────────────────
function EvaluationPrint({ supplier, ev, onClose }: { supplier: Supplier; ev: Evaluation; onClose: () => void }) {
  return (
    <div className="supplier-print fixed inset-0 z-[70] overflow-y-auto bg-white text-black">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .supplier-print, .supplier-print * { visibility: visible !important; }
        .supplier-print { position: absolute !important; inset: 0 auto auto 0 !important; overflow: visible !important; }
        .no-print { display: none !important; }
        @page { margin: 14mm; }
      }`}</style>
      <div className="no-print sticky top-0 flex items-center justify-end gap-2 border-b bg-white px-4 py-3">
        <Button size="sm" className="gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / Save PDF</Button>
        <Button size="sm" variant="outline" onClick={onClose} className="text-black">Close</Button>
      </div>
      <div className="mx-auto max-w-[800px] p-6 text-[12px] leading-snug">
        <div className="mb-4 flex items-center justify-between border-b-2 border-black pb-3">
          <img src="/logo-on-light.svg" alt="GuardTec Security" className="h-10 w-auto" />
          <div className="text-right">
            <p className="text-base font-bold">Approved Supplier Evaluation</p>
            <p className="text-[11px] text-neutral-600">Submitted {fmtDate(ev.submitted_at)} · {ev.submitted_via === "supplier" ? "via supplier link" : "internal review"}</p>
          </div>
        </div>
        <table className="mb-4 w-full border-collapse">
          <tbody>
            {[
              ["Supplier Name", ev.header?.supplier_name || supplier.name, "Product/Services Supplied", ev.header?.services || supplier.services],
              ["Contract Number", ev.header?.contract_number || supplier.contract_number, "Main Contact Number", ev.header?.contact_number || supplier.contact_phone],
              ["Reviewed By", ev.reviewed_by, "Type of Review", reviewTypeLabel(ev.review_type)],
              ["Completed By", [ev.header?.completed_by, ev.header?.completed_by_position].filter(Boolean).join(", ") || "—", "Overall", ev.overall ? GRADE_META[ev.overall as Exclude<Grade, "">].label : "Not graded"],
            ].map((row, i) => (
              <tr key={i}>
                <td className="w-[20%] border border-neutral-400 bg-neutral-100 px-2 py-1.5 font-semibold">{row[0]}</td>
                <td className="w-[30%] border border-neutral-400 px-2 py-1.5">{row[1] || "—"}</td>
                <td className="w-[20%] border border-neutral-400 bg-neutral-100 px-2 py-1.5 font-semibold">{row[2]}</td>
                <td className="w-[30%] border border-neutral-400 px-2 py-1.5">{row[3] || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-neutral-800 text-white">
              <th className="w-[22%] border border-neutral-800 px-2 py-1.5 text-left">Area of Evaluation</th>
              <th className="border border-neutral-800 px-2 py-1.5 text-left">Elements to Consider</th>
              <th className="w-[10%] border border-neutral-800 px-2 py-1.5">Answer</th>
              <th className="w-[16%] border border-neutral-800 px-2 py-1.5">Grade</th>
            </tr>
          </thead>
          <tbody>
            {EVAL_SECTIONS.map(s => s.questions.map((q, i) => (
              <tr key={s.key + i} className="break-inside-avoid">
                {i === 0 && <td rowSpan={3} className="border border-neutral-400 px-2 py-1.5 align-top font-semibold">{s.key}) {s.title}</td>}
                <td className="border border-neutral-400 px-2 py-1.5">{q}</td>
                <td className="border border-neutral-400 px-2 py-1.5 text-center font-semibold uppercase">{ev.answers?.[s.key]?.[i] || "—"}</td>
                {i === 0 && <td rowSpan={3} className="border border-neutral-400 px-2 py-1.5 text-center align-middle font-semibold">{ev.grades?.[s.key] ? GRADE_META[ev.grades[s.key] as Exclude<Grade, "">].label : "—"}</td>}
              </tr>
            )))}
          </tbody>
        </table>
        {EVAL_SECTIONS.some(s => ev.comments?.[s.key] || ev.comments?.[`${s.key}_reviewer`]) && (
          <div className="mt-4 space-y-1">
            <p className="font-bold">Comments</p>
            {EVAL_SECTIONS.map(s => (ev.comments?.[s.key] || ev.comments?.[`${s.key}_reviewer`]) ? (
              <p key={s.key}><span className="font-semibold">{s.key}) </span>
                {ev.comments?.[s.key] && <>Supplier: {ev.comments[s.key]} </>}
                {ev.comments?.[`${s.key}_reviewer`] && <>Reviewer: {ev.comments[`${s.key}_reviewer`]}</>}
              </p>
            ) : null)}
          </div>
        )}
        <div className="mt-8 grid grid-cols-2 gap-8 text-[11px]">
          <div className="border-t border-black pt-1">Reviewer: {ev.graded_by || ev.reviewed_by}</div>
          <div className="border-t border-black pt-1">Date: {ev.graded_at ? fmtDate(ev.graded_at) : ""}</div>
        </div>
        <p className="mt-6 text-center text-[10px] text-neutral-500">GuardTec Security Ltd · Approved Supplier Register</p>
      </div>
    </div>
  )
}

export default function SuppliersPage() {
  const { user } = useAuth()
  const isDirector = user?.role === "director"

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  const [panel, setPanel] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [draft, setDraft] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [panelError, setPanelError] = useState("")

  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [linkOpts, setLinkOpts] = useState({ review_type: "standard", reviewed_by: "Matthew Hunter" })
  const [linkBusy, setLinkBusy] = useState(false)
  const [newLink, setNewLink] = useState("")

  // Evaluation workspace: grading an existing one or filling a new internal one.
  const [evalMode, setEvalMode] = useState<null | { kind: "grade"; ev: Evaluation } | { kind: "new" }>(null)
  const [evAnswers, setEvAnswers] = useState<Answers>(blankAnswers)
  const [evGrades, setEvGrades] = useState<Grades>(blankGrades)
  const [evComments, setEvComments] = useState<Record<string, string>>({})
  const [evReviewer, setEvReviewer] = useState("Matthew Hunter")
  const [evType, setEvType] = useState("standard")
  const [evSaving, setEvSaving] = useState(false)

  const [printEv, setPrintEv] = useState<Evaluation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [docUploading, setDocUploading] = useState(false)
  const docRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const d = await api.get<{ suppliers: Supplier[] }>("/api/suppliers")
      setSuppliers(d.suppliers ?? [])
    } catch {
      toast.error("Failed to load suppliers")
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function openDetail(id: string) {
    setDetailLoading(true); setNewLink(""); setEvalMode(null)
    try {
      const d = await api.get<Detail>(`/api/suppliers/${id}`)
      setDetail(d)
    } catch {
      toast.error("Could not load supplier")
    } finally { setDetailLoading(false) }
  }

  const stats = useMemo(() => ({
    approved: suppliers.filter(s => s.status === "approved").length,
    pending: suppliers.filter(s => s.status === "pending").length,
    review: suppliers.filter(s => s.status === "under_review").length,
    rejected: suppliers.filter(s => s.status === "rejected").length,
    due: suppliers.filter(reviewDue).length,
  }), [suppliers])

  const toGrade = suppliers.filter(s => s.latest_submitted_via === "supplier" && !s.latest_graded_at)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return suppliers.filter(s => {
      if (filter === "due") { if (!reviewDue(s)) return false }
      else if (filter !== "all" && s.status !== filter) return false
      if (!q) return true
      return [s.name, s.services, s.contract_number, s.contact_name, s.contact_email].some(v => String(v ?? "").toLowerCase().includes(q))
    })
  }, [suppliers, search, filter])

  function toggleFilter(f: Filter) { setFilter(prev => (prev === f ? "all" : f)) }

  function openAdd() { setEditing(null); setDraft(BLANK); setPanelError(""); setPanel(true) }
  function openEdit(s: Supplier) {
    setEditing(s)
    setDraft({
      name: s.name, services: s.services, contract_number: s.contract_number, contact_name: s.contact_name,
      contact_phone: s.contact_phone, contact_email: s.contact_email, address: s.address, status: s.status,
      review_date: s.review_date ? String(s.review_date).slice(0, 10) : "",
      next_review_due: s.next_review_due ? String(s.next_review_due).slice(0, 10) : "", notes: s.notes,
    })
    setPanelError(""); setPanel(true)
  }
  const setF = (k: keyof typeof BLANK, v: string) => setDraft(d => ({ ...d, [k]: v }))

  async function save() {
    if (!draft.name.trim()) { setPanelError("Supplier name is required."); return }
    setSaving(true); setPanelError("")
    try {
      const d = editing
        ? await api.patch<{ supplier: Supplier }>(`/api/suppliers/${editing.id}`, draft)
        : await api.post<{ supplier: Supplier }>("/api/suppliers", draft)
      toast.success(editing ? "Supplier updated" : "Supplier added")
      setPanel(false); await load()
      if (detail && editing && detail.supplier.id === editing.id) openDetail(editing.id)
      else if (!editing) openDetail(d.supplier.id)
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : "Could not save.")
    } finally { setSaving(false) }
  }

  async function createLink() {
    if (!detail) return
    setLinkBusy(true)
    try {
      const d = await api.post<{ url: string }>(`/api/suppliers/${detail.supplier.id}/eval-link`, linkOpts)
      setNewLink(d.url)
      try { await navigator.clipboard.writeText(d.url); toast.success("Link copied — paste it into an email to the supplier") }
      catch { toast.success("Link created — copy it below") }
      openDetailSilently(detail.supplier.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create link")
    } finally { setLinkBusy(false) }
  }
  async function openDetailSilently(id: string) {
    try { setDetail(await api.get<Detail>(`/api/suppliers/${id}`)) } catch { /* keep current view */ }
  }
  async function revokeLinks() {
    if (!detail) return
    try {
      await api.delete(`/api/suppliers/${detail.supplier.id}/eval-links`)
      toast.success("Open links revoked"); setNewLink("")
      openDetailSilently(detail.supplier.id)
    } catch { toast.error("Could not revoke links") }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success("Copied") } catch { toast.error("Copy failed — select and copy manually") }
  }

  function startGrade(ev: Evaluation) {
    setEvAnswers(ev.answers ?? blankAnswers())
    setEvGrades({ ...blankGrades(), ...(ev.grades ?? {}) })
    setEvComments(ev.comments ?? {})
    setEvReviewer(ev.reviewed_by || "Matthew Hunter")
    setEvType(ev.review_type || "standard")
    setEvalMode({ kind: "grade", ev })
  }
  function startNew() {
    setEvAnswers(blankAnswers()); setEvGrades(blankGrades()); setEvComments({})
    setEvReviewer(user?.full_name || "Matthew Hunter"); setEvType("standard")
    setEvalMode({ kind: "new" })
  }

  async function saveEvaluation() {
    if (!detail || !evalMode) return
    setEvSaving(true)
    try {
      if (evalMode.kind === "grade") {
        await api.patch(`/api/supplier-evaluations/${evalMode.ev.id}/grades`, {
          grades: evGrades, comments: evComments, reviewed_by: evReviewer, review_type: evType,
        })
      } else {
        const unanswered = Object.values(evAnswers).flat().filter(v => !v).length
        if (unanswered) { toast.error(`Answer all questions (${unanswered} left)`); setEvSaving(false); return }
        await api.post(`/api/suppliers/${detail.supplier.id}/evaluations`, {
          answers: evAnswers, grades: evGrades, comments: evComments, reviewed_by: evReviewer, review_type: evType,
        })
      }
      const graded = Object.values(evGrades).every(Boolean)
      toast.success(graded ? "Evaluation saved — supplier status updated" : "Saved — grade every section to finalise")
      setEvalMode(null)
      await Promise.all([openDetailSilently(detail.supplier.id), load()])
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save evaluation")
    } finally { setEvSaving(false) }
  }

  async function deleteEvaluation(ev: Evaluation) {
    if (!detail || !confirm("Permanently delete this evaluation? This is recorded in the Audit Trail.")) return
    try {
      await api.delete(`/api/supplier-evaluations/${ev.id}`)
      toast.success("Evaluation deleted")
      await Promise.all([openDetailSilently(detail.supplier.id), load()])
    } catch { toast.error("Delete failed") }
  }

  async function uploadDoc(file: File) {
    if (!detail) return
    setDocUploading(true)
    try {
      await uploadFile(`/api/suppliers/${detail.supplier.id}/documents`, file, { "X-Doc-Section": "general" })
      toast.success("Document uploaded")
      openDetailSilently(detail.supplier.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed")
    } finally { setDocUploading(false) }
  }
  async function viewDoc(id: string) {
    const blob = await api.getBlob(`/api/supplier-documents/${id}`)
    if (!openBlobInNewTab(blob)) toast.error("Could not open document")
  }
  async function deleteDoc(id: string) {
    if (!detail || !confirm("Permanently delete this document?")) return
    try { await api.delete(`/api/supplier-documents/${id}`); openDetailSilently(detail.supplier.id) }
    catch { toast.error("Delete failed") }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/api/suppliers/${deleteTarget.id}`)
      toast.success(`${deleteTarget.name} deleted`)
      setDeleteTarget(null); setDetail(null); await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Delete failed")
    } finally { setDeleting(false) }
  }

  const sectionDocs = (evId: string | null, s: SectionKey) => (detail?.documents ?? []).filter(d => d.evaluation_id === evId && d.section === s)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">Approved Supplier Register</h2>
          <p className="text-sm text-muted-foreground">Supplier evaluations across quality, environment, H&amp;S, ethics and data handling — {suppliers.length} suppliers</p>
        </div>
        <Button onClick={openAdd} size="sm" className="shrink-0 gap-1.5"><Plus className="h-4 w-4" /> Add supplier</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<BadgeCheck className="h-4 w-4" />} label="Approved" value={stats.approved} colorClass="bg-success/15 text-success" strip="#22c55e"
          onClick={() => toggleFilter("approved")} active={filter === "approved"} />
        <StatCard icon={<Clock className="h-4 w-4" />} label="Pending / under review" value={stats.pending + stats.review} colorClass="bg-warning/15 text-warning" strip="#f59e0b"
          onClick={() => toggleFilter("under_review")} active={filter === "under_review"} />
        <StatCard icon={<CalendarClock className="h-4 w-4" />} label="Review due ≤30 days" value={stats.due} colorClass="bg-blue-500/15 text-blue-500" strip="#3b82f6"
          onClick={() => toggleFilter("due")} active={filter === "due"} />
        <StatCard icon={<XCircle className="h-4 w-4" />} label="Rejected" value={stats.rejected} colorClass="bg-destructive/15 text-destructive" strip="#ef4444"
          onClick={() => toggleFilter("rejected")} active={filter === "rejected"} />
      </div>

      {toGrade.length > 0 && (
        <div className="surface flex flex-col gap-2 border-warning/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" />{toGrade.length} supplier form{toGrade.length > 1 ? "s" : ""} waiting to be graded</p>
          <div className="flex flex-wrap gap-2">
            {toGrade.map(s => (
              <button key={s.id} onClick={() => openDetail(s.id)} className="rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning hover:bg-warning/25">{s.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search supplier, service, contract…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {([["all", "All"], ["approved", "Approved"], ["pending", "Pending"], ["under_review", "Under review"], ["rejected", "Rejected"]] as [Filter, string][]).map(([f, l]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
      ) : filtered.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 p-10 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{suppliers.length ? "No suppliers match your filters." : "No suppliers yet — add your first supplier, then send them the evaluation link."}</p>
        </div>
      ) : (
        <div className="surface" style={{ overflowX: "auto" }}>
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b bg-muted/30">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Contract</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Latest evaluation</th>
                <th className="px-4 py-3">Next review</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(s => {
                const d = daysUntil(s.next_review_due)
                return (
                  <tr key={s.id} onClick={() => openDetail(s.id)} className="cursor-pointer transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="font-medium">{s.name}</p>
                      <p className="max-w-[260px] truncate text-xs text-muted-foreground">{s.services || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.contract_number || "—"}</td>
                    <td className="px-4 py-3"><StatusPill status={s.status} /></td>
                    <td className="px-4 py-3">
                      {s.latest_submitted_at ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <GradePill grade={s.latest_overall ?? ""} />
                          <span className="text-[11px] text-muted-foreground">{fmtDate(s.latest_submitted_at)}</span>
                        </div>
                      ) : <span className="text-xs italic text-muted-foreground/60">None yet</span>}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 ${d !== null && d < 0 ? "font-semibold text-destructive" : d !== null && d <= 30 ? "font-semibold text-warning" : "text-muted-foreground"}`}>
                      {s.next_review_due ? fmtDate(s.next_review_due) : "—"}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground/50"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailLoading && !detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/70"><Loader2 className="h-6 w-6 animate-spin" /></div>
      )}

      {/* ── Supplier detail ── */}
      {detail && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold">{detail.supplier.name}</h3>
              <div className="mt-0.5"><StatusPill status={detail.supplier.status} /></div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => openEdit(detail.supplier)} title="Edit supplier" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button>
              {isDirector && <button onClick={() => setDeleteTarget(detail.supplier)} title="Delete supplier" className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
              <button onClick={() => { setDetail(null); setEvalMode(null) }} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {evalMode ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">{evalMode.kind === "grade" ? "Grade evaluation" : "New internal evaluation"}</h4>
                  {evalMode.kind === "grade" && (
                    <span className="text-xs text-muted-foreground">
                      Submitted {fmtDate(evalMode.ev.submitted_at)}{evalMode.ev.header?.completed_by ? ` by ${evalMode.ev.header.completed_by}` : ""}
                      {evalMode.ev.header?.completed_by_position ? ` (${evalMode.ev.header.completed_by_position})` : ""}
                    </span>
                  )}
                </div>
                <div className="surface grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>Reviewed by</Label><Input value={evReviewer} onChange={e => setEvReviewer(e.target.value)} /></div>
                  <div className="space-y-1.5">
                    <Label>Type of review</Label>
                    <select value={evType} onChange={e => setEvType(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                      {REVIEW_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                </div>
                <EvaluationSections
                  answers={evAnswers}
                  onAnswer={evalMode.kind === "new" ? (s: SectionKey, i: number, v: YesNo) => setEvAnswers(a => ({ ...a, [s]: a[s].map((x, idx) => (idx === i ? v : x)) })) : undefined}
                  readOnlyAnswers={evalMode.kind === "grade"}
                  comments={evComments} onComment={(k, v) => setEvComments(c => ({ ...c, [k]: v }))}
                  commentPlaceholder="Comments / evidence seen"
                  grades={evGrades} onGrade={(s, g) => setEvGrades(gr => ({ ...gr, [s]: g }))} showGrades showReviewerNotes={evalMode.kind === "grade"}
                  renderSectionExtra={s => {
                    const docs = sectionDocs(evalMode.kind === "grade" ? evalMode.ev.id : "__none__", s)
                    return docs.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {docs.map(d => (
                          <button key={d.id} onClick={() => viewDoc(d.id)} className="flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">
                            <Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{d.original_name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null
                  }}
                />
              </div>
            ) : (
              <>
                <div className="surface grid gap-3 p-4 text-sm sm:grid-cols-2">
                  <div><p className="text-xs text-muted-foreground">Products / services</p><p className="font-medium">{detail.supplier.services || "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Contract number</p><p className="font-medium">{detail.supplier.contract_number || "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Main contact</p><p className="font-medium">{detail.supplier.contact_name || "—"}</p></div>
                  <div className="flex flex-col gap-1">
                    {detail.supplier.contact_phone && <a href={`tel:${detail.supplier.contact_phone}`} className="flex items-center gap-1.5 text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{detail.supplier.contact_phone}</a>}
                    {detail.supplier.contact_email && <a href={`mailto:${detail.supplier.contact_email}`} className="flex min-w-0 items-center gap-1.5 text-primary hover:underline"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{detail.supplier.contact_email}</span></a>}
                  </div>
                  {detail.supplier.address && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Address</p><p className="whitespace-pre-wrap">{detail.supplier.address}</p></div>}
                  <div><p className="text-xs text-muted-foreground">Last review</p><p className="font-medium">{detail.supplier.review_date ? fmtDate(detail.supplier.review_date) : "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Next review due</p><p className="font-medium">{detail.supplier.next_review_due ? fmtDate(detail.supplier.next_review_due) : "—"}</p></div>
                  {detail.supplier.notes && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Notes</p><p className="whitespace-pre-wrap">{detail.supplier.notes}</p></div>}
                </div>

                {/* Send link */}
                <div className="surface space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <div className="icon-badge bg-primary/15 text-primary"><Link2 className="h-4 w-4" /></div>
                    <div className="min-w-0">
                      <p className="font-semibold">Send evaluation form to supplier</p>
                      <p className="text-xs text-muted-foreground">Creates a private link (valid 30 days, one submission). You copy it into your own email.</p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <Label>Type of review</Label>
                      <select value={linkOpts.review_type} onChange={e => setLinkOpts(o => ({ ...o, review_type: e.target.value }))} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                        {REVIEW_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5"><Label>Reviewed by</Label><Input value={linkOpts.reviewed_by} onChange={e => setLinkOpts(o => ({ ...o, reviewed_by: e.target.value }))} /></div>
                    <Button onClick={createLink} disabled={linkBusy} className="gap-1.5">{linkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}Create &amp; copy link</Button>
                  </div>
                  {newLink && (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                      <input readOnly value={newLink} onFocus={e => e.target.select()} className="min-w-0 flex-1 bg-transparent px-1 font-mono text-xs outline-none" />
                      <Button size="sm" variant="outline" onClick={() => copy(newLink)}><Copy className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                  {detail.open_links.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{detail.open_links.length} open link{detail.open_links.length > 1 ? "s" : ""} — latest expires {fmtDate(detail.open_links[0].expires_at)}</span>
                      <button onClick={revokeLinks} className="font-medium text-destructive hover:underline">Revoke open links</button>
                    </div>
                  )}
                </div>

                {/* Evaluations */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold">Evaluations</h4>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={startNew}><ClipboardList className="h-3.5 w-3.5" />Evaluate internally</Button>
                  </div>
                  {detail.evaluations.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No evaluations yet. Send the supplier a link, or evaluate them internally.</p>
                  ) : detail.evaluations.map(ev => (
                    <div key={ev.id} className="surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <GradePill grade={ev.overall} />
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{ev.submitted_via === "supplier" ? "From supplier" : "Internal"}</span>
                            <span className="text-[11px] text-muted-foreground">{reviewTypeLabel(ev.review_type)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Submitted {fmtDate(ev.submitted_at)}{ev.header?.completed_by ? ` by ${ev.header.completed_by}` : ""}
                            {ev.graded_at ? ` · graded ${fmtDate(ev.graded_at)} by ${ev.graded_by}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          <Button size="sm" variant={ev.overall ? "outline" : "default"} onClick={() => startGrade(ev)}>{ev.overall ? "Review" : "Grade now"}</Button>
                          <Button size="sm" variant="outline" onClick={() => setPrintEv(ev)} title="Print"><Printer className="h-3.5 w-3.5" /></Button>
                          {isDirector && <Button size="sm" variant="outline" onClick={() => deleteEvaluation(ev)} title="Delete" className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-5 gap-1.5">
                        {EVAL_SECTIONS.map(s => {
                          const yes = (ev.answers?.[s.key] ?? []).filter(a => a === "yes").length
                          const g = ev.grades?.[s.key]
                          return (
                            <div key={s.key} title={`${s.title}: ${yes}/3 yes`}
                              className={`rounded-md border px-1 py-1.5 text-center ${g ? GRADE_META[g as Exclude<Grade, "">].cls : "border-dashed"}`}>
                              <p className="text-xs font-black">{s.key}</p>
                              <p className="text-[10px] tabular-nums opacity-80">{yes}/3</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Documents */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold">Certificates &amp; policies</h4>
                    <input ref={docRef} type="file" accept={UPLOAD_ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.target.value = "" }} />
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={docUploading} onClick={() => docRef.current?.click()}>
                      {docUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}Upload
                    </Button>
                  </div>
                  {detail.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No documents on file.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.documents.map(d => {
                        const sec = EVAL_SECTIONS.find(s => s.key === d.section)
                        return (
                          <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <button onClick={() => viewDoc(d.id)} className="min-w-0 flex-1 truncate text-left hover:underline">{d.original_name}</button>
                            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{sec ? `${sec.key}) ${sec.title}` : "General"} · {fmtBytes(d.size_bytes)}</span>
                            {isDirector && <button onClick={() => deleteDoc(d.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {evalMode && (
            <div className="mx-auto flex w-full max-w-3xl gap-2 border-t px-5 py-4">
              <Button variant="outline" className="flex-1" onClick={() => setEvalMode(null)}>Cancel</Button>
              <Button className="flex-1" onClick={saveEvaluation} disabled={evSaving}>{evSaving ? "Saving…" : "Save evaluation"}</Button>
            </div>
          )}
        </div>
      )}

      {/* ── Add / Edit supplier ── */}
      {panel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">{editing ? "Edit supplier" : "Add supplier"}</h3>
            <button onClick={() => setPanel(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>
          <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {panelError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{panelError}</p>}
            <div className="space-y-1.5"><Label>Supplier name *</Label><Input value={draft.name} onChange={e => setF("name", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Products / services supplied</Label><Input value={draft.services} onChange={e => setF("services", e.target.value)} placeholder="e.g. Uniforms & PPE" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Contract number</Label><Input value={draft.contract_number} onChange={e => setF("contract_number", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Main contact name</Label><Input value={draft.contact_name} onChange={e => setF("contact_name", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Main contact number</Label><Input type="tel" value={draft.contact_phone} onChange={e => setF("contact_phone", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Contact email</Label><Input type="email" value={draft.contact_email} onChange={e => setF("contact_email", e.target.value)} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <textarea value={draft.address} onChange={e => setF("address", e.target.value)} rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select value={draft.status} onChange={e => setF("status", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  {Object.entries(SUPPLIER_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>Review date</Label><Input type="date" value={draft.review_date} onChange={e => setF("review_date", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Next review due</Label><Input type="date" value={draft.next_review_due} onChange={e => setF("next_review_due", e.target.value)} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Status and review dates update automatically when an evaluation is fully graded (next review = 12 months).</p>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <textarea value={draft.notes} onChange={e => setF("notes", e.target.value)} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-5 py-4">
            <Button variant="outline" className="flex-1" onClick={() => setPanel(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add supplier"}</Button>
          </div>
        </div>
      )}

      {printEv && detail && <EvaluationPrint supplier={detail.supplier} ev={printEv} onClose={() => setPrintEv(null)} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm space-y-4 rounded-xl border bg-background p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10"><Trash2 className="h-5 w-5 text-destructive" /></div>
              <div>
                <p className="font-semibold">Permanently delete {deleteTarget.name}?</p>
                <p className="mt-1 text-sm text-muted-foreground">All evaluations, links and documents for this supplier are removed for good. Purchase orders keep the supplier name. Recorded in the Audit Trail.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" disabled={deleting} onClick={confirmDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
