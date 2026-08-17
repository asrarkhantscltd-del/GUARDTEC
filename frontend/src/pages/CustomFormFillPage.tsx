import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { api, ApiError } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DigitalSignaturePad } from "@/components/acknowledgment/DigitalSignaturePad"
import type { CustomFormField } from "@/types/agency"

// Real row shape from GET /api/custom-forms/:id (server.js) — snake_case,
// not the camelCase CustomForm interface in types/agency.ts. See
// CustomFormsPage.tsx's identical note.
interface CustomForm {
  id: string
  name: string
  description?: string | null
  fields: CustomFormField[]
  is_published: boolean
}

// ─────────────────────────────────────────────────────────────────────────
// Respondent-facing. Must work identically whether the visitor is logged in
// (a staff/agency self-service fill) or not logged in at all (a fully
// anonymous "general" form) — the route this renders under, and whether
// it's public, is decided by the router-integration step (not this file).
// Mirrors AcknowledgmentFormPage's standalone CenteredShell shell so both
// respondent-facing pages in the app look and behave the same way.
// ─────────────────────────────────────────────────────────────────────────

function CenteredShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 py-10 sm:items-center">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="mb-5 flex items-center justify-center gap-2 text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em]">GuardTec Compliance</span>
        </div>
        <div className="surface p-6">{children}</div>
      </div>
    </div>
  )
}

