import { Trash2, X, FileText, Upload, Loader2, FolderUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DOC_CATEGORY_LABELS, DocViewMenu, DocItems } from "./shared"
import type { useSiteDocs } from "./useSiteDocs"

export default function SiteDocsPanel({ siteDocs, canDelete }: {
  siteDocs: ReturnType<typeof useSiteDocs>
  canDelete: boolean
}) {
  const { docsSite, docs, docsLoading, uploadDocFiles, setUploadDocFiles, docView, changeDocView, selectedDocs, bulkConfirm, setBulkConfirm, bulkDeleting, toggleDoc, clearDocSelection, uploadDocCategory, setUploadDocCategory, uploadingDoc, uploadProgress, uploadSite, docError, setDocError, closeDocsPanel, toggleAllDocs, handleBulkDeleteDocs, handleUploadDocs, handleDeleteDoc } = siteDocs
  return (
    <>
    {/* ════════════════════════════════════════════════════════════════════════
        SITE DOCUMENTATION PANEL
    ═════════════════════════════════════════════════════════════════════════ */}
    {docsSite && (
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <div className="border-b px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Site documentation</h3>
              <p className="text-xs text-muted-foreground">{docsSite.name}</p>
            </div>
            <button onClick={closeDocsPanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-5 py-5 space-y-6">

            {/* Upload section */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Upload</p>
              <div className="space-y-3">
                <div>
                  <Label className="mb-1 block text-xs font-medium text-muted-foreground">Category</Label>
                  <select value={uploadDocCategory} onChange={(e) => setUploadDocCategory(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    {Object.entries(DOC_CATEGORY_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs transition-colors hover:bg-muted/40">
                    <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Choose file(s)</span>
                    <input type="file" multiple className="hidden" accept=".pdf,.ppt,.pptx,.doc,.docx"
                      onChange={(e) => { setUploadDocFiles(Array.from(e.target.files ?? [])); setDocError("") }} />
                  </label>
                  <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs transition-colors hover:bg-muted/40">
                    <FolderUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">Choose folder</span>
                    <input type="file" multiple className="hidden"
                      {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
                      onChange={(e) => { setUploadDocFiles(Array.from(e.target.files ?? [])); setDocError("") }} />
                  </label>
                </div>

                {uploadDocFiles.length > 0 && (
                  <div className="rounded-md border bg-muted/20 px-3 py-2">
                    <p className="text-xs font-medium">
                      {uploadDocFiles.length} file{uploadDocFiles.length !== 1 ? "s" : ""} selected
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {uploadDocFiles.slice(0, 3).map(f => f.name).join(", ")}
                      {uploadDocFiles.length > 3 ? `, +${uploadDocFiles.length - 3} more` : ""}
                    </p>
                  </div>
                )}

                {docError && <p className="text-xs text-destructive">{docError}</p>}

                {/* An upload to a DIFFERENT site is still running: say so instead of
                    pretending it's this site's, and keep the button disabled until it ends. */}
                {uploadingDoc && uploadSite && uploadSite.id !== docsSite.id && (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    An upload to “{uploadSite.name}” is still running ({uploadProgress?.done ?? 0} of {uploadProgress?.total ?? 0}).
                    You can upload here once it finishes.
                  </p>
                )}

                <Button onClick={handleUploadDocs} disabled={!uploadDocFiles.length || uploadingDoc} className="w-full gap-2">
                  {uploadingDoc && uploadSite?.id === docsSite.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploadingDoc && uploadSite?.id === docsSite.id
                    ? `Uploading ${uploadProgress?.done ?? 0} of ${uploadProgress?.total ?? uploadDocFiles.length}…`
                    : uploadDocFiles.length > 1 ? `Upload ${uploadDocFiles.length} files` : "Upload file"}
                </Button>
              </div>
            </div>

            {/* Stored docs list */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Stored files {!docsLoading && `(${docs.length})`}
                </p>
                {docs.length > 0 && <DocViewMenu mode={docView} onChange={changeDocView} />}
              </div>
              {docsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : docs.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center">
                  <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">Site documentation, presentations, induction packs — upload above.</p>
                </div>
              ) : (
                <>
                  {/* Multi-select bar — Select all, then delete the ticked files in one go. */}
                  {canDelete && (
                    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                        <input type="checkbox"
                          ref={(el) => { if (el) el.indeterminate = selectedDocs.size > 0 && selectedDocs.size < docs.length }}
                          checked={docs.length > 0 && selectedDocs.size === docs.length}
                          onChange={toggleAllDocs}
                          className="h-4 w-4 cursor-pointer rounded border-border accent-primary" />
                        Select all
                      </label>
                      {selectedDocs.size > 0 && (
                        !bulkConfirm ? (
                          <>
                            <span className="text-xs text-muted-foreground">{selectedDocs.size} selected</span>
                            <button type="button" onClick={() => setBulkConfirm(true)}
                              className="ml-auto flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20">
                              <Trash2 className="h-3.5 w-3.5" />Delete selected
                            </button>
                            <button type="button" onClick={clearDocSelection}
                              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                              <X className="h-3.5 w-3.5" />Clear
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-medium text-destructive">
                              Move {selectedDocs.size} file{selectedDocs.size !== 1 ? "s" : ""} to the Recycle Bin? A Director can restore them for 30 days.
                            </span>
                            <button type="button" onClick={handleBulkDeleteDocs} disabled={bulkDeleting}
                              className="ml-auto flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-destructive/90 disabled:opacity-50">
                              {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              {bulkDeleting ? "Moving…" : "Yes, move"}
                            </button>
                            <button type="button" onClick={() => setBulkConfirm(false)} disabled={bulkDeleting}
                              className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-50">
                              Cancel
                            </button>
                          </>
                        )
                      )}
                    </div>
                  )}
                  <DocItems docs={docs} siteId={docsSite.id} mode={docView} canDelete={canDelete}
                    selected={selectedDocs} onToggle={toggleDoc} onDelete={handleDeleteDoc} />
                </>
              )}
            </div>
        </div>
      </div>
    )}
    </>
  )
}
