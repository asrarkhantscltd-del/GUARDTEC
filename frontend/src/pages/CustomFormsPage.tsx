import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  Plus, X, Loader2, Pencil, Link as LinkIcon, ListChecks, Eye, EyeOff, ClipboardList,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { api, ApiError } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Section, Field } from "@/components/profile/ProfileShared"
import { FormFieldEditor, type FormFieldDraft } from "@/components/customforms/FormFieldEditor"
import { FormLinkGenerator } from "@/components/customforms/FormLinkGenerator"
import type { CustomFormType, CustomFormLinkedEntityType } from "@/types/agency"

// Real row shape from GET/POST/PATCH /api/custom-forms (server.js:4630-4718)
// — a plain `SELECT *`/`RETURNING *` on custom_forms, snake_case throughout.
// NOT the camelCase CustomForm interface in types/agency.ts, which doesn't
// match what the backend actually sends/expects (same mismatch class as
// AgencyStaffForm.tsx's note on agency_staff).
interface CustomForm {
  id: string
  name: string
  description?: string | null
  form_type: CustomFormType
  fields: FormFieldDraft[]
  linked_to_entity_type?: CustomFormLinkedEntityType | null
  linked_to_entity_id?: string | null
  created_by: string
  created_at?: string
  updated_at?: string
  is_published: boolean
  auto_map_to_profile: boolean
  version: number
}

const FORM_TYPES: { value: CustomFormType; label: string }[] = [
  { value: "staff_info",  label: "Staff Info" },
  { value: "agency_info", label: "Agency Info" },
  { value: "site_info",   label: "Site Info" },
  { value: "event_info",  label: "Event Info" },
  { value: "general",     label: "General" },
]

const LINK_ENTITY_TYPES: { value: CustomFormLinkedEntityType; label: string }[] = [
  { value: "staff",  label: "Staff" },
  { value: "agency", label: "Agency" },
  { value: "site",   label: "Site" },
  { value: "event",  label: "Event" },
]

interface FormDraft {
  name: string
  description: string
  formType: CustomFormType
  linkedToEntityType: CustomFormLinkedEntityType | ""
  linkedToEntityId: string
  isPublished: boolean
  autoMapToProfile: boolean
  fields: FormFieldDraft[]
}

function blankDraft(): FormDraft {
  return {
    name: "", description: "", formType: "general",
    linkedToEntityType: "", linkedToEntityId: "",
    isPublished: false, autoMapToProfile: false, fields: [],
  }
}

