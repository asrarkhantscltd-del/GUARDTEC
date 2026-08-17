import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  FileText, Plus, Pencil, X, Loader2, MapPin, CalendarDays, Users, Building2,
  Link2, Copy, Check, Trash2, ShieldCheck, Clock, Eye, Search, Send,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fmtDate } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
// Only the plain string-union types are reused from the shared types file —
// they're just enum values (draft/published/archived, agency_staff/employee)
// and match reality regardless of casing. The table-shaped EventInstruction
// interface in types/agency.ts is camelCased and does NOT match what
// server.js actually returns (see AgencyStaffForm.tsx's note on the same
// mismatch for agency_staff) — so instruction rows are typed locally below,
// snake_case, straight from the real GET/POST/PATCH /api/event-instructions*
// handlers (server.js:4279-4423).
import type { EventInstructionRequirement, EventInstructionStatus, AcknowledgmentRespondentType } from "@/types/agency"

interface Site { id: string; name: string }
interface AgencyOption { id: string; name: string }
interface DeploymentOption { id: string; event_date: string; site_id: string; site?: Site | null }
interface StaffOption { id: string; name: string }

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

  // Links / manage panel
  const [linksInstruction, setLinksInstruction] = useState<EventInstructionRow | null>(null)
  const [existingForms, setExistingForms] = useState<AckFormSummary[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [respondentMode, setRespondentMode] = useState<"deployment" | "employees">("deployment")
  const [agencies, setAgencies] = useState<AgencyOption[]>([])
  const [agencyPick, setAgencyPick] = useState("")
  const [deployments, setDeployments] = useState<DeploymentOption[]>([])
  const [deploymentPick, setDeploymentPick] = useState("")
  const [allStaff, setAllStaff] = useState<StaffOption[]>([])
  const [staffSearch, setStaffSearch] = useState("")
  const [staffPicked, setStaffPicked] = useState<Set<string>>(new Set())
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

  // ── Create/edit instruction ──────────────────────────────────────────────
  function openCreate() {
    setEditingId(null); setForm(BLANK_FORM); setBumpVersion(false); setFormError(""); setFormOpen(true)
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
    setBumpVersion(false); setFormError(""); setFormOpen(true)
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
      } else {
        const res = await api.post<{ ok: boolean; instruction: EventInstructionRow }>("/api/event-instructions", body)
        setInstructions(prev => [res.instruction, ...prev])
        toast.success("Instruction created")
      }
      closeForm()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Network error")
    } finally {
      setSaving(false)
    }
  }

  // ── Links / manage panel ─────────────────────────────────────────────────
  async function openLinks(instr: EventInstructionRow) {
    setLinksInstruction(instr)
    setRespondentMode("deployment"); setAgencyPick(""); setDeploymentPick("")
    setStaffPicked(new Set()); setStaffSearch(""); setGeneratedLinks([])
    setLinksLoading(true)
    try {
      const [detailRes, agenciesRes, staffRes] = await Promise.allSettled([
        api.get<{ ok: boolean; instruction: EventInstructionRow; forms: AckFormSummary[] }>(`/api/event-instructions/${instr.id}`),
        api.get<{ ok: boolean; agencies: AgencyOption[] }>("/api/agencies"),
        api.get<StaffOption[]>("/api/staff"),
      ])
      if (detailRes.status === "fulfilled") setExistingForms(detailRes.value.forms ?? [])
      if (agenciesRes.status === "fulfilled") setAgencies(agenciesRes.value.agencies ?? [])
      if (staffRes.status === "fulfilled") setAllStaff(Array.isArray(staffRes.value) ? staffRes.value : [])
    } finally {
      setLinksLoading(false)
    }
  }
  function closeLinks() { setLinksInstruction(null); setExistingForms([]); setGeneratedLinks([]) }

  useEffect(() => {
    if (!agencyPick) { setDeployments([]); setDeploymentPick(""); return }
    api.get<{ ok: boolean; deployments: DeploymentOption[] }>(`/api/agencies/${agencyPick}/deployments`)
      .then(d => setDeployments(d.deployments ?? []))
      .catch(() => setDeployments([]))
  }, [agencyPick])

  function toggleStaffPick(id: string) {
    setStaffPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase()
    return q ? allStaff.filter(s => s.name.toLowerCase().includes(q)) : allStaff
  }, [allStaff, staffSearch])

  async function generateLinks() {
    if (!linksInstruction) return
    if (respondentMode === "deployment" && !deploymentPick) {
      toast.error("Pick a deployment first."); return
    }
    if (respondentMode === "employees" && staffPicked.size === 0) {
      toast.error("Pick at least one GuardTec employee."); return
    }
    setGenerating(true)
    try {
      const body = respondentMode === "deployment"
        ? { deployment_id: deploymentPick }
        : { respondents: [...staffPicked].map(id => ({ respondent_type: "employee", respondent_id: id })) }
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
          <h2 className="text-2xl font-bold tracking-tight">Event Instructions</h2>
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
      ) : instructions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No event instructions yet. Click "New instruction" to create one.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {instructions.map(instr => (
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
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create/Edit panel ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={closeForm} />
          <div className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">{editingId ? "Edit instruction" : "New event instruction"}</h2>
              <button onClick={closeForm} className="rounded-md p-1.5 hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
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
            <div className="flex gap-2 border-t px-6 py-4">
              <Button variant="outline" className="flex-1" onClick={closeForm}>Cancel</Button>
              <Button className="flex-1" onClick={saveInstruction} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? "Save changes" : "Create instruction"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Links / manage panel ── */}
      {linksInstruction && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={closeLinks} />
          <div className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Acknowledgment links</h2>
                  <p className="text-xs text-muted-foreground">{linksInstruction.title}</p>
                </div>
                <button onClick={closeLinks} className="rounded-md p-1.5 hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {linksLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
              ) : (
                <>
                  {/* Respondent mode toggle — must support BOTH: an agency
                      deployment's guards, or an explicit list of GuardTec staff */}
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Send to</p>
                    <div className="flex gap-2">
                      <button onClick={() => setRespondentMode("deployment")}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors ${
                          respondentMode === "deployment" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"
                        }`}>
                        <Building2 className="h-3.5 w-3.5" />Agency deployment guards
                      </button>
                      <button onClick={() => setRespondentMode("employees")}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors ${
                          respondentMode === "employees" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"
                        }`}>
                        <Users className="h-3.5 w-3.5" />GuardTec staff
                      </button>
                    </div>
                  </div>

                  {respondentMode === "deployment" ? (
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
                        </div>
                      )}
                      <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                        Every guard currently assigned to this deployment gets their own individually-tracked link.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input value={staffSearch} onChange={e => setStaffSearch(e.target.value)}
                          placeholder="Search GuardTec staff…" className="pl-8" />
                      </div>
                      <div className="max-h-52 space-y-1.5 overflow-y-auto">
                        {filteredStaff.length === 0 ? (
                          <p className="py-4 text-center text-xs text-muted-foreground">No staff found.</p>
                        ) : filteredStaff.slice(0, 50).map(s => (
                          <label key={s.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-muted/40 transition-colors cursor-pointer">
                            <input type="checkbox" checked={staffPicked.has(s.id)} onChange={() => toggleStaffPick(s.id)}
                              className="h-4 w-4 rounded border-border" />
                            {s.name}
                          </label>
                        ))}
                      </div>
                      {staffPicked.size > 0 && <p className="text-xs text-muted-foreground">{staffPicked.size} staff selected</p>}
                    </div>
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
                              <span className="ml-1.5 text-muted-foreground">({f.respondent_type === "agency_staff" ? "Agency guard" : "GuardTec staff"})</span>
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
        </div>
      )}
    </div>
  )
}
