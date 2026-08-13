import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Downloads a file via fetch+blob rather than window.open — a top-level
// window.open navigation to /api/* gets intercepted by the PWA service
// worker's navigation handling and served the cached SPA shell instead of
// the real response. fetch() is not a "navigate" request, so it bypasses
// that and reliably saves the file to the browser's Downloads folder.
export async function downloadExport(url: string, fallbackFilename: string) {
  try {
    const res = await fetch(url, { credentials: "include" })
    if (!res.ok) throw new Error("Export failed")
    const blob = await res.blob()
    const cd = res.headers.get("Content-Disposition") || ""
    const match = cd.match(/filename="?([^"]+)"?/)
    const filename = match ? match[1] : fallbackFilename
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(blobUrl)
  } catch {
    throw new Error("Export failed")
  }
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parts = iso.slice(0, 10).split("-")
  if (parts.length !== 3) return "—"
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

export const discTypeLabels: Record<string, string> = {
  warning:       "Warning",
  final_warning: "Final Warning",
  suspension:    "Suspension",
  termination:   "Termination",
  fraud:         "Fraud / False Info",
  misconduct:    "Gross Misconduct",
  other:         "Other",
}

export const discTypeCls: Record<string, string> = {
  warning:       "bg-warning/15 text-warning border-warning/30",
  final_warning: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  suspension:    "bg-destructive/15 text-destructive border-destructive/30",
  termination:   "bg-destructive/20 text-destructive border-destructive/40",
  fraud:         "bg-destructive/20 text-destructive border-destructive/40",
  misconduct:    "bg-destructive/20 text-destructive border-destructive/40",
  other:         "bg-muted text-muted-foreground border-border",
}
