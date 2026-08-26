import { useState } from "react"
import {
  ChevronLeft, ChevronRight, Check, AlertCircle, Loader2, Save,
  Plus, Trash2, Camera, ImageOff, Pencil,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Section, Field, DocUploadRow, TrainingCertRow, ManagerDocRow, ConfidentialDocRow,
  DOC_UPLOADS, TRAINING_CERT_UPLOADS, MANAGER_UPLOADED_DOCS, CONFIDENTIAL_STAFF_DOCS,
} from "@/components/profile/ProfileShared"
import type {
  AddressHistoryEntry, EmploymentHistoryEntry, CriminalHistoryEntry,
  CautionEntry, OtherQualification, OnboardingDeclarations,
} from "@/types/staff"

// Mandatory training certs per the spec — "Manual Handling" and "Additional
// Role-Specific Training" are explicitly marked conditional, so they're left
// optional here rather than blocking submission for roles that don't need them.
// bwcTraining (Body Worn Camera) is deliberately excluded — not every role
// carries a BWC, so it's optional at submission; staff can still upload it
// later from My Profile if it becomes relevant.
const MANDATORY_TRAINING_KEYS = ["siaCertificate", "firstAid", "fireAwareness", "conflictManagement", "cscsTest"]

function genId() { return Math.random().toString(36).slice(2, 10) }

// ── Shared small field primitives ──────────────────────────────────────────

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground"
    />
  )
}

