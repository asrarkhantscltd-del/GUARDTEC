import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import {
  FileText, Plus, Pencil, X, Loader2, MapPin, CalendarDays, Users, Building2,
  Link2, Copy, Check, Trash2, ShieldCheck, Clock, Eye, Search, Send, Truck,
  UserCog, Upload, Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fmtDate } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
// Only the plain string-union types are reused from the shared types file —
// they're just enum values (draft/published/archived, agency_staff/employee/
// driver/manager) and match reality regardless of casing. The table-shaped
// EventInstruction interface in types/agency.ts is camelCased and does NOT
// match what server.js actually returns (see AgencyStaffForm.tsx's note on
// the same mismatch for agency_staff) — so instruction rows are typed locally
// below, snake_case, straight from the real GET/POST/PATCH
// /api/event-instructions* handlers.
import type { EventInstructionRequirement, EventInstructionStatus, AcknowledgmentRespondentType } from "@/types/agency"

interface Site { id: string; name: string }
interface AgencyOption { id: string; name: string }
interface DeploymentOption { id: string; event_date: string; site_id: string; site?: Site | null }
interface StaffOption { id: string; name: string }
interface DriverOption { id: string; first_name?: string; last_name?: string }
interface ManagerOption { id: string; full_name: string }

interface EventInstructionRow {
  id: string
  site_id?: string
  site?: Site | null
  event_date?: string
  title: string
  instructions_html?: string
  requirements?: EventInstructionRequirement[]
  document_file_url?: string
  document_mime_type?: string
  created_by: string
  created_at?: string
  version: number
  status: EventInstructionStatus
}

interface AckFormSummary {
  id: string
  respondent_type: AcknowledgmentRespondentType
  respondent_id: string
  respondent_name_snapshot?: string
  instruction_version: number
  link_expires_at: string
  form_opened_at?: string
  signed_at?: string
  current_step: number
}

interface GeneratedLink {
  respondent_type: string
  respondent_id: string
  url: string
}

const BLANK_FORM = {
  title: "", site_id: "", event_date: "", instructions_html: "",
  status: "draft" as EventInstructionStatus,
  requirements: [] as EventInstructionRequirement[],
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  published: "bg-success/15 text-success border-success/30",
  archived: "bg-destructive/15 text-destructive border-destructive/30",
}

function respondentTypeLabel(t: string) {
  switch (t) {
    case "agency_staff": return "Agency guard"
    case "employee": return "GuardTec staff"
    case "driver": return "Driver"
    case "manager": return "Manager"
    default: return t
  }
}

function toggleInSet(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
  setter(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
}

const AUDIENCE_TABS = [
  { key: "staff" as const, label: "Staff", icon: Users },
  { key: "agency" as const, label: "Agency", icon: Building2 },
  { key: "driver" as const, label: "Driver", icon: Truck },
  { key: "manager" as const, label: "Manager", icon: UserCog },
]
type Audience = (typeof AUDIENCE_TABS)[number]["key"]

// One searchable multi-select checkbox list, reused for all four "Send to"
// audiences — lifted directly from the employees picker this file already
// had, just generalised over {id,label} instead of being staff-specific.
interface PickOption { id: string; label: string }
function MultiSelectList({
  options, picked, onToggle, search, onSearch, placeholder, emptyText,
}: {
  options: PickOption[]
  picked: Set<string>
  onToggle: (id: string) => void
  search: string
  onSearch: (v: string) => void
  placeholder: string
  emptyText: string
}) {
  const q = search.trim().toLowerCase()
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => onSearch(e.target.value)} placeholder={placeholder} className="pl-8" />
      </div>
      <div className="max-h-52 space-y-1.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{emptyText}</p>
        ) : filtered.slice(0, 50).map(o => (
          <label key={o.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-muted/40 transition-colors cursor-pointer">
            <input type="checkbox" checked={picked.has(o.id)} onChange={() => onToggle(o.id)}
              className="h-4 w-4 rounded border-border" />
            {o.label}
          </label>
        ))}
      </div>
      {picked.size > 0 && <p className="text-xs text-muted-foreground">{picked.size} selected</p>}
    </div>
  )
}

