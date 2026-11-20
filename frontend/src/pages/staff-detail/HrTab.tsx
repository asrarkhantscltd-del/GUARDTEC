import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { toast } from "sonner"
import type { DiscRecord } from "@/types/staff"
import { fmtDate, discTypeLabels, discTypeCls } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  FileText, Loader2, Upload, Eye, CheckCircle2, BadgeAlert, Trash2, Plus,
} from "lucide-react"

export default function HrTab({ staffId, canEdit, canDelete, isDirector, contractExists, setContractExists }: {
  staffId: string; canEdit: boolean; canDelete: boolean; isDirector: boolean
  contractExists: boolean; setContractExists: (exists: boolean) => void
}) {
  const id = staffId
  // Disciplinary records
  const [discRecords, setDiscRecords]   = useState<DiscRecord[]>([])
  const [discLoading, setDiscLoading]   = useState(false)
  const [discForm, setDiscForm]         = useState(false)
  const [discDraft, setDiscDraft]       = useState({ incident_date: "", type: "warning", description: "", action_taken: "" })
  const [discSaving, setDiscSaving]     = useState(false)
  const [discError, setDiscError]       = useState("")
  const [contractUploading, setContractUploading] = useState(false)

  useEffect(() => { loadDiscRecords() }, [staffId])

  async function loadDiscRecords() {
    if (!id) return
    setDiscLoading(true)
    try {
      const d = await api.get<{ ok: boolean; records: DiscRecord[] }>(`/api/staff/${id}/disciplinary`)
      if (d.ok) setDiscRecords(d.records)
    } finally {
      setDiscLoading(false)
    }
  }

  async function addDiscRecord() {
    if (!discDraft.incident_date || !discDraft.description.trim()) {
      setDiscError("Date and description are required.")
      return
    }
    setDiscSaving(true); setDiscError("")
    try {
      await api.post(`/api/staff/${id}/disciplinary`, discDraft)
      setDiscForm(false)
      setDiscDraft({ incident_date: "", type: "warning", description: "", action_taken: "" })
      await loadDiscRecords()
    } catch (err) {
      setDiscError(err instanceof ApiError ? err.message : "Failed to save.")
    } finally {
      setDiscSaving(false)
    }
  }

  async function deleteDiscRecord(recordId: string) {
    await api.delete(`/api/disciplinary/${recordId}`)
    await loadDiscRecords()
  }

  async function uploadContract(file: File) {
    setContractUploading(true)
    try {
      const d = await api.post<{ ok: boolean; error?: string }>(`/api/staff/${id}/contract`, new Blob([await file.arrayBuffer()], { type: file.type || "application/pdf" }))
      if (!d.ok) { toast.error(d.error ?? "Upload failed."); return }
      toast.success("Contract uploaded.")
      setContractExists(true)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upload failed.")
    } finally {
      setContractUploading(false)
    }
  }

  async function deleteContract() {
    await api.delete(`/api/staff/${id}/contract`)
    setContractExists(false)
    toast.success("Contract removed.")
  }

  return (
    <motion.div key="hr" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>

      {/* ── Disciplinary Records ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <BadgeAlert className="h-4 w-4 text-destructive" />Disciplinary Records
            </CardTitle>
            {canEdit && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setDiscForm(true); setDiscError("") }}>
                <Plus className="h-3 w-3" />Add Record
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">

          {/* Add form */}
          {discForm && (
            <div className="rounded-lg border bg-destructive/5 border-destructive/20 p-4 space-y-3">
              <p className="text-xs font-semibold text-destructive uppercase tracking-wide">New Disciplinary Record</p>
              {discError && <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{discError}</p>}
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Incident date *</p>
                  <input type="date" value={discDraft.incident_date}
                    onChange={e => setDiscDraft(p => ({ ...p, incident_date: e.target.value }))}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Type *</p>
                  <select value={discDraft.type}
                    onChange={e => setDiscDraft(p => ({ ...p, type: e.target.value }))}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="warning">Verbal / Written Warning</option>
                    <option value="final_warning">Final Written Warning</option>
                    <option value="suspension">Suspension</option>
                    <option value="termination">Termination</option>
                    <option value="fraud">Fraud / False Information</option>
                    <option value="misconduct">Gross Misconduct</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Description of incident *</p>
                <textarea value={discDraft.description} rows={3}
                  onChange={e => setDiscDraft(p => ({ ...p, description: e.target.value }))}
                  placeholder="What happened?"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Action taken</p>
                <input type="text" value={discDraft.action_taken}
                  onChange={e => setDiscDraft(p => ({ ...p, action_taken: e.target.value }))}
                  placeholder="e.g. Formal warning issued, contract terminated"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={addDiscRecord} disabled={discSaving}>
                  {discSaving ? "Saving…" : "Save Record"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDiscForm(false); setDiscError("") }}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Records list */}
          {discLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />Loading records…
            </div>
          ) : discRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No disciplinary records on file.</p>
          ) : (
            <div className="space-y-3">
              {discRecords.map(rec => {
                return (
                  <div key={rec.id} className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${discTypeCls[rec.type] ?? discTypeCls.other}`}>
                          {discTypeLabels[rec.type] ?? rec.type}
                        </span>
                        <span className="text-xs text-muted-foreground">{fmtDate(rec.incident_date)}</span>
                      </div>
                      {isDirector && (
                        <button onClick={() => deleteDiscRecord(rec.id)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm">{rec.description}</p>
                    {rec.action_taken && (
                      <p className="text-xs text-muted-foreground">Action: {rec.action_taken}</p>
                    )}
                    {rec.issued_by_name && (
                      <p className="text-xs text-muted-foreground">Issued by: {rec.issued_by_name}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Contract Upload ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Contract / Assignment Instructions
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {contractExists ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border bg-success/5 border-success/20 px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                <span className="text-sm font-medium">Contract on file</span>
              </div>
              <div className="flex gap-2">
                <a href={`/api/staff/${id}/contract`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
                    <Eye className="h-3 w-3" /> View
                  </Button>
                </a>
                {canEdit && (
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted transition-colors h-7">
                    <Upload className="h-3 w-3" /> Replace
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadContract(f) }} />
                  </label>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={deleteContract}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/10 px-4 py-6 text-center space-y-2">
              <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">No contract on file for this staff member.</p>
              {canEdit && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                  {contractUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload Contract
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadContract(f) }} />
                </label>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Accepted: PDF, Word documents, or images.</p>
        </CardContent>
      </Card>

    </motion.div>
  )
}
