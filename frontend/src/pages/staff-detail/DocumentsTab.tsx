import { motion } from "framer-motion"
import type { StaffMember } from "@/types/staff"
import { parseRoles } from "@/components/ui/role-picker"
import { fmtDate } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ShieldCheck, CreditCard, FileText, ClipboardList, Briefcase, Car, MapPin, BadgeAlert, Pencil,
  ShieldAlert,
} from "lucide-react"
import { ConfidentialDocManagerRow, CONFIDENTIAL_STAFF_DOCS } from "@/components/profile/ProfileShared"
import { docStatusOf, DocRow, type DocTools, type VettingTools } from "./shared"

export default function DocumentsTab({ staffId: id, staff, docTools, vettingTools, onChanged: refreshStaffRecord }: {
  staffId: string
  staff: StaffMember
  docTools: DocTools
  vettingTools: VettingTools
  onChanged: () => Promise<void>
}) {
  const { canEdit, openDocEdit, docDeleteProps, docEditPanel } = docTools
  const { editingVetting, setEditingVetting, vettingDraft, setVettingDraft, vettingSaving, openVettingEdit, saveVetting } = vettingTools
  const docs = staff.documents ?? {}

  return (
    <motion.div key="documents" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      {docEditPanel}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BadgeAlert className="h-4 w-4" />Identity &amp; Licensing
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <DocRow icon={<ShieldCheck className="h-4 w-4" />} label="SIA Licence (physical scan)"
            status={docStatusOf(docs.siaPhysical?.uploaded)} uploadedDate={docs.siaPhysical?.date}
            note="Front and back of the physical SIA badge"
            viewUrl={docs.siaPhysical?.uploaded ? `/api/staff/${id}/documents/siaPhysical` : undefined}
            onEdit={canEdit ? () => openDocEdit("siaPhysical") : undefined} {...docDeleteProps("siaPhysical")} />
          <DocRow icon={<FileText className="h-4 w-4" />} label="Passport"
            status={docStatusOf(docs.passport?.uploaded)} uploadedDate={docs.passport?.date}
            note="Required for BS 7858 identity verification"
            viewUrl={docs.passport?.uploaded ? `/api/staff/${id}/documents/passport` : undefined}
            onEdit={canEdit ? () => openDocEdit("passport") : undefined} {...docDeleteProps("passport")} />
          <DocRow icon={<CreditCard className="h-4 w-4" />} label="BRP / Share Code / RTW Evidence"
            status={docStatusOf(docs.brpCard?.uploaded)} uploadedDate={docs.brpCard?.date}
            note="Biometric Residence Permit or right to work share code proof"
            viewUrl={docs.brpCard?.uploaded ? `/api/staff/${id}/documents/brpCard` : undefined}
            onEdit={canEdit ? () => openDocEdit("brpCard") : undefined} {...docDeleteProps("brpCard")} />
          <DocRow icon={<CreditCard className="h-4 w-4" />} label="CSCS Card"
            status={docStatusOf(docs.cscsCard?.uploaded)} uploadedDate={docs.cscsCard?.date}
            note="Front of the physical CSCS card"
            viewUrl={docs.cscsCard?.uploaded ? `/api/staff/${id}/documents/cscsCard` : undefined}
            onEdit={canEdit ? () => openDocEdit("cscsCard") : undefined} {...docDeleteProps("cscsCard")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />Proof of Address
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <DocRow icon={<FileText className="h-4 w-4" />} label="Proof of Address 1 (utility bill / bank statement)"
            status={docStatusOf(docs.proofOfAddress1?.uploaded)} uploadedDate={docs.proofOfAddress1?.date}
            note="Must be dated within the last 3 months"
            viewUrl={docs.proofOfAddress1?.uploaded ? `/api/staff/${id}/documents/proofOfAddress1` : undefined}
            onEdit={canEdit ? () => openDocEdit("proofOfAddress1") : undefined} {...docDeleteProps("proofOfAddress1")} />
          <DocRow icon={<FileText className="h-4 w-4" />} label="Proof of Address 2"
            status={docStatusOf(docs.proofOfAddress2?.uploaded)} uploadedDate={docs.proofOfAddress2?.date}
            note="Second document, also within last 3 months"
            viewUrl={docs.proofOfAddress2?.uploaded ? `/api/staff/${id}/documents/proofOfAddress2` : undefined}
            onEdit={canEdit ? () => openDocEdit("proofOfAddress2") : undefined} {...docDeleteProps("proofOfAddress2")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" />Employment &amp; Payroll
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <DocRow icon={<FileText className="h-4 w-4" />} label="Application Form"
            status={docStatusOf(docs.application?.uploaded)} uploadedDate={docs.application?.date}
            note="Signed job application / new starter form"
            viewUrl={docs.application?.uploaded ? `/api/staff/${id}/documents/application` : undefined}
            onEdit={canEdit ? () => openDocEdit("application") : undefined} {...docDeleteProps("application")} />
          <DocRow icon={<FileText className="h-4 w-4" />} label="Employment Contract"
            status={staff.contract && staff.contract.toLowerCase() !== "not signed" ? "uploaded" : "missing"}
            note={`Status: ${staff.contract || "Not signed"}`} />
          <DocRow icon={<FileText className="h-4 w-4" />} label="P45 / P60 (previous employer)"
            status={docStatusOf(docs.p45?.uploaded)} uploadedDate={docs.p45?.date}
            note="Last employer's P45 or most recent P60"
            viewUrl={docs.p45?.uploaded ? `/api/staff/${id}/documents/p45` : undefined}
            onEdit={canEdit ? () => openDocEdit("p45") : undefined} {...docDeleteProps("p45")} />
          <DocRow icon={<FileText className="h-4 w-4" />} label="Bank Account Letter / Void Cheque"
            status={docStatusOf(docs.bankLetter?.uploaded)} uploadedDate={docs.bankLetter?.date}
            note="Required for payroll setup"
            viewUrl={docs.bankLetter?.uploaded ? `/api/staff/${id}/documents/bankLetter` : undefined}
            onEdit={canEdit ? () => openDocEdit("bankLetter") : undefined} {...docDeleteProps("bankLetter")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />Operational
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <DocRow icon={<FileText className="h-4 w-4" />} label="Assignment Instructions (signed)"
            status={docStatusOf(docs.assignmentInstructions?.uploaded)} uploadedDate={docs.assignmentInstructions?.date}
            note="Site-specific assignment instructions, legally required per SIA"
            viewUrl={docs.assignmentInstructions?.uploaded ? `/api/staff/${id}/documents/assignmentInstructions` : undefined}
            onEdit={canEdit ? () => openDocEdit("assignmentInstructions") : undefined} {...docDeleteProps("assignmentInstructions")} />
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />Confidential Checks
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Upload results here after you've reviewed them yourself. Uploads always start hidden from{" "}
              {staff.name} — use the visibility toggle to reveal one only if you choose to.
            </p>
            {CONFIDENTIAL_STAFF_DOCS.map(doc => {
              const meta = docs[doc.key as keyof typeof docs] as { uploaded?: boolean; date?: string; visibleToStaff?: boolean } | undefined
              return (
                <ConfidentialDocManagerRow key={doc.key} label={doc.label}
                  uploadUrl={`/api/staff/${id}/documents/${doc.key}`}
                  visibilityUrl={`/api/staff/${id}/documents/${doc.key}/visibility`}
                  downloadUrl={`/api/staff/${id}/documents/${doc.key}`}
                  uploaded={meta?.uploaded} date={meta?.date} visibleToSubject={meta?.visibleToStaff}
                  subjectLabel={staff.name} onChanged={refreshStaffRecord} />
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Driver (only for staff carrying the "Driver" role) ── */}
      {parseRoles(staff.jobRole).includes("Driver") && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Car className="h-4 w-4" />Driving Licence &amp; Qualifications
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 space-y-3">
              {/* This used to render unconditionally, so it kept claiming
                  a submission was "subject to your approval" even after
                  Pending Review genuinely showed 0 pending and the data
                  below was already the approved, live version — confirmed
                  via staff_data.json that pending_submission was null.
                  Gate it on the submission actually still being there. */}
              {staff.pending_submission?.driverLicence && (
                <p className="text-xs text-muted-foreground">
                  Submitted by {staff.name} via their own profile — subject to your approval on the Pending Review queue.
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Licence Number</p>
                  <p className="mt-0.5 font-mono">{staff.driverLicence?.licenceNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Licence Expiry</p>
                  <p className="mt-0.5">{staff.driverLicence?.licenceExpiry ? fmtDate(staff.driverLicence.licenceExpiry) : "—"}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Licence Categories</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {staff.driverLicence?.licenceCategories?.length
                      ? staff.driverLicence.licenceCategories.map(c => (
                          <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold">{c}</span>
                        ))
                      : <span className="text-muted-foreground">—</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">CPC Card No.</p>
                  <p className="mt-0.5 font-mono">{staff.driverLicence?.cpcCard || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">CPC Expiry</p>
                  <p className="mt-0.5">{staff.driverLicence?.cpcExpiry ? fmtDate(staff.driverLicence.cpcExpiry) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Medical Cert Expiry</p>
                  <p className="mt-0.5">{staff.driverLicence?.medicalExpiry ? fmtDate(staff.driverLicence.medicalExpiry) : "—"}</p>
                </div>
              </div>
              <DocRow icon={<FileText className="h-4 w-4" />} label="Driving Licence (scan)"
                status={docStatusOf(docs.driverLicenceCopy?.uploaded)} uploadedDate={docs.driverLicenceCopy?.date}
                viewUrl={docs.driverLicenceCopy?.uploaded ? `/api/staff/${id}/documents/driverLicenceCopy` : undefined}
                onEdit={canEdit ? () => openDocEdit("driverLicenceCopy") : undefined} {...docDeleteProps("driverLicenceCopy")} />
              <DocRow icon={<FileText className="h-4 w-4" />} label="Driver CPC Card (scan)"
                status={docStatusOf(docs.driverCpcCard?.uploaded)} uploadedDate={docs.driverCpcCard?.date}
                viewUrl={docs.driverCpcCard?.uploaded ? `/api/staff/${id}/documents/driverCpcCard` : undefined}
                onEdit={canEdit ? () => openDocEdit("driverCpcCard") : undefined} {...docDeleteProps("driverCpcCard")} />
              <DocRow icon={<FileText className="h-4 w-4" />} label="Driver Medical Certificate"
                status={docStatusOf(docs.driverMedicalCert?.uploaded)} uploadedDate={docs.driverMedicalCert?.date}
                viewUrl={docs.driverMedicalCert?.uploaded ? `/api/staff/${id}/documents/driverMedicalCert` : undefined}
                onEdit={canEdit ? () => openDocEdit("driverMedicalCert") : undefined} {...docDeleteProps("driverMedicalCert")} />
            </CardContent>
          </Card>

          {canEdit && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Car className="h-4 w-4" />Driver — Company Assigned
                  </CardTitle>
                  {editingVetting !== "driver" && (
                    <button onClick={() => openVettingEdit("driver")}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 py-3">
                {editingVetting === "driver" ? (
                  <div className="space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                      {[
                        { field: "fuelCardNumber", label: "Fuel Card Number", type: "text" },
                        { field: "tachoCard",       label: "Tachograph Card No.", type: "text" },
                        { field: "tachoExpiry",     label: "Tachograph Expiry", type: "date" },
                        { field: "dbsNumber",       label: "DBS Certificate No.", type: "text" },
                        { field: "dbsDate",         label: "DBS Issue Date", type: "date" },
                        { field: "lastAssessment",  label: "Last Assessment", type: "date" },
                      ].map(({ field, label, type }) => (
                        <div key={field}>
                          <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                          <input type={type} value={vettingDraft[field] as string}
                            onChange={e => setVettingDraft(p => ({ ...p, [field]: e.target.value }))}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                      ))}
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                        <select value={vettingDraft.status as string}
                          onChange={e => setVettingDraft(p => ({ ...p, status: e.target.value }))}
                          className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="on_leave">On Leave</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Notes</p>
                      <textarea rows={2} value={vettingDraft.notes as string}
                        onChange={e => setVettingDraft(p => ({ ...p, notes: e.target.value }))}
                        className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
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
                    {[
                      { label: "Fuel Card Number",     val: staff.driverAssignment?.fuelCardNumber ?? "—" },
                      { label: "Tachograph Card No.",  val: staff.driverAssignment?.tachoCard ?? "—" },
                      { label: "Tachograph Expiry",    val: staff.driverAssignment?.tachoExpiry ? fmtDate(staff.driverAssignment.tachoExpiry) : "—" },
                      { label: "DBS Certificate No.",  val: staff.driverAssignment?.dbsNumber ?? "—" },
                      { label: "DBS Issue Date",       val: staff.driverAssignment?.dbsDate ? fmtDate(staff.driverAssignment.dbsDate) : "—" },
                      { label: "Last Assessment",      val: staff.driverAssignment?.lastAssessment ? fmtDate(staff.driverAssignment.lastAssessment) : "—" },
                      { label: "Status",               val: staff.driverAssignment?.status ?? "active" },
                    ].map(({ label, val }) => (
                      <div key={label}>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
                        <p className="mt-0.5 capitalize">{val}</p>
                      </div>
                    ))}
                    {staff.driverAssignment?.notes && (
                      <div className="sm:col-span-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Notes</p>
                        <p className="mt-0.5">{staff.driverAssignment.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
              <CardContent className="px-4 pb-4 pt-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Upload results here after you've reviewed them yourself. Uploads always start hidden from{" "}
                  {staff.name} — use the visibility toggle to reveal one only if you choose to.
                </p>
                {[
                  { key: "driverTachoCard",        label: "Tachograph Card (scan)" },
                  { key: "driverDbsCheck",          label: "Driver DBS Certificate" },
                  { key: "driverAssessmentReport",  label: "Driving Assessment Report" },
                ].map(doc => {
                  const meta = docs[doc.key as keyof typeof docs] as { uploaded?: boolean; date?: string; visibleToStaff?: boolean } | undefined
                  return (
                    <ConfidentialDocManagerRow key={doc.key} label={doc.label}
                      uploadUrl={`/api/staff/${id}/documents/${doc.key}`}
                      visibilityUrl={`/api/staff/${id}/documents/${doc.key}/visibility`}
                      downloadUrl={`/api/staff/${id}/documents/${doc.key}`}
                      uploaded={meta?.uploaded} date={meta?.date} visibleToSubject={meta?.visibleToStaff}
                      subjectLabel={staff.name} onChanged={refreshStaffRecord} />
                  )
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </motion.div>
  )
}
