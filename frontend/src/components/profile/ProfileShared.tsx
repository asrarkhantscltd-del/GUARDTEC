import { useState, useRef } from "react"
import { toast } from "sonner"
import { Loader2, Upload, ShieldCheck, Download, FileText } from "lucide-react"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api"

// Documents your OFFICE/manager uploads for you — e.g. a signed contract or
// assignment instructions once you've returned a signed copy via Messages.
// Staff can view and download these but never upload, edit, or delete them —
// that stays under manager control (see StaffDetailPage's Documents tab).
export const MANAGER_UPLOADED_DOCS = [
  { key: "application",             label: "Application Form" },
  { key: "p45",                     label: "P45 / P60" },
  { key: "bankLetter",              label: "Bank Confirmation Letter" },
  { key: "assignmentInstructions",  label: "Assignment Instructions / Employment Contract" },
]

export function ManagerDocRow({ label, staffId, docKey, uploaded, date }: {
  label: string; staffId: string; docKey: string; uploaded?: boolean; date?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {uploaded ? `Provided by your office${date ? ` · ${date}` : ""}` : "Not yet provided by your office"}
        </div>
      </div>
      {uploaded && (
        <a href={`/api/staff/${staffId}/documents/${docKey}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
          <Download className="h-3.5 w-3.5" /> View / Download
        </a>
      )}
    </div>
  )
}

export const DOC_UPLOADS = [
  { key: "passport",          label: "Passport / Photo ID",   hint: "Photo page of your passport, driving licence, or national ID" },
  { key: "drivingLicenceDoc", label: "Driving Licence",       hint: "Front & back — if using this as your photo ID" },
  { key: "brpCard",           label: "BRP Card",              hint: "Biometric Residence Permit — if applicable" },
  { key: "proofOfAddress1",   label: "Proof of Address (1)",  hint: "Utility bill, bank statement, or council tax letter (within 3 months)" },
  { key: "proofOfAddress2",   label: "Proof of Address (2)",  hint: "A DIFFERENT document type from Proof of Address (1)" },
  { key: "siaPhysical",       label: "SIA Licence Copy",      hint: "Front of your SIA licence card — PDF, JPG or PNG" },
  { key: "cscsCard",          label: "CSCS Card",             hint: "Front of your CSCS card — PDF, JPG or PNG" },
]

export function DocUploadRow({ label, hint, staffId, docKey, initialUploaded }: {
  label: string; hint: string; staffId: string; docKey: string; initialUploaded?: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(!!initialUploaded)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      await api.post(`/api/staff/${staffId}/documents/${docKey}`, file)
      setUploaded(true)
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
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="shrink-0">
        {uploaded ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400">
            <ShieldCheck className="h-3 w-3" /> Uploaded
          </span>
        ) : (
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted ${uploading ? "pointer-events-none opacity-50" : ""}`}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Uploading…" : "Upload"}
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
        )}
      </div>
    </div>
  )
}

// ── Training certificate uploads ────────────────────────────────────────────

export type StandardTrainingKey = "siaCertificate" | "firstAid" | "manualHandling" | "fireAwareness" | "conflictManagement" | "bwcTraining" | "cscsTest"

export const TRAINING_CERT_UPLOADS: { key: StandardTrainingKey; label: string }[] = [
  { key: "siaCertificate",     label: "SIA Qualifying Certificate" },
  { key: "firstAid",           label: "First Aid (Emergency)" },
  { key: "manualHandling",     label: "Manual Handling" },
  { key: "fireAwareness",      label: "Fire Awareness" },
  { key: "conflictManagement", label: "Conflict Management" },
  { key: "bwcTraining",        label: "Body Worn Camera (BWC)" },
  { key: "cscsTest",           label: "CSCS Health & Safety Test" },
]

export function TrainingCertRow({ label, staffId, courseKey, item }: {
  label: string; staffId: string; courseKey: string
  item?: { completed?: boolean; expiry?: string; certUploaded?: boolean }
}) {
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(!!item?.certUploaded)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      await api.post(`/api/staff/${staffId}/training/${courseKey}/certificate`, file)
      setUploaded(true)
      toast.success(`${label} certificate uploaded`)
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
          {item?.completed ? "Marked complete by your office" : "Not yet marked complete"}
          {item?.expiry ? ` · Expires ${item.expiry}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {uploaded && (
          <a href={`/api/staff/${staffId}/training/${courseKey}/certificate`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary hover:underline">View</a>
        )}
        {uploaded ? (
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted ${uploading ? "pointer-events-none opacity-50" : ""}`}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-green-600" />}
            {uploading ? "Uploading…" : "Replace"}
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
        ) : (
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted ${uploading ? "pointer-events-none opacity-50" : ""}`}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Uploading…" : "Upload certificate"}
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
        )}
      </div>
    </div>
  )
}

export function Section({ title, icon, badge, children }: { title: string; icon?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="surface p-5">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}{title}{badge}
      </h3>
      {children}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
