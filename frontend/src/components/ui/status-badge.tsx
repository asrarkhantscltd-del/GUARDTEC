import { cn } from "@/lib/utils"

type Status = "green" | "amber" | "red" | "unknown"

const config: Record<Status, { label: string; classes: string }> = {
  green:   { label: "Compliant",   classes: "bg-success/15 text-success border-success/30" },
  amber:   { label: "Action Needed", classes: "bg-warning/15 text-warning border-warning/30" },
  red:     { label: "Expired",     classes: "bg-destructive/15 text-destructive border-destructive/30" },
  unknown: { label: "Incomplete",  classes: "bg-muted text-muted-foreground border-border" },
}

export function StatusBadge({ status }: { status: string }) {
  const s = (status || "unknown") as Status
  const { label, classes } = config[s] ?? config.unknown
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", classes)}>
      {label}
    </span>
  )
}

export function StatusDot({ status }: { status: string }) {
  const colours: Record<string, string> = {
    green:   "bg-success",
    amber:   "bg-warning",
    red:     "bg-destructive",
    unknown: "bg-muted-foreground",
  }
  return (
    <span className={cn("inline-block h-2 w-2 rounded-full", colours[status] ?? colours.unknown)} />
  )
}
