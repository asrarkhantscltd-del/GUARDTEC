import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { type SiteDoc, type DocViewMode, DOC_VIEW_OPTIONS, DOC_VIEW_KEY, type Site } from "./shared"

export function useSiteDocs() {
  // Documents panel
  const [docsSite, setDocsSite]             = useState<Site | null>(null)
  const [docs, setDocs]                     = useState<SiteDoc[]>([])
  const [docsLoading, setDocsLoading]       = useState(false)
  const [uploadDocFiles, setUploadDocFiles] = useState<File[]>([])
  const [docView, setDocView] = useState<DocViewMode>(() => {
    try {
      const v = localStorage.getItem(DOC_VIEW_KEY)
      return DOC_VIEW_OPTIONS.some(o => o.mode === v) ? (v as DocViewMode) : "content"
    } catch { return "content" }
  })
  function changeDocView(m: DocViewMode) {
    setDocView(m)
    try { localStorage.setItem(DOC_VIEW_KEY, m) } catch { /* private mode — fine, just not remembered */ }
  }
  // Multi-select for bulk delete (filenames of the ticked documents).
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  function toggleDoc(filename: string) {
    setSelectedDocs(prev => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename); else next.add(filename)
      return next
    })
    setBulkConfirm(false)
  }
  function clearDocSelection() { setSelectedDocs(new Set()); setBulkConfirm(false) }
  const [uploadDocCategory, setUploadDocCategory] = useState("documentation")
  const [uploadingDoc, setUploadingDoc]     = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  // Which site the running upload belongs to. Without this, opening a different
  // site's documents panel mid-upload showed the first site's "Uploading 3 of 9…",
  // and on completion appended its files to whichever site's list was on screen.
  const [uploadSite, setUploadSite] = useState<{ id: string; name: string } | null>(null)
  const docsSiteIdRef = useRef<string | null>(null)
  useEffect(() => { docsSiteIdRef.current = docsSite?.id ?? null }, [docsSite])
  const [docError, setDocError]             = useState("")

  // ── Documents CRUD ───────────────────────────────────────────────────────────

  async function openDocsPanel(site: Site) {
    setDocsSite(site); setDocsLoading(true); setDocError("")
    setDocs([]) // never show another site's files while this site's list is loading
    setUploadDocFiles([]); setUploadDocCategory("documentation")
    clearDocSelection()
    try {
      const d = await api.get<{ items: SiteDoc[] }>(`/api/sites/${site.id}/documents`)
      // A slow response for an earlier site must not overwrite the site now on screen.
      if (docsSiteIdRef.current === site.id) setDocs(d.items ?? [])
    } finally {
      if (docsSiteIdRef.current === site.id) setDocsLoading(false)
    }
  }
  function closeDocsPanel() { setDocsSite(null); setDocs([]); setUploadDocFiles([]); setDocError(""); clearDocSelection() }

  function toggleAllDocs() {
    setSelectedDocs(prev => prev.size === docs.length ? new Set() : new Set(docs.map(d => d.filename)))
    setBulkConfirm(false)
  }

  // Deletes the ticked files one by one through the existing per-file route
  // (same permission check as a single delete), then drops only the ones that
  // really went from the list so a partial failure stays visible and retryable.
  async function handleBulkDeleteDocs() {
    if (!docsSite || selectedDocs.size === 0) return
    setBulkDeleting(true)
    const removed: string[] = []
    let failed = 0
    for (const filename of Array.from(selectedDocs)) {
      try {
        await api.delete(`/api/sites/${docsSite.id}/documents/${filename}`)
        removed.push(filename)
      } catch {
        failed++
      }
    }
    setDocs(prev => prev.filter(d => !removed.includes(d.filename)))
    setSelectedDocs(new Set(Array.from(selectedDocs).filter(f => !removed.includes(f))))
    setBulkConfirm(false)
    setBulkDeleting(false)
    if (failed > 0) toast.error(`${removed.length} moved to the Recycle Bin, ${failed} could not be deleted`)
    else toast.success(`${removed.length} file${removed.length !== 1 ? "s" : ""} moved to the Recycle Bin`)
  }

  async function handleUploadDocs() {
    if (!uploadDocFiles.length || !docsSite) return
    // OS housekeeping files that come along with a folder pick — never real documents.
    const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|~\$.*)$/i
    const MAX_BYTES = 20 * 1024 * 1024 // matches nginx client_max_body_size (frontend/nginx.conf)
    const toSend = uploadDocFiles.filter(f => !JUNK.test(f.name))
    const site = docsSite // pin the target now — the panel may be switched to another site mid-upload
    setUploadingDoc(true); setDocError("")
    setUploadSite({ id: site.id, name: site.name })
    setUploadProgress({ done: 0, total: toSend.length })
    const uploaded: SiteDoc[] = []
    const failures: string[] = []
    try {
      for (let i = 0; i < toSend.length; i++) {
        const file = toSend[i]
        // For a picked folder this is "Folder/Sub/file.pdf", so nested files stay
        // distinguishable (two subfolders can both hold a "Plan.pdf").
        const shownName = file.webkitRelativePath || file.name
        if (file.size > MAX_BYTES) {
          failures.push(`${shownName} (over 20 MB)`)
        } else if (file.size === 0) {
          failures.push(`${shownName} (empty file)`)
        } else {
          try {
            const res = await fetch(`/api/sites/${site.id}/documents`, {
              method: "POST",
              credentials: "include",
              headers: {
                // Always octet-stream: the server reads the raw body itself, and a file whose own
                // type is application/json (e.g. a .json inside the folder) would otherwise be
                // swallowed by the server's JSON body parser and never reach the upload route.
                "Content-Type": "application/octet-stream",
                "X-Filename": encodeURIComponent(shownName),
                "X-Doc-Category": uploadDocCategory },
              body: file })
            const d = await res.json().catch(() => null)
            if (res.ok && d?.ok) uploaded.push(d.doc)
            else failures.push(`${shownName} (${res.status === 413 ? "too large for the server" : d?.error ?? `error ${res.status}`})`)
          } catch {
            failures.push(`${shownName} (network error)`)
          }
        }
        setUploadProgress({ done: i + 1, total: toSend.length })
      }
      // Is the panel still showing the site this upload was for? If the user moved to
      // another site meanwhile, don't touch that site's list, file picker or error line.
      const stillHere = docsSiteIdRef.current === site.id
      if (uploaded.length && stillHere) setDocs(prev => [...prev, ...uploaded])
      if (failures.length > 0) {
        const msg = `${uploaded.length} of ${toSend.length} file(s) uploaded — ${failures.length} failed: ` +
          failures.slice(0, 5).join(", ") + (failures.length > 5 ? `, +${failures.length - 5} more` : "")
        if (stillHere) setDocError(msg)
        else toast.error(`${site.name}: ${msg}`)
      } else {
        const n = uploaded.length
        toast.success(
          stillHere
            ? (n > 1 ? `${n} files uploaded` : "File uploaded")
            : `${n} file${n !== 1 ? "s" : ""} uploaded to ${site.name}`
        )
      }
      if (stillHere) setUploadDocFiles([])
    } finally {
      setUploadingDoc(false)
      setUploadProgress(null)
      setUploadSite(null)
    }
  }

  async function handleDeleteDoc(filename: string) {
    if (!docsSite) return
    try {
      await api.delete(`/api/sites/${docsSite.id}/documents/${filename}`)
      setDocs(prev => prev.filter(d => d.filename !== filename))
      setSelectedDocs(prev => { const next = new Set(prev); next.delete(filename); return next })
      toast.success("Moved to the Recycle Bin — a Director can restore it for 30 days")
    } catch {
      toast.error("Failed to delete document")
    }
  }

  return {
    docsSite,
    setDocsSite,
    docs,
    setDocs,
    docsLoading,
    setDocsLoading,
    uploadDocFiles,
    setUploadDocFiles,
    docView,
    setDocView,
    changeDocView,
    selectedDocs,
    setSelectedDocs,
    bulkConfirm,
    setBulkConfirm,
    bulkDeleting,
    setBulkDeleting,
    toggleDoc,
    clearDocSelection,
    uploadDocCategory,
    setUploadDocCategory,
    uploadingDoc,
    setUploadingDoc,
    uploadProgress,
    setUploadProgress,
    uploadSite,
    setUploadSite,
    docsSiteIdRef,
    docError,
    setDocError,
    openDocsPanel,
    closeDocsPanel,
    toggleAllDocs,
    handleBulkDeleteDocs,
    handleUploadDocs,
    handleDeleteDoc }
}
