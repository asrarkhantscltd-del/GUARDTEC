import { useState } from "react"
import { canPreviewInBrowser } from "@/lib/docPreview"
import {
  Trash2, Building2, Car, Layers, Briefcase, Store, MoreHorizontal, Phone, Package, Monitor,
  Smartphone, Sofa, Utensils, FileText, Eye, Download, Presentation, FileImage, FileSpreadsheet,
  FileArchive, FileVideo, File as FileIcon, LayoutGrid, Check, ChevronDown,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WelfareItem {
  id: string
  name: string
  quantity: number
  condition: "good" | "fair" | "poor"
  serial_number: string
  notes: string
  image_ext?: string
}

export interface SiteDoc {
  filename: string
  originalName: string
  category: string
  size: number
  uploadedAt: string
}

export const DOC_CATEGORY_LABELS: Record<string, string> = {
  documentation: "Documentation",
  presentation:  "Presentation",
  induction:     "Induction Pack" }

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

// ── Site documents: Explorer-style view modes ─────────────────────────────────

export type DocViewMode = "xl" | "large" | "medium" | "small" | "list" | "details" | "tiles" | "content"

export const DOC_VIEW_OPTIONS: { mode: DocViewMode; label: string }[] = [
  { mode: "xl",      label: "Extra large icons" },
  { mode: "large",   label: "Large icons" },
  { mode: "medium",  label: "Medium icons" },
  { mode: "small",   label: "Small icons" },
  { mode: "list",    label: "List" },
  { mode: "details", label: "Details" },
  { mode: "tiles",   label: "Tiles" },
  { mode: "content", label: "Content" },
]
export const DOC_VIEW_KEY = "guardtec_site_docs_view"

export type DocKind = "pdf" | "image" | "sheet" | "slides" | "doc" | "video" | "archive" | "other"

export function docKind(name: string): DocKind {
  const ext = (name.split(".").pop() ?? "").toLowerCase()
  if (ext === "pdf") return "pdf"
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image"
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet"
  if (["ppt", "pptx"].includes(ext)) return "slides"
  if (["doc", "docx", "txt", "rtf"].includes(ext)) return "doc"
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video"
  if (["zip", "rar", "7z"].includes(ext)) return "archive"
  return "other"
}

export function DocTypeIcon({ name, className }: { name: string; className: string }) {
  switch (docKind(name)) {
    case "pdf":     return <FileText className={`${className} text-red-500`} />
    case "image":   return <FileImage className={`${className} text-emerald-500`} />
    case "sheet":   return <FileSpreadsheet className={`${className} text-green-600`} />
    case "slides":  return <Presentation className={`${className} text-orange-500`} />
    case "doc":     return <FileText className={`${className} text-blue-500`} />
    case "video":   return <FileVideo className={`${className} text-purple-500`} />
    case "archive": return <FileArchive className={`${className} text-yellow-600`} />
    default:        return <FileIcon className={`${className} text-muted-foreground`} />
  }
}

// Explorer-style thumbnail: the real picture for images, the embedded preview for
// Office files, page 1 for PDFs. Anything without one (or if loading fails) falls
// back to the file-type icon.
export function DocThumb({ siteId, doc, base, iconClass }: { siteId: string; doc: SiteDoc; base: string; iconClass: string }) {
  const [failed, setFailed] = useState(false)
  const kind = docKind(base)
  const hasThumb = kind === "image" || kind === "pdf" || kind === "slides" || kind === "doc" || kind === "sheet"
  if (!hasThumb || failed) return <DocTypeIcon name={base} className={iconClass} />
  const src = kind === "image"
    ? `/api/sites/${siteId}/documents/${doc.filename}?thumb=1`
    : `/api/sites/${siteId}/documents/${doc.filename}/thumbnail`
  return <img src={src} alt={base} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
}

// A picked folder stores "Folder/Sub/file.pdf" as the name — show the file name
// prominently and the folder path as secondary text.
export function splitDocPath(originalName: string): { base: string; folder: string } {
  const parts = originalName.replace(/\\/g, "/").split("/")
  return { base: parts[parts.length - 1] || originalName, folder: parts.slice(0, -1).join("/") }
}

export function DocViewMenu({ mode, onChange }: { mode: DocViewMode; onChange: (m: DocViewMode) => void }) {
  const [open, setOpen] = useState(false)
  const current = DOC_VIEW_OPTIONS.find(o => o.mode === mode)
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <LayoutGrid className="h-3.5 w-3.5" />{current?.label}<ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          {/* Transparent click-catcher: tapping anywhere else just closes the menu. */}
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-xl border bg-card py-1 shadow-xl">
            {DOC_VIEW_OPTIONS.map(o => (
              <button key={o.mode} type="button" onClick={() => { onChange(o.mode); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${o.mode === mode ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{o.mode === mode && <Check className="h-3.5 w-3.5" />}</span>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export const DOC_ICON_TILE = {
  xl:     { grid: "grid-cols-2 sm:grid-cols-3", box: "h-32", icon: "h-16 w-16" },
  large:  { grid: "grid-cols-3 sm:grid-cols-4", box: "h-24", icon: "h-12 w-12" },
  medium: { grid: "grid-cols-4 sm:grid-cols-5", box: "h-16", icon: "h-8 w-8" } } as const

export function DocCheck({ checked, onChange, className = "" }: { checked: boolean; onChange: () => void; className?: string }) {
  return (
    <input type="checkbox" checked={checked} onChange={onChange} aria-label="Select file"
      className={`h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary ${className}`} />
  )
}

export function DocItems({ docs, siteId, mode, canDelete, selected, onToggle, onDelete }: {
  docs: SiteDoc[]; siteId: string; mode: DocViewMode; canDelete: boolean
  selected: Set<string>; onToggle: (filename: string) => void; onDelete: (filename: string) => void
}) {
  const url = (d: SiteDoc) => `/api/sites/${siteId}/documents/${d.filename}`
  const sel = (d: SiteDoc) => selected.has(d.filename)
  // Checkboxes only exist for people who can delete (selecting is only useful for bulk delete).
  const check = (d: SiteDoc, extra = "") => canDelete && <DocCheck checked={sel(d)} onChange={() => onToggle(d.filename)} className={extra} />
  const catLabel = (d: SiteDoc) => DOC_CATEGORY_LABELS[d.category] ?? d.category
  const dateStr = (d: SiteDoc) => new Date(d.uploadedAt).toLocaleDateString("en-GB")

  const deleteBtn = (d: SiteDoc, extra = "") => canDelete && (
    <button type="button" onClick={() => onDelete(d.filename)} title="Delete"
      className={`rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${extra}`}>
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
  const viewLink = (d: SiteDoc) => {
    const preview = canPreviewInBrowser(d.originalName)
    return (
      <a href={url(d)} target="_blank" rel="noopener noreferrer" title={preview ? "View" : "Download (can't be previewed in the browser)"}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        {preview ? <Eye className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
      </a>
    )
  }

  // Extra large / Large / Medium icons — image files show a real thumbnail.
  if (mode === "xl" || mode === "large" || mode === "medium") {
    const cfg = DOC_ICON_TILE[mode]
    return (
      <div className={`grid gap-3 ${cfg.grid}`}>
        {docs.map(d => {
          const { base } = splitDocPath(d.originalName)
          return (
            <div key={d.filename} className={`group relative rounded-lg ${sel(d) ? "ring-2 ring-primary" : ""}`}>
              {check(d, `absolute left-2 top-2 z-10 ${sel(d) ? "" : "sm:opacity-0 sm:group-hover:opacity-100"}`)}
              <a href={url(d)} target="_blank" rel="noopener noreferrer" title={d.originalName}
                className="flex flex-col items-center gap-1.5 rounded-lg border bg-card p-2 text-center transition-colors hover:bg-muted/50">
                <div className={`flex w-full items-center justify-center overflow-hidden rounded-md bg-muted/40 ${cfg.box}`}>
                  <DocThumb siteId={siteId} doc={d} base={base} iconClass={cfg.icon} />
                </div>
                <span className="w-full truncate text-[11px] font-medium">{base}</span>
              </a>
              {canDelete && deleteBtn(d, "absolute right-1 top-1 bg-background/90 shadow-sm sm:opacity-0 sm:group-hover:opacity-100")}
            </div>
          )
        })}
      </div>
    )
  }

  // Small icons — compact, icon beside the name, laid out in a grid.
  if (mode === "small") {
    return (
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {docs.map(d => {
          const { base } = splitDocPath(d.originalName)
          return (
            <div key={d.filename} className={`flex items-center gap-1 rounded-md hover:bg-muted/50 ${sel(d) ? "bg-primary/10" : ""}`}>
              {check(d, "ml-2")}
              <a href={url(d)} target="_blank" rel="noopener noreferrer" title={d.originalName}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm">
                <DocTypeIcon name={base} className="h-5 w-5 shrink-0" />
                <span className="truncate">{base}</span>
              </a>
              {deleteBtn(d)}
            </div>
          )
        })}
      </div>
    )
  }

  // List — text-first, flows down each column before starting the next (like Explorer).
  if (mode === "list") {
    return (
      <div className="columns-1 gap-x-6 sm:columns-2">
        {docs.map(d => {
          const { base } = splitDocPath(d.originalName)
          return (
            <div key={d.filename}
              className={`flex break-inside-avoid items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50 ${sel(d) ? "bg-primary/10" : ""}`}>
              {check(d)}
              <a href={url(d)} target="_blank" rel="noopener noreferrer" title={d.originalName}
                className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <DocTypeIcon name={base} className="h-4 w-4 shrink-0" />
                <span className="truncate">{base}</span>
              </a>
            </div>
          )
        })}
      </div>
    )
  }

  // Details — a table with columns.
  if (mode === "details") {
    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              {canDelete && <th className="w-8 px-3 py-2"></th>}
              <th className="px-3 py-2">Name</th>
              <th className="hidden px-3 py-2 sm:table-cell">Category</th>
              <th className="px-3 py-2">Size</th>
              <th className="hidden px-3 py-2 sm:table-cell">Uploaded</th>
              <th className="w-20 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {docs.map(d => {
              const { base, folder } = splitDocPath(d.originalName)
              return (
                <tr key={d.filename} className={`hover:bg-muted/30 ${sel(d) ? "bg-primary/10" : ""}`}>
                  {canDelete && <td className="px-3 py-2">{check(d)}</td>}
                  <td className="px-3 py-2">
                    <a href={url(d)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                      <DocTypeIcon name={base} className="h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{base}</span>
                        {folder && <span className="block truncate text-[11px] text-muted-foreground">{folder}</span>}
                      </span>
                    </a>
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{catLabel(d)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatBytes(d.size)}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground sm:table-cell">{dateStr(d)}</td>
                  <td className="px-3 py-2"><div className="flex items-center justify-end gap-0.5">{viewLink(d)}{deleteBtn(d)}</div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Tiles — medium icon with name, type and size beside it.
  if (mode === "tiles") {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {docs.map(d => {
          const { base } = splitDocPath(d.originalName)
          return (
            <div key={d.filename} className={`flex items-center gap-1 rounded-lg border bg-card pr-1 hover:bg-muted/40 ${sel(d) ? "ring-2 ring-primary" : ""}`}>
              {check(d, "ml-2.5")}
              <a href={url(d)} target="_blank" rel="noopener noreferrer" title={d.originalName}
                className="flex min-w-0 flex-1 items-center gap-3 p-2.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted/40">
                  <DocTypeIcon name={base} className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{base}</div>
                  <div className="text-[11px] text-muted-foreground">{catLabel(d)}</div>
                  <div className="text-[11px] text-muted-foreground">{formatBytes(d.size)}</div>
                </div>
              </a>
              {deleteBtn(d)}
            </div>
          )
        })}
      </div>
    )
  }

  // Content — one row each with a larger preview and all the details underneath.
  return (
    <div className="space-y-2">
      {docs.map(d => {
        const { base, folder } = splitDocPath(d.originalName)
        return (
          <div key={d.filename} className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 ${sel(d) ? "ring-2 ring-primary" : ""}`}>
            {check(d)}
            <a href={url(d)} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
                <DocThumb siteId={siteId} doc={d} base={base} iconClass="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{base}</div>
                {folder && <div className="truncate text-[11px] text-muted-foreground">{folder}</div>}
                <div className="text-[11px] text-muted-foreground">{catLabel(d)} · {formatBytes(d.size)} · {dateStr(d)}</div>
              </div>
            </a>
            {viewLink(d)}
            {deleteBtn(d)}
          </div>
        )
      })}
    </div>
  )
}

export interface AssignedStaff {
  id: string
  name: string
  overall: string
}

export interface AllStaff {
  id: string
  name: string
  overall: string
}

export interface Site {
  id: string
  name: string
  type: string
  client_name: string
  client_phone: string
  client_email: string
  address: string
  supervisor_name: string
  supervisor_phone: string
  supervisor_email: string
  status: string
  notes: string
  welfare_items?: WelfareItem[]
  assigned_staff?: string[]
}

export const BLANK_SITE: Site = {
  id: "", name: "", type: "construction", client_name: "",
  client_phone: "", client_email: "",
  address: "", supervisor_name: "", supervisor_phone: "",
  supervisor_email: "", status: "active", notes: "" }

export const BLANK_ITEM: WelfareItem = {
  id: "", name: "", quantity: 1, condition: "good", serial_number: "", notes: "", image_ext: "" }

// ── Static data ───────────────────────────────────────────────────────────────

export const SITE_TYPES = [
  { value: "construction", label: "Construction", icon: Building2, color: "bg-amber-100 text-amber-800" },
  { value: "parking",      label: "Parking",      icon: Car,        color: "bg-blue-100 text-blue-800" },
  { value: "events",       label: "Events",       icon: Layers,     color: "bg-purple-100 text-purple-800" },
  { value: "retail",       label: "Retail",       icon: Store,      color: "bg-teal-100 text-teal-800" },
  { value: "corporate",    label: "Corporate",    icon: Briefcase,  color: "bg-gray-100 text-gray-700" },
  { value: "other",        label: "Other",        icon: MoreHorizontal, color: "bg-gray-100 text-gray-600" },
]

export const CONDITION_COLORS = {
  good: "bg-green-100 text-green-700",
  fair: "bg-amber-100 text-amber-700",
  poor: "bg-red-100 text-red-700" }

export const OVERALL_DOT: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red:   "bg-red-500",
  grey:  "bg-gray-400" }

export const QUICK_ITEMS = [
  { name: "Microwave",     icon: Utensils },
  { name: "Laptop",        icon: Monitor },
  { name: "Mobile phone",  icon: Smartphone },
  { name: "Desk phone",    icon: Phone },
  { name: "Chair",         icon: Sofa },
  { name: "Table / Desk",  icon: Sofa },
  { name: "First aid kit", icon: Package },
  { name: "CCTV monitor",  icon: Monitor },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function typeInfo(type: string) {
  return SITE_TYPES.find((t) => t.value === type) ?? SITE_TYPES[SITE_TYPES.length - 1]
}
