import { Input } from "@/components/ui/input"
import { Search, Loader2, X, UserX, RotateCcw, Archive, Trash2 } from "lucide-react"
import { InitialsAvatar } from "./shared"
import type { useExStaff } from "./useExStaff"

export default function ExStaffPanel({ exStaffPanel }: {
  exStaffPanel: ReturnType<typeof useExStaff>
}) {
  const { exPanel, setExPanel, exStaff, exLoading, restoringId, exError, setExError, confirmDeleteId, setConfirmDeleteId, confirmDeleteText, setConfirmDeleteText, permDeleting, exSearch, setExSearch, exSelectedIds, setExSelectedIds, exBulkConfirm, setExBulkConfirm, exBulkWorking, toggleExSelect, toggleExSelectAll, bulkRestoreEx, bulkDeleteEx, permanentDelete, restoreExStaff } = exStaffPanel
  return (
    <>
    {/* ── Ex-Staff panel ── */}
    {exPanel && (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="border-b px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Archive className="h-4 w-4 text-muted-foreground" />Ex-Staff
                {!exLoading && exStaff.length > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {exStaff.length}
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground">Restore a returning employee back to Active Staff</p>
            </div>
            <button onClick={() => setExPanel(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          {!exLoading && exStaff.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={exSearch}
                onChange={e => setExSearch(e.target.value)}
                placeholder="Search ex-staff by name…"
                className="h-9 pl-9 text-sm"
              />
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5">
            {exError && (
              <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{exError}</p>
            )}

            {exLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading ex-staff…</span>
              </div>
            ) : exStaff.length === 0 ? (
              /* empty state — no ex-staff at all */
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 text-center">
                <UserX className="mb-4 h-12 w-12 text-muted-foreground/25" />
                <h3 className="font-semibold text-muted-foreground">No ex-staff found</h3>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground/70">
                  Staff moved out of Active Staff will appear here — nothing is ever permanently deleted.
                </p>
              </div>
            ) : (
              <>
                {/* Select-all + bulk action bar */}
                <div className="mb-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={exStaff.length > 0 && exStaff.every(e => exSelectedIds.has(e.folderId))}
                    onChange={toggleExSelectAll}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className="text-xs text-muted-foreground">
                    {exSelectedIds.size > 0 ? `${exSelectedIds.size} selected` : "Select all"}
                  </span>
                </div>

                {/* Bulk action bar */}
                {exSelectedIds.size > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                    {exBulkConfirm === null ? (
                      <>
                        <span className="text-xs font-medium text-primary mr-1">{exSelectedIds.size} selected</span>
                        <button
                          onClick={() => setExBulkConfirm("restore")}
                          className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Restore Selected
                        </button>
                        <button
                          onClick={() => setExBulkConfirm("delete")}
                          className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete Selected
                        </button>
                        <button
                          onClick={() => setExSelectedIds(new Set())}
                          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="h-3.5 w-3.5" /> Clear
                        </button>
                      </>
                    ) : exBulkConfirm === "restore" ? (
                      <>
                        <span className="text-xs font-medium text-primary">
                          Restore {exSelectedIds.size} staff member{exSelectedIds.size > 1 ? "s" : ""} to Active?
                        </span>
                        <button
                          onClick={bulkRestoreEx}
                          disabled={exBulkWorking}
                          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          {exBulkWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          {exBulkWorking ? "Restoring…" : "Yes, restore all"}
                        </button>
                        <button onClick={() => setExBulkConfirm(null)} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs font-medium text-destructive">
                          Permanently delete {exSelectedIds.size} record{exSelectedIds.size > 1 ? "s" : ""}? Cannot be undone.
                        </span>
                        <button
                          onClick={bulkDeleteEx}
                          disabled={exBulkWorking}
                          className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                        >
                          {exBulkWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {exBulkWorking ? "Deleting…" : "Yes, delete all"}
                        </button>
                        <button onClick={() => setExBulkConfirm(null)} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">Cancel</button>
                      </>
                    )}
                  </div>
                )}

                {exSearch.trim() && exStaff.filter(e => e.name.toLowerCase().includes(exSearch.toLowerCase().trim())).length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No ex-staff matching "{exSearch.trim()}"
                  </p>
                ) : (
                <div className="space-y-2">
                  {(exSearch.trim() ? exStaff.filter(e => e.name.toLowerCase().includes(exSearch.toLowerCase().trim())) : exStaff).map((e) => (
                    <div key={e.folderId} className={`rounded-lg border bg-card px-4 py-3 space-y-2 transition-colors ${exSelectedIds.has(e.folderId) ? "border-primary/40 bg-primary/5" : ""}`}>
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={exSelectedIds.has(e.folderId)}
                          onChange={() => toggleExSelect(e.folderId)}
                          onClick={(ev) => ev.stopPropagation()}
                          className="h-4 w-4 rounded border-border shrink-0"
                        />
                        <InitialsAvatar name={e.name} status={e.overall} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{e.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[e.nationality, e.gender].filter(Boolean).join(" · ") || "No details on file"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => restoreExStaff(e.folderId)} disabled={restoringId === e.folderId}
                            className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50">
                            {restoringId === e.folderId
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <RotateCcw className="h-3.5 w-3.5" />}
                            Restore
                          </button>
                          <button onClick={() => { setConfirmDeleteId(e.folderId); setConfirmDeleteText(""); setExError("") }}
                            className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20">
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </div>

                      {confirmDeleteId === e.folderId && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 space-y-2">
                          <p className="text-xs text-destructive font-medium">
                            Permanently delete {e.name}'s record? This cannot be undone, and BS7858/GDPR retention
                            rules mean it will be blocked unless this record has been archived for 7+ years.
                          </p>
                          <p className="text-xs text-muted-foreground">Type <span className="font-semibold text-foreground">{e.name}</span> to confirm:</p>
                          <div className="flex items-center gap-2">
                            <Input value={confirmDeleteText} onChange={ev => setConfirmDeleteText(ev.target.value)}
                              placeholder={e.name} className="h-8 text-xs" autoFocus />
                            <button onClick={() => { setConfirmDeleteId(null); setConfirmDeleteText("") }}
                              className="rounded px-2.5 py-1.5 text-xs border hover:bg-muted transition-colors shrink-0">Cancel</button>
                            <button onClick={() => permanentDelete(e.folderId, confirmDeleteText)}
                              disabled={permDeleting || confirmDeleteText.trim() !== e.name.trim()}
                              className="rounded px-2.5 py-1.5 text-xs bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center gap-1 shrink-0">
                              {permDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                              Yes, Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </>
            )}
        </div>
      </div>
    )}
    </>
  )
}
