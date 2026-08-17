import { useState } from "react"
import { toast } from "sonner"
import { Loader2, X, Camera, ImageOff, Briefcase, ShieldCheck, CalendarOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Section, Field } from "@/components/profile/ProfileShared"
import { DocumentUploadRow } from "@/components/agency/DocumentUploadRow"
import { UnavailabilityCalendar } from "@/components/agency/UnavailabilityCalendar"
import { ComplianceBadge } from "@/components/agency/ComplianceBadge"
import { api, ApiError } from "@/lib/api"

// Real Postgres row shape for agency_staff, as actually returned by server.js
// (SELECT * passed straight through, plus a computed compliance_status) — NOT
// the camelCased shape sketched in types/agency.ts's AgencyStaffMember. That
// file describes an aspirational camelCase API; the real, shipped endpoints
// (GUARDTEC backend stage) read/write snake_case bodies and rows directly
// (job_role, custom_role, badge_type, dbs_expiry, compliance_status, ...).
// Defined locally here — same convention StaffPage.tsx uses for its own
// page-local interfaces (Site, ExStaffMember) rather than pulling from a
// shared types file that doesn't match the wire format.
export interface AgencyStaffRecord {
  id: string
  agency_id: string
  name: string
  email?: string
  phone?: string
  nationality?: string
  job_role: string
  custom_role?: string
  badge_type?: string
  dbs_expiry?: string
  sia_cert_uploaded: boolean
  sia_cert_upload_date?: string
  cscs_cert_uploaded: boolean
  cscs_cert_upload_date?: string
  rtw_cert_uploaded: boolean
  rtw_cert_upload_date?: string
  dog_handler_cert_uploaded: boolean
  dog_handler_cert_upload_date?: string
  training_cert_uploaded: boolean
  training_cert_upload_date?: string
  status: "active" | "archived"
  archived_at?: string
  created_at?: string
  updated_at?: string
  compliance_status?: "COMPLIANT" | "ACTION_NEEDED" | "EXPIRED" | "INCOMPLETE"
}

// job_role VARCHAR(100) NOT NULL -- "Security Officer, Door Supervisor, Dog
// Handler, Other" per the plan; custom_role only fills in when job_role is
// literally 'Other'. Dropdown offers exactly these four.
const KNOWN_JOB_ROLES = ["Security Officer", "Door Supervisor", "Dog Handler"] as const
const BADGE_TYPES = ["SIA", "CSCS", "Other"] as const

// No <Select> component exists in components/ui — styled to match Input's
// exact classes so a plain <select> sits visually identical in this form.
const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none " +
  "transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

interface AgencyStaffFormProps {
  agencyId: string
  // Present = editing an existing guard; absent = registering a new one.
  initialStaff?: AgencyStaffRecord
  onSaved: (staff: AgencyStaffRecord) => void
  onCancel: () => void
}

