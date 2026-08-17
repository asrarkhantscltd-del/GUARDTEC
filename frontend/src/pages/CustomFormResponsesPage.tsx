import { Fragment, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, Download, Loader2 } from "lucide-react"
import { downloadExport } from "@/lib/utils"
import { api } from "@/lib/api"
import type { CustomFormField, CustomFormResponseStatus } from "@/types/agency"

// Real row shapes from GET /api/custom-forms/:id/responses (server.js:4720)
// — snake_case Postgres rows, not the camelCase CustomForm/CustomFormResponse
// interfaces in types/agency.ts. See CustomFormsPage.tsx's identical note.
interface CustomForm {
  id: string
  name: string
  fields: CustomFormField[]
}

interface CustomFormResponse {
  id: string
  form_id: string
  respondent_type?: string | null
  respondent_id?: string | null
  response_data: Record<string, unknown>
  submitted_at?: string | null
  status: CustomFormResponseStatus
}

const STATUS_LABELS: Record<CustomFormResponseStatus, string> = {
  draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected",
}
const STATUS_CLS: Record<CustomFormResponseStatus, string> = {
  draft:     "bg-muted text-muted-foreground border-border",
  submitted: "bg-primary/15 text-primary border-primary/30",
  approved:  "bg-success/15 text-success border-success/30",
  rejected:  "bg-destructive/15 text-destructive border-destructive/30",
}

function renderResponseValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—"
  if (Array.isArray(v)) {
    if (v.length > 0 && typeof v[0] === "object") return `${v.length} row(s)`
    return v.join(", ")
  }
  if (typeof v === "object") {
    const o = v as { name?: string }
    return o.name ? `File: ${o.name}` : "[signature captured]"
  }
  return String(v)
}

export default function CustomFormResponsesPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [form, setForm]           = useState<CustomForm | null>(null)
  const [responses, setResponses] = useState<CustomFormResponse[]>([])
  const [loading, setLoading]     = useState(true)
  const [statusFilter, setStatusFilter] = useState<"all" | CustomFormResponseStatus>("all")
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [exporting, setExporting]       = useState(false)

  useEffect(() => {
    if (!id) return
    // One endpoint returns both — { ok, form, responses } — no need for a
    // separate /api/custom-forms/:id call here.
    api.get<{ ok: boolean; form: CustomForm; responses: CustomFormResponse[] }>(`/api/custom-forms/${id}/responses`)
      .then(d => { setForm(d.form); setResponses(d.responses ?? []) })
      .catch(() => toast.error("Failed to load responses"))
      .finally(() => setLoading(false))
  }, [id])

  async function exportCsv() {
    if (!id || !form) return
    setExporting(true)
    try {
      await downloadExport(`/api/custom-forms/${id}/export`, `${form.name}-responses.csv`)
    } catch {
      toast.error("Failed to export responses")
    } finally {
      setExporting(false)
    }
  }

  const filtered = responses.filter(r => statusFilter === "all" || r.status === statusFilter)
  const counts = {
    all:       responses.length,
    draft:     responses.filter(r => r.status === "draft").length,
    submitted: responses.filter(r => r.status === "submitted").length,
    approved:  responses.filter(r => r.status === "approved").length,
    rejected:  responses.filter(r => r.status === "rejected").length,
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading responses...</span>
      </div>
    )
  }
  if (!form) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Form not found.</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate("/custom-forms")}
            className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> All forms
          </button>
          <h2 className="text-2xl font-bold tracking-tight">{form.name}</h2>
          <p className="text-sm text-muted-foreground">{responses.length} response{responses.length === 1 ? "" : "s"}</p>
        </div>
        <button onClick={exportCsv} disabled={exporting}
          className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "draft", "submitted", "approved", "rejected"] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-opacity ${
              s === "all" ? "border-transparent bg-secondary text-secondary-foreground" : STATUS_CLS[s]
            } ${statusFilter === s ? "opacity-100 ring-2 ring-ring ring-offset-1" : "opacity-70 hover:opacity-100"}`}>
            {s === "all" ? "All" : STATUS_LABELS[s]} ({counts[s]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No responses yet.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Respondent</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => (
                <Fragment key={r.id}>
                  <tr onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="cursor-pointer transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      {r.respondent_type ? `${r.respondent_type}${r.respondent_id ? ` · ${r.respondent_id}` : ""}` : "Anonymous"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.submitted_at ? new Date(r.submitted_at).toLocaleString("en-GB") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[r.status]}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr>
                      <td colSpan={3} className="bg-muted/20 px-4 py-3">
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {form.fields.map(f => (
                            <div key={f.id} className="space-y-0.5">
                              <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
                              <dd className="break-words text-sm">{renderResponseValue(r.response_data[f.id])}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
