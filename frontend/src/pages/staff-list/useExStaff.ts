import { useState } from "react"
import { api, ApiError } from "@/lib/api"
import { runBulk, reportBulk } from "@/lib/bulk"
import { type ExStaffMember } from "./shared"

export function useExStaff({ reloadStaff }: { reloadStaff: () => Promise<void> }) {
  // Ex-Staff panel
  const [exPanel, setExPanel]         = useState(false)
  const [exStaff, setExStaff]         = useState<ExStaffMember[]>([])
  const [exLoading, setExLoading]     = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [exError, setExError]         = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteText, setConfirmDeleteText] = useState("")
  const [permDeleting, setPermDeleting]       = useState(false)

  // Ex-Staff search
  const [exSearch, setExSearch] = useState("")

  // Ex-Staff multi-select
  const [exSelectedIds, setExSelectedIds]   = useState<Set<string>>(new Set())
  const [exBulkConfirm, setExBulkConfirm]   = useState<"restore" | "delete" | null>(null)
  const [exBulkWorking, setExBulkWorking]   = useState(false)

  function toggleExSelect(id: string) {
    setExSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleExSelectAll() {
    const allSelected = exStaff.length > 0 && exStaff.every(e => exSelectedIds.has(e.folderId))
    setExSelectedIds(allSelected ? new Set() : new Set(exStaff.map(e => e.folderId)))
  }

  async function bulkRestoreEx() {
    setExBulkWorking(true)
    const result = await runBulk([...exSelectedIds], (folderId) =>
      api.post("/api/exstaff/restore", { folderId }).then(() => undefined)
    )
    const done = new Set(result.succeeded)
    setExStaff(prev => prev.filter(e => !done.has(e.folderId)))
    if (result.succeeded.length > 0) await reloadStaff()
    setExBulkWorking(false); setExBulkConfirm(null); setExSelectedIds(new Set())
    reportBulk(result, "restored")
  }

  async function bulkDeleteEx() {
    setExBulkWorking(true)
    const result = await runBulk([...exSelectedIds], (folderId) =>
      api.delete("/api/exstaff/permanent", { folderId }).then(() => undefined)
    )
    const done = new Set(result.succeeded)
    setExStaff(prev => prev.filter(e => !done.has(e.folderId)))
    setExBulkWorking(false); setExBulkConfirm(null); setExSelectedIds(new Set())
    reportBulk(result, "permanently deleted", "record")
  }

  async function openExStaff() {
    setExPanel(true); setExLoading(true); setExError(""); setExSearch("")
    try {
      const d = await api.get<ExStaffMember[]>("/api/exstaff")
      setExStaff(Array.isArray(d) ? d : [])
    } catch {
      setExError("Failed to load ex-staff.")
    } finally {
      setExLoading(false)
    }
  }

  async function permanentDelete(folderId: string, confirmPhrase: string) {
    setPermDeleting(true); setExError("")
    try {
      await api.delete("/api/exstaff/permanent", { folderId, confirmPhrase })
      setExStaff(prev => prev.filter(e => e.folderId !== folderId))
      setConfirmDeleteId(null); setConfirmDeleteText("")
    } catch (err) {
      // Surfaces the server's actual reason — e.g. the 7-year retention
      // block, or "type the name exactly" — instead of a generic message.
      setExError(err instanceof ApiError ? err.message : "Network error.")
    } finally {
      setPermDeleting(false)
    }
  }

  async function restoreExStaff(folderId: string) {
    setRestoringId(folderId); setExError("")
    try {
      await api.post("/api/exstaff/restore", { folderId })
      setExStaff((prev) => prev.filter((e) => e.folderId !== folderId))
      await reloadStaff()
    } catch {
      setExError("Network error.")
    } finally {
      setRestoringId(null)
    }
  }

  return {
    exPanel,
    setExPanel,
    exStaff,
    setExStaff,
    exLoading,
    setExLoading,
    restoringId,
    setRestoringId,
    exError,
    setExError,
    confirmDeleteId,
    setConfirmDeleteId,
    confirmDeleteText,
    setConfirmDeleteText,
    permDeleting,
    setPermDeleting,
    exSearch,
    setExSearch,
    exSelectedIds,
    setExSelectedIds,
    exBulkConfirm,
    setExBulkConfirm,
    exBulkWorking,
    setExBulkWorking,
    toggleExSelect,
    toggleExSelectAll,
    bulkRestoreEx,
    bulkDeleteEx,
    openExStaff,
    permanentDelete,
    restoreExStaff }
}
