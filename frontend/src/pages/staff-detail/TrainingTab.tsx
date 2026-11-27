import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { toast } from "sonner"
import type { TrainingItem, ExtraTrainingItem, TrainingRecord } from "@/types/staff"
import { fmtDate } from "@/lib/utils"
import { api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ShieldCheck, CreditCard, Loader2, Upload, Eye, GraduationCap, HeartPulse, Flame, Swords,
  HardHat, Camera, Pencil, Trash2, Plus, X as XIcon,
} from "lucide-react"
import { docStatusOf, DocStatusChip } from "./shared"

export default function TrainingTab({ staffId, training: trainingData, setTraining: setTrainingData, onChanged: refreshStaffRecord }: {
  staffId: string
  training: TrainingRecord
  setTraining: (training: TrainingRecord) => void
  onChanged: () => Promise<void>
}) {
  const id = staffId
  const training = trainingData
  const [trainingSaving, setTrainingSaving] = useState(false)
  const [editingKey, setEditingKey]       = useState<string | null>(null)
  const [editDraft, setEditDraft]         = useState<Record<string, string | boolean>>({})
  const [showAddForm, setShowAddForm]     = useState(false)
  const [addDraft, setAddDraft]           = useState({ label: "", completed: false, date: "", expiry: "", number: "", provider: "" })
  const [confirmDeleteCertKey, setConfirmDeleteCertKey] = useState<string | null>(null)
  const [deletingCert, setDeletingCert]   = useState(false)
  const certFileInputRef                  = useRef<HTMLInputElement>(null)
  const [uploadingCertKey, setUploadingCertKey] = useState<string | null>(null)

  useEffect(() => {
    if (editingKey) {
      requestAnimationFrame(() =>
        document.querySelector(`[data-training-edit="${editingKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
    }
  }, [editingKey])

  async function uploadCertFile(courseKey: string, file: File) {
    if (!id) return
    setUploadingCertKey(courseKey)
    try {
      const d = await api.post<{ ok: boolean; date: string }>(`/api/staff/${id}/training/${courseKey}/certificate`, file)
      if (d.ok) {
        await refreshStaffRecord()
        toast.success("Certificate uploaded")
      } else toast.error("Upload failed")
    } catch {
      toast.error("Upload failed — please try again")
    } finally {
      setUploadingCertKey(null)
    }
  }

  // ── Training helpers ──
  async function patchTraining(updated: TrainingRecord) {
    setTrainingSaving(true)
    try {
      await api.patch(`/api/staff/${id}/training`, { training: updated })
    } finally { setTrainingSaving(false) }
  }

  function startEdit(key: string, existing?: TrainingItem | ExtraTrainingItem) {
    setEditingKey(key)
    setEditDraft({
      label:     (existing as ExtraTrainingItem)?.label ?? "",
      completed: existing?.completed ?? false,
      date:      existing?.date ?? "",
      expiry:    existing?.expiry ?? "",
      number:    existing?.number ?? "",
      provider:  existing?.provider ?? "" })
  }

  function saveStdEdit(key: keyof Omit<TrainingRecord, "extra">) {
    const item: TrainingItem = {
      completed: editDraft.completed as boolean,
      date:      (editDraft.date as string) || undefined,
      expiry:    (editDraft.expiry as string) || undefined,
      number:    (editDraft.number as string) || undefined,
      provider:  (editDraft.provider as string) || undefined }
    const updated = { ...trainingData, [key]: item }
    setTrainingData(updated); patchTraining(updated); setEditingKey(null)
  }

  function clearStdCourse(key: keyof Omit<TrainingRecord, "extra">) {
    const updated = { ...trainingData, [key]: {} }
    setTrainingData(updated); patchTraining(updated)
  }

  function saveExtraEdit(itemId: string) {
    const updated = {
      ...trainingData,
      extra: (trainingData.extra ?? []).map(e =>
        e.id === itemId
          ? { ...e, label: editDraft.label as string, completed: editDraft.completed as boolean,
              date: (editDraft.date as string) || undefined, expiry: (editDraft.expiry as string) || undefined,
              number: (editDraft.number as string) || undefined, provider: (editDraft.provider as string) || undefined }
          : e
      ) }
    setTrainingData(updated); patchTraining(updated); setEditingKey(null)
  }

  function deleteExtra(itemId: string) {
    const updated = { ...trainingData, extra: (trainingData.extra ?? []).filter(e => e.id !== itemId) }
    setTrainingData(updated); patchTraining(updated)
  }

  function addCustomTraining() {
    if (!addDraft.label.trim()) return
    const newItem: ExtraTrainingItem = {
      id:        `${Date.now()}`,
      label:     addDraft.label.trim(),
      completed: addDraft.completed,
      date:      addDraft.date || undefined,
      expiry:    addDraft.expiry || undefined,
      number:    addDraft.number || undefined,
      provider:  addDraft.provider || undefined }
    const updated = { ...trainingData, extra: [...(trainingData.extra ?? []), newItem] }
    setTrainingData(updated); patchTraining(updated)
    setAddDraft({ label: "", completed: false, date: "", expiry: "", number: "", provider: "" })
    setShowAddForm(false)
  }

  async function deleteCertFile(courseKey: string) {
    if (!id) return
    setDeletingCert(true)
    try {
      await api.delete(`/api/staff/${id}/training/${courseKey}/certificate`)
      await refreshStaffRecord()
      toast.success("Certificate removed")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setDeletingCert(false)
      setConfirmDeleteCertKey(null)
    }
  }

  return (
    <motion.div key="training" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <input ref={certFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]; const k = e.currentTarget.dataset.key
          if (f && k) uploadCertFile(k, f)
          e.currentTarget.value = ""
        }} />
      {/* ── Standard courses ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />Standard Courses
            </CardTitle>
            {trainingSaving && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Saving…</span>}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-1">
          {(
            [
              { key: "siaCertificate",    label: "SIA Qualifying Certificate",    icon: <ShieldCheck className="h-4 w-4" /> },
              { key: "firstAid",          label: "First Aid (Emergency)",         icon: <HeartPulse className="h-4 w-4" /> },
              { key: "conflictManagement",label: "Conflict Management (ACT)",       icon: <Swords className="h-4 w-4" /> },
              { key: "manualHandling",    label: "Manual Handling",               icon: <HardHat className="h-4 w-4" /> },
              { key: "fireAwareness",     label: "Fire Awareness",                icon: <Flame className="h-4 w-4" /> },
              { key: "bwcTraining",       label: "Body Worn Camera (BWC)",        icon: <Camera className="h-4 w-4" /> },
              { key: "cscsTest",          label: "CSCS Health & Safety Test",     icon: <CreditCard className="h-4 w-4" /> },
            ] as const
          ).map(({ key, label, icon }) => {
            const item = training[key]
            const isEditing = editingKey === key
            return (
              <div key={key} className="border-b last:border-0 pb-2 last:pb-0">
                {/* Row */}
                <div className="flex items-center gap-3 py-1.5">
                  <div className="text-muted-foreground w-5 shrink-0">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    {item?.date   && <p className="text-xs text-muted-foreground">Completed {fmtDate(item.date)}</p>}
                    {item?.expiry && <p className="text-xs text-muted-foreground">Expires {fmtDate(item.expiry)}</p>}
                    {item?.number && <p className="text-xs text-muted-foreground">Cert # {item.number}</p>}
                    {item?.certUploaded ? (
                      <span className="mt-0.5 flex items-center gap-2">
                        <a href={`/api/staff/${id}/training/${key}/certificate`} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <Eye className="h-3 w-3" />Certificate on file
                        </a>
                        <button onClick={() => setConfirmDeleteCertKey(key)}
                          className="text-xs text-muted-foreground hover:text-destructive transition-colors">Remove</button>
                      </span>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground/60">No certificate uploaded yet</p>
                    )}
                    <button
                      onClick={() => { if (certFileInputRef.current) { certFileInputRef.current.dataset.key = key; certFileInputRef.current.click() } }}
                      disabled={uploadingCertKey === key}
                      className="mt-1 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
                      {uploadingCertKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                      {uploadingCertKey === key ? "Uploading…" : item?.certUploaded ? "Replace certificate" : "Upload certificate"}
                    </button>
                    {confirmDeleteCertKey === key && (
                      <div className="mt-1.5 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                        <p className="text-xs font-medium text-destructive">Remove this certificate? Staff will need to re-upload it.</p>
                        <div className="flex shrink-0 gap-2">
                          <button onClick={() => setConfirmDeleteCertKey(null)} className="rounded px-2.5 py-1 text-xs border hover:bg-muted transition-colors">Cancel</button>
                          <button onClick={() => deleteCertFile(key)} disabled={deletingCert}
                            className="rounded bg-destructive px-2.5 py-1 text-xs text-white hover:bg-destructive/90 transition-colors disabled:opacity-50">
                            {deletingCert ? "Removing…" : "Yes, remove"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <DocStatusChip status={item?.completed ? docStatusOf(true, item.expiry) : "missing"} />
                  <button onClick={() => isEditing ? setEditingKey(null) : startEdit(key, item)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                    {isEditing ? <XIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => clearStdCourse(key)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Clear entire record">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* Inline edit form */}
                {isEditing && (
                  <div data-training-edit={key}
                    className="ml-8 mb-2 rounded-lg border bg-muted/20 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { field: "date",     label: "Completed date", type: "date" },
                        { field: "expiry",   label: "Expiry date",    type: "date" },
                        { field: "number",   label: "Cert number",    type: "text" },
                        { field: "provider", label: "Provider",       type: "text" },
                      ].map(({ field, label: fl, type }) => (
                        <div key={field}>
                          <p className="text-xs text-muted-foreground mb-0.5">{fl}</p>
                          <input type={type} value={editDraft[field] as string}
                            onChange={e => setEditDraft(p => ({ ...p, [field]: e.target.value }))}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={editDraft.completed as boolean}
                        onChange={e => setEditDraft(p => ({ ...p, completed: e.target.checked }))}
                        className="rounded" />
                      Mark as completed
                    </label>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="h-7 text-xs" onClick={() => saveStdEdit(key)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingKey(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* ── Custom / extra training ── */}
      {(training.extra ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />Additional Training
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-1">
            {(training.extra ?? []).map((item) => {
              const isEditing = editingKey === item.id
              return (
                <div key={item.id} className="border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-3 py-1.5">
                    <div className="text-muted-foreground w-5 shrink-0"><GraduationCap className="h-4 w-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.label}</p>
                      {item.date   && <p className="text-xs text-muted-foreground">Completed {fmtDate(item.date)}</p>}
                      {item.expiry && <p className="text-xs text-muted-foreground">Expires {fmtDate(item.expiry)}</p>}
                      {item.number && <p className="text-xs text-muted-foreground">Cert # {item.number}</p>}
                      {item.provider && <p className="text-xs text-muted-foreground">{item.provider}</p>}
                    </div>
                    <DocStatusChip status={item.completed ? docStatusOf(true, item.expiry) : "missing"} />
                    <button onClick={() => isEditing ? setEditingKey(null) : startEdit(item.id, item)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                      {isEditing ? <XIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => deleteExtra(item.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {isEditing && (
                    <div className="ml-8 mb-2 rounded-lg border bg-muted/20 p-3 space-y-2">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Training name</p>
                        <input type="text" value={editDraft.label as string}
                          onChange={e => setEditDraft(p => ({ ...p, label: e.target.value }))}
                          className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { field: "date",     label: "Completed date", type: "date" },
                          { field: "expiry",   label: "Expiry date",    type: "date" },
                          { field: "number",   label: "Cert number",    type: "text" },
                          { field: "provider", label: "Provider",       type: "text" },
                        ].map(({ field, label: fl, type }) => (
                          <div key={field}>
                            <p className="text-xs text-muted-foreground mb-0.5">{fl}</p>
                            <input type={type} value={editDraft[field] as string}
                              onChange={e => setEditDraft(p => ({ ...p, [field]: e.target.value }))}
                              className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={editDraft.completed as boolean}
                          onChange={e => setEditDraft(p => ({ ...p, completed: e.target.checked }))}
                          className="rounded" />
                        Mark as completed
                      </label>
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" className="h-7 text-xs" onClick={() => saveExtraEdit(item.id)}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingKey(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Add training ── */}
      <Card>
        <CardContent className="px-4 py-3">
          {!showAddForm ? (
            <button onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-1">
              <Plus className="h-4 w-4" />Add training / certificate
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">New training entry</p>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Training name <span className="text-destructive">*</span></p>
                <input type="text" placeholder="e.g. CCTV Operations, Lone Worker…" value={addDraft.label}
                  onChange={e => setAddDraft(p => ({ ...p, label: e.target.value }))}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { field: "date",     label: "Completed date", type: "date" },
                  { field: "expiry",   label: "Expiry date",    type: "date" },
                  { field: "number",   label: "Cert number",    type: "text" },
                  { field: "provider", label: "Provider",       type: "text" },
                ].map(({ field, label: fl, type }) => (
                  <div key={field}>
                    <p className="text-xs text-muted-foreground mb-0.5">{fl}</p>
                    <input type={type} value={(addDraft as Record<string, string | boolean>)[field] as string}
                      onChange={e => setAddDraft(p => ({ ...p, [field]: e.target.value }))}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={addDraft.completed}
                  onChange={e => setAddDraft(p => ({ ...p, completed: e.target.checked }))}
                  className="rounded" />
                Already completed
              </label>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-7 text-xs" onClick={addCustomTraining} disabled={!addDraft.label.trim()}>
                  <Plus className="h-3 w-3 mr-1" />Add
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAddForm(false); setAddDraft({ label: "", completed: false, date: "", expiry: "", number: "", provider: "" }) }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