export default function AgencyStaffForm({ agencyId, initialStaff, onSaved, onCancel }: AgencyStaffFormProps) {
  const editing = !!initialStaff

  // CSV import and hand-typed legacy data both store job_role as free text
  // with no enum check server-side (see normalizeCsvRow / the POST route) —
  // so an existing record's job_role might not be one of the three known
  // options. Fall back to "Other" with the raw text preserved so nothing is
  // silently dropped when re-saving.
  const jobRoleKnown = initialStaff ? (KNOWN_JOB_ROLES as readonly string[]).includes(initialStaff.job_role) : false
  const [jobRole, setJobRole] = useState(initialStaff ? (jobRoleKnown ? initialStaff.job_role : "Other") : "")
  const [customRole, setCustomRole] = useState(
    initialStaff ? (jobRoleKnown ? "" : (initialStaff.custom_role || initialStaff.job_role || "")) : ""
  )

  const [name, setName] = useState(initialStaff?.name ?? "")
  const [email, setEmail] = useState(initialStaff?.email ?? "")
  const [phone, setPhone] = useState(initialStaff?.phone ?? "")
  const [nationality, setNationality] = useState(initialStaff?.nationality ?? "")
  const [badgeType, setBadgeType] = useState(initialStaff?.badge_type ?? "")
  const [dbsExpiry, setDbsExpiry] = useState(initialStaff?.dbs_expiry?.slice(0, 10) ?? "")

  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBroken, setPhotoBroken] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function pickPhoto(file: File | null) {
    setPhoto(file)
    setPhotoBroken(false)
    if (!file) { setPhotoPreview(null); return }
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    setError("")
    const trimmedName = name.trim()
    if (!trimmedName) { setError("Guard name is required."); return }
    if (!jobRole) { setError("Job role is required."); return }
    if (jobRole === "Other" && !customRole.trim()) { setError("Please describe the role."); return }

    setSaving(true)
    try {
      const body = {
        name: trimmedName,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        nationality: nationality.trim() || undefined,
        job_role: jobRole,
        custom_role: jobRole === "Other" ? customRole.trim() : undefined,
        badge_type: badgeType || undefined,
        dbs_expiry: dbsExpiry || undefined,
      }
      const res = editing
        ? await api.patch<{ ok: boolean; staff: AgencyStaffRecord }>(
            `/api/agencies/${agencyId}/staff/${initialStaff!.id}`, body)
        : await api.post<{ ok: boolean; staff: AgencyStaffRecord }>(
            `/api/agencies/${agencyId}/staff`, body)

      let staff = res.staff

      if (photo) {
        try {
          await api.post(`/api/agencies/${agencyId}/staff/${staff.id}/photo`, photo)
        } catch {
          toast.error("Guard saved, but the photo failed to upload — try again from Edit.")
        }
      }

      toast.success(editing ? "Guard updated" : "Guard added")
      onSaved(staff)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onCancel} />
      <div className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{editing ? "Edit Cover Guard" : "Add Cover Guard"}</h2>
              {editing && initialStaff?.compliance_status && <ComplianceBadge status={initialStaff.compliance_status} />}
            </div>
            <p className="text-xs text-muted-foreground">
              {editing ? "Update this guard's details, certificates and availability" : "Register a new cover guard for this agency"}
            </p>
          </div>
          <button onClick={onCancel} className="rounded-md p-1.5 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Section title="Guard Details" icon={<Briefcase className="h-3.5 w-3.5" />}>
            <div className="space-y-3">
              <Field label="Full name *">
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Michael Osei" />
              </Field>

              <Field label="Job role *">
                <select className={selectCls} value={jobRole} onChange={e => setJobRole(e.target.value)}>
                  <option value="">— Select role —</option>
                  <option value="Security Officer">Security Officer</option>
                  <option value="Door Supervisor">Door Supervisor</option>
                  <option value="Dog Handler">Dog Handler</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              {jobRole === "Other" && (
                <Field label="Describe the role *">
                  <Input value={customRole} onChange={e => setCustomRole(e.target.value)} placeholder="e.g. Steward" />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Badge type">
                  <select className={selectCls} value={badgeType} onChange={e => setBadgeType(e.target.value)}>
                    <option value="">— None —</option>
                    {BADGE_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </Field>
                <Field label="DBS expiry">
                  <Input type="date" value={dbsExpiry} onChange={e => setDbsExpiry(e.target.value)} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Email">
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
                </Field>
                <Field label="Phone">
                  <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 000000" />
                </Field>
              </div>

              <Field label="Nationality">
                <Input value={nationality} onChange={e => setNationality(e.target.value)} placeholder="e.g. British" />
              </Field>
            </div>
          </Section>

          <Section title="Photo" icon={<Camera className="h-3.5 w-3.5" />}>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed bg-muted/40">
                {photoPreview
                  ? <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                  : editing && !photoBroken
                    ? <img src={`/api/agencies/${agencyId}/staff/${initialStaff!.id}/photo`} alt={name}
                        className="h-full w-full object-cover" onError={() => setPhotoBroken(true)} />
                    : <ImageOff className="h-6 w-6 text-muted-foreground/40" />}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                <Camera className="h-3.5 w-3.5" />
                {photo ? "Change photo" : "Upload photo"}
                <input type="file" accept="image/*" className="hidden" onChange={e => pickPhoto(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </Section>

          {editing ? (
            <>
              <Section title="Certification Documents" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                <div className="space-y-3">
                  <DocumentUploadRow label="Right to Work" hint="Passport, visa or share code confirmation"
                    agencyId={agencyId} staffId={initialStaff!.id} docType="rtw_cert"
                    initialUploaded={initialStaff!.rtw_cert_uploaded} initialDate={initialStaff!.rtw_cert_upload_date} />
                  {badgeType === "SIA" && (
                    <DocumentUploadRow label="SIA Licence" hint="Front of the SIA licence card"
                      agencyId={agencyId} staffId={initialStaff!.id} docType="sia_cert"
                      initialUploaded={initialStaff!.sia_cert_uploaded} initialDate={initialStaff!.sia_cert_upload_date} />
                  )}
                  {badgeType === "CSCS" && (
                    <DocumentUploadRow label="CSCS Card" hint="Front of the CSCS card"
                      agencyId={agencyId} staffId={initialStaff!.id} docType="cscs_cert"
                      initialUploaded={initialStaff!.cscs_cert_uploaded} initialDate={initialStaff!.cscs_cert_upload_date} />
                  )}
                  {jobRole === "Dog Handler" && (
                    <DocumentUploadRow label="Dog Handler Certificate" hint="Dog handling qualification"
                      agencyId={agencyId} staffId={initialStaff!.id} docType="dog_handler_cert"
                      initialUploaded={initialStaff!.dog_handler_cert_uploaded} initialDate={initialStaff!.dog_handler_cert_upload_date} />
                  )}
                  <DocumentUploadRow label="Training Certificate" hint="BS7858 / general training evidence"
                    agencyId={agencyId} staffId={initialStaff!.id} docType="training_cert"
                    initialUploaded={initialStaff!.training_cert_uploaded} initialDate={initialStaff!.training_cert_upload_date} />
                </div>
              </Section>

              <Section title="Unavailability" icon={<CalendarOff className="h-3.5 w-3.5" />}>
                <UnavailabilityCalendar agencyId={agencyId} staffId={initialStaff!.id} />
              </Section>
            </>
          ) : (
            <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
              Certificates and unavailable dates can be added once this guard is registered — reopen them from Edit.
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t px-6 py-4">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={saving}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : editing ? "Save changes" : "Add guard"}
          </Button>
        </div>
      </div>
    </div>
  )
}
