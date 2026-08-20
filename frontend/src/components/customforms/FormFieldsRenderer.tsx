import { Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DigitalSignaturePad } from "@/components/acknowledgment/DigitalSignaturePad"
import type { CustomFormField } from "@/types/agency"

// Single source of truth for "what does a respondent actually see for field
// type X" — shared by CustomFormFillPage (the real thing) and the builder's
// live preview pane (CustomFormsPage). Extracted so the two can never drift
// apart: if they rendered separate copies of this JSX, a fix or new field
// type applied to one would silently stop being true of the other, and the
// live preview would start lying about what respondents actually get.

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

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function FormFieldsRenderer({
  fields, values, errors, onChange,
}: {
  fields: CustomFormField[]
  values: Record<string, unknown>
  errors?: Record<string, string>
  onChange: (id: string, value: unknown) => void
}) {
  return (
    <div className="space-y-4">
      {fields.map(f => (
        <div key={f.id} className="space-y-1.5">
          <Label className="text-sm">
            {f.label || <span className="italic text-muted-foreground">Untitled field</span>}
            {f.required && <span className="text-destructive"> *</span>}
          </Label>
          {f.helpText && <p className="text-xs text-muted-foreground">{f.helpText}</p>}

          {["text", "email", "phone", "number"].includes(f.type) && (
            <Input
              type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
              placeholder={f.placeholder} value={(values[f.id] as string) ?? ""}
              onChange={e => onChange(f.id, e.target.value)} aria-invalid={!!errors?.[f.id]} />
          )}
          {f.type === "date" && (
            <Input type="date" value={(values[f.id] as string) ?? ""}
              onChange={e => onChange(f.id, e.target.value)} aria-invalid={!!errors?.[f.id]} />
          )}
          {f.type === "textarea" && (
            <textarea rows={3} placeholder={f.placeholder} value={(values[f.id] as string) ?? ""}
              onChange={e => onChange(f.id, e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-[3px] focus:ring-ring/50" />
          )}
          {f.type === "dropdown" && (
            <select value={(values[f.id] as string) ?? ""} onChange={e => onChange(f.id, e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-[3px] focus:ring-ring/50">
              <option value="">— Select —</option>
              {(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {f.type === "radio" && (
            <div className="space-y-1.5">
              {(f.options ?? []).map(o => (
                <label key={o.value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={f.id} checked={values[f.id] === o.value} onChange={() => onChange(f.id, o.value)}
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
                      onChange={e => onChange(f.id, e.target.checked ? [...arr, o.value] : arr.filter(v => v !== o.value))}
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
                if (file) onChange(f.id, { name: file.name, type: file.type, data: await fileToDataUrl(file) })
              }} />
          )}
          {f.type === "signature" && (
            <DigitalSignaturePad onChange={v => onChange(f.id, v)} />
          )}
          {f.type === "table" && (
            <TableFieldInput field={f} value={(values[f.id] as Record<string, string>[]) ?? []} onChange={v => onChange(f.id, v)} />
          )}

          {errors?.[f.id] && <p className="text-xs text-destructive">{errors[f.id]}</p>}
        </div>
      ))}
    </div>
  )
}
