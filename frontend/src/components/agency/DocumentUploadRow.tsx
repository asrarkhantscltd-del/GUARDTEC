import { useRef, useState } from "react"
import { toast } from "sonner"
import { Loader2, Upload, ShieldCheck, Download } from "lucide-react"
import { api, ApiError } from "@/lib/api"

// Mirrors DocUploadRow (components/profile/ProfileShared.tsx) exactly in
// visual shape, but targets the agency-staff document routes instead:
//   POST/GET /api/agencies/:agencyId/staff/:id/documents/:docType
// docType is one of ALLOWED_AGENCY_DOC_TYPES (server.js):
//   sia_cert | cscs_cert | rtw_cert | dog_handler_cert | training_cert
// Unlike DocUploadRow, these routes also support GET (view/download), so this
// row additionally offers a "View" link once uploaded and a "Replace" affordance
// (borrowed from TrainingCertRow) — certs expire and agencies need to refresh
// them without deleting/recreating the guard record.
export type AgencyDocType = "sia_cert" | "cscs_cert" | "rtw_cert" | "dog_handler_cert" | "training_cert"

interface DocumentUploadRowProps {
  label: string
  hint?: string
  agencyId: string
  staffId: string
  docType: AgencyDocType
  initialUploaded?: boolean
  initialDate?: string
  // Lets the parent form keep its own snapshot of the guard record in sync
  // (compliance_status is only recomputed on GET/POST/PATCH of the staff row
  // itself, not on a document upload) without forcing a full refetch here.
  onUploaded?: (date: string) => void
}

export function DocumentUploadRow({
  label, hint, agencyId, staffId, docType, initialUploaded, initialDate, onUploaded,
}: DocumentUploadRowProps) {
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(!!initialUploaded)
  const [date, setDate] = useState(initialDate)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const res = await api.post<{ ok: boolean; date: string }>(
        `/api/agencies/${agencyId}/staff/${staffId}/documents/${docType}`,
        file
      )
      setUploaded(true)
      setDate(res.date)
      onUploaded?.(res.date)
      toast.success(`${label} uploaded`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {uploaded ? `Uploaded${date ? ` · ${date.slice(0, 10)}` : ""}` : (hint ?? "Not yet uploaded")}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {uploaded && (
          <a
            href={`/api/agencies/${agencyId}/staff/${staffId}/documents/${docType}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Download className="h-3 w-3" /> View
          </a>
        )}
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted ${uploading ? "pointer-events-none opacity-50" : ""}`}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : uploaded ? <ShieldCheck className="h-3.5 w-3.5 text-success" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "Uploading…" : uploaded ? "Replace" : "Upload"}
          <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </label>
      </div>
    </div>
  )
}