export default function CustomFormsPage() {
  const { user } = useAuth()
  // No dedicated permission key exists for Custom Forms yet (Permissions
  // type, contexts/AuthContext.tsx) — "compliance" is the closest existing
  // gate for a cross-cutting admin feature like this, mirrored on directors.
  const canManage = user?.role === "director" || !!user?.permissions?.compliance
  const navigate = useNavigate()

  const [forms, setForms]     = useState<CustomForm[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<"all" | CustomFormType>("all")

  const [panelOpen, setPanelOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft]         = useState<FormDraft>(blankDraft())
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState("")

  const [linkFormId, setLinkFormId] = useState<string | null>(null)

  async function reload() {
    try {
      // GET /api/custom-forms returns { ok, forms }, not a bare array.
      const data = await api.get<{ ok: boolean; forms: CustomForm[] }>("/api/custom-forms")
      setForms(data.forms ?? [])
    } catch {
      toast.error("Failed to load forms")
    }
  }

  useEffect(() => { reload().finally(() => setLoading(false)) }, [])

  function openCreate() {
    setEditingId(null)
    setDraft(blankDraft())
    setError("")
    setPanelOpen(true)
  }

  function openEdit(f: CustomForm) {
    setEditingId(f.id)
    setDraft({
      name: f.name,
      description: f.description ?? "",
      formType: f.form_type,
      linkedToEntityType: f.linked_to_entity_type ?? "",
      linkedToEntityId: f.linked_to_entity_id ?? "",
      isPublished: f.is_published,
      autoMapToProfile: f.auto_map_to_profile,
      fields: (f.fields ?? []) as FormFieldDraft[],
    })
    setError("")
    setPanelOpen(true)
  }

  async function save() {
    if (!draft.name.trim()) { setError("Form name is required."); return }
    if (draft.fields.length === 0) { setError("Add at least one field."); return }
    if (draft.fields.some(f => !f.label.trim())) { setError("Every field needs a label."); return }

    setSaving(true); setError("")
    // Snake_case keys — matches what server.js's POST/PATCH /api/custom-forms
    // actually reads off req.body (form_type, is_published, etc.), not the
    // camelCase shape sketched in types/agency.ts.
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      form_type: draft.formType,
      fields: draft.fields,
      linked_to_entity_type: draft.linkedToEntityType || undefined,
      linked_to_entity_id: draft.linkedToEntityId.trim() || undefined,
      is_published: draft.isPublished,
      // auto_map_to_profile only ever means something for staff_info forms —
      // force it false for every other type regardless of prior UI state.
      auto_map_to_profile: draft.formType === "staff_info" ? draft.autoMapToProfile : false,
    }
    try {
      if (editingId) await api.patch(`/api/custom-forms/${editingId}`, body)
      else await api.post("/api/custom-forms", body)
      await reload()
      setPanelOpen(false)
      toast.success(editingId ? "Form updated" : "Form created")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  async function togglePublish(f: CustomForm) {
    try {
      await api.patch(`/api/custom-forms/${f.id}`, { is_published: !f.is_published })
      setForms(prev => prev.map(x => (x.id === f.id ? { ...x, is_published: !x.is_published } : x)))
      toast.success(!f.is_published ? "Form published" : "Form unpublished")
    } catch {
      toast.error("Network error — could not update form")
    }
  }

  const filtered = forms.filter(f => typeFilter === "all" || f.form_type === typeFilter)
  const counts: Record<string, number> = {
    all: forms.length,
    ...Object.fromEntries(FORM_TYPES.map(t => [t.value, forms.filter(f => f.form_type === t.value).length])),
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Custom Forms</h2>
          <p className="text-sm text-muted-foreground">{forms.length} form{forms.length === 1 ? "" : "s"}</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> New form
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTypeFilter("all")}
          className={`rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground transition-opacity ${
            typeFilter === "all" ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
          }`}>
          All ({counts.all})
        </button>
        {FORM_TYPES.map(t => (
          <button key={t.value} onClick={() => setTypeFilter(t.value)}
            className={`rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-opacity ${
              typeFilter === t.value ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"
            }`}>
            {t.label} ({counts[t.value] ?? 0})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading forms...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No forms found.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="hidden px-4 py-3 sm:table-cell">Fields</th>
                <th className="hidden px-4 py-3 md:table-cell">Linked To</th>
                <th className="px-4 py-3">Status</th>
                <th className="w-8 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(f => (
                <tr key={f.id} onClick={() => navigate(`/custom-forms/${f.id}/responses`)}
                  className="cursor-pointer transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    {f.name}
                    {f.auto_map_to_profile && (
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Auto-maps to profile
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {FORM_TYPES.find(t => t.value === f.form_type)?.label ?? f.form_type}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{f.fields?.length ?? 0}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                    {f.linked_to_entity_type ? `${f.linked_to_entity_type}${f.linked_to_entity_id ? ` · ${f.linked_to_entity_id}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      f.is_published ? "border-success/30 bg-success/15 text-success" : "border-border bg-muted text-muted-foreground"
                    }`}>
                      {f.is_published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5">
                      <button onClick={() => navigate(`/custom-forms/${f.id}/responses`)} title="View responses"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <ClipboardList className="h-3.5 w-3.5" />
                      </button>
                      {canManage && (
                        <>
                          <button onClick={() => setLinkFormId(f.id)} title="Get link"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                            <LinkIcon className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => togglePublish(f)} title={f.is_published ? "Unpublish" : "Publish"}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                            {f.is_published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button onClick={() => openEdit(f)} title="Edit"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── Create/Edit panel ── */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">{editingId ? "Edit form" : "New custom form"}</h2>
              <p className="text-xs text-muted-foreground">Build the fields respondents will fill in</p>
            </div>
            <button onClick={() => setPanelOpen(false)} className="rounded-md p-1.5 transition-colors hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

              <Field label="Form name *">
                <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Agency Onboarding Checklist" />
              </Field>

              <Field label="Description">
                <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  rows={2} placeholder="Shown to respondents above the fields"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-[3px] focus:ring-ring/50" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Form type">
                  <select value={draft.formType}
                    onChange={e => setDraft(d => ({
                      ...d,
                      formType: e.target.value as CustomFormType,
                      autoMapToProfile: e.target.value === "staff_info" ? d.autoMapToProfile : false,
                    }))}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-[3px] focus:ring-ring/50">
                    {FORM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Linked entity type">
                  <select value={draft.linkedToEntityType}
                    onChange={e => setDraft(d => ({ ...d, linkedToEntityType: e.target.value as CustomFormLinkedEntityType | "" }))}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-[3px] focus:ring-ring/50">
                    <option value="">None</option>
                    {LINK_ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
              </div>

              {draft.linkedToEntityType && (
                <Field label="Linked entity ID (optional — leave blank for a generic form)">
                  <Input value={draft.linkedToEntityId} onChange={e => setDraft(d => ({ ...d, linkedToEntityId: e.target.value }))} />
                </Field>
              )}

              <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">Published</p>
                  <p className="text-xs text-muted-foreground">Only published forms accept responses</p>
                </div>
                <input type="checkbox" checked={draft.isPublished}
                  onChange={e => setDraft(d => ({ ...d, isPublished: e.target.checked }))}
                  className="h-4 w-4 rounded border-border" />
              </div>

              {draft.formType === "staff_info" && (
                <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">Auto-map to staff profile</p>
                    <p className="text-xs text-muted-foreground">
                      Mapped answers go through the normal pending-approval step — same as any self-service profile edit
                    </p>
                  </div>
                  <input type="checkbox" checked={draft.autoMapToProfile}
                    onChange={e => setDraft(d => ({ ...d, autoMapToProfile: e.target.checked }))}
                    className="h-4 w-4 rounded border-border" />
                </div>
              )}

              <Section title="Fields" icon={<ListChecks className="h-3.5 w-3.5" />}>
                <FormFieldEditor
                  fields={draft.fields}
                  onChange={fields => setDraft(d => ({ ...d, fields }))}
                  mappingEnabled={draft.formType === "staff_info" && draft.autoMapToProfile}
                />
              </Section>
          </div>

          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-6 py-4">
            <Button variant="outline" className="flex-1" onClick={() => setPanelOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : editingId ? "Save changes" : "Create form"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Get link modal ── */}
      {linkFormId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setLinkFormId(null)}>
          <div className="w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Share form link</h3>
              <button onClick={() => setLinkFormId(null)} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <FormLinkGenerator formId={linkFormId} />
          </div>
        </div>
      )}
    </div>
  )
}
