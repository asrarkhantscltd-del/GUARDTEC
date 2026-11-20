import { useState } from "react"
import { motion } from "framer-motion"
import type { StaffMember, EmploymentHistoryEntry } from "@/types/staff"
import { fmtDate } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Fingerprint, Building2, UserCheck, Briefcase, Pencil, Trash2, Plus } from "lucide-react"
import { docStatusOf, DocStatusChip, DocRow, type DocTools, type VettingTools } from "./shared"

export default function VettingTab({ staffId: id, staff, docTools, vettingTools, patchField }: {
  staffId: string
  staff: StaffMember
  docTools: DocTools
  vettingTools: VettingTools
  patchField: (updates: Partial<StaffMember>) => Promise<void>
}) {
  const { canEdit, editingDocKey, openDocEdit, docDeleteProps, docEditPanel } = docTools
  const { editingVetting, setEditingVetting, vettingDraft, setVettingDraft, vettingSaving, openVettingEdit, saveVetting } = vettingTools
  const docs = staff.documents ?? {}
  const [newHistoryEntry, setNewHistoryEntry] = useState("")
  const [historyAdding, setHistoryAdding]   = useState(false)

  async function addHistoryEntry() {
    if (!newHistoryEntry.trim() || !staff) return
    setHistoryAdding(true)
    await patchField({ employmentHistory: [...(staff.employmentHistory ?? []), newHistoryEntry.trim()] })
    setNewHistoryEntry("")
    setHistoryAdding(false)
  }

  async function deleteHistoryEntry(index: number) {
    if (!staff) return
    const updated = (staff.employmentHistory ?? []).filter((_, i) => i !== index)
    await patchField({ employmentHistory: updated })
  }

  return (
    <motion.div key="vetting" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>

      {/* ── DBS ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Fingerprint className="h-4 w-4" />DBS Check
            </CardTitle>
            {canEdit && editingVetting !== "dbs" && (
              <button onClick={() => openVettingEdit("dbs")}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 py-3">
          {editingVetting === "dbs" ? (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { field: "type",          label: "Check type",       type: "text",  placeholder: "e.g. Enhanced, Basic" },
                  { field: "checkDate",     label: "Check date",       type: "date",  placeholder: "" },
                  { field: "certificateNo", label: "Certificate No.",  type: "text",  placeholder: "" },
                ].map(({ field, label, type, placeholder }) => (
                  <div key={field}>
                    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                    <input type={type} value={vettingDraft[field] as string} placeholder={placeholder}
                      onChange={e => setVettingDraft(p => ({ ...p, [field]: e.target.value }))}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveVetting} disabled={vettingSaving}>
                  {vettingSaving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingVetting(null)}>Cancel</Button>
                {(staff.dbs?.type || staff.dbs?.checkDate || staff.dbs?.certificateNo) && (
                  <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => setVettingDraft({ type: "", checkDate: "", certificateNo: "" })}
                    title="Empties the fields — press Save to remove the DBS details">
                    <Trash2 className="h-3.5 w-3.5 mr-1" />Clear details
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                { label: "Check Type",       val: staff.dbs?.type ?? "—" },
                { label: "Check Date",       val: staff.dbs?.checkDate ? fmtDate(staff.dbs.checkDate) : "—" },
                { label: "Certificate No.",  val: staff.dbs?.certificateNo ?? "—" },
              ].map(({ label, val }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
                  <p className="mt-0.5">{val}</p>
                </div>
              ))}
              <div className="sm:col-span-2">
                <DocStatusChip status={staff.dbs?.checkDate ? "uploaded" : "missing"} />
              </div>
            </div>
          )}
          {/* Certificate scan — separate from the text fields above; staff
              can self-upload this from My Profile, or a manager can add
              it here. Optional, same as the DBS check itself. */}
          <div className="mt-3 border-t pt-3">
            <DocRow icon={<Fingerprint className="h-4 w-4" />} label="DBS Certificate (scan)"
              status={docStatusOf(docs.dbsCertificate?.uploaded)} uploadedDate={docs.dbsCertificate?.date}
              note="Optional — the certificate file itself, separate from the check details above"
              viewUrl={docs.dbsCertificate?.uploaded ? `/api/staff/${id}/documents/dbsCertificate` : undefined}
              onEdit={canEdit ? () => openDocEdit("dbsCertificate") : undefined} {...docDeleteProps("dbsCertificate")} />
            {editingDocKey === "dbsCertificate" && <div className="mt-3">{docEditPanel}</div>}
          </div>
        </CardContent>
      </Card>

      {/* ── BS 7858 ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck className="h-4 w-4" />BS 7858 Screening
            </CardTitle>
            {canEdit && editingVetting !== "bs7858" && (
              <button onClick={() => openVettingEdit("bs7858")}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 py-3">
          {editingVetting === "bs7858" ? (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={vettingDraft.completed as boolean}
                  onChange={e => setVettingDraft(p => ({ ...p, completed: e.target.checked }))}
                  className="rounded" />
                BS 7858 screening completed
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { field: "completionDate", label: "Completion date", type: "date" },
                  { field: "reviewer",       label: "Reviewed by",     type: "text" },
                ].map(({ field, label, type }) => (
                  <div key={field}>
                    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                    <input type={type} value={vettingDraft[field] as string}
                      onChange={e => setVettingDraft(p => ({ ...p, [field]: e.target.value }))}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveVetting} disabled={vettingSaving}>
                  {vettingSaving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingVetting(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Status</p>
                <p className="mt-1">
                  <DocStatusChip status={staff.bs7858?.completed ? "uploaded" : "missing"} />
                </p>
              </div>
              {staff.bs7858?.completionDate && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Completed On</p>
                  <p className="mt-0.5">{fmtDate(staff.bs7858.completionDate)}</p>
                </div>
              )}
              {staff.bs7858?.reviewer && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Reviewed By</p>
                  <p className="mt-0.5">{staff.bs7858.reviewer}</p>
                </div>
              )}
              <div className="sm:col-span-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  BS 7858 requires 5-year employment history, address history, two character references, criminal record check, and financial probity for key roles.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── References ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />References
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y px-4">
          {(["ref1", "ref2"] as const).map((key, i) => {
            const draftRef = staff.wizard_draft?.references?.[key]
            const isDraftRef = !staff.references?.[key]?.name && !!draftRef?.name
            const ref = isDraftRef ? draftRef : staff.references?.[key]
            const isEditing = editingVetting === key
            return (
              <div key={key} className="py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Reference {i + 1}
                    {isDraftRef && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] normal-case tracking-normal text-warning">Draft — not submitted yet</span>}
                  </p>
                  {canEdit && !isEditing && (
                    <button onClick={() => openVettingEdit(key)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid sm:grid-cols-2 gap-2">
                      {[
                        { field: "name",    label: "Name",    type: "text" },
                        { field: "company", label: "Company", type: "text" },
                        { field: "email",   label: "Email",   type: "email" },
                        { field: "phone",   label: "Phone",   type: "tel" },
                      ].map(({ field, label, type }) => (
                        <div key={field}>
                          <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                          <input type={type} value={vettingDraft[field] as string}
                            onChange={e => setVettingDraft(p => ({ ...p, [field]: e.target.value }))}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                      <select value={vettingDraft.status as string}
                        onChange={e => setVettingDraft(p => ({ ...p, status: e.target.value }))}
                        className="rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                        <option value="Not Started">Not Started</option>
                        <option value="Requested">Requested</option>
                        <option value="Satisfactory">Satisfactory</option>
                        <option value="Unsatisfactory">Unsatisfactory</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" onClick={saveVetting} disabled={vettingSaving}>
                        {vettingSaving ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingVetting(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : ref?.name ? (
                  <div className="grid sm:grid-cols-2 gap-2 text-sm">
                    <div><p className="text-xs text-muted-foreground">Name</p><p>{ref.name}</p></div>
                    {ref.company  && <div><p className="text-xs text-muted-foreground">Company</p><p>{ref.company}</p></div>}
                    {ref.email    && <div><p className="text-xs text-muted-foreground">Email</p><p>{ref.email}</p></div>}
                    {ref.phone    && <div><p className="text-xs text-muted-foreground">Phone</p><p>{ref.phone}</p></div>}
                    {ref.status   && (
                      <div className="sm:col-span-2">
                        <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                          ref.status === "Satisfactory" ? "bg-success/15 text-success"
                          : ref.status === "Not Started" ? "bg-muted text-muted-foreground"
                          : "bg-warning/15 text-warning"
                        }`}>{ref.status}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not recorded</p>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* ── 5-Year Employment History (BS 7858) ──
          What staff actually fill in on the vetting wizard/My Profile,
          lands in `employmentHistoryDetail`. This page never rendered it
          anywhere — PendingReviewPage shows it only while a submission is
          still pending approval, so once approved it became invisible.
          Read-only here (it's the staff's own submitted record, same
          treatment as References above); not to be confused with the
          separate freeform "Employment History" notes list below. */}
      {(() => {
        const live = (staff.employmentHistoryDetail ?? []) as EmploymentHistoryEntry[]
        const draft = (staff.wizard_draft?.employmentHistoryDetail ?? []) as EmploymentHistoryEntry[]
        const isDraftHist = live.length === 0 && draft.length > 0
        const hist = isDraftHist ? draft : live
        if (hist.length === 0) return null
        return (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              <Building2 className="h-4 w-4" />5-Year Employment History
              {isDraftHist && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">Draft — not submitted yet</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-3">
            {hist.map(e => (
              <div key={e.id} className="rounded-lg border bg-muted/20 p-3 text-sm space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{e.companyName} — {e.jobTitle}</p>
                  {e.verificationStatus && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      e.verificationStatus === "verified" ? "bg-success/15 text-success"
                      : e.verificationStatus === "unable-to-verify" ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground"
                    }`}>{e.verificationStatus.replace("-", " ")}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{e.startDate || "?"} to {e.endDate || "present"}</p>
                {e.reasonForLeaving && <p className="text-xs text-muted-foreground">Reason for leaving: {e.reasonForLeaving}</p>}
                {(e.managerName || e.managerPhone || e.managerEmail) && (
                  <p className="text-xs text-muted-foreground">
                    Referee: {[e.managerName, e.managerJobTitle].filter(Boolean).join(", ")}
                    {e.managerPhone && ` · ${e.managerPhone}`}{e.managerEmail && ` · ${e.managerEmail}`}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        )
      })()}

      {/* ── Employment History ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />Employment History
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-2">
          {(staff.employmentHistory ?? []).length > 0 ? (
            <ol className="space-y-1 text-sm list-decimal list-inside">
              {(staff.employmentHistory ?? []).map((entry, i) => (
                <li key={i} className="flex items-start gap-2 group">
                  <span className="flex-1 text-muted-foreground">{entry}</span>
                  {canEdit && (
                    <button onClick={() => deleteHistoryEntry(i)}
                      className="p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all" title="Remove">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No employment history recorded.</p>
          )}
          {canEdit && (
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={newHistoryEntry}
                onChange={e => setNewHistoryEntry(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addHistoryEntry()}
                placeholder="Add employer (e.g. ABC Security 2021–2023)"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
              <Button size="sm" className="h-7 text-xs" onClick={addHistoryEntry} disabled={historyAdding || !newHistoryEntry.trim()}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
