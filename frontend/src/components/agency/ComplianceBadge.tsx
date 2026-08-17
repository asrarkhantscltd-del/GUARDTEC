import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"

// Mirrors the shape of components/ui/status-badge.tsx (StatusBadge), but for
// agency_staff's role-conditional compliance_status — computed server-side by
// calculateComplianceStatus() (server.js) and returned UPPERCASE exactly as
// listed in server.js / GUARDTEC_IMPLEMENTATION_PLAN.md §1.5:
// 'COMPLIANT' | 'ACTION_NEEDED' | 'EXPIRED' | 'INCOMPLETE'.
export type ComplianceStatusValue = "COMPLIANT" | "ACTION_NEEDED" | "EXPIRED" | "INCOMPLETE"

const CONFIG: Record<ComplianceStatusValue, { label: string; icon: typeof CheckCircle2; classes: string }> = {
  COMPLIANT:     { label: "Compliant",     icon: CheckCircle2,  classes: "bg-success/15 text-success border-success/30" },
  ACTION_NEEDED: { label: "Action Needed", icon: AlertTriangle, classes: "bg-warning/15 text-warning border-warning/30" },
  EXPIRED:       { label: "Expired",       icon: XCircle,       classes: "bg-destructive/15 text-destructive border-destructive/30" },
  INCOMPLETE:    { label: "Incomplete",    icon: HelpCircle,    classes: "bg-muted text-muted-foreground border-border" },
}

// Accepts any casing / missing value defensively — falls back to Incomplete,
// same "unknown -> unknown bucket" convention as StatusBadge.
export function ComplianceBadge({ status }: { status?: string | null }) {
  const key = String(status || "INCOMPLETE").toUpperCase() as ComplianceStatusValue
  const cfg = CONFIG[key] ?? CONFIG.INCOMPLETE
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", cfg.classes)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}
