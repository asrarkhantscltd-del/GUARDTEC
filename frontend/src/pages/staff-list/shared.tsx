import { useEffect, useState } from "react"
import { daysUntil, fmtDate, initials } from "@/lib/utils"
import {
  Loader2, Pencil, Table2, StretchHorizontal, MapPin, BarChart3, FileWarning, Trash2,
} from "lucide-react"
import { makeStagger } from "@/lib/motion"

export const stagger = makeStagger(0.05, 0.35)

export interface Site {
  id: string
  name: string
  address?: string
}

export interface ExStaffMember {
  folderId: string
  name: string
  nationality?: string
  gender?: string
  overall: string
}

export type ViewMode = "details" | "tiles"
export type SortKey = "name" | "sia" | "cscs" | "rtw"

export interface SameNameConflict {
  error: string
  existing: { id: string; name: string; phone: string | null; email: string | null; nationality: string | null; jobRole: string | null } | null
}

export function normDeploy(raw?: string): "onsite" | "available" | "offduty" | "unknown" {
  const v = (raw ?? "").toLowerCase().replace(/[\s_-]/g, "")
  if (v.includes("onsite") || v.includes("site") || v.includes("deployed")) return "onsite"
  if (v.includes("available") || v.includes("standby")) return "available"
  if (v.includes("off") || v.includes("leave") || v.includes("rest") || v.includes("inactive")) return "offduty"
  return "unknown"
}

export function docStatus(iso?: string): "missing" | "expired" | "expiring" | "ok" {
  if (!iso) return "missing"
  const d = daysUntil(iso)
  if (d === null) return "missing"
  if (d < 0)  return "expired"
  if (d < 91) return "expiring"
  return "ok"
}

export function ExpiryCell({ date }: { date?: string }) {
  const days = daysUntil(date)
  if (!date) return <span className="text-muted-foreground text-sm">—</span>
  const colour =
    days === null ? "text-muted-foreground"
    : days < 0   ? "text-destructive font-medium"
    : days < 91  ? "text-warning font-medium"
    : "text-foreground"
  return <span className={`text-sm ${colour}`}>{fmtDate(date)}</span>
}

export function DocChip({ label, date }: { label: string; date?: string }) {
  const st = docStatus(date)
  const cfg = {
    missing:  "bg-muted text-muted-foreground",
    expired:  "bg-destructive/15 text-destructive border border-destructive/30",
    expiring: "bg-warning/15 text-warning border border-warning/30",
    ok:       "bg-success/15 text-success border border-success/30" } as const
  const suffix = st === "expired" ? " ✕" : st === "expiring" ? " !" : st === "ok" ? " ✓" : " —"
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cfg[st]}`}>{label}{suffix}</span>
}

export function InitialsAvatar({ name, status, size = "md" }: { name: string; status: string; size?: "sm" | "md" | "lg" }) {
  const avatarText = initials(name)
  const bg: Record<string, string> = {
    green:   "bg-success/20 text-success border border-success/30",
    amber:   "bg-warning/20 text-warning border border-warning/30",
    red:     "bg-destructive/20 text-destructive border border-destructive/30",
    unknown: "bg-muted text-muted-foreground border border-border" }
  const sz = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-11 w-11 text-sm"
  return (
    <div className={`rounded-full flex items-center justify-center font-semibold shrink-0 ${sz} ${bg[status] ?? bg.unknown}`}>
      {avatarText}
    </div>
  )
}

// Quick edit/delete actions for an Overview row — stopPropagation so they don't trigger the row's own onClick
export function RowActions({
  canEdit, canDelete, confirming, deleting, onEdit, onDeleteClick, onConfirmDelete, onCancelDelete }: {
  canEdit: boolean; canDelete: boolean; confirming: boolean; deleting: boolean
  onEdit: () => void; onDeleteClick: () => void; onConfirmDelete: () => void; onCancelDelete: () => void
}) {
  if (!canEdit && !canDelete) return null
  if (confirming) {
    return (
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button onClick={onConfirmDelete} disabled={deleting}
          className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50">
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
        </button>
        <button onClick={onCancelDelete}
          className="rounded-md border px-2 py-1 text-[10px] transition-colors hover:bg-muted">
          Cancel
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
      {canEdit && (
        <button onClick={onEdit} title="Quick edit"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {canDelete && (
        <button onClick={onDeleteClick} title="Move to Ex-Staff"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// Combined deployment status + site selector (editable inline, local state for instant feedback)
export function DeploySelect({
  staffId, deployStatus, currentSite, sites, onUpdate }: {
  staffId: string; deployStatus?: string; currentSite?: string; sites: Site[]
  onUpdate: (id: string, status: string, site?: string) => void
}) {
  const [localStatus, setLocalStatus] = useState(() => {
    const n = normDeploy(deployStatus); return n === "unknown" ? "" : n
  })
  useEffect(() => {
    const n = normDeploy(deployStatus); setLocalStatus(n === "unknown" ? "" : n)
  }, [deployStatus])

  const statusCls: Record<string, string> = {
    onsite:    "border-success/40 bg-success/5 text-success",
    available: "border-warning/40 bg-warning/5 text-warning",
    offduty:   "border-destructive/40 bg-destructive/5 text-destructive",
    "":        "border-border bg-background text-muted-foreground" }

  function handleStatusChange(val: string) {
    setLocalStatus(val)
    if (val !== "onsite") onUpdate(staffId, val || "unknown")
    // if onsite: wait for site selection before calling onUpdate
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <select
        value={localStatus}
        onChange={(e) => handleStatusChange(e.target.value)}
        className={`rounded border text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring ${statusCls[localStatus] ?? statusCls[""]}`}
      >
        <option value="">— Status —</option>
        <option value="onsite">Onsite</option>
        <option value="available">Available</option>
        <option value="offduty">Off Duty</option>
      </select>
      {localStatus === "onsite" && (
        <select
          value={currentSite ?? ""}
          onChange={(e) => onUpdate(staffId, "onsite", e.target.value)}
          className="rounded border border-success/30 bg-success/5 text-success text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring max-w-[150px]"
        >
          <option value="">— Location —</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}

export const viewButtons: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: "details", icon: <Table2 className="h-4 w-4" />,           label: "Table" },
  { mode: "tiles",   icon: <StretchHorizontal className="h-4 w-4" />, label: "Cards" },
]

export type SectionId = "compliance" | "deployment" | "documents"

export const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: "compliance", label: "Compliance Status", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "deployment", label: "Deployment",         icon: <MapPin className="h-3.5 w-3.5" /> },
  { id: "documents",  label: "Document Issues",    icon: <FileWarning className="h-3.5 w-3.5" /> },
]