function TableFieldInput({ field, value, onChange }: {
  field: CustomFormField; value: Record<string, string>[]; onChange: (rows: Record<string, string>[]) => void
}) {
  const columns = field.options ?? []
  function addRow() {
    onChange([...value, Object.fromEntries(columns.map(c => [c.value, ""]))])
  }
  function updateCell(ri: number, key: string, v: string) {
    onChange(value.map((row, i) => (i === ri ? { ...row, [key]: v } : row)))
  }
  function removeRow(ri: number) {
    onChange(value.filter((_, i) => i !== ri))
  }
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                {columns.map(c => <th key={c.value} className="px-2 py-1.5">{c.label}</th>)}
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {value.map((row, ri) => (
                <tr key={ri}>
                  {columns.map(c => (
                    <td key={c.value} className="px-2 py-1.5">
                      <input value={row[c.value] ?? ""} onChange={e => updateCell(ri, c.value, e.target.value)}
                        className="w-full rounded border border-input bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button type="button" onClick={() => removeRow(ri)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={addRow}
        className="inline-flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">
        <Plus className="h-3 w-3" /> Add row
      </button>
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function CustomFormFillPage() {
  const { formId } = useParams<{ formId: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const [form, setForm]         = useState<CustomForm | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [values, setValues]     = useState<Record<string, unknown>>({})
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  useEffect(() => {
    if (!formId) return
    api.get<{ ok: boolean; form: CustomForm }>(`/api/custom-forms/${formId}`)
      .then(d => setForm(d.form))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [formId])

  function setValue(id: string, v: unknown) {
    setValues(prev => ({ ...prev, [id]: v }))
    setErrors(prev => {
      if (!(id in prev)) return prev
      const rest = { ...prev }
      delete rest[id]
      return rest
    })
  }

  function validate(): boolean {
    if (!form) return false
    const nextErrors: Record<string, string> = {}
    for (const f of form.fields) {
      const v = values[f.id]
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)
      if (f.required && empty) { nextErrors[f.id] = "This field is required"; continue }
      if (!empty && f.validation && typeof v === "string") {
        try {
          if (!new RegExp(f.validation).test(v)) nextErrors[f.id] = "Doesn't match the expected format"
        } catch {
          // A malformed regex authored in the builder shouldn't block a
          // respondent from submitting — fail open on the pattern check.
        }
      }
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function submit() {
    if (!form || !formId) return
    if (!validate()) { toast.error("Please fix the highlighted fields"); return }
    setSubmitting(true)
    try {
      // entityType/entityId are convenience hints only (who this response is
      // ABOUT, for the agency-fills-on-behalf-of-staff case, plan §3.6) — the
      // backend is the actual authority on respondent identity and
      // permission, same as every other ownership check in this app.
      const entityType = searchParams.get("entityType") || undefined
      const entityId = searchParams.get("entityId") || undefined
      // Snake_case — server.js's POST /submit reads response_data,
      // respondent_type, respondent_id off req.body (resolveFormRespondent,
      // server.js ~4743), not the camelCase names used here previously.
      await api.post(`/api/custom-forms/${formId}/submit`, {
        response_data: values,
        ...(entityType ? { respondent_type: entityType } : {}),
        ...(entityId ? { respondent_id: entityId } : {}),
      })
      setSubmitted(true)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <CenteredShell>
        <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Loading form…</p>
        </div>
      </CenteredShell>
    )
  }

  if (notFound || !form) {
    return (
      <CenteredShell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="icon-badge bg-destructive/15"><AlertTriangle className="h-6 w-6 text-destructive" /></span>
          <h2 className="text-lg font-semibold">Form Not Found</h2>
          <p className="max-w-sm text-sm text-muted-foreground">This link doesn't point to a valid form.</p>
        </div>
      </CenteredShell>
    )
  }

  if (!form.is_published) {
    return (
      <CenteredShell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="icon-badge bg-warning/15"><AlertTriangle className="h-6 w-6 text-warning" /></span>
          <h2 className="text-lg font-semibold">Not Accepting Responses</h2>
          <p className="max-w-sm text-sm text-muted-foreground">This form is not currently published.</p>
        </div>
      </CenteredShell>
    )
  }

  if (submitted) {
    return (
      <CenteredShell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="icon-badge bg-success/15"><CheckCircle2 className="h-6 w-6 text-success" /></span>
          <h2 className="text-lg font-semibold">Thank You</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Your response has been submitted.</p>
        </div>
      </CenteredShell>
    )
  }

  return (
    <CenteredShell wide>
      <div className="mb-4">
        <h1 className="text-lg font-semibold">{form.name}</h1>
        {form.description && <p className="mt-1 text-sm text-muted-foreground">{form.description}</p>}
        {user && <p className="mt-1 text-xs text-muted-foreground">Signed in as {user.full_name}</p>}
      </div>

      <div className="space-y-4">
        {form.fields.map(f => (
          <div key={f.id} className="space-y-1.5">
            <Label className="text-sm">
              {f.label}{f.required && <span className="text-destructive"> *</span>}
            </Label>
            {f.helpText && <p className="text-xs text-muted-foreground">{f.helpText}</p>}

            {["text", "email", "phone", "number"].includes(f.type) && (
              <Input
                type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                placeholder={f.placeholder} value={(values[f.id] as string) ?? ""}
                onChange={e => setValue(f.id, e.target.value)} aria-invalid={!!errors[f.id]} />
            )}
            {f.type === "date" && (
              <Input type="date" value={(values[f.id] as string) ?? ""}
                onChange={e => setValue(f.id, e.target.value)} aria-invalid={!!errors[f.id]} />
            )}
            {f.type === "textarea" && (
              <textarea rows={3} placeholder={f.placeholder} value={(values[f.id] as string) ?? ""}
                onChange={e => setValue(f.id, e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-[3px] focus:ring-ring/50" />
            )}
            {f.type === "dropdown" && (
              <select value={(values[f.id] as string) ?? ""} onChange={e => setValue(f.id, e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-[3px] focus:ring-ring/50">
                <option value="">— Select —</option>
                {(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.type === "radio" && (
              <div className="space-y-1.5">
                {(f.options ?? []).map(o => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={f.id} checked={values[f.id] === o.value} onChange={() => setValue(f.id, o.value)}
                      className="h-3.5 w-3.5" />
                    {o.label}
                  </label>
                ))}
              </div>
            )}
            {f.type === "checkbox" && (
              <div className="space-y-1.5">
                {(f.options ?? []).map(o => {
                  const arr = (values[f.id] as string[]) ?? []
                  return (
                    <label key={o.value} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={arr.includes(o.value)}
                        onChange={e => setValue(f.id, e.target.checked ? [...arr, o.value] : arr.filter(v => v !== o.value))}
                        className="h-3.5 w-3.5 rounded border-border" />
                      {o.label}
                    </label>
                  )
                })}
              </div>
            )}
            {f.type === "file" && (
              <input type="file" className="text-sm"
                onChange={async e => {
                  const file = e.target.files?.[0]
                  if (file) setValue(f.id, { name: file.name, type: file.type, data: await fileToDataUrl(file) })
                }} />
            )}
            {f.type === "signature" && (
              <DigitalSignaturePad onChange={v => setValue(f.id, v)} />
            )}
            {f.type === "table" && (
              <TableFieldInput field={f} value={(values[f.id] as Record<string, string>[]) ?? []} onChange={v => setValue(f.id, v)} />
            )}

            {errors[f.id] && <p className="text-xs text-destructive">{errors[f.id]}</p>}
          </div>
        ))}
      </div>

      <Button onClick={submit} disabled={submitting} className="mt-5 w-full">
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : "Submit"}
      </Button>
    </CenteredShell>
  )
}
