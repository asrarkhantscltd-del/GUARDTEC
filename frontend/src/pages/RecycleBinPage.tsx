import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Trash2, RotateCcw, Eye, Loader2, FileText, Info } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"

// Director-only. Lists site documents that were deleted (they are moved here, not
// destroyed) and lets a Director preview, restore, or permanently delete them.
// The server removes anything older than `retentionDays` automatically.

interface BinItem {
  id: string
  kind: string
  site_id: string
  site_name: string | null
  site_exists: boolean
  original_name: string
  category: string | null
  size_bytes: number | null
  uploaded_at: string | null
  deleted_by: string | null
  deleted_at: string
  days_left: number
}

const CATEGORY_LABELS: Record<string, string> = {
  documentation: "Documentation",
  presentation: "Presentation",
  induction: "Induction Pack",
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—"
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

// A folder upload is stored as "Folder/Sub/file.pdf" — show the file name first.
function splitPath(name: string): { base: string; folder: string } {
  const parts = name.replace(/\\/g, "/").split("/")
  return { base: parts[parts.length - 1] || name, folder: parts.slice(0, -1).join("/") }
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function DaysLeft({ days }: { days: number }) {
  const tone = days <= 3 ? "bg-destructive/10 text-destructive" : days <= 7 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{days} day{days !== 1 ? "s" : ""} left</span>
}

export default function RecycleBinPage() {
  const [items, setItems] = useState<BinItem[]>([])
  const [retentionDays, setRetentionDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [emptying, setEmptying] = useState(false)

  async function load() {
    try {
      const d = await api.get<{ items: BinItem[]; retentionDays: number }>("/api/recycle-bin")
      setItems(d.items ?? [])
      setRetentionDays(d.retentionDays ?? 30)
      setError("")
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "Only a Director can open the Recycle Bin." : "Could not load the Recycle Bin.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function restore(item: BinItem) {
    setBusyId(item.id)
    try {
      const d = await api.post<{ siteName: string }>(`/api/recycle-bin/${item.id}/restore`)
      setItems(prev => prev.filter(i => i.id !== item.id))
      toast.success(`Restored to ${d?.siteName ?? "its site"}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not restore this file")
    } finally {
      setBusyId(null)
    }
  }

  async function deleteForever(item: BinItem) {
    setBusyId(item.id)
    try {
      await api.delete(`/api/recycle-bin/${item.id}`)
      setItems(prev => prev.filter(i => i.id !== item.id))
      setConfirmId(null)
      toast.success("Deleted permanently")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete this file")
    } finally {
      setBusyId(null)
    }
  }

  async function emptyBin() {
    setEmptying(true)
    try {
      const d = await api.post<{ deleted: number }>("/api/recycle-bin/empty")
      setItems([])
      setConfirmEmpty(false)
      toast.success(`${d?.deleted ?? 0} file${d?.deleted === 1 ? "" : "s"} deleted permanently`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not empty the Recycle Bin")
    } finally {
      setEmptying(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Recycle Bin</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${items.length} deleted file${items.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {items.length > 0 && !confirmEmpty && (
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => setConfirmEmpty(true)}>
            <Trash2 className="h-4 w-4" />Empty Recycle Bin
          </Button>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Deleted site documents are kept here for <strong>{retentionDays} days</strong>, then removed permanently.
          Only Directors can see this page. A file can only be restored while its site still exists.
        </span>
      </div>

      {confirmEmpty && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <span className="text-sm font-medium text-destructive">
            Permanently delete all {items.length} file{items.length !== 1 ? "s" : ""}? This cannot be undone.
          </span>
          <Button size="sm" variant="destructive" className="ml-auto gap-1.5" disabled={emptying} onClick={emptyBin}>
            {emptying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {emptying ? "Deleting…" : "Yes, empty it"}
          </Button>
          <Button size="sm" variant="outline" disabled={emptying} onClick={() => setConfirmEmpty(false)}>Cancel</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-destructive">{error}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Trash2 className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">The Recycle Bin is empty.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Site documents you delete will appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Site</th>
                <th className="hidden px-3 py-2 sm:table-cell">Size</th>
                <th className="hidden px-3 py-2 md:table-cell">Deleted</th>
                <th className="px-3 py-2">Time left</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map(item => {
                const { base, folder } = splitPath(item.original_name)
                const busy = busyId === item.id
                return (
                  <tr key={item.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{base}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {folder ? `${folder} · ` : ""}{item.category ? (CATEGORY_LABELS[item.category] ?? item.category) : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="truncate">{item.site_name ?? "Unknown site"}</div>
                      {!item.site_exists && <span className="text-[11px] font-medium text-destructive">site deleted</span>}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground sm:table-cell">{formatBytes(item.size_bytes)}</td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                      <div className="whitespace-nowrap">{fmtWhen(item.deleted_at)}</div>
                      {item.deleted_by && <div className="text-[11px]">by {item.deleted_by}</div>}
                    </td>
                    <td className="px-3 py-2"><DaysLeft days={item.days_left} /></td>
                    <td className="px-3 py-2">
                      {confirmId === item.id ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="whitespace-nowrap text-xs font-medium text-destructive">Delete forever?</span>
                          <Button size="sm" variant="destructive" disabled={busy} onClick={() => deleteForever(item)}>
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes"}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmId(null)}>No</Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-0.5">
                          <a href={`/api/recycle-bin/${item.id}/file`} target="_blank" rel="noopener noreferrer" title="Preview"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                            <Eye className="h-3.5 w-3.5" />
                          </a>
                          <button type="button" disabled={busy || !item.site_exists} onClick={() => restore(item)}
                            title={item.site_exists ? "Restore to its site" : "Its site was deleted, so it cannot be restored"}
                            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40">
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Restore
                          </button>
                          <button type="button" disabled={busy} onClick={() => setConfirmId(item.id)} title="Delete forever"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