export default function EventInstructionsPanel() {
  const [instructions, setInstructions] = useState<EventInstructionRow[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<"all" | EventInstructionStatus>("all")

  // Create/edit panel
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [bumpVersion, setBumpVersion] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")

  // Document attachment (create-then-attach — same shape as this app's other
  // "save the record first, then a document control unlocks" forms, except
  // it unlocks in-place instead of needing a re-open)
  const [formDocUrl, setFormDocUrl] = useState<string | undefined>(undefined)
  const [docUploading, setDocUploading] = useState(false)
  const docInputRef = useRef<HTMLInputElement>(null)

  // Archive (soft-delete) confirm
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)

  // Links / manage panel
  const [linksInstruction, setLinksInstruction] = useState<EventInstructionRow | null>(null)
  const [existingForms, setExistingForms] = useState<AckFormSummary[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [audience, setAudience] = useState<Audience>("staff")

  const [allStaff, setAllStaff] = useState<StaffOption[]>([])
  const [staffSearch, setStaffSearch] = useState("")
  const [staffPicked, setStaffPicked] = useState<Set<string>>(new Set())

  const [agencies, setAgencies] = useState<AgencyOption[]>([])
  const [agencyPick, setAgencyPick] = useState("")
  const [agencyGuards, setAgencyGuards] = useState<StaffOption[]>([])
  const [guardSearch, setGuardSearch] = useState("")
  const [guardPicked, setGuardPicked] = useState<Set<string>>(new Set())
  // Secondary shortcut kept from the old flow: skip picking individual guards
  // and just send to everyone already on a given deployment.
  const [deploymentShortcut, setDeploymentShortcut] = useState(false)
  const [deployments, setDeployments] = useState<DeploymentOption[]>([])
  const [deploymentPick, setDeploymentPick] = useState("")

  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [driverSearch, setDriverSearch] = useState("")
  const [driverPicked, setDriverPicked] = useState<Set<string>>(new Set())

  const [managers, setManagers] = useState<ManagerOption[]>([])
  const [managerSearch, setManagerSearch] = useState("")
  const [managerPicked, setManagerPicked] = useState<Set<string>>(new Set())

  const [generating, setGenerating] = useState(false)
  const [generatedLinks, setGeneratedLinks] = useState<GeneratedLink[]>([])
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  async function loadInstructions() {
    setLoading(true)
    try {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : ""
      const d = await api.get<{ ok: boolean; instructions: EventInstructionRow[] }>(`/api/event-instructions${qs}`)
      setInstructions(d.instructions ?? [])
    } catch {
      toast.error("Failed to load event instructions")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadInstructions() }, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get<{ sites: Site[] }>("/api/sites").then(d => setSites(d.sites ?? [])).catch(() => {})
  }, [])

  // The backend has no default archived-exclusion, so the "all" tab filters
  // archived instructions out client-side — the "archived" tab (already an
  // explicit filter option) is the "show archived" toggle.
  const visibleInstructions = statusFilter === "all"
    ? instructions.filter(i => i.status !== "archived")
    : instructions

  // ── Create/edit instruction ──────────────────────────────────────────────
  function openCreate() {
    setEditingId(null); setForm(BLANK_FORM); setBumpVersion(false); setFormError("")
    setFormDocUrl(undefined); setFormOpen(true)
  }
  function openEdit(instr: EventInstructionRow) {
    setEditingId(instr.id)
    setForm({
      title: instr.title,
      site_id: instr.site_id ?? "",
      event_date: instr.event_date ? instr.event_date.slice(0, 10) : "",
      instructions_html: instr.instructions_html ?? "",
      status: instr.status,
      requirements: instr.requirements ?? [],
    })
    setBumpVersion(false); setFormError("")
    setFormDocUrl(instr.document_file_url); setFormOpen(true)
  }
  function closeForm() { setFormOpen(false); setEditingId(null); setFormError("") }

  function addRequirement() {
    setForm(p => ({ ...p, requirements: [...p.requirements, { title: "", description: "", mandatory: true }] }))
  }
  function updateRequirement(i: number, patch: Partial<EventInstructionRequirement>) {
    setForm(p => ({ ...p, requirements: p.requirements.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }))
  }
  function removeRequirement(i: number) {
    setForm(p => ({ ...p, requirements: p.requirements.filter((_, idx) => idx !== i) }))
  }

  async function saveInstruction() {
    if (!form.title.trim()) { setFormError("Title is required."); return }
    setSaving(true); setFormError("")
    const body = {
      title: form.title.trim(),
      site_id: form.site_id || undefined,
      event_date: form.event_date || undefined,
      instructions_html: form.instructions_html || undefined,
      requirements: form.requirements.filter(r => r.title.trim()),
      status: form.status,
      ...(editingId && bumpVersion ? { bump_version: true } : {}),
    }
    try {
      if (editingId) {
        const res = await api.patch<{ ok: boolean; instruction: EventInstructionRow }>(`/api/event-instructions/${editingId}`, body)
        setInstructions(prev => prev.map(i => (i.id === editingId ? res.instruction : i)))
        toast.success("Instruction updated")
        closeForm()
      } else {
        const res = await api.post<{ ok: boolean; instruction: EventInstructionRow }>("/api/event-instructions", body)
        setInstructions(prev => [res.instruction, ...prev])
        // Don't close — switch straight into edit mode so the document
        // attachment control (which needs an id) unlocks immediately.
        setEditingId(res.instruction.id)
        setFormDocUrl(res.instruction.document_file_url)
        toast.success("Instruction created — you can now attach a document below")
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setSaving(false)
    }
  }

  async function handleDocFile(file: File) {
    if (!editingId) return
    setDocUploading(true)
    try {
      const res = await api.post<{ ok: boolean; instruction: EventInstructionRow }>(
        `/api/event-instructions/${editingId}/document`, file
      )
      setFormDocUrl(res.instruction.document_file_url)
      setInstructions(prev => prev.map(i => (i.id === editingId ? res.instruction : i)))
      toast.success("Document attached")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setDocUploading(false)
      if (docInputRef.current) docInputRef.current.value = ""
    }
  }

  // ── Archive (soft-delete) ────────────────────────────────────────────────
  async function archiveInstruction(id: string) {
    setArchivingId(id)
    try {
      const res = await api.post<{ ok: boolean; instruction: EventInstructionRow }>(`/api/event-instructions/${id}/archive`)
      setInstructions(prev => prev.map(i => (i.id === id ? res.instruction : i)))
      toast.success("Instruction archived")
      setConfirmArchiveId(null)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setArchivingId(null)
    }
  }

  // ── Links / manage panel ─────────────────────────────────────────────────
  async function openLinks(instr: EventInstructionRow) {
    setLinksInstruction(instr)
    setAudience("staff")
    setAgencyPick(""); setDeploymentPick(""); setDeploymentShortcut(false)
    setStaffPicked(new Set()); setStaffSearch("")
    setAgencyGuards([]); setGuardPicked(new Set()); setGuardSearch("")
    setDriverPicked(new Set()); setDriverSearch("")
    setManagerPicked(new Set()); setManagerSearch("")
    setGeneratedLinks([])
    setLinksLoading(true)
    try {
      const [detailRes, agenciesRes, staffRes, driversRes, managersRes] = await Promise.allSettled([
        api.get<{ ok: boolean; instruction: EventInstructionRow; forms: AckFormSummary[] }>(`/api/event-instructions/${instr.id}`),
        api.get<{ ok: boolean; agencies: AgencyOption[] }>("/api/agencies"),
        api.get<StaffOption[]>("/api/staff"),
        api.get<DriverOption[]>("/api/fleet-drivers"),
        api.get<{ ok: boolean; managers: ManagerOption[] }>("/api/manager-directory"),
      ])
      if (detailRes.status === "fulfilled") setExistingForms(detailRes.value.forms ?? [])
      if (agenciesRes.status === "fulfilled") setAgencies(agenciesRes.value.agencies ?? [])
      if (staffRes.status === "fulfilled") setAllStaff(Array.isArray(staffRes.value) ? staffRes.value : [])
      if (driversRes.status === "fulfilled") setDrivers(Array.isArray(driversRes.value) ? driversRes.value : [])
      if (managersRes.status === "fulfilled") setManagers(managersRes.value.managers ?? [])
    } finally {
      setLinksLoading(false)
    }
  }
  function closeLinks() { setLinksInstruction(null); setExistingForms([]); setGeneratedLinks([]) }

  useEffect(() => {
    if (!agencyPick) { setAgencyGuards([]); setGuardPicked(new Set()); setDeployments([]); setDeploymentPick(""); return }
    api.get<{ ok: boolean; staff: StaffOption[] }>(`/api/agencies/${agencyPick}/staff`)
      .then(d => setAgencyGuards(d.staff ?? []))
      .catch(() => setAgencyGuards([]))
    api.get<{ ok: boolean; deployments: DeploymentOption[] }>(`/api/agencies/${agencyPick}/deployments`)
      .then(d => setDeployments(d.deployments ?? []))
      .catch(() => setDeployments([]))
  }, [agencyPick])

  async function generateLinks() {
    if (!linksInstruction) return
    let body: { deployment_id: string } | { respondents: { respondent_type: AcknowledgmentRespondentType; respondent_id: string }[] }
    if (audience === "agency" && deploymentShortcut) {
      if (!deploymentPick) { toast.error("Pick a deployment first."); return }
      body = { deployment_id: deploymentPick }
    } else {
      const respondents =
        audience === "staff" ? [...staffPicked].map(id => ({ respondent_type: "employee" as const, respondent_id: id })) :
        audience === "agency" ? [...guardPicked].map(id => ({ respondent_type: "agency_staff" as const, respondent_id: id })) :
        audience === "driver" ? [...driverPicked].map(id => ({ respondent_type: "driver" as const, respondent_id: id })) :
        [...managerPicked].map(id => ({ respondent_type: "manager" as const, respondent_id: id }))
      if (respondents.length === 0) { toast.error("Pick at least one recipient."); return }
      body = { respondents }
    }
    setGenerating(true)
    try {
      const res = await api.post<{ ok: boolean; links: GeneratedLink[] }>(`/api/event-instructions/${linksInstruction.id}/links`, body)
      setGeneratedLinks(res.links ?? [])
      toast.success(`${res.links?.length ?? 0} link(s) generated`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setGenerating(false)
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(url)
      setTimeout(() => setCopiedUrl(null), 1500)
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Event Instructions</h2>
          <p className="text-sm text-muted-foreground">Publish compliance instructions and send acknowledgment links to cover guards or GuardTec staff</p>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New instruction</Button>
      </div>

      <div className="flex gap-2">
        {(["all", "draft", "published", "archived"] as const).map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              statusFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading instructions…</span>
        </div>
      ) : visibleInstructions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No event instructions yet. Click "New instruction" to create one.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleInstructions.map(instr => (
            <div key={instr.id} className="surface flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{instr.title}
                  </p>
                  {instr.site && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />{instr.site.name}
                    </p>
                  )}
                  {instr.event_date && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="h-3 w-3" />{fmtDate(instr.event_date)}
                    </p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[instr.status]}`}>
                  {instr.status}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                v{instr.version} · {instr.requirements?.length ?? 0} requirement{instr.requirements?.length === 1 ? "" : "s"}
              </p>
              <div className="mt-1 flex gap-1.5">
                <button onClick={() => openEdit(instr)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                  <Pencil className="h-3.5 w-3.5" />Edit
                </button>
                <button onClick={() => openLinks(instr)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">
                  <Link2 className="h-3.5 w-3.5" />Links
                </button>
                <button onClick={() => setConfirmArchiveId(instr.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />Delete
                </button>
              </div>
              {confirmArchiveId === instr.id && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex flex-col gap-2">
                  <p className="text-xs text-destructive font-medium">Archive this instruction? It disappears from the default list, but its acknowledgment records are kept.</p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmArchiveId(null)}
                      className="rounded px-2.5 py-1 text-xs border hover:bg-muted transition-colors">Cancel</button>
                    <button onClick={() => archiveInstruction(instr.id)} disabled={archivingId === instr.id}
                      className="rounded px-2.5 py-1 text-xs bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center gap-1">
                      {archivingId === instr.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Yes, archive
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Create/Edit panel ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-semibold">{editingId ? "Edit instruction" : "New event instruction"}</h2>
            <button onClick={closeForm} className="rounded-md p-1.5 hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
          </div>
          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {formError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}

              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Westfield Site — Event Day Briefing" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Linked site (optional)</Label>
                  <select value={form.site_id} onChange={e => setForm(p => ({ ...p, site_id: e.target.value }))}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    <option value="">Standalone (no site)</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Event date</Label>
                  <Input type="date" value={form.event_date} onChange={e => setForm(p => ({ ...p, event_date: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Instructions</Label>
                <textarea rows={5} value={form.instructions_html}
                  onChange={e => setForm(p => ({ ...p, instructions_html: e.target.value }))}
                  placeholder="Briefing text guards must read before signing…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none" />
              </div>

              <div className="space-y-1.5">
                <Label>Document attachment</Label>
                {editingId ? (
                  <div className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">Instructions document</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formDocUrl ? "Attached" : "PDF, JPG or PNG — the full briefing document, if any"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {formDocUrl && (
                        <a href={`/api/event-instructions/${editingId}/document`} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <Download className="h-3 w-3" /> View
                        </a>
                      )}
                      <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted ${docUploading ? "pointer-events-none opacity-50" : ""}`}>
                        {docUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        {docUploading ? "Uploading…" : formDocUrl ? "Replace" : "Upload"}
                        <input ref={docInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleDocFile(f) }} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                    Create the instruction first — the upload control appears here immediately after.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Requirements</Label>
                  <button type="button" onClick={addRequirement}
                    className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Plus className="h-3 w-3" />Add requirement
                  </button>
                </div>
                {form.requirements.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70 italic">No requirements added yet.</p>
                ) : (
                  <div className="space-y-2">
                    {form.requirements.map((r, i) => (
                      <div key={i} className="rounded-md border bg-muted/20 p-2.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input value={r.title} placeholder="Requirement title" className="h-8 flex-1 text-xs"
                            onChange={e => updateRequirement(i, { title: e.target.value })} />
                          <button type="button" onClick={() => removeRequirement(i)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <Input value={r.description ?? ""} placeholder="Description (optional)" className="h-8 text-xs"
                          onChange={e => updateRequirement(i, { description: e.target.value })} />
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input type="checkbox" checked={r.mandatory}
                            onChange={e => updateRequirement(i, { mandatory: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-border" />
                          Mandatory
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex gap-2">
                  {(["draft", "published", "archived"] as const).map(s => (
                    <button key={s} type="button" onClick={() => setForm(p => ({ ...p, status: s }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium capitalize transition-colors ${
                        form.status === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {editingId && (
                <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
                  <input type="checkbox" checked={bumpVersion} onChange={e => setBumpVersion(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-border" />
                  This is a substantive change — bump the version so everyone must re-acknowledge
                </label>
              )}
            </div>
          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-6 py-4">
            <Button variant="outline" className="flex-1" onClick={closeForm}>{editingId ? "Done" : "Cancel"}</Button>
            <Button className="flex-1" onClick={saveInstruction} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? "Save changes" : "Create instruction"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Links / manage panel ── */}
      {linksInstruction && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <div className="border-b px-6 py-4">
              <div className="mx-auto flex w-full max-w-2xl items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Acknowledgment links</h2>
                  <p className="text-xs text-muted-foreground">{linksInstruction.title}</p>
                </div>
                <button onClick={closeLinks} className="rounded-md p-1.5 hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {linksLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
              ) : (
                <>
                  {/* 4-way audience selector — Staff / Agency / Driver / Manager,
                      each a searchable multi-select feeding an explicit
                      respondents[] array on submit. */}
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Send to</p>
                    <div className="grid grid-cols-4 gap-2">
                      {AUDIENCE_TABS.map(t => (
                        <button key={t.key} onClick={() => setAudience(t.key)}
                          className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs font-medium transition-colors ${
                            audience === t.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"
                          }`}>
                          <t.icon className="h-3.5 w-3.5" />{t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {audience === "staff" && (
                    <MultiSelectList
                      options={allStaff.map(s => ({ id: s.id, label: s.name }))}
                      picked={staffPicked} onToggle={id => toggleInSet(setStaffPicked, id)}
                      search={staffSearch} onSearch={setStaffSearch}
                      placeholder="Search GuardTec staff…" emptyText="No staff found."
                    />
                  )}

                  {audience === "agency" && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Agency</Label>
                        <select value={agencyPick} onChange={e => setAgencyPick(e.target.value)}
                          className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                          <option value="">Select agency…</option>
                          {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                      {agencyPick && (
                        <>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                            <input type="checkbox" checked={deploymentShortcut}
                              onChange={e => setDeploymentShortcut(e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-border" />
                            Shortcut: send to everyone on a specific deployment
                          </label>
                          {deploymentShortcut ? (
                            <div className="space-y-1.5">
                              <Label>Deployment</Label>
                              <select value={deploymentPick} onChange={e => setDeploymentPick(e.target.value)}
                                className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                                <option value="">Select deployment…</option>
                                {deployments.map(d => (
                                  <option key={d.id} value={d.id}>{fmtDate(d.event_date)} — {d.site?.name ?? d.site_id}</option>
                                ))}
                              </select>
                              {deployments.length === 0 && <p className="text-xs text-muted-foreground/70">No deployments booked for this agency yet.</p>}
                              <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                                Every guard currently assigned to this deployment gets their own individually-tracked link.
                              </p>
                            </div>
                          ) : (
                            <MultiSelectList
                              options={agencyGuards.map(s => ({ id: s.id, label: s.name }))}
                              picked={guardPicked} onToggle={id => toggleInSet(setGuardPicked, id)}
                              search={guardSearch} onSearch={setGuardSearch}
                              placeholder="Search this agency's guards…" emptyText="No guards found for this agency."
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {audience === "driver" && (
                    <MultiSelectList
                      options={drivers.map(d => ({ id: d.id, label: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed driver" }))}
                      picked={driverPicked} onToggle={id => toggleInSet(setDriverPicked, id)}
                      search={driverSearch} onSearch={setDriverSearch}
                      placeholder="Search drivers…" emptyText="No drivers found."
                    />
                  )}

                  {audience === "manager" && (
                    <MultiSelectList
                      options={managers.map(m => ({ id: m.id, label: m.full_name }))}
                      picked={managerPicked} onToggle={id => toggleInSet(setManagerPicked, id)}
                      search={managerSearch} onSearch={setManagerSearch}
                      placeholder="Search managers…" emptyText="No managers found."
                    />
                  )}

                  <Button onClick={generateLinks} disabled={generating} className="w-full gap-2">
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {generating ? "Generating…" : "Generate links"}
                  </Button>

                  {generatedLinks.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        New links ({generatedLinks.length}) — each expires in 5 minutes, one-time use
                      </p>
                      {generatedLinks.map((l, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-xs font-mono">{l.url}</span>
                          <button onClick={() => copyLink(l.url)}
                            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                            {copiedUrl === l.url ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Existing links ({existingForms.length})
                    </p>
                    {existingForms.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70 italic">No links generated yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {existingForms.map(f => (
                          <div key={f.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
                            <span className="flex-1 truncate">
                              {f.respondent_name_snapshot ?? f.respondent_id}
                              <span className="ml-1.5 text-muted-foreground">({respondentTypeLabel(f.respondent_type)})</span>
                            </span>
                            {f.signed_at ? (
                              <span className="flex items-center gap-1 text-success"><ShieldCheck className="h-3 w-3" />Signed</span>
                            ) : f.form_opened_at ? (
                              <span className="flex items-center gap-1 text-warning"><Eye className="h-3 w-3" />Opened</span>
                            ) : (
                              <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" />Pending</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
        </div>
      )}
    </div>
  )
}
