import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  ClipboardCheck, Check, X, Loader2, Clock, Camera, ChevronDown, ChevronUp, AlertTriangle, FileText, Download, Eye,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type {
  AddressHistoryEntry, EmploymentHistoryEntry, CriminalHistoryEntry, CautionEntry,
  OtherQualification, OnboardingDeclarations, DriverLicenceInfo,
} from "@/types/staff"

interface Ref { name?: string; company?: string; email?: string; phone?: string }
interface Bank { accountHolderName?: string; bankName?: string; sortCode?: string; accountNumber?: string }
interface EmergencyContact { name?: string; phone?: string; relationship?: string }

// Mirrors MY_PROFILE_FIELDS in server.js — every field a staff member can
// submit via self-service lives here on BOTH the live record (current
// values) and pending_submission (proposed values), so CompareField/
// ListCompare/DeclarationsCompare below can render a real diff for
// everything the wizard collects, not just the handful of fields this page
// originally shipped with.
interface ProfileSnapshot {
  phone?: string
  address?: string
  emergencyContact?: EmergencyContact
  bankDetails?: Bank
  sia?:  { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
  references?: { ref1?: Ref; ref2?: Ref }
  driverLicence?: DriverLicenceInfo
  notes?: string
  dateOfBirth?: string
  nationality?: string
  ni?: string
  uniqueTaxpayerReference?: string
  utrNotApplicable?: boolean
  previousNames?: string
  yearsAtCurrentAddress?: number
  addressHistory?: AddressHistoryEntry[]
  employmentHistoryDetail?: EmploymentHistoryEntry[]
  otherQualifications?: OtherQualification[]
  hasCriminalHistory?: boolean
  criminalHistory?: CriminalHistoryEntry[]
  hasCautions?: boolean
  cautionsAndInvestigations?: CautionEntry[]
  declarations?: OnboardingDeclarations
}

interface PendingStaff extends ProfileSnapshot {
  id: string
  name: string
  // Document scans upload straight to the live record the moment they're
  // submitted (same as every other doc type in this app — cscsCard,
  // siaPhysical, etc. — there's no separate pending/approved state for a
  // file). So these always reflect "whatever's on file right now", not a
  // proposed change to compare — that's why this lives at the top level,
  // not inside pending_submission below.
  documents?: Record<string, { uploaded?: boolean; date?: string } | undefined>
  pending_submission?: ProfileSnapshot & { submitted_at?: string; photo_pending?: boolean }
}

function fmtDateTime(iso?: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

const DECLARATION_LABELS: Record<string, string> = {
  rightToWorkConfirmed:      "Right to Work confirmed",
  identityDocumentConfirmed: "Identity document confirmed",
  proofOfAddressConfirmed:   "Proof of address confirmed",
  siaLicenceConfirmed:       "SIA licence confirmed",
  dbsConsent:                "DBS check consent",
  creditCheckConsent:        "Credit check consent",
  socialMediaCheckConsent:   "Social media check consent",
  criminalHistoryDeclared:   "Criminal history declared truthfully",
  vettingAuthorization:      "BS7858 vetting authorisation",
  bankDetailsConfirmed:      "Bank details confirmed",
  trainingCertConfirmed:     "Training certificates confirmed",
  fraudActAcknowledged:      "Fraud Act 2006 warning acknowledged",
  conductPolicyAccepted:     "Conduct policy accepted",
  dataProtectionAccepted:    "Data protection notice accepted",
  accuracyDeclared:          "Accuracy of information declared",
}

export default function PendingReviewPage() {
  const [list, setList] = useState<PendingStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  async function load() {
    setLoading(true)
    try {
      const d = await api.get<{ staff: PendingStaff[] }>("/api/staff/pending-review")
      setList(d.staff ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function approve(id: string) {
    setBusyId(id)
    try {
      await api.post(`/api/staff/${id}/approve`)
      toast.success("Submission approved")
      await load()
    } catch {
      toast.error("Network error — could not approve")
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    try {
      await api.post(`/api/staff/${id}/reject`, { reason })
      toast.success("Submission rejected")
      setRejectingId(null)
      setReason("")
      await load()
    } catch {
      toast.error("Network error — could not reject")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight">Pending Review</h2>
        <p className="text-sm text-muted-foreground">
          Staff-submitted profile changes waiting for approval — {list.length} pending
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <div className="surface rounded-xl border-dashed p-12 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">Nothing to review</p>
          <p className="mt-1 text-xs text-muted-foreground">Staff submissions will appear here for your approval.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((s) => {
            const p = s.pending_submission ?? {}
            const nothingToShow =
              !p.phone && !p.address && !p.bankDetails && !p.sia && !p.cscs && !p.visa &&
              !p.references && !p.driverLicence && !p.notes && !p.dateOfBirth && !p.nationality &&
              !p.ni && !p.uniqueTaxpayerReference && p.utrNotApplicable === undefined && !p.previousNames &&
              p.yearsAtCurrentAddress === undefined && !p.emergencyContact &&
              (!p.addressHistory || p.addressHistory.length === 0) &&
              (!p.employmentHistoryDetail || p.employmentHistoryDetail.length === 0) &&
              (!p.otherQualifications || p.otherQualifications.length === 0) &&
              p.hasCriminalHistory === undefined && (!p.criminalHistory || p.criminalHistory.length === 0) &&
              p.hasCautions === undefined && (!p.cautionsAndInvestigations || p.cautionsAndInvestigations.length === 0) &&
              !p.declarations && !p.photo_pending

            return (
              <div key={s.id} className="surface p-5">
                <div className="mb-4">
                  <p className="font-semibold">{s.name}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />Submitted {fmtDateTime(p.submitted_at)}
                    {p.photo_pending && (
                      <span className="ml-2 flex items-center gap-1 text-primary">
                        <Camera className="h-3 w-3" />New photo submitted — see their profile photo to review it
                      </span>
                    )}
                  </p>
                </div>

                {/* Everything below this line is what they submitted — read it
                    before deciding, not just the two buttons at the very bottom. */}
                <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ClipboardCheck className="h-3.5 w-3.5" />What they submitted — review before deciding
                </p>

                {nothingToShow && !p.photo_pending && (
                  <p className="mb-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    No field changes detected in this submission — if a photo was submitted, it's shown above.
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <CompareField label="Phone" current={s.phone} proposed={p.phone} />
                  <CompareField label="Address" current={s.address} proposed={p.address} />
                  <CompareField label="Date of birth" current={s.dateOfBirth} proposed={p.dateOfBirth} />
                  <CompareField label="Nationality" current={s.nationality} proposed={p.nationality} />
                  <CompareField label="Previous names" current={s.previousNames} proposed={p.previousNames} />
                  <CompareField label="Years at current address" current={s.yearsAtCurrentAddress?.toString()} proposed={p.yearsAtCurrentAddress?.toString()} />
                  <CompareField label="National Insurance number" current={s.ni} proposed={p.ni} />
                  <CompareField label="UTR"
                    current={s.utrNotApplicable ? "Not applicable" : s.uniqueTaxpayerReference}
                    proposed={p.utrNotApplicable !== undefined || p.uniqueTaxpayerReference !== undefined
                      ? (p.utrNotApplicable ? "Not applicable" : p.uniqueTaxpayerReference) : undefined} />

                  <CompareField label="Emergency contact name" current={s.emergencyContact?.name} proposed={p.emergencyContact?.name} />
                  <CompareField label="Emergency contact phone" current={s.emergencyContact?.phone} proposed={p.emergencyContact?.phone} />
                  <CompareField label="Emergency contact relationship" current={s.emergencyContact?.relationship} proposed={p.emergencyContact?.relationship} />

                  <CompareField label="Bank account holder" current={s.bankDetails?.accountHolderName} proposed={p.bankDetails?.accountHolderName} />
                  <CompareField label="Bank name" current={s.bankDetails?.bankName} proposed={p.bankDetails?.bankName} />
                  <CompareField label="Sort code" current={s.bankDetails?.sortCode} proposed={p.bankDetails?.sortCode} />
                  <CompareField label="Account number" current={s.bankDetails?.accountNumber} proposed={p.bankDetails?.accountNumber} />

                  <CompareField label="SIA number" current={s.sia?.number} proposed={p.sia?.number} />
                  <CompareField label="SIA expiry" current={s.sia?.expiry} proposed={p.sia?.expiry} />
                  <CompareField label="CSCS number" current={s.cscs?.number} proposed={p.cscs?.number} />
                  <CompareField label="CSCS expiry" current={s.cscs?.expiry} proposed={p.cscs?.expiry} />
                  <CompareField label="Visa / RTW type" current={s.visa?.type} proposed={p.visa?.type} />
                  <CompareField label="Visa expiry" current={s.visa?.expiry} proposed={p.visa?.expiry} />

                  <CompareField label="Reference 1 — name" current={s.references?.ref1?.name} proposed={p.references?.ref1?.name} />
                  <CompareField label="Reference 1 — company" current={s.references?.ref1?.company} proposed={p.references?.ref1?.company} />
                  <CompareField label="Reference 1 — phone" current={s.references?.ref1?.phone} proposed={p.references?.ref1?.phone} />
                  <CompareField label="Reference 2 — name" current={s.references?.ref2?.name} proposed={p.references?.ref2?.name} />
                  <CompareField label="Reference 2 — company" current={s.references?.ref2?.company} proposed={p.references?.ref2?.company} />
                  <CompareField label="Reference 2 — phone" current={s.references?.ref2?.phone} proposed={p.references?.ref2?.phone} />

                  {p.driverLicence && (
                    <DriverLicenceReviewForm staffId={s.id} documents={s.documents}
                      current={s.driverLicence} proposed={p.driverLicence} />
                  )}

                  <CompareField label="Criminal history declared"
                    current={s.hasCriminalHistory ? "Yes" : "No"}
                    proposed={p.hasCriminalHistory !== undefined ? (p.hasCriminalHistory ? "Yes" : "No") : undefined} />
                  <CompareField label="Cautions / investigations declared"
                    current={s.hasCautions ? "Yes" : "No"}
                    proposed={p.hasCautions !== undefined ? (p.hasCautions ? "Yes" : "No") : undefined} />

                  <CompareField label="Notes" current={s.notes} proposed={p.notes} />

                  <ListCompare label="Address history" items={p.addressHistory}
                    render={e => `${e.address}${e.postcode ? ", " + e.postcode : ""} — ${e.fromDate || "?"} to ${e.toDate || "present"}`} />
                  <ListCompare label="Employment history" items={p.employmentHistoryDetail}
                    render={e => `${e.companyName} — ${e.jobTitle} (${e.startDate || "?"} to ${e.endDate || "present"})`} />
                  <ListCompare label="Other qualifications" items={p.otherQualifications}
                    render={e => `${e.qualification} — ${e.awardingBody} (${e.dateAchieved || "date not given"})`} />
                  <ListCompare label="Criminal history disclosed" items={p.criminalHistory} warn
                    render={e => `${e.offenseType} — ${e.date}${e.court ? " · " + e.court : ""}${e.sentence ? " · " + e.sentence : ""}`} />
                  <ListCompare label="Cautions / investigations disclosed" items={p.cautionsAndInvestigations} warn
                    render={e => `${e.type} — ${e.date}${e.outcome ? " · " + e.outcome : ""}`} />

                  {p.declarations && <DeclarationsCompare declarations={p.declarations} />}
                </div>

                {/* Decision — deliberately below everything submitted, not above it */}
                <div className="mt-4 border-t pt-4">
                  {rejectingId === s.id ? (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reason (shown to staff member)</label>
                      <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
                        placeholder="e.g. Please re-upload a clearer photo of your SIA card"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none" />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setRejectingId(null); setReason("") }}>Cancel</Button>
                        <Button size="sm" variant="destructive" disabled={busyId === s.id} onClick={() => reject(s.id)}>
                          Confirm reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:bg-destructive/10"
                        disabled={busyId === s.id}
                        onClick={() => { setRejectingId(s.id); setReason("") }}>
                        <X className="h-3.5 w-3.5" />Reject
                      </Button>
                      <Button size="sm" className="gap-1.5" disabled={busyId === s.id} onClick={() => approve(s.id)}>
                        {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompareField({ label, current, proposed }: { label: string; current?: string; proposed?: string }) {
  const changed = proposed !== undefined && proposed !== current && proposed !== ""
  if (!changed) return null
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground line-through opacity-60">{current || "—"}</p>
      <p className="text-sm font-medium text-primary">{proposed}</p>
    </div>
  )
}

// For array-shaped submissions (address/employment history, qualifications,
// criminal history, cautions) a line-by-line before/after diff doesn't make
// sense — these are usually being provided for the first time. Show a count
// + expandable list instead, so the manager sees the actual content rather
// than nothing at all. `warn` renders it as a flagged/amber card for
// sensitive disclosures (criminal history, cautions) that deserve attention
// even when reviewing a routine submission.
function ListCompare<T>({ label, items, render, warn }: { label: string; items?: T[]; render: (item: T) => string; warn?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!items || items.length === 0) return null
  return (
    <div className={`rounded-lg px-3 py-2 sm:col-span-2 ${warn ? "bg-destructive/10" : "bg-muted/40"}`}>
      <button type="button" onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center justify-between text-left">
        <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${warn ? "text-destructive" : "text-muted-foreground"}`}>
          {warn && <AlertTriangle className="h-3 w-3" />}
          {label} — {items.length} submitted
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1 text-xs text-foreground">
          {items.map((item, i) => <li key={i}>{render(item)}</li>)}
        </ul>
      )}
    </div>
  )
}

function DeclarationsCompare({ declarations }: { declarations: OnboardingDeclarations }) {
  const entries = Object.entries(declarations) as [string, boolean | undefined][]
  const confirmed = entries.filter(([, v]) => v === true).length
  const notConfirmed = entries.filter(([, v]) => v !== true)
  const [expanded, setExpanded] = useState(notConfirmed.length > 0)
  return (
    <div className={`rounded-lg px-3 py-2 sm:col-span-2 ${notConfirmed.length > 0 ? "bg-warning/10" : "bg-muted/40"}`}>
      <button type="button" onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center justify-between text-left">
        <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${notConfirmed.length > 0 ? "text-warning" : "text-muted-foreground"}`}>
          {notConfirmed.length > 0 && <AlertTriangle className="h-3 w-3" />}
          Declarations — {confirmed}/{entries.length} confirmed
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {expanded && notConfirmed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-warning">
          {notConfirmed.map(([key]) => <li key={key}>Not confirmed: {DECLARATION_LABELS[key] ?? key}</li>)}
        </ul>
      )}
    </div>
  )
}

const LICENCE_CATS = ["B", "B+E", "C1", "C1+E", "C", "C+E", "D1", "D1+E", "D", "AM"]

// Mirrors the exact field layout of the driver-licence form on
// MyProfilePage.tsx (same labels, same order, same category chip set) —
// so a manager reviewing a submission sees the same shape they'd recognise
// from the input form, not an abstract list of "label: old → new" pills.
// Each text/date field still highlights a change where there is one.
function DriverLicenceReviewForm({ current, proposed, staffId, documents }: {
  current?: DriverLicenceInfo; proposed?: DriverLicenceInfo; staffId: string
  documents?: Record<string, { uploaded?: boolean; date?: string } | undefined>
}) {
  const currentCats = current?.licenceCategories ?? []
  const proposedCats = proposed?.licenceCategories ?? currentCats
  return (
    <div className="sm:col-span-2 space-y-3 rounded-lg border bg-background p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Driving Licence &amp; Qualifications — as submitted</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <ReviewField label="Licence Number" current={current?.licenceNumber} proposed={proposed?.licenceNumber} />
        <ReviewField label="Licence Expiry" current={current?.licenceExpiry} proposed={proposed?.licenceExpiry} />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Licence Categories</p>
        <div className="flex flex-wrap gap-2">
          {LICENCE_CATS.map(cat => {
            const wasSelected = currentCats.includes(cat)
            const isSelected = proposedCats.includes(cat)
            const added = isSelected && !wasSelected
            const removed = !isSelected && wasSelected
            return (
              <span key={cat} title={added ? "Newly added" : removed ? "Removed" : undefined}
                className={`rounded-md border px-3 py-1 text-xs font-bold ${
                  added   ? "border-success bg-success/15 text-success" :
                  removed ? "border-destructive/40 bg-destructive/5 text-destructive/70 line-through" :
                  isSelected ? "border-primary bg-primary text-primary-foreground" :
                  "border-border bg-background text-muted-foreground/40"
                }`}>
                {cat}
              </span>
            )
          })}
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <ReviewField label="CPC Card Number" current={current?.cpcCard} proposed={proposed?.cpcCard} />
        <ReviewField label="CPC Expiry" current={current?.cpcExpiry} proposed={proposed?.cpcExpiry} />
        <ReviewField label="Medical Cert Expiry" current={current?.medicalExpiry} proposed={proposed?.medicalExpiry} />
      </div>
      <DriverDocLinks staffId={staffId} documents={documents} />
    </div>
  )
}

// A single form field shown as it would appear on the input form — value
// filled in, with the previous value struck through above it only when it
// actually changed, instead of a separate compact "compare pill".
function ReviewField({ label, current, proposed }: { label: string; current?: string; proposed?: string }) {
  const changed = proposed !== undefined && proposed !== current && proposed !== ""
  const display = proposed !== undefined ? proposed : current
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {changed && <p className="text-xs text-muted-foreground line-through opacity-60">{current || "—"}</p>}
      <p className={`text-sm ${changed ? "font-semibold text-primary" : "text-foreground"}`}>{display || "—"}</p>
    </div>
  )
}

const DRIVER_DOC_KEYS = [
  { key: "driverLicenceCopy", label: "Licence scan" },
  { key: "driverCpcCard",     label: "CPC card" },
  { key: "driverMedicalCert", label: "Medical certificate" },
] as const

// Scans upload straight to the live record (see the `documents` comment on
// PendingStaff above), so this shows whatever's currently on file — not a
// proposed change — right alongside the licence field diff, so a manager
// reviewing a category/number change can also open the actual scan instead
// of taking the typed values on trust.
function DriverDocLinks({ staffId, documents }: { staffId: string; documents?: Record<string, { uploaded?: boolean; date?: string } | undefined> }) {
  const uploaded = DRIVER_DOC_KEYS.filter(d => documents?.[d.key]?.uploaded)
  if (uploaded.length === 0) return null
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2 sm:col-span-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Scans on file</p>
      <div className="flex flex-wrap gap-2">
        {uploaded.map(d => (
          <span key={d.key} className="inline-flex items-center gap-1 rounded-md border bg-background pl-2.5 pr-1 py-1 text-xs font-medium">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />{d.label}
            <a href={`/api/staff/${staffId}/documents/${d.key}`} target="_blank" rel="noopener noreferrer"
              className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="View">
              <Eye className="h-3.5 w-3.5" />
            </a>
            <a href={`/api/staff/${staffId}/documents/${d.key}`} download
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Download">
              <Download className="h-3.5 w-3.5" />
            </a>
          </span>
        ))}
      </div>
    </div>
  )
}
