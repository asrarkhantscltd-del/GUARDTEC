import { Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { CustomFormField, CustomFormFieldType } from "@/types/agency"

// MY_PROFILE_FIELDS (server.js ~line 1666-1673) — the ONLY field names a
// custom form is allowed to offer as an auto-map target. This list must stay
// in exact sync with that backend array: it exists precisely so the builder
// UI can never construct a mapping target server.js doesn't already gate
// through applyPendingProfileFields() + the manager-approve-merge step
// (plan §3.5 governance fix).
export const PROFILE_MAPPABLE_FIELDS: { value: string; label: string }[] = [
  { value: "phone", label: "Phone Number" },
  { value: "address", label: "Address" },
  { value: "emergencyContact", label: "Emergency Contact" },
  { value: "sia", label: "SIA Licence" },
  { value: "cscs", label: "CSCS Card" },
  { value: "visa", label: "Right to Work / Visa" },
  { value: "references", label: "References" },
  { value: "bankDetails", label: "Bank Details" },
  { value: "notes", label: "Notes" },
  { value: "dateOfBirth", label: "Date of Birth" },
  { value: "nationality", label: "Nationality" },
  { value: "ni", label: "National Insurance Number" },
  { value: "uniqueTaxpayerReference", label: "Unique Taxpayer Reference (UTR)" },
  { value: "utrNotApplicable", label: "UTR Not Applicable" },
  { value: "previousNames", label: "Previous Names" },
  { value: "yearsAtCurrentAddress", label: "Years at Current Address" },
  { value: "addressHistory", label: "Address History" },
  { value: "employmentHistoryDetail", label: "Employment History" },
  { value: "otherQualifications", label: "Other Qualifications" },
  { value: "hasCriminalHistory", label: "Has Criminal History" },
  { value: "criminalHistory", label: "Criminal History Detail" },
  { value: "hasCautions", label: "Has Cautions" },
  { value: "cautionsAndInvestigations", label: "Cautions & Investigations" },
  { value: "declarations", label: "Declarations" },
]

// A field as edited in the builder — same shape as CustomFormField
// (types/agency.ts) plus one builder-only key. Not added to the shared
// interface itself (that file is frozen/shared across all Feature 1-3
// frontend work per its own header comment) but every extra key here is
// still plain JSON and travels through `custom_forms.fields JSONB` untouched.
//
// Key name note: this must be `profile_field`, not a camelCase
// `mapToProfileField` — the backend's validateCustomFormFields() and
// extractMappedFields() (server.js ~4607/4774) read `f.profile_field`
// directly off each field object in the stored JSONB. A different key name
// here would silently make the whole auto-map-to-profile feature a no-op
// (the mapping would never validate and never extract), so this name is
// load-bearing, not a style choice.
export interface FormFieldDraft extends CustomFormField {
  // Only meaningful when the parent form is formType === "staff_info" AND
  // autoMapToProfile is on. Restricted to PROFILE_MAPPABLE_FIELDS above.
  profile_field?: string
}

const FIELD_TYPES: { value: CustomFormFieldType; label: string }[] = [
  { value: "text",      label: "Short Text" },
  { value: "textarea",  label: "Long Text" },
  { value: "email",     label: "Email" },
  { value: "phone",     label: "Phone" },
  { value: "date",      label: "Date" },
  { value: "number",    label: "Number" },
  { value: "dropdown",  label: "Dropdown" },
  { value: "radio",     label: "Radio Buttons" },
  { value: "checkbox",  label: "Checkboxes" },
  { value: "file",      label: "File Upload" },
  { value: "signature", label: "Signature" },
  { value: "table",     label: "Table" },
]

// dropdown/radio/checkbox use `options` as the selectable choices; table
// uses the same array for its column definitions (value = column key).
const OPTIONS_TYPES: CustomFormFieldType[] = ["dropdown", "radio", "checkbox"]
const PLACEHOLDER_TYPES: CustomFormFieldType[] = ["text", "textarea", "email", "phone", "number"]
const VALIDATION_TYPES: CustomFormFieldType[] = ["text", "email", "phone", "number"]

function newFieldId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `field_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function blankField(type: CustomFormFieldType = "text"): FormFieldDraft {
  return {
    id: newFieldId(),
    type,
    label: "",
    required: false,
    ...(OPTIONS_TYPES.includes(type) || type === "table" ? { options: [] } : {}),
  }
}

export function FormFieldEditor({
  fields, onChange, mappingEnabled = false,
}: {
  fields: FormFieldDraft[]
  onChange: (fields: FormFieldDraft[]) => void
  // Pass true only when the parent form's formType === "staff_info" AND
  // autoMapToProfile is enabled — that's the only case a mapping target
  // means anything (plan §3.5).
  mappingEnabled?: boolean
}) {
  function update(i: number, patch: Partial<FormFieldDraft>) {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function remove(i: number) {
    onChange(fields.filter((_, idx) => idx !== i))
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= fields.length) return
    const next = [...fields]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  function addField() {
    onChange([...fields, blankField("text")])
  }
  function changeType(i: number, type: CustomFormFieldType) {
    const f = fields[i]
    const needsOptions = OPTIONS_TYPES.includes(type) || type === "table"
    update(i, { type, options: needsOptions ? (f.options ?? []) : undefined })
  }
  function addOption(i: number) {
    const opts = fields[i].options ?? []
    update(i, { options: [...opts, { value: `option_${opts.length + 1}`, label: "" }] })
  }
  function updateOption(i: number, oi: number, label: string) {
    const opts = (fields[i].options ?? []).map((o, idx) => (idx === oi ? { value: label || o.value, label } : o))
    update(i, { options: opts })
  }
  function removeOption(i: number, oi: number) {
    update(i, { options: (fields[i].options ?? []).filter((_, idx) => idx !== oi) })
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No fields yet — add one below.
        </div>
      )}

      {fields.map((f, i) => (
        <div key={f.id} className="rounded-lg border bg-muted/20 p-3 space-y-3">
          <div className="flex items-start gap-2">
            <div className="flex shrink-0 flex-col items-center pt-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
              <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} title="Move down"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Label</Label>
                <Input value={f.label} onChange={e => update(i, { label: e.target.value })} placeholder="Field label" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Field type</Label>
                <select value={f.type} onChange={e => changeType(i, e.target.value as CustomFormFieldType)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-[3px] focus:ring-ring/50">
                  {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <button type="button" onClick={() => remove(i)} title="Remove field"
              className="mt-6 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 pl-6">
            {PLACEHOLDER_TYPES.includes(f.type) && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Placeholder</Label>
                <Input value={f.placeholder ?? ""} onChange={e => update(i, { placeholder: e.target.value })} />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Help text</Label>
              <Input value={f.helpText ?? ""} onChange={e => update(i, { helpText: e.target.value })} />
            </div>
            {VALIDATION_TYPES.includes(f.type) && (
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Validation pattern (regex, optional)</Label>
                <Input value={f.validation ?? ""} onChange={e => update(i, { validation: e.target.value })}
                  placeholder="e.g. ^[0-9]{10,11}$" />
              </div>
            )}
          </div>

          {(OPTIONS_TYPES.includes(f.type) || f.type === "table") && (
            <div className="space-y-2 pl-6">
              <Label className="text-xs text-muted-foreground">{f.type === "table" ? "Columns" : "Options"}</Label>
              {(f.options ?? []).map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <Input value={o.label} onChange={e => updateOption(i, oi, e.target.value)}
                    placeholder={f.type === "table" ? "Column header" : "Option label"} className="flex-1" />
                  <button type="button" onClick={() => removeOption(i, oi)}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => addOption(i)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">
                <Plus className="h-3 w-3" /> Add {f.type === "table" ? "column" : "option"}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pl-6">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={f.required} onChange={e => update(i, { required: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border" />
              Required
            </label>

            {mappingEnabled && (
              <div className="flex items-center gap-1.5">
                <Label className="whitespace-nowrap text-xs text-muted-foreground">Maps to profile field</Label>
                <select value={f.profile_field ?? ""}
                  onChange={e => update(i, { profile_field: e.target.value || undefined })}
                  className="h-7 rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-[3px] focus:ring-ring/50">
                  <option value="">— Not mapped —</option>
                  {PROFILE_MAPPABLE_FIELDS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addField} className="gap-1.5">
        <Plus className="h-4 w-4" /> Add field
      </Button>
    </div>
  )
}
