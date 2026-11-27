import type { Dispatch, ReactNode, SetStateAction } from "react"
import { daysUntil, fmtDate } from "@/lib/utils"
import {
  Eye, EyeOff, ShieldOff, CheckCircle2, AlertCircle, Clock, FileQuestion, Pencil, Trash2,
  Download,
} from "lucide-react"

export type DocStatus = "uploaded" | "missing" | "expired" | "expiring"

export function docStatusOf(uploaded?: boolean, expiry?: string): DocStatus {
  if (!uploaded) return "missing"
  const d = daysUntil(expiry)
  if (d !== null && d < 0)  return "expired"
  if (d !== null && d < 91) return "expiring"
  return "uploaded"
}

export function DocStatusChip({ status }: { status: DocStatus }) {
  const cfg = {
    uploaded: { label: "On file",       cls: "bg-success/15 text-success border-success/30",           Icon: CheckCircle2 },
    expiring: { label: "Expiring soon", cls: "bg-warning/15 text-warning border-warning/30",           Icon: Clock },
    expired:  { label: "Expired",       cls: "bg-destructive/15 text-destructive border-destructive/30", Icon: AlertCircle },
    missing:  { label: "Not uploaded",  cls: "bg-muted text-muted-foreground border-border",            Icon: FileQuestion } } as const
  const { label, cls, Icon } = cfg[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  )
}

export function DocRow({
  icon, label, status, uploadedDate, expiry, note, onEdit, viewUrl,
  onDelete, confirmingDelete, onConfirmDelete, onCancelDelete, deleting }: {
  icon: React.ReactNode; label: string; status: DocStatus
  uploadedDate?: string; expiry?: string; note?: string
  onEdit?: () => void
  viewUrl?: string
  onDelete?: () => void
  confirmingDelete?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
  deleting?: boolean
}) {
  return (
    <div className="border-b last:border-0">
      <div className="flex items-center gap-3 py-2.5">
        <div className="text-muted-foreground w-5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {uploadedDate && <p className="text-xs text-muted-foreground">Uploaded {fmtDate(uploadedDate)}</p>}
          {expiry && <p className="text-xs text-muted-foreground">Expires {fmtDate(expiry)}</p>}
          {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DocStatusChip status={status} />
          {viewUrl && (
            <a href={viewUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="View document">
              <Eye className="h-3.5 w-3.5" />
            </a>
          )}
          {viewUrl && (
            <a href={viewUrl} download
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Download document">
              <Download className="h-3.5 w-3.5" />
            </a>
          )}
          {onEdit && (
            <button onClick={onEdit}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit / Upload">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {viewUrl && onDelete && (
            <button onClick={onDelete}
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete document">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {confirmingDelete && (
        <div className="mb-2.5 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">Remove this document? The staff member will need to re-upload it.</p>
          <div className="flex shrink-0 gap-2">
            <button onClick={onCancelDelete} className="rounded px-2.5 py-1 text-xs border hover:bg-muted transition-colors">Cancel</button>
            <button onClick={onConfirmDelete} disabled={deleting}
              className="rounded bg-destructive px-2.5 py-1 text-xs text-white hover:bg-destructive/90 transition-colors disabled:opacity-50">
              {deleting ? "Removing…" : "Yes, remove"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// Every ACS row carries an eye: uploaded files open in a new tab (one eye per
// file, labelled when there are several); data-only checks jump to the tab
// where that data lives; nothing on file shows a disabled eye.
export function AcsCheckRow({ label, done, note, viewUrl, views, onGo, exempt }: {
  label: string; done?: boolean; note?: string; viewUrl?: string
  views?: { label: string; url?: string }[]; onGo?: () => void
  // Office login roles skip guard checks — shown as a neutral "Exempt" row,
  // never a green pass, so it can't be mistaken for evidence being on file.
  exempt?: boolean
}) {
  const files = (views ?? (viewUrl ? [{ label: "", url: viewUrl }] : [])).filter(v => v.url)
  const eyeCls = "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
  const rowCls = exempt ? "bg-muted/40" : done ? "bg-success/5" : "bg-destructive/5"
  return (
    <div className={`flex items-start gap-3 rounded-md px-3 py-2.5 ${rowCls}`}>
      {exempt
        ? <ShieldOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        : done
        ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
        : <AlertCircle  className="h-4 w-4 text-destructive mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {label}
          {exempt && <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exempt — office role</span>}
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
        {files.length > 0 ? files.map(f => (
          <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className={eyeCls}
            title={f.label ? `View ${f.label}` : "View uploaded document"}>
            <Eye className="h-3.5 w-3.5" />{f.label && <span>{f.label}</span>}
          </a>
        )) : onGo ? (
          <button onClick={onGo} className={eyeCls} title="View the recorded details">
            <Eye className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-1 text-xs text-muted-foreground/50" title="Nothing uploaded">
            <EyeOff className="h-3.5 w-3.5" /><span className="hidden sm:inline">Nothing uploaded</span>
          </span>
        )}
      </div>
    </div>
  )
}

export function ComplianceRow({ icon, label, number, expiry }: {
  icon: React.ReactNode; label: string; number?: string; expiry?: string
}) {
  const days = daysUntil(expiry)
  const colour =
    !expiry         ? "text-muted-foreground"
    : days !== null && days < 0   ? "text-destructive"
    : days !== null && days < 91  ? "text-warning"
    : "text-success"
  const expiryLabel =
    !expiry   ? "Not on file"
    : days === null ? fmtDate(expiry)
    : days < 0  ? `Expired ${Math.abs(days)} days ago`
    : days === 0 ? "Expires today"
    : days < 91 ? `${fmtDate(expiry)} — ${days} days left`
    : fmtDate(expiry)

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium mt-0.5">{number || "Not on file"}</p>
        <p className={`text-xs mt-0.5 ${colour}`}>{expiryLabel}</p>
      </div>
    </div>
  )
}

export type AcsCheckKey =
  | "siaValid" | "siaType" | "rtwVerified" | "dbsChecked" | "bs7858" | "twoRefs" | "contractSigned"
  | "firstAid" | "conflictMgmt" | "siaPhysicalCopy" | "passportOnFile" | "addressProof"
  | "assignmentInstr" | "emergencyContact"
export type AcsChecks = Record<AcsCheckKey, boolean>

export type VettingSection = "dbs" | "bs7858" | "ref1" | "ref2" | "driver"

export interface DocDeleteProps {
  onDelete?: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
  deleting: boolean
}

// Document upload/edit machinery owned by StaffDetailPage and shared by the
// Documents and Vetting tabs (the DBS certificate scan lives in Vetting).
export interface DocTools {
  canEdit: boolean
  editingDocKey: string | null
  openDocEdit: (docKey: string) => void
  docDeleteProps: (docKey: string) => DocDeleteProps
  docEditPanel: ReactNode
}

// Vetting-section editing, shared by the Vetting tab and the Documents tab's driver block.
export interface VettingTools {
  editingVetting: VettingSection | null
  setEditingVetting: (section: VettingSection | null) => void
  vettingDraft: Record<string, string | boolean>
  setVettingDraft: Dispatch<SetStateAction<Record<string, string | boolean>>>
  vettingSaving: boolean
  openVettingEdit: (section: VettingSection) => void
  saveVetting: () => Promise<void>
}
