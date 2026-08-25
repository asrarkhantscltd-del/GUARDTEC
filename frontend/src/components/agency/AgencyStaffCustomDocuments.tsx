import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Trash2, Download, FileText } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { fmtDate } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"

// Unlimited free-labeled certs per guard, on top of the fixed 5 types
// DocumentUploadRow covers (RTW/SIA/CSCS/Dog Handler/Training). Table:
// agency_staff_custom_documents. Routes (server.js, exact):
//   POST   /api/agencies/:agencyId/staff/:id/custom-documents?label=...  (raw File body, like DocumentUploadRow)
//   GET    /api/agencies/:agencyId/staff/:id/custom-documents            -> { ok, documents: [{id,label,uploaded_at}] }
//   GET    /api/agencies/:agencyId/staff/:id/custom-documents/:docId     (view/download, streamed)
//   DELETE /api/agencies/:agencyId/staff/:id/custom-documents/:docId
// The label here is free text, unlike DocumentUploadRow's strict AgencyDocType
// union, so this is its own small component rather than widening that union.
export interface CustomDocument {
  id: string
  label: string
  uploaded_at: string
}

interface AgencyStaffCustomDocumentsProps {
  agencyId: string
  staffId: string
}

export function AgencyStaffCustomDocuments({ agencyId, staffId }: AgencyStaffCustomDocumentsProps) {
  const [docs, setDocs] = useState<CustomDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState("")

  function load() {
    setLoading(true)
    api.get<{ ok: boolean; documents: CustomDocument[] }>(
      `/api/agencies/${agencyId}/staff/${staffId}/custom-documents`
    ).then(d => setDocs(d.documents ?? []))
      .catch(() => setError("Could not load certificates."))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [agencyId, staffId])

  async function handleAdd() {
    setError("")
    const trimmed = label.trim()
    if (!trimmed) { setError("A certificate name is required."); return }
    if (!file) { setError("Choose a file to upload."); return }
    setUploading(true)
    try {
      await api.post(
        `/api/agencies/${agencyId}/staff/${staffId}/custom-documents?label=${encodeURIComponent(trimmed)}`,
        file
      )
      toast.success(`${trimmed} uploaded`)
      setLabel("")
      setFile(null)
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again.")
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string, docLabel: string) {
    setDeletingId(id)
    try {
      await api.delete(`/api/agencies/${agencyId}/staff/${staffId}/custom-documents/${id}`)
      setDocs(prev => prev.filter(d => d.id !== id))
      toast.success(`${docLabel} removed`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error — could not remove")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground">Additional Certificates</div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="text-xs">Loading certificates…</span>
        </div>
      ) : docs.length > 0 && (
        <div className="space-y-2">
          {docs.map(d => (
            <div key={d.id} className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{d.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Uploaded · {fmtDate(d.uploaded_at)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`/api/agencies/${agencyId}/staff/${staffId}/custom-documents/${d.id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Download className="h-3 w-3" /> View
                </a>
                <button
                  onClick={() => handleDelete(d.id, d.label)}
                  disabled={deletingId === d.id}
                  title="Delete"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  {deletingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed bg-muted/20 p-3">
        <div className="min-w-[140px] flex-1 space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Certificate name</label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. First Aid Certificate" className="h-8 text-xs" />
        </div>
        <label className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted ${uploading ? "pointer-events-none opacity-50" : ""}`}>
          <FileText className="h-3.5 w-3.5" />
          <span className="max-w-[110px] truncate">{file ? file.name : "Choose file"}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button size="sm" onClick={handleAdd} disabled={uploading} className="gap-1 shrink-0">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </Button>
      </div>
    </div>
  )
}