function YesNo({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange(false)}
        className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${value === false ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>
        No
      </button>
      <button type="button" onClick={() => onChange(true)}
        className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${value === true ? "border-destructive bg-destructive/10 text-destructive" : "hover:bg-muted"}`}>
        Yes
      </button>
    </div>
  )
}

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border" />
      <span className="text-sm leading-relaxed">{children}</span>
    </label>
  )
}

function ErrorBanner({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Please complete the following before continuing:</p>
        <ul className="mt-1 list-disc pl-4 space-y-0.5">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      </div>
    </div>
  )
}

// ── Profile shape this wizard operates on (subset of MyProfilePage's Profile) ──

export interface WizardProfile {
  id: string
  name: string
  email?: string
  phone?: string
  address?: string
  dateOfBirth?: string
  nationality?: string
  ni?: string
  uniqueTaxpayerReference?: string
  utrNotApplicable?: boolean
  previousNames?: string
  yearsAtCurrentAddress?: number
  addressHistory?: AddressHistoryEntry[]
  emergencyContact?: { name?: string; phone?: string; relationship?: string; address?: string }
  employmentHistoryDetail?: EmploymentHistoryEntry[]
  visa?: { type?: string; expiry?: string }
  sia?: { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string; cardType?: string }
  otherQualifications?: OtherQualification[]
  references?: { ref1?: any; ref2?: any }
  declarations?: OnboardingDeclarations
  hasCriminalHistory?: boolean
  criminalHistory?: CriminalHistoryEntry[]
  hasCautions?: boolean
  cautionsAndInvestigations?: CautionEntry[]
  bankDetails?: { accountHolderName?: string; bankName?: string; sortCode?: string; accountNumber?: string; iban?: string }
  documents?: Record<string, { uploaded?: boolean; date?: string; docType?: string } | undefined>
  training?: any
}

interface WizardProps {
  profile: WizardProfile
  set: <K extends keyof WizardProfile>(field: K, value: WizardProfile[K]) => void
  photo: File | null
  photoPreview: string | null
  pickPhoto: (file: File | null) => void
  saving: boolean
  submitError: string
  onSubmit: () => void | Promise<void>
  onAutosave?: () => void
}

const PHASE_TITLES = [
  "Personal & Tax Details",
  "Address",
  "Emergency Contact",
  "Employment History (5 yrs)",
  "Right to Work",
  "SIA, CSCS & Qualifications",
  "References",
  "DBS & Criminal History",
  "Bank Details",
  "Documents & Certificates",
  "Declarations",
  "Review & Submit",
]
const LAST_PHASE = PHASE_TITLES.length - 1
const REVIEW_PHASE = LAST_PHASE

export default function OnboardingWizard({ profile: p, set, photo, photoPreview, pickPhoto, saving, submitError, onSubmit, onAutosave }: WizardProps) {
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [errors, setErrors] = useState<string[]>([])

  function validatePhase(i: number): string[] {
    const errs: string[] = []
    const req = (cond: boolean, msg: string) => { if (!cond) errs.push(msg) }

    if (i === 0) {
      req(!!p.phone?.trim(), "Personal mobile phone is required.")
      req(!!p.dateOfBirth, "Date of birth is required.")
      req(!!p.nationality?.trim(), "Nationality is required.")
      req(!!p.ni && /^[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$/i.test(p.ni.trim()), "A valid National Insurance number is required (format: AA 12 34 56 A).")
      if (!p.utrNotApplicable) {
        req(!!p.uniqueTaxpayerReference && /^\d{10}$/.test(p.uniqueTaxpayerReference.replace(/\s/g, "")), "A valid 10-digit Unique Taxpayer Reference (UTR) is required, or tick \"I don't have a UTR\" if it doesn't apply to you.")
      }
    }
    if (i === 1) {
      req(!!p.address?.trim(), "Current address is required.")
      req(p.yearsAtCurrentAddress !== undefined && p.yearsAtCurrentAddress !== null, "Years at current address is required.")
      const years = p.yearsAtCurrentAddress ?? 0
      if (years < 5) {
        const hist = p.addressHistory ?? []
        req(hist.length > 0, "Since you've been at your current address less than 5 years, at least one previous address is required.")
        hist.forEach((h, idx) => {
          req(!!h.address?.trim(), `Previous address ${idx + 1}: address is required.`)
          req(!!h.fromDate && !!h.toDate, `Previous address ${idx + 1}: from/to dates are required.`)
        })
      }
    }
    if (i === 2) {
      req(!!p.emergencyContact?.name?.trim(), "Emergency contact name is required.")
      req(!!p.emergencyContact?.phone?.trim(), "Emergency contact phone is required.")
      req(!!p.emergencyContact?.relationship?.trim(), "Emergency contact relationship is required.")
    }
    if (i === 3) {
      const hist = p.employmentHistoryDetail ?? []
      req(hist.length > 0, "At least one employment history entry (last 5 years) is required.")
      hist.forEach((h, idx) => {
        req(!!h.companyName?.trim(), `Employment ${idx + 1}: company name is required.`)
        req(!!h.jobTitle?.trim(), `Employment ${idx + 1}: job title is required.`)
        req(!!h.startDate && !!h.endDate, `Employment ${idx + 1}: start and end dates are required.`)
        req(!!h.managerName?.trim(), `Employment ${idx + 1}: manager/supervisor name is required.`)
        req(!!h.managerPhone?.trim() || !!h.managerEmail?.trim(), `Employment ${idx + 1}: a manager phone or email is required for verification.`)
      })
    }
    if (i === 4) {
      req(!!p.visa?.type?.trim(), "Right to work / immigration status is required.")
      const isBritish = /british|irish|uk citizen/i.test(p.visa?.type ?? "")
      if (!isBritish) req(!!p.visa?.expiry, "An expiry date is required for non-British/Irish right to work documents.")
    }
    if (i === 5) {
      req(!!p.sia?.number?.trim(), "SIA licence number is required.")
      req(!!p.sia?.type?.trim(), "SIA licence category is required.")
      req(!!p.sia?.expiry, "SIA licence expiry date is required.")
      if (p.cscs?.number) req(!!p.cscs?.expiry, "CSCS card expiry date is required once a card number is entered.")
    }
    if (i === 6) {
      const refOk = (r: any, n: number) => {
        req(!!r?.name?.trim(), `Reference ${n}: name is required.`)
        req(!!r?.company?.trim(), `Reference ${n}: company is required.`)
        req(!!r?.jobTitle?.trim(), `Reference ${n}: their job title is required.`)
        req(!!r?.phone?.trim(), `Reference ${n}: phone is required.`)
        req(!!r?.email?.trim(), `Reference ${n}: email is required.`)
        req(!!r?.relationship?.trim(), `Reference ${n}: relationship is required.`)
        req(!!r?.permissionToContact, `Reference ${n}: permission to contact must be answered.`)
      }
      refOk(p.references?.ref1, 1)
      refOk(p.references?.ref2, 2)
    }
    if (i === 7) {
      req(!!p.declarations?.dbsConsent, "You must consent to a DBS check to proceed.")
      req(p.hasCriminalHistory !== undefined, "Please declare whether you have any criminal convictions or cautions.")
      if (p.hasCriminalHistory) {
        const hist = p.criminalHistory ?? []
        req(hist.length > 0, "Please provide details of your criminal history.")
        hist.forEach((h, idx) => req(!!h.details?.trim(), `Criminal history ${idx + 1}: details are required.`))
      }
      req(p.hasCautions !== undefined, "Please declare whether you have any cautions or police involvement.")
      if (p.hasCautions) {
        const hist = p.cautionsAndInvestigations ?? []
        req(hist.length > 0, "Please provide details of your cautions/police involvement.")
        hist.forEach((h, idx) => req(!!h.details?.trim(), `Caution/investigation ${idx + 1}: details are required.`))
      }
    }
    if (i === 8) {
      req(!!p.bankDetails?.accountHolderName?.trim(), "Account holder name is required.")
      req(!!p.bankDetails?.bankName?.trim(), "Bank name is required.")
      req(!!p.bankDetails?.sortCode && /^\d{6}$/.test(p.bankDetails.sortCode.replace(/-/g, "")), "A valid 6-digit sort code is required.")
      req(!!p.bankDetails?.accountNumber && /^\d{8}$/.test(p.bankDetails.accountNumber), "A valid 8-digit account number is required.")
    }
    if (i === 9) {
      req(!!p.documents?.passport?.uploaded || !!p.documents?.drivingLicenceDoc?.uploaded, "A photo ID document (passport or driving licence) must be uploaded.")
      req(!!p.documents?.proofOfAddress1?.uploaded, "Proof of address (1) must be uploaded.")
      req(!!p.documents?.proofOfAddress2?.uploaded, "Proof of address (2) must be uploaded — a different document type from Proof of Address 1.")
      req(!!p.documents?.siaPhysical?.uploaded, "A copy of your SIA licence must be uploaded.")
      if (p.cscs?.number) req(!!p.documents?.cscsCard?.uploaded, "A copy of your CSCS card must be uploaded.")
      MANDATORY_TRAINING_KEYS.forEach(key => {
        req(!!p.training?.[key]?.certUploaded, `${TRAINING_CERT_UPLOADS.find(t => t.key === key)?.label ?? key} certificate must be uploaded.`)
      })
      req(!!photo || !!p.id, "A staff ID photo must be uploaded.")
    }
    if (i === 10) {
      const d = p.declarations ?? {}
      req(!!d.rightToWorkConfirmed, "You must confirm your right to work declaration.")
      req(!!d.vettingAuthorization, "You must authorize GuardTec's background screening checks.")
      req(!!d.accuracyDeclared, "You must confirm all information provided is accurate.")
      req(!!d.fraudActAcknowledged, "You must acknowledge the Fraud Act 2006 notice.")
      req(!!d.conductPolicyAccepted, "You must accept the Workplace Conduct Policy.")
      req(!!d.dataProtectionAccepted, "You must accept the Data Protection notice.")
      req(!!d.creditCheckConsent, "You must consent to a credit check to proceed.")
      req(!!d.socialMediaCheckConsent, "You must consent to a social media check to proceed.")
    }
    return errs
  }

  // Navigation is intentionally unrestricted — staff can browse every phase
  // to see what the form will ask before filling anything in. The only hard
  // gate is handleFinalSubmit below: it re-validates everything and jumps
  // back to the first incomplete phase rather than letting a partial form
  // through.
  function goNext() {
    setErrors([])
    setPhaseIndex(i => Math.min(i + 1, LAST_PHASE))
    onAutosave?.()
  }

  function goBack() {
    setErrors([])
    setPhaseIndex(i => Math.max(i - 1, 0))
    onAutosave?.()
  }

  function goToPhase(i: number) {
    setErrors([])
    setPhaseIndex(i)
    onAutosave?.()
  }

  function handleFinalSubmit() {
    for (let i = 0; i < REVIEW_PHASE; i++) {
      const errs = validatePhase(i)
      if (errs.length > 0) {
        setPhaseIndex(i)
        setErrors(errs)
        return
      }
    }
    setErrors([])
    onSubmit()
  }

  const completedCount = Array.from({ length: REVIEW_PHASE }, (_, i) => i).filter(i => validatePhase(i).length === 0).length
  const pct = Math.round((completedCount / REVIEW_PHASE) * 100)

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="surface p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold">{PHASE_TITLES[phaseIndex]}</span>
          <span className="text-muted-foreground">Step {phaseIndex + 1} of {PHASE_TITLES.length}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PHASE_TITLES.map((title, i) => {
            const done = i < REVIEW_PHASE && validatePhase(i).length === 0
            return (
              <button key={title} type="button" onClick={() => goToPhase(i)}
                title={title}
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
                  i === phaseIndex ? "bg-primary text-white"
                  : done ? "bg-success/20 text-success hover:bg-success/30"
                  : "bg-muted hover:bg-muted/70"
                }`}>
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Feel free to look ahead — every step is open to browse. Only the final submission checks everything is complete.
        </p>
      </div>

      <ErrorBanner errors={errors} />
      {submitError && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{submitError}</p>}

      {/* Phase content */}
      {phaseIndex === 0 && <PersonalPhase p={p} set={set} />}
      {phaseIndex === 1 && <AddressPhase p={p} set={set} />}
      {phaseIndex === 2 && <EmergencyPhase p={p} set={set} />}
      {phaseIndex === 3 && <EmploymentPhase p={p} set={set} />}
      {phaseIndex === 4 && <RightToWorkPhase p={p} set={set} />}
      {phaseIndex === 5 && <QualificationsPhase p={p} set={set} />}
      {phaseIndex === 6 && <ReferencesPhase p={p} set={set} />}
      {phaseIndex === 7 && <DbsPhase p={p} set={set} />}
      {phaseIndex === 8 && <BankPhase p={p} set={set} />}
      {phaseIndex === 9 && <DocumentsPhase p={p} set={set} photo={photo} photoPreview={photoPreview} pickPhoto={pickPhoto} />}
      {phaseIndex === 10 && <DeclarationsPhase p={p} set={set} />}
      {phaseIndex === REVIEW_PHASE && <ReviewPhase p={p} goToPhase={goToPhase} />}

      {/* Navigation */}
      <div className="sticky bottom-4 flex items-center justify-between rounded-xl border bg-card/95 backdrop-blur px-4 py-3 shadow-lg">
        <Button type="button" variant="outline" onClick={goBack} disabled={phaseIndex === 0} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {phaseIndex < REVIEW_PHASE ? (
          <Button type="button" onClick={goNext} className="gap-1.5">
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" onClick={handleFinalSubmit} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Submitting…" : "Submit for Review"}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Phase 0: Personal & Tax ──────────────────────────────────────────────────

function PersonalPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  return (
    <Section title="Personal & Tax Details">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Full name"><Input value={p.name} disabled className="opacity-60" /></Field>
        <Field label="Email"><Input value={p.email ?? ""} disabled className="opacity-60" /></Field>
        <Field label="Personal mobile phone *">
          <Input type="tel" value={p.phone ?? ""} onChange={e => set("phone", e.target.value)} />
        </Field>
        <Field label="Date of birth *">
          <Input type="date" value={p.dateOfBirth ?? ""} onChange={e => set("dateOfBirth", e.target.value)} />
        </Field>
        <Field label="Nationality *">
          <Input value={p.nationality ?? ""} onChange={e => set("nationality", e.target.value)} />
        </Field>
        <Field label="Previous names (if any)">
          <Input value={p.previousNames ?? ""} placeholder="Maiden name, name change, etc." onChange={e => set("previousNames", e.target.value)} />
        </Field>
        <Field label="National Insurance number *">
          <Input className="font-mono uppercase" placeholder="AA 12 34 56 A" value={p.ni ?? ""} onChange={e => set("ni", e.target.value)} />
        </Field>
        <Field label="Unique Taxpayer Reference (UTR) *">
          <Input className="font-mono" placeholder="10 digits" maxLength={10} disabled={!!p.utrNotApplicable}
            value={p.uniqueTaxpayerReference ?? ""} onChange={e => set("uniqueTaxpayerReference", e.target.value)} />
          <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={!!p.utrNotApplicable}
              onChange={e => {
                set("utrNotApplicable", e.target.checked)
                if (e.target.checked) set("uniqueTaxpayerReference", "")
              }}
              className="h-3.5 w-3.5 rounded border-border" />
            I don't have a UTR (not registered for Self Assessment)
          </label>
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Name and email are managed by your office — contact them to change these.</p>
    </Section>
  )
}

// ── Phase 1: Address ─────────────────────────────────────────────────────────

function AddressPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  const hist = p.addressHistory ?? []
  const showHistory = (p.yearsAtCurrentAddress ?? 0) < 5

  function addEntry() {
    set("addressHistory", [...hist, { id: genId(), address: "", fromDate: "", toDate: "" }])
  }
  function updateEntry(id: string, patch: Partial<AddressHistoryEntry>) {
    set("addressHistory", hist.map(h => h.id === id ? { ...h, ...patch } : h))
  }
  function removeEntry(id: string) {
    set("addressHistory", hist.filter(h => h.id !== id))
  }

  return (
    <>
      <Section title="Current Address">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Full address *">
            <Input value={p.address ?? ""} placeholder="Street, town, county, postcode" onChange={e => set("address", e.target.value)} />
          </Field>
          <Field label="Years at current address *">
            <Input type="number" min={0} step={0.5} value={p.yearsAtCurrentAddress ?? ""}
              onChange={e => set("yearsAtCurrentAddress", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Field>
        </div>
      </Section>

      {showHistory && (
        <Section title="Address History (Last 5 Years)" badge={<span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">Required</span>}>
          <p className="mb-3 text-xs text-muted-foreground">
            BS 7858 requires all addresses for the last 5 years. List in reverse chronological order.
          </p>
          <div className="space-y-3">
            {hist.map((h, idx) => (
              <div key={h.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Previous address {idx + 1}</span>
                  <button type="button" onClick={() => removeEntry(h.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input placeholder="Full address with postcode" value={h.address} onChange={e => updateEntry(h.id, { address: e.target.value })} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Field label="From"><Input type="date" value={h.fromDate} onChange={e => updateEntry(h.id, { fromDate: e.target.value })} /></Field>
                  <Field label="To"><Input type="date" value={h.toDate} onChange={e => updateEntry(h.id, { toDate: e.target.value })} /></Field>
                  <Field label="Reason for moving"><Input value={h.reasonForMoving ?? ""} onChange={e => updateEntry(h.id, { reasonForMoving: e.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addEntry} className="mt-3 inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
            <Plus className="h-3.5 w-3.5" /> Add previous address
          </button>
        </Section>
      )}
    </>
  )
}

// ── Phase 2: Emergency Contact ───────────────────────────────────────────────

function EmergencyPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  const ec = p.emergencyContact ?? {}
  return (
    <Section title="Emergency Contact">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name *"><Input value={ec.name ?? ""} onChange={e => set("emergencyContact", { ...ec, name: e.target.value })} /></Field>
        <Field label="Relationship *"><Input value={ec.relationship ?? ""} onChange={e => set("emergencyContact", { ...ec, relationship: e.target.value })} /></Field>
        <Field label="Phone *"><Input type="tel" value={ec.phone ?? ""} onChange={e => set("emergencyContact", { ...ec, phone: e.target.value })} /></Field>
        <Field label="Address"><Input value={ec.address ?? ""} onChange={e => set("emergencyContact", { ...ec, address: e.target.value })} /></Field>
      </div>
    </Section>
  )
}

// ── Phase 3: Employment History ──────────────────────────────────────────────

function EmploymentPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  const hist = p.employmentHistoryDetail ?? []
  function addEntry() {
    set("employmentHistoryDetail", [...hist, {
      id: genId(), companyName: "", jobTitle: "", startDate: "", endDate: "",
      managerName: "", managerJobTitle: "", managerPhone: "", managerEmail: "",
    }])
  }
  function updateEntry(id: string, patch: Partial<EmploymentHistoryEntry>) {
    set("employmentHistoryDetail", hist.map(h => h.id === id ? { ...h, ...patch } : h))
  }
  function removeEntry(id: string) {
    set("employmentHistoryDetail", hist.filter(h => h.id !== id))
  }

  return (
    <Section title="Employment History (Last 5 Years)">
      <p className="mb-3 text-xs text-muted-foreground">
        List all employment in the last 5 years, most recent first, with a manager or supervisor who can verify each role.
      </p>
      <div className="space-y-3">
        {hist.map((h, idx) => (
          <div key={h.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Employer {idx + 1}</span>
              <button type="button" onClick={() => removeEntry(h.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Company name"><Input value={h.companyName} onChange={e => updateEntry(h.id, { companyName: e.target.value })} /></Field>
              <Field label="Job title"><Input value={h.jobTitle} onChange={e => updateEntry(h.id, { jobTitle: e.target.value })} /></Field>
              <Field label="Start date"><Input type="date" value={h.startDate} onChange={e => updateEntry(h.id, { startDate: e.target.value })} /></Field>
              <Field label="End date"><Input type="date" value={h.endDate} onChange={e => updateEntry(h.id, { endDate: e.target.value })} /></Field>
              <Field label="Reason for leaving"><Input value={h.reasonForLeaving ?? ""} onChange={e => updateEntry(h.id, { reasonForLeaving: e.target.value })} /></Field>
              <Field label="Permission to contact">
                <select value={h.permissionToContact ?? ""} onChange={e => updateEntry(h.id, { permissionToContact: e.target.value as any })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="phone-only">Phone only</option>
                  <option value="email-only">Email only</option>
                </select>
              </Field>
            </div>
            <p className="pt-1 text-xs font-semibold text-muted-foreground">Manager/supervisor who can verify this role</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Manager name"><Input value={h.managerName} onChange={e => updateEntry(h.id, { managerName: e.target.value })} /></Field>
              <Field label="Manager job title"><Input value={h.managerJobTitle} onChange={e => updateEntry(h.id, { managerJobTitle: e.target.value })} /></Field>
              <Field label="Manager phone"><Input type="tel" value={h.managerPhone} onChange={e => updateEntry(h.id, { managerPhone: e.target.value })} /></Field>
              <Field label="Manager email"><Input type="email" value={h.managerEmail} onChange={e => updateEntry(h.id, { managerEmail: e.target.value })} /></Field>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={addEntry} className="mt-3 inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
        <Plus className="h-3.5 w-3.5" /> Add employer
      </button>
    </Section>
  )
}

// ── Phase 4: Right to Work ───────────────────────────────────────────────────

function RightToWorkPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  return (
    <Section title="Right to Work / Immigration Status">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Status / document type *">
          <Input value={p.visa?.type ?? ""} placeholder="e.g. British citizen, BRP, Skilled Worker visa"
            onChange={e => set("visa", { ...p.visa, type: e.target.value })} />
        </Field>
        <Field label="Expiry date (if applicable)">
          <Input type="date" value={p.visa?.expiry ?? ""} onChange={e => set("visa", { ...p.visa, expiry: e.target.value })} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        British/Irish citizens do not need an expiry date. All other statuses must include one.
      </p>
    </Section>
  )
}

// ── Phase 5: SIA / CSCS / Qualifications ─────────────────────────────────────

function QualificationsPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  const quals = p.otherQualifications ?? []
  function addQual() {
    set("otherQualifications", [...quals, { id: genId(), qualification: "", awardingBody: "", dateAchieved: "" }])
  }
  function updateQual(id: string, patch: Partial<OtherQualification>) {
    set("otherQualifications", quals.map(q => q.id === id ? { ...q, ...patch } : q))
  }
  function removeQual(id: string) {
    set("otherQualifications", quals.filter(q => q.id !== id))
  }

  return (
    <>
      <Section title="SIA Licence">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Licence number *"><Input className="font-mono" value={p.sia?.number ?? ""} onChange={e => set("sia", { ...p.sia, number: e.target.value })} /></Field>
          <Field label="Category *"><Input value={p.sia?.type ?? ""} placeholder="Door Supervisor / Security Guard / CCTV" onChange={e => set("sia", { ...p.sia, type: e.target.value })} /></Field>
          <Field label="Expiry date *"><Input type="date" value={p.sia?.expiry ?? ""} onChange={e => set("sia", { ...p.sia, expiry: e.target.value })} /></Field>
        </div>
      </Section>
      <Section title="CSCS Card (if applicable)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Card number"><Input className="font-mono" value={p.cscs?.number ?? ""} onChange={e => set("cscs", { ...p.cscs, number: e.target.value })} /></Field>
          <Field label="Card type"><Input value={p.cscs?.cardType ?? ""} placeholder="Blue, Gold, White…" onChange={e => set("cscs", { ...p.cscs, cardType: e.target.value })} /></Field>
          <Field label="Expiry date"><Input type="date" value={p.cscs?.expiry ?? ""} onChange={e => set("cscs", { ...p.cscs, expiry: e.target.value })} /></Field>
        </div>
      </Section>
      <Section title="Other Qualifications">
        <div className="space-y-2">
          {quals.map((q) => (
            <div key={q.id} className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-4">
              <Input placeholder="Qualification" value={q.qualification} onChange={e => updateQual(q.id, { qualification: e.target.value })} />
              <Input placeholder="Awarding body" value={q.awardingBody} onChange={e => updateQual(q.id, { awardingBody: e.target.value })} />
              <Input type="date" value={q.dateAchieved} onChange={e => updateQual(q.id, { dateAchieved: e.target.value })} />
              <div className="flex items-center gap-2">
                <Input placeholder="Ref number" value={q.referenceNumber ?? ""} onChange={e => updateQual(q.id, { referenceNumber: e.target.value })} />
                <button type="button" onClick={() => removeQual(q.id)} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={addQual} className="mt-3 inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
          <Plus className="h-3.5 w-3.5" /> Add qualification
        </button>
      </Section>
    </>
  )
}

// ── Phase 6: References ──────────────────────────────────────────────────────

function ReferencesPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  return (
    <Section title="Professional References">
      <p className="mb-3 text-xs text-muted-foreground">Two professional references are required — not family members.</p>
      {(["ref1", "ref2"] as const).map((key, i) => {
        const r = p.references?.[key] ?? {}
        const upd = (patch: any) => set("references", { ...p.references, [key]: { ...r, ...patch } })
        return (
          <div key={key} className={i > 0 ? "mt-4 border-t pt-4" : ""}>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Reference {i + 1}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name *"><Input value={r.name ?? ""} onChange={e => upd({ name: e.target.value })} /></Field>
              <Field label="Job title *"><Input value={r.jobTitle ?? ""} onChange={e => upd({ jobTitle: e.target.value })} /></Field>
              <Field label="Company *"><Input value={r.company ?? ""} onChange={e => upd({ company: e.target.value })} /></Field>
              <Field label="Company address"><Input value={r.companyAddress ?? ""} onChange={e => upd({ companyAddress: e.target.value })} /></Field>
              <Field label="Email *"><Input type="email" value={r.email ?? ""} onChange={e => upd({ email: e.target.value })} /></Field>
              <Field label="Phone *"><Input type="tel" value={r.phone ?? ""} onChange={e => upd({ phone: e.target.value })} /></Field>
              <Field label="Relationship *"><Input placeholder="Line manager, senior colleague…" value={r.relationship ?? ""} onChange={e => upd({ relationship: e.target.value })} /></Field>
              <Field label="Permission to contact *">
                <select value={r.permissionToContact ?? ""} onChange={e => upd({ permissionToContact: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <option value="">Select…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="phone-only">Phone only</option>
                  <option value="email-only">Email only</option>
                </select>
              </Field>
            </div>
          </div>
        )
      })}
    </Section>
  )
}

// ── Phase 7: DBS & Criminal History ──────────────────────────────────────────

function DbsPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  const crimHist = p.criminalHistory ?? []
  const cautions = p.cautionsAndInvestigations ?? []
  const decl = p.declarations ?? {}

  return (
    <>
      <Section title="DBS Consent">
        <CheckRow checked={!!decl.dbsConsent} onChange={v => set("declarations", { ...decl, dbsConsent: v })}>
          I consent to GuardTec Security &amp; Patrol UK Ltd conducting a Disclosure and Barring Service (DBS) check as required for security industry employment.
        </CheckRow>
      </Section>

      <Section title="Criminal History Declaration">
        <p className="mb-2 text-sm">Do you have any criminal convictions, cautions, or pending investigations?</p>
        <YesNo value={p.hasCriminalHistory} onChange={v => set("hasCriminalHistory", v)} />
        {p.hasCriminalHistory && (
          <div className="mt-3 space-y-2">
            {crimHist.map((h, idx) => (
              <div key={h.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Entry {idx + 1}</span>
                  <button type="button" onClick={() => set("criminalHistory", crimHist.filter(x => x.id !== h.id))} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Input placeholder="Offense type" value={h.offenseType} onChange={e => set("criminalHistory", crimHist.map(x => x.id === h.id ? { ...x, offenseType: e.target.value } : x))} />
                  <Input type="date" value={h.date} onChange={e => set("criminalHistory", crimHist.map(x => x.id === h.id ? { ...x, date: e.target.value } : x))} />
                  <Input placeholder="Sentence" value={h.sentence ?? ""} onChange={e => set("criminalHistory", crimHist.map(x => x.id === h.id ? { ...x, sentence: e.target.value } : x))} />
                </div>
                <TextArea value={h.details} placeholder="Full details" onChange={v => set("criminalHistory", crimHist.map(x => x.id === h.id ? { ...x, details: v } : x))} />
              </div>
            ))}
            <button type="button" onClick={() => set("criminalHistory", [...crimHist, { id: genId(), offenseType: "", date: "", details: "" }])}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add entry
            </button>
          </div>
        )}
      </Section>

      <Section title="Cautions & Police Involvement">
        <p className="mb-2 text-sm">Have you had any cautions, reprimands, or police investigations (even if not charged)?</p>
        <YesNo value={p.hasCautions} onChange={v => set("hasCautions", v)} />
        {p.hasCautions && (
          <div className="mt-3 space-y-2">
            {cautions.map((h, idx) => (
              <div key={h.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Entry {idx + 1}</span>
                  <button type="button" onClick={() => set("cautionsAndInvestigations", cautions.filter(x => x.id !== h.id))} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select value={h.type} onChange={e => set("cautionsAndInvestigations", cautions.map(x => x.id === h.id ? { ...x, type: e.target.value as any } : x))}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none">
                    <option value="caution">Caution</option>
                    <option value="reprimand">Reprimand</option>
                    <option value="investigation">Investigation</option>
                  </select>
                  <Input type="date" value={h.date} onChange={e => set("cautionsAndInvestigations", cautions.map(x => x.id === h.id ? { ...x, date: e.target.value } : x))} />
                  <Input placeholder="Outcome" value={h.outcome ?? ""} onChange={e => set("cautionsAndInvestigations", cautions.map(x => x.id === h.id ? { ...x, outcome: e.target.value } : x))} />
                </div>
                <TextArea value={h.details} placeholder="Full details" onChange={v => set("cautionsAndInvestigations", cautions.map(x => x.id === h.id ? { ...x, details: v } : x))} />
              </div>
            ))}
            <button type="button" onClick={() => set("cautionsAndInvestigations", [...cautions, { id: genId(), type: "caution", date: "", details: "" }])}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add entry
            </button>
          </div>
        )}
      </Section>
    </>
  )
}

// ── Phase 8: Bank Details ────────────────────────────────────────────────────

function BankPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  const b = p.bankDetails ?? {}
  return (
    <Section title="Bank Details">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Account holder name *"><Input value={b.accountHolderName ?? ""} onChange={e => set("bankDetails", { ...b, accountHolderName: e.target.value })} /></Field>
        <Field label="Bank name *"><Input value={b.bankName ?? ""} onChange={e => set("bankDetails", { ...b, bankName: e.target.value })} /></Field>
        <Field label="Sort code *"><Input className="font-mono" inputMode="numeric" maxLength={8} placeholder="00-00-00" value={b.sortCode ?? ""} onChange={e => set("bankDetails", { ...b, sortCode: e.target.value })} /></Field>
        <Field label="Account number *"><Input className="font-mono" inputMode="numeric" maxLength={8} placeholder="12345678" value={b.accountNumber ?? ""} onChange={e => set("bankDetails", { ...b, accountNumber: e.target.value })} /></Field>
        <Field label="IBAN (EU accounts only)"><Input className="font-mono" value={b.iban ?? ""} onChange={e => set("bankDetails", { ...b, iban: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Used by Accounts to pay your wages — double-check before submitting.</p>
    </Section>
  )
}

// ── Phase 9: Documents & Training ────────────────────────────────────────────

function DocumentsPhase({ p, set, photo, photoPreview, pickPhoto }: {
  p: WizardProfile; set: WizardProps["set"]; photo: File | null; photoPreview: string | null; pickPhoto: (f: File | null) => void
}) {
  // DocUploadRow/TrainingCertRow track "uploaded" in their own local state,
  // seeded once from these props — but this whole phase unmounts/remounts
  // every time phaseIndex navigates away from and back to step 9 (it's a
  // conditional `{phaseIndex === 9 && <DocumentsPhase .../>}`, not a
  // display:none toggle). Without mirroring a successful upload back into
  // p.documents/p.training here, a remount re-seeds from the ORIGINAL
  // (pre-upload) prop value, so already-uploaded docs silently show as
  // missing again and block final submission on a false "must upload" error
  // — confirmed by testing: files were genuinely saved server-side the whole
  // time, only this component's local state had gone stale.
  function markDocUploaded(key: string) {
    set("documents", { ...p.documents, [key]: { ...p.documents?.[key], uploaded: true, date: new Date().toISOString().slice(0, 10) } })
  }
  function markCertUploaded(key: string) {
    set("training", { ...p.training, [key]: { ...p.training?.[key], certUploaded: true } })
  }
  return (
    <>
      <Section title="Staff Photo">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed bg-muted/40">
            {photoPreview
              ? <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
              : p.id
                ? <img src={`/api/staff/${p.id}/photo`} alt={p.name} className="h-full w-full object-cover" onError={e => { e.currentTarget.style.display = "none" }} />
                : <ImageOff className="h-6 w-6 text-muted-foreground/40" />}
          </div>
          <div className="flex-1">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
              <Camera className="h-3.5 w-3.5" />
              {photo ? "Change photo" : "Upload new photo"}
              <input type="file" accept="image/*" className="hidden" onChange={e => pickPhoto(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
      </Section>

      <Section title="Identity & Compliance Documents">
        <div className="space-y-3">
          {DOC_UPLOADS.map(doc => (
            <DocUploadRow key={doc.key} label={doc.label} hint={doc.hint} staffId={p.id} docKey={doc.key} initialUploaded={!!p.documents?.[doc.key]?.uploaded}
              onUploaded={() => markDocUploaded(doc.key)} />
          ))}
        </div>
      </Section>

      <Section title="Training Certificates">
        <p className="mb-3 text-xs text-muted-foreground">
          You can add further certificates for the same course at any time, even after submitting — this section never locks.
        </p>
        <div className="space-y-3">
          {TRAINING_CERT_UPLOADS.map(course => (
            <TrainingCertRow key={course.key} label={course.label} staffId={p.id} courseKey={course.key} item={p.training?.[course.key]}
              onUploaded={() => markCertUploaded(course.key)} />
          ))}
        </div>
      </Section>

      <Section title="Documents From Your Office">
        <p className="mb-3 text-xs text-muted-foreground">
          Your office uploads these for you — you can view and download them, but not edit or delete them.
          If a document needs your signature, download it, sign it, then send the signed copy back as an attachment
          in Messages — your manager will upload the signed version here once received.
        </p>
        <div className="space-y-3">
          {MANAGER_UPLOADED_DOCS.map(doc => (
            <ManagerDocRow key={doc.key} label={doc.label} staffId={p.id} docKey={doc.key}
              uploaded={!!p.documents?.[doc.key]?.uploaded} date={p.documents?.[doc.key]?.date} />
          ))}
          {/* Only rendered when the entry is actually present — the backend
              already omits it entirely from this profile fetch unless a
              manager has explicitly made it visible, so absence here means
              nothing to show, not "not yet provided" (see ConfidentialDocRow). */}
          {CONFIDENTIAL_STAFF_DOCS.filter(doc => p.documents?.[doc.key]?.uploaded).map(doc => (
            <ConfidentialDocRow key={doc.key} label={doc.label} staffId={p.id} docKey={doc.key} date={p.documents?.[doc.key]?.date} />
          ))}
        </div>
      </Section>
    </>
  )
}

// ── Phase 10: Declarations ───────────────────────────────────────────────────

function DeclarationsPhase({ p, set }: { p: WizardProfile; set: WizardProps["set"] }) {
  const d = p.declarations ?? {}
  const upd = (patch: Partial<OnboardingDeclarations>) => set("declarations", { ...d, ...patch })
  return (
    <Section title="Declarations">
      <div className="space-y-2.5">
        <CheckRow checked={!!d.rightToWorkConfirmed} onChange={v => upd({ rightToWorkConfirmed: v })}>
          I confirm I have the legal right to work in the United Kingdom without restrictions.
        </CheckRow>
        <CheckRow checked={!!d.vettingAuthorization} onChange={v => upd({ vettingAuthorization: v })}>
          I authorize GuardTec to contact previous employers, references, and relevant bodies to verify the information provided in this form (BS 7858:2019 vetting).
        </CheckRow>
        <CheckRow checked={!!d.accuracyDeclared} onChange={v => upd({ accuracyDeclared: v })}>
          All information provided in this form is complete, accurate, and truthful, and I have not knowingly omitted anything relevant to my suitability for employment.
        </CheckRow>
        <CheckRow checked={!!d.fraudActAcknowledged} onChange={v => upd({ fraudActAcknowledged: v })}>
          I understand that providing false or misleading information is a criminal offence under the Fraud Act 2006, punishable by up to 10 years imprisonment and unlimited fines.
        </CheckRow>
        <CheckRow checked={!!d.conductPolicyAccepted} onChange={v => upd({ conductPolicyAccepted: v })}>
          I have read and accept GuardTec's Zero Tolerance Workplace Conduct Policy, and understand violations may result in immediate dismissal.
        </CheckRow>
        <CheckRow checked={!!d.dataProtectionAccepted} onChange={v => upd({ dataProtectionAccepted: v })}>
          I acknowledge GuardTec processes my personal data under UK GDPR and the Data Protection Act 2018, for employment vetting, payroll, and legal compliance purposes.
        </CheckRow>
        <CheckRow checked={!!d.creditCheckConsent} onChange={v => upd({ creditCheckConsent: v })}>
          I consent to GuardTec conducting a credit check as part of pre-employment screening.
        </CheckRow>
        <CheckRow checked={!!d.socialMediaCheckConsent} onChange={v => upd({ socialMediaCheckConsent: v })}>
          I consent to GuardTec reviewing my publicly available social media profiles as part of pre-employment screening.
        </CheckRow>
      </div>
    </Section>
  )
}

// ── Phase 11: Review ─────────────────────────────────────────────────────────

function ReviewRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="truncate text-sm">{value}</p>
    </div>
  )
}

function ReviewSection({ title, phaseIndex, goToPhase, children }: { title: string; phaseIndex: number; goToPhase: (i: number) => void; children: React.ReactNode }) {
  return (
    <Section title={title} badge={
      <button type="button" onClick={() => goToPhase(phaseIndex)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <Pencil className="h-3 w-3" /> Edit
      </button>
    }>
      {children}
    </Section>
  )
}

function ReviewPhase({ p, goToPhase }: { p: WizardProfile; goToPhase: (i: number) => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <p className="font-medium">Please review everything below before submitting.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Once submitted, these sections will lock and cannot be edited directly — only your manager can unlock a section if a correction is needed. Training certificates remain unlocked and can be added at any time.
        </p>
      </div>

      <ReviewSection title="Personal & Tax Details" phaseIndex={0} goToPhase={goToPhase}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <ReviewRow label="Phone" value={p.phone} />
          <ReviewRow label="Date of birth" value={p.dateOfBirth} />
          <ReviewRow label="Nationality" value={p.nationality} />
          <ReviewRow label="NI number" value={p.ni} />
          <ReviewRow label="UTR" value={p.utrNotApplicable ? "Not applicable" : p.uniqueTaxpayerReference} />
          <ReviewRow label="Previous names" value={p.previousNames} />
        </div>
      </ReviewSection>

      <ReviewSection title="Address" phaseIndex={1} goToPhase={goToPhase}>
        <ReviewRow label="Current address" value={p.address} />
        <ReviewRow label="Years at address" value={p.yearsAtCurrentAddress} />
        {(p.addressHistory ?? []).length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{p.addressHistory!.length} previous address(es) on file.</p>
        )}
      </ReviewSection>

      <ReviewSection title="Emergency Contact" phaseIndex={2} goToPhase={goToPhase}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <ReviewRow label="Name" value={p.emergencyContact?.name} />
          <ReviewRow label="Relationship" value={p.emergencyContact?.relationship} />
          <ReviewRow label="Phone" value={p.emergencyContact?.phone} />
        </div>
      </ReviewSection>

      <ReviewSection title="Employment History" phaseIndex={3} goToPhase={goToPhase}>
        <p className="text-sm">{(p.employmentHistoryDetail ?? []).length} employer(s) listed.</p>
      </ReviewSection>

      <ReviewSection title="Right to Work" phaseIndex={4} goToPhase={goToPhase}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <ReviewRow label="Status" value={p.visa?.type} />
          <ReviewRow label="Expiry" value={p.visa?.expiry} />
        </div>
      </ReviewSection>

      <ReviewSection title="SIA, CSCS & Qualifications" phaseIndex={5} goToPhase={goToPhase}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <ReviewRow label="SIA number" value={p.sia?.number} />
          <ReviewRow label="SIA category" value={p.sia?.type} />
          <ReviewRow label="SIA expiry" value={p.sia?.expiry} />
          <ReviewRow label="CSCS number" value={p.cscs?.number} />
          <ReviewRow label="CSCS expiry" value={p.cscs?.expiry} />
        </div>
        {(p.otherQualifications ?? []).length > 0 && <p className="mt-2 text-xs text-muted-foreground">{p.otherQualifications!.length} other qualification(s) on file.</p>}
      </ReviewSection>

      <ReviewSection title="References" phaseIndex={6} goToPhase={goToPhase}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><ReviewRow label="Reference 1" value={p.references?.ref1?.name} /><ReviewRow label="Company" value={p.references?.ref1?.company} /></div>
          <div><ReviewRow label="Reference 2" value={p.references?.ref2?.name} /><ReviewRow label="Company" value={p.references?.ref2?.company} /></div>
        </div>
      </ReviewSection>

      <ReviewSection title="DBS & Criminal History" phaseIndex={7} goToPhase={goToPhase}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <ReviewRow label="DBS consent" value={p.declarations?.dbsConsent ? "Given" : "Not given"} />
          <ReviewRow label="Credit check consent" value={p.declarations?.creditCheckConsent ? "Given" : "Not given"} />
          <ReviewRow label="Social media check consent" value={p.declarations?.socialMediaCheckConsent ? "Given" : "Not given"} />
          <ReviewRow label="Criminal history declared" value={p.hasCriminalHistory === undefined ? undefined : p.hasCriminalHistory ? "Yes — see details" : "None declared"} />
          <ReviewRow label="Cautions declared" value={p.hasCautions === undefined ? undefined : p.hasCautions ? "Yes — see details" : "None declared"} />
        </div>
      </ReviewSection>

      <ReviewSection title="Bank Details" phaseIndex={8} goToPhase={goToPhase}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <ReviewRow label="Account holder" value={p.bankDetails?.accountHolderName} />
          <ReviewRow label="Bank" value={p.bankDetails?.bankName} />
          <ReviewRow label="Account number" value={p.bankDetails?.accountNumber ? `•••• ${p.bankDetails.accountNumber.slice(-4)}` : undefined} />
        </div>
      </ReviewSection>

      <ReviewSection title="Documents & Certificates" phaseIndex={9} goToPhase={goToPhase}>
        <p className="text-sm text-muted-foreground">Uploaded documents and training certificates are on file — see the Documents step to review each one.</p>
      </ReviewSection>

      <ReviewSection title="Declarations" phaseIndex={10} goToPhase={goToPhase}>
        <p className="text-sm text-muted-foreground">All required legal declarations have been accepted.</p>
      </ReviewSection>
    </div>
  )
}
