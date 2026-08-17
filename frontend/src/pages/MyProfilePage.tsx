import { useEffect, useState, useRef } from "react"
import { toast } from "sonner"
import { discTypeLabels, discTypeCls } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
import {
  ShieldCheck, AlertTriangle, Clock,
  Loader2, User as UserIcon, Upload, BadgeAlert, Flag, EyeOff, Eye,
  Paperclip, X, FileVideo, FileText, Image as ImageIcon,
  MessageSquare, Package, Send, Pencil, Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import OnboardingWizard from "@/components/onboarding/OnboardingWizard"
import { Section, Field } from "@/components/profile/ProfileShared"
import type {
  TrainingRecord, BankDetails, ReferenceDetail,
  AddressHistoryEntry, EmploymentHistoryEntry, CriminalHistoryEntry,
  CautionEntry, OtherQualification, OnboardingDeclarations, DriverLicenceInfo,
} from "@/types/staff"
import { parseRoles } from "@/components/ui/role-picker"

const LICENCE_CATS = ["B", "B+E", "C1", "C1+E", "C", "C+E", "D1", "D1+E", "D", "AM"]

interface EmergencyContact { name?: string; phone?: string; relationship?: string; address?: string }
type Ref = ReferenceDetail
interface DiscRecord { id: string; incident_date: string; type: string; description: string; action_taken?: string }
interface IncidentReport { id: string; report_date: string; incident_type: string; status: string; description: string; resolution_notes?: string; attachment_count?: number }
interface Profile {
  id: string
  name: string
  jobRole?: string
  email?: string
  phone?: string
  address?: string
  emergencyContact?: EmergencyContact
  bankDetails?: BankDetails
  driverLicence?: DriverLicenceInfo
  sia?:  { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string; cardType?: string }
  visa?: { type?: string; expiry?: string }
  references?: { ref1?: Ref; ref2?: Ref }
  pending_submission?: { submitted_at?: string; photo_pending?: boolean }
  rejection_reason?: string
  documents?: Record<string, { uploaded?: boolean; date?: string; docType?: string } | undefined>
  training?: TrainingRecord

  // BS7858 onboarding fields
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
  onboardingStatus?: "not-started" | "in-progress" | "submitted" | "locked"
  onboardingSubmittedAt?: string
}

const BLANK: Profile = { id: "", name: "" }

export default function MyProfilePage() {
  const [profile, setProfile] = useState<Profile>(BLANK)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<"overview"|"details"|"report"|"messages">("overview")

  // Disciplinary history (read-only for staff)
  const [discRecords, setDiscRecords] = useState<DiscRecord[]>([])

  // Incident report form
  const [incidentDraft, setIncidentDraft] = useState({
    incident_type: "harassment",
    report_date: new Date().toISOString().slice(0, 10),
    site_location: "",
    against_person: "",
    description: "",
    is_anonymous: false,
  })
  const [incidentSaving, setIncidentSaving]   = useState(false)
  const [incidentSuccess, setIncidentSuccess] = useState(false)
  const [incidentError, setIncidentError]     = useState("")
  const [myReports, setMyReports]             = useState<IncidentReport[]>([])
  const [attachFiles, setAttachFiles]         = useState<File[]>([])
  const attachInputRef                        = useRef<HTMLInputElement>(null)

  // Messages
  const [messages, setMessages]       = useState<{
    id: string; message: string; sender_name: string; sender_role: string; created_at: string; is_read: boolean
    attachment_id?: string; attachment_filename?: string; attachment_original_name?: string
    attachment_mime_type?: string; attachment_size?: number
  }[]>([])
  const [msgDraft, setMsgDraft]       = useState("")
  const [msgSending, setMsgSending]   = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [msgFile, setMsgFile]         = useState<File | null>(null)
  const msgFileInputRef               = useRef<HTMLInputElement>(null)
  const msgEndRef                     = useRef<HTMLDivElement>(null)

  // Provisions
  const [provisions, setProvisions] = useState<{id:string;item:string;provided:boolean;date_given:string|null;date_returned:string|null;notes:string|null}[]>([])

  // Contract
  const [contractExists, setContractExists] = useState(false)

  // Form minimize — collapses to summary after submit
  const [formExpanded, setFormExpanded] = useState(true)

  // Driver licence & qualifications — self-service, saved independently of
  // the big onboarding form below (own pending_submission field, see
  // MY_PROFILE_FIELDS in server.js). Only shown once a manager has given
  // this staff member the "Driver" role via Add/Edit Staff.
  const [driverDraft, setDriverDraft]     = useState<DriverLicenceInfo>({})
  const [driverSaving, setDriverSaving]   = useState(false)
  const [driverSuccess, setDriverSuccess] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const d = await api.get<{ profile: Profile }>("/api/my-profile")
      setProfile(d.profile)
      setDriverDraft(d.profile.driverLicence ?? {})
    } catch {
    } finally {
      setLoading(false)
    }
  }

  function toggleDriverCat(cat: string) {
    setDriverDraft(prev => {
      const cats = prev.licenceCategories ?? []
      return { ...prev, licenceCategories: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat] }
    })
  }

  async function saveDriverLicence() {
    setDriverSaving(true)
    setDriverSuccess(false)
    try {
      await api.post("/api/my-profile", { driverLicence: driverDraft })
      await load()
      setDriverSuccess(true)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save — please try again.")
    } finally {
      setDriverSaving(false)
    }
  }

  async function loadMyHR() {
    try {
      const [discData, repData, msgData, provData, contractData] = await Promise.all([
        api.get<{ records: DiscRecord[] }>("/api/my-disciplinary"),
        api.get<{ reports: IncidentReport[] }>("/api/my-incident-reports"),
        api.get<{ messages: typeof messages; unread: number }>("/api/my-messages"),
        api.get<{ provisions: typeof provisions }>("/api/my-provisions"),
        api.get<{ exists: boolean }>("/api/my-contract/info"),
      ])
      setDiscRecords(discData.records)
      setMyReports(repData.reports)
      setMessages(msgData.messages); setUnreadCount(msgData.unread)
      setProvisions(provData.provisions)
      setContractExists(contractData.exists)
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 150)
    } catch {}
  }

  async function sendMyMessage() {
    if (!msgDraft.trim() && !msgFile) return
    setMsgSending(true)
    try {
      const d = await api.post<{ message: { id: string } }>("/api/my-messages", { message: msgDraft.trim() || `📎 ${msgFile?.name}` })
      if (msgFile) {
        const buf = await msgFile.arrayBuffer()
        const attRes = await fetch(`/api/messages/${d.message.id}/attachment`, {
          method: "POST",
          headers: { "Content-Type": msgFile.type || "application/octet-stream", "x-original-name": encodeURIComponent(msgFile.name) },
          credentials: "include",
          body: buf,
        })
        const attD = await attRes.json()
        if (!attD.ok) toast.error(attD.error ?? "Message sent, but the attachment failed to upload.")
      }
      setMsgDraft(""); setMsgFile(null)
      await loadMyHR()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send.")
    } finally {
      setMsgSending(false)
    }
  }

  function pickMsgFile(file: File | null) {
    if (!file) return
    const allowed = ["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
    if (!allowed.includes(file.type)) { toast.error("Only images, videos, PDFs, and Word docs are allowed."); return }
    if (file.size > 100 * 1024 * 1024) { toast.error("File too large (max 100 MB)."); return }
    setMsgFile(file)
  }

  async function submitIncident(e: React.FormEvent) {
    e.preventDefault()
    if (!incidentDraft.description.trim()) { setIncidentError("Description is required."); return }
    setIncidentSaving(true); setIncidentError("")
    try {
      const d = await api.post<{ report: { id: string } }>("/api/incident-reports", incidentDraft)

      // Upload attachments one by one
      if (attachFiles.length > 0) {
        for (const file of attachFiles) {
          const buf = await file.arrayBuffer()
          await fetch(`/api/incident-reports/${d.report.id}/attachments`, {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "x-original-name": encodeURIComponent(file.name),
            },
            credentials: "include",
            body: buf,
          })
        }
      }

      setIncidentSuccess(true)
      setAttachFiles([])
      setIncidentDraft({ incident_type: "harassment", report_date: new Date().toISOString().slice(0, 10), site_location: "", against_person: "", description: "", is_anonymous: false })
      await loadMyHR()
    } catch (err) {
      setIncidentError(err instanceof ApiError ? err.message : "Failed to submit.")
    } finally {
      setIncidentSaving(false)
    }
  }

  function addAttachFiles(files: FileList | null) {
    if (!files) return
    const allowed = ["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
    const newFiles = Array.from(files).filter(f => allowed.includes(f.type))
    if (newFiles.length < files.length) toast.error("Some files were skipped — only images, videos, and PDFs are allowed.")
    setAttachFiles(prev => [...prev, ...newFiles])
  }

  function removeAttach(idx: number) {
    setAttachFiles(prev => prev.filter((_, i) => i !== idx))
  }

  function attachIcon(mime: string) {
    if (mime.startsWith("video/")) return <FileVideo className="h-3.5 w-3.5 text-primary shrink-0" />
    if (mime.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5 text-success shrink-0" />
    return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  }

  useEffect(() => { load(); loadMyHR() }, [])

  function set<K extends keyof Profile>(field: K, value: Profile[K]) {
    setProfile(p => ({ ...p, [field]: value }))
  }

  function pickPhoto(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhoto(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  async function handleSubmit() {
    setSaving(true)
    setError("")
    setSuccess(false)
    try {
      await api.post("/api/my-profile", {
        phone: profile.phone, address: profile.address,
        emergencyContact: profile.emergencyContact,
        bankDetails: profile.bankDetails,
        sia: profile.sia, cscs: profile.cscs, visa: profile.visa,
        references: profile.references,
        dateOfBirth: profile.dateOfBirth, nationality: profile.nationality,
        ni: profile.ni, uniqueTaxpayerReference: profile.uniqueTaxpayerReference,
        utrNotApplicable: profile.utrNotApplicable,
        previousNames: profile.previousNames, yearsAtCurrentAddress: profile.yearsAtCurrentAddress,
        addressHistory: profile.addressHistory, employmentHistoryDetail: profile.employmentHistoryDetail,
        otherQualifications: profile.otherQualifications,
        hasCriminalHistory: profile.hasCriminalHistory, criminalHistory: profile.criminalHistory,
        hasCautions: profile.hasCautions, cautionsAndInvestigations: profile.cautionsAndInvestigations,
        declarations: profile.declarations,
      })

      if (photo) {
        try {
          await api.post("/api/my-profile/photo", photo)
        } catch {
          toast.error("Profile saved but photo upload failed — please try again.")
        }
      }

      await load()
      setPhoto(null)
      if (photoPreview) URL.revokeObjectURL(photoPreview)
      setPhotoPreview(null)
      setSuccess(true)
      setFormExpanded(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const isPending = !!profile.pending_submission

  function compStatus(expiry?: string): "valid"|"expiring"|"expired"|"missing" {
    if (!expiry) return "missing"
    const days = Math.round((new Date(expiry).getTime() - Date.now()) / 86400000)
    if (days < 0) return "expired"
    if (days < 90) return "expiring"
    return "valid"
  }
  const siaStatus  = profile.sia?.number  ? compStatus(profile.sia?.expiry)  : "missing"
  const cscsStatus = profile.cscs?.number ? compStatus(profile.cscs?.expiry) : "missing"
  const visaStatus = profile.visa?.type?.toLowerCase().includes("british") ? "valid" : compStatus(profile.visa?.expiry)

  const statusCfg = {
    valid:    { label: "Valid",         cls: "bg-success/15 text-success border-success/30" },
    expiring: { label: "Expiring soon", cls: "bg-warning/15 text-warning border-warning/30" },
    expired:  { label: "Expired",       cls: "bg-destructive/15 text-destructive border-destructive/30" },
    missing:  { label: "Not on file",   cls: "bg-muted text-muted-foreground border-border" },
  }

  const TABS = [
    { id: "overview" as const,  label: "Overview",    Icon: ShieldCheck },
    { id: "details"  as const,  label: "My Details",  Icon: UserIcon },
    { id: "report"   as const,  label: "Report",      Icon: Flag },
    { id: "messages" as const,  label: "Messages",    Icon: MessageSquare },
  ]

  return (
    <div className="space-y-0 relative">

      {/* ── Hero ── */}
      <div className="rounded-xl bg-gradient-to-br from-sidebar to-sidebar/90 text-sidebar-foreground p-5 mb-5 flex items-center gap-4 shadow-sm relative overflow-hidden">
        {/* GuardTec mark watermark — real brand mark (icon only, cropped from the master logo), faint in the corner */}
        <svg
          className="pointer-events-none absolute -right-3 -top-3 h-28 w-28 opacity-[0.16]"
          viewBox="58 98 72 87" xmlns="http://www.w3.org/2000/svg" aria-hidden
        >
          <path
            fill="var(--color-primary)"
            d="M121.62,116.11l7.77-17.62-17.32,14.41s1.32-6.73,1.32-7.99-8.12,13.44-8.12,13.44l-15.09,12.08.92-3.85s-5.73,4.76-5.25,10.01c.49,5.25,7.38,6.12,7.38,6.12l-2.33-3.6,4.76,1.55v-4.37s9.77,0,9.77,0l-9.07,8.07h-1.96s-1.17,6.12,5.64,9.91c0,0-.78-4.37,2.82-7.19,3.6-2.82,9.91-9.23,10.4-10.01.49-.78.78-1.85.58-2.72-.1-.46-.34-1.35-.54-2.09,0,0-.22-.67-.28-1.02-.04-.2-.06-.4-.05-.61.02-1.65,1.36-3.04,3-3.11,1.81-.08,3.3,1.36,3.3,3.15-.04,3.65-.86,7.26-2.41,10.56-.18.39-.3.61-.3.61-9.04,19.53-22.16,25.75-22.16,25.75,0,0-17.59-8.64-18.22-28.28-.16-4.86,2.1-10.76,6.74-14.62,21.87-18.14,32.48-26.2,32.48-26.2h-55.98s0,9.92,2.17,23.35h0s-3.56,0-3.56,0c0,0-.02,9.33,7.38,23.28h-3.08s2.33,20.32,32.07,40.05c5.54-3.71,10.21-8.43,14.13-13.73h0s3.54,2.14,3.54,2.14c4.08-4.79,8.5-19.77,8.5-19.77l3.76,1.55c2.98-6.35,2.07-21.25,2.07-21.25h2.98c0-12.31-7.77-18.01-7.77-18.01ZM92.46,134.26c-1,.62-2.05-.09-2.05-.09l2.66-1.94s.31,1.47-.61,2.03ZM106.01,127.19c-3.41,2.4-5.05-.45-5.05-.45l7.77-6.28s-.97,5.51-2.72,6.74Z"
          />
        </svg>
        <div className="h-16 w-16 shrink-0 rounded-full overflow-hidden border-2 border-white/20 bg-white/10 flex items-center justify-center">
          {profile.id
            ? <img src={`/api/staff/${profile.id}/photo`} alt={profile.name}
                className="h-full w-full object-cover"
                onError={e => { e.currentTarget.style.display="none" }} />
            : <UserIcon className="h-7 w-7 opacity-60" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-lg leading-tight truncate">{profile.name}</p>
          <p className="text-sm opacity-60 truncate">{profile.email}</p>
          <div className="flex gap-2 flex-wrap mt-2">
            {[
              { label: "SIA",  status: siaStatus,  expiry: profile.sia?.expiry },
              { label: "CSCS", status: cscsStatus, expiry: profile.cscs?.expiry },
              { label: "RTW",  status: visaStatus, expiry: profile.visa?.expiry },
            ].map(({ label, status }) => (
              <span key={label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusCfg[status].cls}`}>
                {label} · {statusCfg[status].label}
              </span>
            ))}
          </div>
        </div>
        {(isPending || profile.rejection_reason) && (
          <div className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium ${profile.rejection_reason ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning"}`}>
            {profile.rejection_reason ? "Action needed" : "Pending review"}
          </div>
        )}
      </div>

      {/* ── Alert banners ── */}
      {profile.rejection_reason && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive mb-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="font-medium">Your last submission needs changes</p>
          <p className="mt-0.5 text-destructive/80">{profile.rejection_reason}</p></div>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/8 px-4 py-3 text-sm text-success mb-4">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <p>Submitted — your manager will review these changes shortly.</p>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="flex gap-1 border-b mb-6 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? "text-primary border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}>
            <t.Icon className="h-3.5 w-3.5" />
            {t.label}
            {t.id === "messages" && unreadCount > 0 && (
              <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW TAB ══ */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {/* Compliance cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "SIA Licence", status: siaStatus, detail: profile.sia?.number ? `${profile.sia.type ?? ""} · Exp ${profile.sia.expiry?.slice(0,10).split("-").reverse().join("/")??""}`.trim() : "Not provided" },
              { label: "CSCS Card",   status: cscsStatus, detail: profile.cscs?.number ? `Exp ${profile.cscs.expiry?.slice(0,10).split("-").reverse().join("/")??""}` : "Not provided" },
              { label: "Right to Work", status: visaStatus, detail: profile.visa?.type ?? "Not provided" },
            ].map(c => (
              <div key={c.label} className={`rounded-xl border p-3 space-y-1 ${statusCfg[c.status].cls}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{c.label}</p>
                <p className="text-sm font-bold">{statusCfg[c.status].label}</p>
                <p className="text-[11px] opacity-70 truncate">{c.detail}</p>
              </div>
            ))}
          </div>

          {/* Pending review notice */}
          {isPending && !success && (
            <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
              <Clock className="h-4 w-4 shrink-0" />
              <p>Your submitted changes are pending review by your manager.</p>
            </div>
          )}

          {/* Disciplinary history */}
          {discRecords.length > 0 && (
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <BadgeAlert className="h-3.5 w-3.5 text-destructive" /> Disciplinary History
              </p>
              {discRecords.map(rec => {
                const [y,m,d] = rec.incident_date.slice(0,10).split("-")
                return (
                  <div key={rec.id} className="rounded-lg border bg-muted/20 p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${discTypeCls[rec.type]??discTypeCls.other}`}>{discTypeLabels[rec.type]??rec.type}</span>
                      <span className="text-xs text-muted-foreground">{d}/{m}/{y}</span>
                    </div>
                    <p className="text-sm">{rec.description}</p>
                    {rec.action_taken && <p className="text-xs text-muted-foreground">Action: {rec.action_taken}</p>}
                  </div>
                )
              })}
              <p className="text-xs text-muted-foreground">These records are managed by your office. Contact them if you believe a record is incorrect.</p>
            </div>
          )}

          {/* Provisions */}
          {provisions.length > 0 && (
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> Uniform & Equipment
              </p>
              {provisions.map(p => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border bg-muted/10 px-3 py-2.5">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{p.item}</span>
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${p.provided?"bg-success/15 text-success":"bg-destructive/15 text-destructive"}`}>
                        {p.provided?"Provided":"Not Provided"}
                      </span>
                    </div>
                    {p.date_given && <p className="text-xs text-muted-foreground">Given: {p.date_given.slice(0,10).split("-").reverse().join("/")}</p>}
                    {p.notes && <p className="text-xs text-muted-foreground truncate">{p.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Contract */}
          {contractExists && (
            <div className="rounded-xl border bg-card p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">Your Contract</p>
                  <p className="text-xs text-muted-foreground">Uploaded by your manager</p>
                </div>
              </div>
              <a href="/api/my-contract" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                <Eye className="h-3.5 w-3.5" /> View
              </a>
            </div>
          )}

          {discRecords.length === 0 && provisions.length === 0 && !contractExists && (
            <p className="text-sm text-muted-foreground text-center py-8">Your compliance overview will appear here once your details are on file.</p>
          )}

          {/* Driver licence & qualifications — only for staff carrying the "Driver" role */}
          {parseRoles(profile.jobRole).includes("Driver") && (
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Driving Licence &amp; Qualifications
              </p>
              <p className="text-xs text-muted-foreground">
                Fill in what's on your own licence — your office handles fuel cards, tachograph, DBS and assessments separately.
              </p>
              {driverSuccess && (
                <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  Submitted — your manager will review these changes shortly.
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Licence Number">
                  <input className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-ring"
                    value={driverDraft.licenceNumber ?? ""}
                    onChange={e => setDriverDraft(p => ({ ...p, licenceNumber: e.target.value.toUpperCase() }))} />
                </Field>
                <Field label="Licence Expiry">
                  <input type="date" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={driverDraft.licenceExpiry ?? ""}
                    onChange={e => setDriverDraft(p => ({ ...p, licenceExpiry: e.target.value }))} />
                </Field>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Licence Categories</label>
                <div className="flex flex-wrap gap-2">
                  {LICENCE_CATS.map(cat => {
                    const active = driverDraft.licenceCategories?.includes(cat)
                    return (
                      <button key={cat} type="button" onClick={() => toggleDriverCat(cat)}
                        className={`rounded-md border px-3 py-1 text-xs font-bold transition-colors ${
                          active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
                        }`}>
                        {cat}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="CPC Card Number">
                  <input className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                    value={driverDraft.cpcCard ?? ""}
                    onChange={e => setDriverDraft(p => ({ ...p, cpcCard: e.target.value }))} />
                </Field>
                <Field label="CPC Expiry">
                  <input type="date" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={driverDraft.cpcExpiry ?? ""}
                    onChange={e => setDriverDraft(p => ({ ...p, cpcExpiry: e.target.value }))} />
                </Field>
                <Field label="Medical Cert Expiry">
                  <input type="date" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    value={driverDraft.medicalExpiry ?? ""}
                    onChange={e => setDriverDraft(p => ({ ...p, medicalExpiry: e.target.value }))} />
                </Field>
              </div>
              <Button size="sm" onClick={saveDriverLicence} disabled={driverSaving} className="gap-1.5">
                {driverSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {driverSaving ? "Saving…" : "Save Driver Details"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ══ MY DETAILS TAB ══ */}
      {activeTab === "details" && !formExpanded && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Your details have been submitted for review.</p>
            <button onClick={() => setFormExpanded(true)}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
              <Pencil className="h-3 w-3" /> Edit Details
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {profile.phone    && <div><span className="text-muted-foreground text-xs">Phone</span><p className="truncate">{profile.phone}</p></div>}
            {profile.address  && <div><span className="text-muted-foreground text-xs">Address</span><p className="truncate">{profile.address}</p></div>}
            {profile.sia?.number  && <div><span className="text-muted-foreground text-xs">SIA No.</span><p className="truncate">{profile.sia.number}</p></div>}
            {profile.cscs?.number && <div><span className="text-muted-foreground text-xs">CSCS No.</span><p className="truncate">{profile.cscs.number}</p></div>}
            {profile.emergencyContact?.name && <div><span className="text-muted-foreground text-xs">Emergency Contact</span><p className="truncate">{profile.emergencyContact.name}</p></div>}
            {profile.bankDetails?.accountNumber && <div><span className="text-muted-foreground text-xs">Bank Details</span><p className="truncate">{profile.bankDetails.bankName || "On file"} •••• {profile.bankDetails.accountNumber.slice(-4)}</p></div>}
          </div>
        </div>
      )}

      {activeTab === "details" && formExpanded && (
        <OnboardingWizard
          profile={profile}
          set={set}
          photo={photo}
          photoPreview={photoPreview}
          pickPhoto={pickPhoto}
          saving={saving}
          submitError={error}
          onSubmit={handleSubmit}
        />
      )}  {/* end details tab */}

      {/* ══ REPORT TAB ══ */}
      {activeTab === "report" && (
      <Section title="Report an Incident">
        <p className="mb-4 text-xs text-muted-foreground">
          Use this form to report anything that happened on site — misbehaviour by a supervisor,
          discrimination based on race, religion, caste, or any other misconduct. Your report is sent
          directly to the Director and Ops Manager. You can choose to keep your name anonymous.
        </p>

        {incidentSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success mb-4">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Your report has been submitted. The management team will review it.
          </div>
        )}

        <form onSubmit={submitIncident} className="space-y-3">
          {incidentError && <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{incidentError}</p>}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Type of incident *">
              <select value={incidentDraft.incident_type}
                onChange={e => setIncidentDraft(p => ({ ...p, incident_type: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="harassment">Harassment</option>
                <option value="discrimination">Discrimination (race, religion, caste)</option>
                <option value="misconduct">Supervisor misconduct</option>
                <option value="safety">Safety concern</option>
                <option value="fraud">Fraud / dishonesty</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Date of incident *">
              <input type="date" value={incidentDraft.report_date}
                onChange={e => setIncidentDraft(p => ({ ...p, report_date: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Site / location">
              <input type="text" value={incidentDraft.site_location}
                onChange={e => setIncidentDraft(p => ({ ...p, site_location: e.target.value }))}
                placeholder="e.g. Wembley Arena"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </Field>
            <Field label="Person being reported (name / role)">
              <input type="text" value={incidentDraft.against_person}
                onChange={e => setIncidentDraft(p => ({ ...p, against_person: e.target.value }))}
                placeholder="e.g. John Smith, Supervisor"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </Field>
          </div>

          <Field label="What happened? *">
            <textarea value={incidentDraft.description} rows={4}
              onChange={e => setIncidentDraft(p => ({ ...p, description: e.target.value }))}
              placeholder="Please describe the incident in as much detail as possible."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
          </Field>

          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <input type="checkbox" checked={incidentDraft.is_anonymous}
              onChange={e => setIncidentDraft(p => ({ ...p, is_anonymous: e.target.checked }))}
              className="mt-0.5 rounded" />
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {incidentDraft.is_anonymous ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                Submit anonymously
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {incidentDraft.is_anonymous
                  ? "Your name will NOT be shared. Management will only see the incident details."
                  : "Your name will be visible to management. Tick to submit without revealing your identity."}
              </p>
            </div>
          </label>

          {/* Attachment picker */}
          <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                Attachments (photos, videos, documents)
              </p>
              <button type="button"
                onClick={() => attachInputRef.current?.click()}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Upload className="h-3 w-3" /> Add file
              </button>
              <input ref={attachInputRef} type="file" multiple hidden
                accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx"
                onChange={e => addAttachFiles(e.target.files)} />
            </div>
            {attachFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files selected — optional</p>
            ) : (
              <ul className="space-y-1">
                {attachFiles.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    {attachIcon(f.type)}
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => removeAttach(i)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={incidentSaving} className="gap-2">
              {incidentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
              {incidentSaving ? "Submitting…" : "Submit Report"}
            </Button>
          </div>
        </form>

        {/* My past reports */}
        {myReports.length > 0 && (
          <div className="mt-4 border-t pt-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your previous reports</p>
            {myReports.map(r => {
              const statusCls: Record<string, string> = {
                open:         "bg-success/15 text-success",
                under_review: "bg-warning/15 text-warning",
                resolved:     "bg-destructive/15 text-destructive",
                closed:       "bg-destructive/15 text-destructive",
              }
              const statusLabel: Record<string, string> = {
                open:         "Report Received",
                under_review: "Decision Pending",
                resolved:     "Closed",
                closed:       "Closed",
              }
              return (
                <div key={r.id} className="rounded-lg border bg-muted/20 p-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium capitalize">{r.incident_type.replace(/_/g, " ")}</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${statusCls[r.status] ?? statusCls.open}`}>
                      {statusLabel[r.status] ?? r.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted-foreground">{r.report_date.slice(0, 10).split("-").reverse().join("/")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{r.description}</p>
                  {r.attachment_count ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />{r.attachment_count} attachment{r.attachment_count > 1 ? "s" : ""}
                    </p>
                  ) : null}
                  {r.resolution_notes && <p className="text-xs text-success">Resolution: {r.resolution_notes}</p>}
                </div>
              )
            })}
          </div>
        )}
      </Section>
      )}  {/* end report tab */}

      {/* ══ MESSAGES TAB ══ */}
      {activeTab === "messages" && (
        <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={{ minHeight: "480px" }}>
          <div className="border-b px-4 py-3 bg-muted/20">
            <p className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Messages
            </p>
            <p className="text-xs text-muted-foreground">Private messages from your manager. You can reply here.</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-muted/5" style={{ maxHeight: "380px" }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <MessageSquare className="h-8 w-8 opacity-20" />
                <p className="text-sm">No messages yet from your manager.</p>
              </div>
            )}
            {messages.map(m => {
              const isMe = m.sender_role === "staff"
              const isImage = m.attachment_mime_type?.startsWith("image/")
              return (
                <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-sm rounded-2xl px-4 py-2.5 text-sm shadow-sm ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border text-foreground rounded-tl-sm"}`}>
                    <p className="text-[11px] font-semibold mb-1 opacity-60">{m.sender_name}</p>
                    <p className="leading-snug">{m.message}</p>
                    {m.attachment_filename && (
                      isImage ? (
                        <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" className="mt-1.5 block">
                          <img src={`/api/message-attachments/${m.attachment_filename}`} alt={m.attachment_original_name}
                            className="max-h-48 w-full rounded-lg object-cover" />
                        </a>
                      ) : (
                        <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" download={m.attachment_original_name}
                          className={`mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${isMe ? "bg-white/15" : "bg-muted"}`}>
                          {attachIcon(m.attachment_mime_type ?? "")}
                          <span className="flex-1 truncate">{m.attachment_original_name}</span>
                          <Download className="h-3 w-3 shrink-0" />
                        </a>
                      )
                    )}
                    <p className="text-[10px] mt-1.5 opacity-50 text-right">
                      {new Date(m.created_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                    </p>
                  </div>
                </div>
              )
            })}
            <div ref={msgEndRef} />
          </div>
          <div className="border-t p-4 bg-background space-y-2">
            {msgFile && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                {attachIcon(msgFile.type)}
                <span className="flex-1 truncate">{msgFile.name}</span>
                <span className="text-muted-foreground shrink-0">{(msgFile.size / 1024 / 1024).toFixed(1)} MB</span>
                <button onClick={() => setMsgFile(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input ref={msgFileInputRef} type="file" hidden
                accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx"
                onChange={e => { pickMsgFile(e.target.files?.[0] ?? null); e.target.value = "" }} />
              <button onClick={() => msgFileInputRef.current?.click()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground hover:bg-muted transition-colors" title="Attach file">
                <Paperclip className="h-4 w-4" />
              </button>
              <input value={msgDraft} onChange={e => setMsgDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMyMessage() } }}
                placeholder="Type a reply…"
                className="flex-1 h-10 rounded-lg border border-input bg-muted/30 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <Button disabled={msgSending || (!msgDraft.trim() && !msgFile)} onClick={sendMyMessage} className="gap-1.5 h-10 px-5">
                {msgSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// Section, Field, DocUploadRow, TrainingCertRow, DOC_UPLOADS, TRAINING_CERT_UPLOADS
// moved to @/components/profile/ProfileShared — shared with OnboardingWizard.
