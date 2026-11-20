import { Trash2, X, Users, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OVERALL_DOT } from "./shared"
import type { useSiteStaff } from "./useSiteStaff"

export default function SiteStaffPanel({ siteStaff, canDelete }: {
  siteStaff: ReturnType<typeof useSiteStaff>
  canDelete: boolean
}) {
  const { staffSite, assignedStaff, staffLoading, staffSearch, setStaffSearch, deleteStaffId, setDeleteStaffId, closeStaffPanel, assignStaff, confirmRemoveStaff, unassigned } = siteStaff
  return (
    <>
    {/* ════════════════════════════════════════════════════════════════════════
        STAFF ON SITE PANEL
    ═════════════════════════════════════════════════════════════════════════ */}
    {staffSite && (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <div className="border-b px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Staff on site</h3>
              <p className="text-xs text-muted-foreground">{staffSite.name} · {assignedStaff.length} assigned</p>
            </div>
            <button onClick={closeStaffPanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {staffLoading ? (
              <p className="text-sm text-muted-foreground">Loading staff…</p>
            ) : (
              <>
                {/* Assigned staff list */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Assigned staff ({assignedStaff.length})
                  </p>
                  {assignedStaff.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-6 text-center">
                      <Users className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">No staff assigned yet.</p>
                      <p className="text-xs text-muted-foreground">Search below to assign staff to this site.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {assignedStaff.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${OVERALL_DOT[s.overall] ?? OVERALL_DOT.grey}`} />
                          <p className="flex-1 text-sm font-medium">{s.name}</p>
                          {canDelete && (
                            <button onClick={() => setDeleteStaffId(s.id)}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Search to add staff */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Add staff from roster
                  </p>
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)}
                      placeholder="Search by name…" className="pl-8" />
                  </div>
                  {unassigned.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-4">
                      {staffSearch ? "No matching staff found" : "All staff already assigned to this site"}
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {unassigned.slice(0, 30).map((s) => (
                        <div key={s.id}
                          className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 hover:bg-muted/40 transition-colors">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${OVERALL_DOT[s.overall] ?? OVERALL_DOT.grey}`} />
                          <p className="flex-1 text-sm">{s.name}</p>
                          <button onClick={() => assignStaff(s.id)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                            + Assign
                          </button>
                        </div>
                      ))}
                      {unassigned.length > 30 && (
                        <p className="text-center text-xs text-muted-foreground pt-1">
                          Showing 30 of {unassigned.length} — type to filter
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
        </div>
      </div>
    )}
    {/* ── Remove staff from site ── */}
    {deleteStaffId && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <Users className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-semibold">Remove from site?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {assignedStaff.find((s) => s.id === deleteStaffId)?.name ?? "This staff member"} will be removed from {staffSite?.name}.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteStaffId(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={confirmRemoveStaff}>Remove</Button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
