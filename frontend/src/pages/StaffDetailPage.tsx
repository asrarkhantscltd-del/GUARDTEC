import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  ArrowLeft, Phone, Mail, User, ShieldCheck, CreditCard, FileText,
  Loader2, Upload, Eye, CheckCircle2, AlertCircle, Clock, FileQuestion,
  Fingerprint, Building2, GraduationCap, ClipboardList, UserCheck,
  HeartPulse, Flame, Swords, HardHat, Camera, Briefcase,
  MapPin, Contact, BadgeAlert, Pencil, Trash2, Plus, X as XIcon,
  KeyRound, Copy, RefreshCw, Check, UserX,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────────────

interface TrainingItem { completed?: boolean; date?: string; expiry?: string; provider?: string; number?: string }
interface ExtraTrainingItem { id: string; label: string; completed?: boolean; date?: string; expiry?: string; number?: string; provider?: string }
interface TrainingRecord {
  siaCertificate?:     TrainingItem
  firstAid?:           TrainingItem
  manualHandling?:     TrainingItem
  fireAwareness?:      TrainingItem
  conflictManagement?: TrainingItem
  bwcTraining?:        TrainingItem
  cscsTest?:           TrainingItem
  extra?:              ExtraTrainingItem[]
}
interface DbsRecord    { type?: string; checkDate?: string; certificateNo?: string }
interface Bs7858Record { completed?: boolean; completionDate?: string; reviewer?: string }
interface EmergencyContact { name?: string; phone?: string; relationship?: string }

interface StaffMember {
  id: string
  name: string
  overall: string
  jobRole?: string
  email?: string
  phone?: string
  nationality?: string
  gender?: string
  dateOfBirth?: string
  dob?: string
  ni?: string
  placeOfBirth?: string
  address?: string
  drivingLicence?: string
  deployStatus?: string
  currentSite?: string
  sia?:  { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
  references?: {
    ref1?: { name?: string; company?: string; email?: string; phone?: string; status?: string }
    ref2?: { name?: string; company?: string; email?: string; phone?: string; status?: string }
  }
  employmentHistory?: string[]
  contract?: string
  dbs?: DbsRecord
  bs7858?: Bs7858Record
  emergencyContact?: EmergencyContact
  training?: TrainingRecord
  documents?: {
    siaPhysical?:      { uploaded?: boolean; date?: string }
    passport?:         { uploaded?: boolean; date?: string }
    brpCard?:          { uploaded?: boolean; date?: string }
    proofOfAddress1?:  { uploaded?: boolean; date?: string }
    proofOfAddress2?:  { uploaded?: boolean; date?: string }
    p45?:              { uploaded?: boolean; date?: string }
    bankLetter?:       { uploaded?: boolean; date?: string }
    application?:      { uploaded?: boolean; date?: string }
    assignmentInstructions?: { uploaded?: boolean; date?: string }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return "Not on file"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
}

// ── Shared UI pieces ──────────────────────────────────────────────────────────

type DocStatus = "uploaded" | "missing" | "expired" | "expiring"

function docStatusOf(uploaded?: boolean, expiry?: string): DocStatus {
  if (!uploaded) return "missing"
  const d = daysUntil(expiry)
  if (d !== null && d < 0)  return "expired"
  if (d !== null && d < 91) return "expiring"
  return "uploaded"
}

function DocStatusChip({ status }: { status: DocStatus }) {
  const cfg = {
    uploaded: { label: "On file",       cls: "bg-success/15 text-success border-success/30",           Icon: CheckCircle2 },
    expiring: { label: "Expiring soon", cls: "bg-warning/15 text-warning border-warning/30",           Icon: Clock },
    expired:  { label: "Expired",       cls: "bg-destructive/15 text-destructive border-destructive/30", Icon: AlertCircle },
    missing:  { label: "Not uploaded",  cls: "bg-muted text-muted-foreground border-border",            Icon: FileQuestion },
  } as const
  const { label, cls, Icon } = cfg[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  )
}

function DocRow({
  icon, label, status, uploadedDate, expiry, note,
}: {
  icon: React.ReactNode; label: string; status: DocStatus
  uploadedDate?: string; expiry?: string; note?: string
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-0">
      <div className="text-muted-foreground w-5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {uploadedDate && <p className="text-xs text-muted-foreground">Uploaded {fmtDate(uploadedDate)}</p>}
        {expiry && <p className="text-xs text-muted-foreground">Expires {fmtDate(expiry)}</p>}
        {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <DocStatusChip status={status} />
        {status === "uploaded" ? (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" disabled>
            <Eye className="h-3 w-3" />View
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" disabled>
            <Upload className="h-3 w-3" />Upload
          </Button>
        )}
      </div>
    </div>
  )
}


function AcsCheckRow({ label, done, note }: { label: string; done?: boolean; note?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-md px-3 py-2.5 ${done ? "bg-success/5" : "bg-destructive/5"}`}>
      {done
        ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
        : <AlertCircle  className="h-4 w-4 text-destructive mt-0.5 shrink-0" />}
      <div>
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  )
}

function ComplianceRow({ icon, label, number, expiry }: {
  icon: React.ReactNode; label: string; number?: string; expiry?: string
}) {
  const days = daysUntil(expiry)
  const colour =
    !expiry         ? "text-muted-foreground"
    : days !== null && days < 0   ? "text-destructive"
    : days !== null && days < 91  ? "text-warning"
    : "text-success"
  const expiryLabel =
    !expiry   ? "Not on file"
    : days === null ? fmtDate(expiry)
    : days < 0  ? `Expired ${Math.abs(days)} days ago`
    : days === 0 ? "Expires today"
    : days < 91 ? `${fmtDate(expiry)} — ${days} days left`
    : fmtDate(expiry)

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium mt-0.5">{number || "Not on file"}</p>
        <p className={`text-xs mt-0.5 ${colour}`}>{expiryLabel}</p>
      </div>
    </div>
  )
}

// ── Tab component ─────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",   label: "Overview",     Icon: User },
  { id: "documents",  label: "Documents",    Icon: FileText },
  { id: "vetting",    label: "Vetting",      Icon: Fingerprint },
  { id: "training",   label: "Training",     Icon: GraduationCap },
  { id: "acs",        label: "ACS Audit",    Icon: ClipboardList },
] as const

type TabId = typeof TABS[number]["id"]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const [staff, setStaff]     = useState<StaffMember | null>(null)
  const [loading, setLoading]   = useState(true)
  const [photoUrl, setPhotoUrl]       = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [tab, setTab]           = useState<TabId>("overview")

  // Portal access — registration code for the staff self-service login
  const [regCode, setRegCode]         = useState<string | null>(null)
  const [regClaimed, setRegClaimed]   = useState(false)
  const [regLoading, setRegLoading]   = useState(false)
  const [regCopied, setRegCopied]     = useState(false)

  // Move to Ex-Staff
  const [exConfirm, setExConfirm] = useState(false)
  const [exMoving, setExMoving]   = useState(false)
  const [exError, setExError]     = useState("")

  // Training management
  const [trainingData, setTrainingData]   = useState<TrainingRecord>({})
  const [trainingSaving, setTrainingSaving] = useState(false)
  const [editingKey, setEditingKey]       = useState<string | null>(null)
  const [editDraft, setEditDraft]         = useState<Record<string, string | boolean>>({})
  const [showAddForm, setShowAddForm]     = useState(false)
  const [addDraft, setAddDraft]           = useState({ label: "", completed: false, date: "", expiry: "", number: "", provider: "" })

  // Profile edit panel
  const [editOpen, setEditOpen]       = useState(false)
  const [profileDraft, setProfileDraft] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving]   = useState(false)
  const [editError, setEditError]     = useState("")

  useEffect(() => {
    fetch("/api/staff", { credentials: "include" })
      .then((r) => r.json())
      .then((data: StaffMember[]) => {
        const found = data.find((s) => s.id === id) ?? null
        setStaff(found)
        if (found?.training) setTrainingData(found.training)
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    fetch(`/api/staff/${id}/photo`, { credentials: "include" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => { if (blob) setPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [id])

  const canManagePortalAccess = me?.role === "director" || me?.role === "ops_manager"
  const canEdit   = me?.role === "director" || !!me?.permissions?.edit_staff
  const canDelete = me?.role === "director" || !!me?.permissions?.delete_staff

  function openEdit() {
    if (!staff) return
    setProfileDraft({
      name:        staff.name ?? "",
      jobRole:     staff.jobRole ?? "",
      email:       staff.email ?? "",
      phone:       staff.phone ?? "",
      nationality: staff.nationality ?? "",
      gender:      staff.gender ?? "",
      dob:         staff.dob || staff.dateOfBirth || "",
      ni:          staff.ni ?? "",
      address:     staff.address ?? "",
      contract:    staff.contract ?? "",
      sia_number:  staff.sia?.number ?? "",
      sia_type:    staff.sia?.type ?? "",
      sia_expiry:  staff.sia?.expiry ?? "",
      cscs_number: staff.cscs?.number ?? "",
      cscs_expiry: staff.cscs?.expiry ?? "",
      rtw_type:    staff.visa?.type ?? "",
      rtw_expiry:  staff.visa?.expiry ?? "",
    })
    setEditError("")
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!staff || !id) return
    if (!profileDraft.name?.trim()) { setEditError("Name is required."); return }
    setEditSaving(true); setEditError("")
    try {
      const body = {
        ...staff,
        name:        profileDraft.name.trim(),
        jobRole:     profileDraft.jobRole || undefined,
        email:       profileDraft.email || undefined,
        phone:       profileDraft.phone || undefined,
        nationality: profileDraft.nationality || undefined,
        gender:      profileDraft.gender || undefined,
        dob:         profileDraft.dob || undefined,
        dateOfBirth: profileDraft.dob || undefined,
        ni:          profileDraft.ni || undefined,
        address:     profileDraft.address || undefined,
        contract:    profileDraft.contract || undefined,
        sia:  { ...staff.sia,  number: profileDraft.sia_number || undefined, type: profileDraft.sia_type || undefined, expiry: profileDraft.sia_expiry || undefined },
        cscs: { ...staff.cscs, number: profileDraft.cscs_number || undefined, expiry: profileDraft.cscs_expiry || undefined },
        visa: { ...staff.visa, type: profileDraft.rtw_type || undefined, expiry: profileDraft.rtw_expiry || undefined },
      }
      const res = await fetch(`/api/staff/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!d.ok) { setEditError(d.error ?? "Failed to save."); setEditSaving(false); return }
      const refreshRes = await fetch("/api/staff", { credentials: "include" })
      const data: StaffMember[] = await refreshRes.json()
      const updated = data.find(s => s.id === id) ?? null
      setStaff(updated)
      if (updated?.training) setTrainingData(updated.training)
      setEditOpen(false)
    } catch {
      setEditError("Network error.")
    } finally {
      setEditSaving(false)
    }
  }

  useEffect(() => {
    if (!canManagePortalAccess || !id) return
    fetch(`/api/staff/${id}/registration-code`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setRegCode(d.code); setRegClaimed(d.claimed) } })
      .catch(() => {})
  }, [id, canManagePortalAccess])

  async function regenerateCode() {
    setRegLoading(true)
    try {
      const res = await fetch(`/api/staff/${id}/registration-code/regenerate`, { method: "POST", credentials: "include" })
      const d = await res.json()
      if (d.ok) { setRegCode(d.code); setRegClaimed(false) }
    } finally {
      setRegLoading(false)
    }
  }

  function copyCode() {
    if (!regCode) return
    navigator.clipboard.writeText(regCode).then(() => {
      setRegCopied(true)
      setTimeout(() => setRegCopied(false), 2000)
    })
  }

  async function handlePhotoUpload(file: File | null) {
    if (!file || !id) return
    setUploadingPhoto(true)
    try {
      await fetch(`/api/staff/${id}/photo`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      const res = await fetch(`/api/staff/${id}/photo`, { credentials: "include" })
      if (res.ok) {
        const blob = await res.blob()
        if (photoUrl) URL.revokeObjectURL(photoUrl)
        setPhotoUrl(URL.createObjectURL(blob))
      }
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function moveToExStaff() {
    setExMoving(true); setExError("")
    try {
      const res = await fetch(`/api/staff/${id}`, { method: "DELETE", credentials: "include" })
      const d = await res.json()
      if (!d.ok) { setExError(d.error ?? "Failed to move to Ex-Staff."); setExMoving(false); return }
      navigate("/staff", { replace: true })
    } catch {
      setExError("Network error.")
      setExMoving(false)
    }
  }

  // ── Training helpers ──
  async function patchTraining(updated: TrainingRecord) {
    setTrainingSaving(true)
    try {
      await fetch(`/api/staff/${id}/training`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ training: updated }),
      })
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
      provider:  existing?.provider ?? "",
    })
  }

  function saveStdEdit(key: keyof Omit<TrainingRecord, "extra">) {
    const item: TrainingItem = {
      completed: editDraft.completed as boolean,
      date:      (editDraft.date as string) || undefined,
      expiry:    (editDraft.expiry as string) || undefined,
      number:    (editDraft.number as string) || undefined,
      provider:  (editDraft.provider as string) || undefined,
    }
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
      ),
    }
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
      provider:  addDraft.provider || undefined,
    }
    const updated = { ...trainingData, extra: [...(trainingData.extra ?? []), newItem] }
    setTrainingData(updated); patchTraining(updated)
    setAddDraft({ label: "", completed: false, date: "", expiry: "", number: "", provider: "" })
    setShowAddForm(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading profile...</span>
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/staff")}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to Staff
        </Button>
        <p className="text-muted-foreground">Staff member not found.</p>
      </div>
    )
  }

  const docs = staff.documents ?? {}
  const training = trainingData
  const dob = staff.dob || staff.dateOfBirth

  // ACS audit — computed pass/fail for each point
  const acs = {
    siaValid:          !!(staff.sia?.number && (daysUntil(staff.sia.expiry) ?? 1) >= 0),
    siaType:           !!(staff.sia?.type),
    rtwVerified:       !!(staff.visa?.type || staff.nationality?.toLowerCase().includes("british")),
    dbsChecked:        !!(staff.dbs?.checkDate),
    bs7858:            !!(staff.bs7858?.completed),
    twoRefs:           !!(staff.references?.ref1?.status === "Satisfactory" && staff.references?.ref2?.status === "Satisfactory"),
    contractSigned:    !!(staff.contract && staff.contract.toLowerCase() !== "not signed"),
    firstAid:          !!(training.firstAid?.completed),
    conflictMgmt:      !!(training.conflictManagement?.completed),
    siaPhysicalCopy:   !!(docs.siaPhysical?.uploaded),
    passportOnFile:    !!(docs.passport?.uploaded),
    addressProof:      !!(docs.proofOfAddress1?.uploaded),
    assignmentInstr:   !!(docs.assignmentInstructions?.uploaded),
    emergencyContact:  !!(staff.emergencyContact?.name),
  }

  const acsScore = Object.values(acs).filter(Boolean).length
  const acsTotal = Object.values(acs).length

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/staff")}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to Staff
        </Button>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={openEdit} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" />Edit Profile
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={() => setExConfirm(true)}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <UserX className="mr-2 h-4 w-4" />Move to Ex-Staff
            </Button>
          )}
        </div>
      </div>

      {/* ── Profile header ── */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-4">
            <label className="relative h-16 w-16 shrink-0 cursor-pointer group" title="Click to change photo">
              {photoUrl ? (
                <img src={photoUrl} alt={staff.name} className="h-16 w-16 rounded-full object-cover border" />
              ) : (
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                  <User className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingPhoto
                  ? <Loader2 className="h-5 w-5 text-white animate-spin" />
                  : <Camera className="h-5 w-5 text-white" />}
              </div>
              <input type="file" accept="image/*" className="hidden"
                disabled={uploadingPhoto}
                onChange={e => handlePhotoUpload(e.target.files?.[0] ?? null)} />
            </label>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate">{staff.name}</h2>
              {staff.jobRole && (
                <p className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                  <Briefcase className="h-3.5 w-3.5 shrink-0" />{staff.jobRole}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <StatusBadge status={staff.overall} />
                {staff.sia?.type && (
                  <span className="inline-flex items-center gap-1 text-xs rounded-full bg-blue-500/15 text-blue-500 border border-blue-500/30 px-2 py-0.5">
                    <BadgeAlert className="h-3 w-3" />{staff.sia.type}
                  </span>
                )}
              </div>
              {/* ACS score bar */}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[180px]">
                  <div className="h-full bg-success rounded-full transition-all"
                    style={{ width: `${(acsScore / acsTotal) * 100}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">ACS: {acsScore}/{acsTotal}</span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
            {staff.phone && (
              <a href={`tel:${staff.phone}`} className="flex items-center gap-1.5 hover:text-foreground">
                <Phone className="h-3.5 w-3.5" />{staff.phone}
              </a>
            )}
            {staff.email && (
              <a href={`mailto:${staff.email}`} className="flex items-center gap-1.5 hover:text-foreground">
                <Mail className="h-3.5 w-3.5" />{staff.email}
              </a>
            )}
            {staff.deployStatus && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                <span className="capitalize">{staff.deployStatus}</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Portal access ── */}
      {canManagePortalAccess && (
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Staff portal access</p>
              {regClaimed ? (
                <p className="text-xs text-success">This staff member has already registered their own login.</p>
              ) : regCode ? (
                <p className="text-xs text-muted-foreground">
                  Share this one-time code so {staff.name.split(" ")[0]} can register at <span className="font-medium">/register</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Loading…</p>
              )}
            </div>
            {!regClaimed && regCode && (
              <div className="flex items-center gap-2">
                <span className="rounded-md border bg-muted/50 px-3 py-1.5 font-mono text-sm font-bold tracking-widest">
                  {regCode}
                </span>
                <Button variant="outline" size="icon-sm" onClick={copyCode} title="Copy code">
                  {regCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="icon-sm" onClick={regenerateCode} disabled={regLoading} title="Generate new code">
                  <RefreshCw className={`h-3.5 w-3.5 ${regLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Tab bar ── */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1">
        {TABS.map(({ id: tid, label, Icon }) => (
          <button key={tid} onClick={() => setTab(tid)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              tab === tid ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ════════ OVERVIEW ════════ */}
      {tab === "overview" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Compliance Documents</CardTitle></CardHeader>
            <CardContent className="divide-y px-4">
              <ComplianceRow icon={<ShieldCheck className="h-4 w-4" />} label="SIA Licence"
                number={staff.sia?.number ? `${staff.sia.number}${staff.sia.type ? ` — ${staff.sia.type}` : ""}` : undefined}
                expiry={staff.sia?.expiry} />
              <ComplianceRow icon={<CreditCard className="h-4 w-4" />} label="CSCS Card"
                number={staff.cscs?.number} expiry={staff.cscs?.expiry} />
              <ComplianceRow icon={<FileText className="h-4 w-4" />} label="Right to Work"
                number={staff.visa?.type ?? "British (no visa required)"} expiry={staff.visa?.expiry} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                { label: "Date of Birth",     val: dob ? fmtDate(dob) : null },
                { label: "Nationality",        val: staff.nationality },
                { label: "Gender",             val: staff.gender },
                { label: "Place of Birth",     val: staff.placeOfBirth },
                { label: "NI Number",          val: staff.ni },
                { label: "Driving Licence",    val: staff.drivingLicence },
                { label: "Address",            val: staff.address },
                { label: "Contract",           val: staff.contract },
              ].filter((r) => r.val).map(({ label, val }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
                  <p className="mt-0.5">{val}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {staff.emergencyContact?.name && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Contact className="h-4 w-4" />Emergency Contact
                </CardTitle>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Name</p>
                  <p className="mt-0.5">{staff.emergencyContact.name}</p>
                </div>
                {staff.emergencyContact.relationship && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Relationship</p>
                    <p className="mt-0.5">{staff.emergencyContact.relationship}</p>
                  </div>
                )}
                {staff.emergencyContact.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Phone</p>
                    <a href={`tel:${staff.emergencyContact.phone}`} className="mt-0.5 flex items-center gap-1 hover:text-foreground text-muted-foreground">
                      <Phone className="h-3 w-3" />{staff.emergencyContact.phone}
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ════════ DOCUMENTS ════════ */}
      {tab === "documents" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            Document upload is coming in a future release. This page shows which documents are on file.
          </p>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BadgeAlert className="h-4 w-4" />Identity &amp; Licensing
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <DocRow icon={<ShieldCheck className="h-4 w-4" />} label="SIA Licence (physical scan)"
                status={docStatusOf(docs.siaPhysical?.uploaded)} uploadedDate={docs.siaPhysical?.date}
                note="Front and back of the physical SIA badge" />
              <DocRow icon={<FileText className="h-4 w-4" />} label="Passport"
                status={docStatusOf(docs.passport?.uploaded)} uploadedDate={docs.passport?.date}
                note="Required for BS 7858 identity verification" />
              <DocRow icon={<CreditCard className="h-4 w-4" />} label="BRP / Share Code / RTW Evidence"
                status={docStatusOf(docs.brpCard?.uploaded)} uploadedDate={docs.brpCard?.date}
                note="Biometric Residence Permit or right to work share code proof" />
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
                note="Must be dated within the last 3 months" />
              <DocRow icon={<FileText className="h-4 w-4" />} label="Proof of Address 2"
                status={docStatusOf(docs.proofOfAddress2?.uploaded)} uploadedDate={docs.proofOfAddress2?.date}
                note="Second document, also within last 3 months" />
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
                note="Signed job application / new starter form" />
              <DocRow icon={<FileText className="h-4 w-4" />} label="Employment Contract"
                status={staff.contract && staff.contract.toLowerCase() !== "not signed" ? "uploaded" : "missing"}
                note={`Status: ${staff.contract || "Not signed"}`} />
              <DocRow icon={<FileText className="h-4 w-4" />} label="P45 / P60 (previous employer)"
                status={docStatusOf(docs.p45?.uploaded)} uploadedDate={docs.p45?.date}
                note="Last employer's P45 or most recent P60" />
              <DocRow icon={<FileText className="h-4 w-4" />} label="Bank Account Letter / Void Cheque"
                status={docStatusOf(docs.bankLetter?.uploaded)} uploadedDate={docs.bankLetter?.date}
                note="Required for payroll setup" />
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
                note="Site-specific assignment instructions, legally required per SIA" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ════════ VETTING (BS 7858) ════════ */}
      {tab === "vetting" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Fingerprint className="h-4 w-4" />DBS Check
              </CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3 text-sm px-4 py-3">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4" />BS 7858 Screening
              </CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3 text-sm px-4 py-3">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Briefcase className="h-4 w-4" />References
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y px-4">
              {(["ref1", "ref2"] as const).map((key, i) => {
                const ref = staff.references?.[key]
                return (
                  <div key={key} className="py-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Reference {i + 1}</p>
                    {ref?.name ? (
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

          {staff.employmentHistory && staff.employmentHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />Employment History
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <ol className="space-y-1 text-sm list-decimal list-inside text-muted-foreground">
                  {staff.employmentHistory.map((entry, i) => (
                    <li key={i}>{entry}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ════════ TRAINING ════════ */}
      {tab === "training" && (
        <div className="space-y-4">
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
                  { key: "conflictManagement",label: "Conflict Management",           icon: <Swords className="h-4 w-4" /> },
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
                      </div>
                      <DocStatusChip status={item?.completed ? docStatusOf(true, item.expiry) : "missing"} />
                      <button onClick={() => isEditing ? setEditingKey(null) : startEdit(key, item)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit">
                        {isEditing ? <XIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => clearStdCourse(key)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Clear">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Inline edit form */}
                    {isEditing && (
                      <div className="ml-8 mb-2 rounded-lg border bg-muted/20 p-3 space-y-2">
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
        </div>
      )}

      {/* ════════ ACS AUDIT ════════ */}
      {tab === "acs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">ACS Readiness Score</p>
              <p className="text-xs text-muted-foreground">Based on key audit checkpoints</p>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-bold ${acsScore >= acsTotal * 0.8 ? "text-success" : acsScore >= acsTotal * 0.6 ? "text-warning" : "text-destructive"}`}>
                {acsScore}/{acsTotal}
              </p>
              <p className="text-xs text-muted-foreground">{Math.round((acsScore / acsTotal) * 100)}%</p>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Licensing</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="Valid SIA licence held"           done={acs.siaValid}       note="Must be in-date and active" />
              <AcsCheckRow label="SIA licence type recorded"        done={acs.siaType}        note="Door Supervisor / Security Guard / CCTV / Close Protection" />
              <AcsCheckRow label="Physical SIA copy on file"        done={acs.siaPhysicalCopy} note="Scanned front and back of badge" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Identity &amp; Right to Work</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="Right to Work verified"           done={acs.rtwVerified}    note="Passport, BRP, or share code confirmed" />
              <AcsCheckRow label="Passport copy on file"           done={acs.passportOnFile}  note="Required for BS 7858 identity check" />
              <AcsCheckRow label="Proof of address on file"        done={acs.addressProof}    note="Two documents within last 3 months" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Vetting (BS 7858)</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="DBS check obtained"              done={acs.dbsChecked}      note="Enhanced DBS recommended for security roles" />
              <AcsCheckRow label="BS 7858 screening complete"      done={acs.bs7858}          note="Full 5-year employment history + references verified" />
              <AcsCheckRow label="Two satisfactory references"     done={acs.twoRefs}         note="Both references marked Satisfactory" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Training &amp; Competency</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="First Aid certificate held"       done={acs.firstAid}       note="Emergency First Aid at Work — valid 3 years" />
              <AcsCheckRow label="Conflict management trained"      done={acs.conflictMgmt}   note="Mandatory for Door Supervisors under SIA guidance" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Employment &amp; Operations</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="Employment contract signed"       done={acs.contractSigned}   note="Signed copy on file" />
              <AcsCheckRow label="Assignment instructions signed"   done={acs.assignmentInstr}  note="Site-specific — legally required by SIA" />
              <AcsCheckRow label="Emergency contact recorded"       done={acs.emergencyContact} note="Name, phone, and relationship" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Edit Profile slide-over ── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setEditOpen(false)} />
          <div className="flex w-full max-w-md flex-col bg-background shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-base font-semibold">Edit Profile — {staff.name}</h3>
              <button onClick={() => setEditOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors">
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {editError && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{editError}</p>
              )}

              {/* Basic Info */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1.5">Basic Info</p>
                <div className="space-y-1.5">
                  <Label>Full name *</Label>
                  <Input value={profileDraft.name}
                    onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))}
                    placeholder="Full name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Job role / title</Label>
                  <Input value={profileDraft.jobRole}
                    onChange={e => setProfileDraft(d => ({ ...d, jobRole: e.target.value }))}
                    placeholder="e.g. Security Officer" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={profileDraft.phone}
                      onChange={e => setProfileDraft(d => ({ ...d, phone: e.target.value }))}
                      placeholder="+44..." />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input value={profileDraft.email}
                      onChange={e => setProfileDraft(d => ({ ...d, email: e.target.value }))}
                      placeholder="name@email.com" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Nationality</Label>
                    <Input value={profileDraft.nationality}
                      onChange={e => setProfileDraft(d => ({ ...d, nationality: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Gender</Label>
                    <select value={profileDraft.gender}
                      onChange={e => setProfileDraft(d => ({ ...d, gender: e.target.value }))}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="">—</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Date of birth</Label>
                    <Input type="date" value={profileDraft.dob}
                      onChange={e => setProfileDraft(d => ({ ...d, dob: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>NI number</Label>
                    <Input value={profileDraft.ni}
                      onChange={e => setProfileDraft(d => ({ ...d, ni: e.target.value }))}
                      placeholder="AB123456C" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Home address</Label>
                  <Input value={profileDraft.address}
                    onChange={e => setProfileDraft(d => ({ ...d, address: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contract status</Label>
                  <select value={profileDraft.contract}
                    onChange={e => setProfileDraft(d => ({ ...d, contract: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">—</option>
                    <option value="Signed">Signed</option>
                    <option value="Not signed">Not signed</option>
                    <option value="Pending">Pending</option>
                  </select>
                </div>
              </section>

              {/* SIA Licence */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1.5 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />SIA Licence
                </p>
                <div className="space-y-1.5">
                  <Label>Licence number</Label>
                  <Input value={profileDraft.sia_number}
                    onChange={e => setProfileDraft(d => ({ ...d, sia_number: e.target.value }))}
                    placeholder="e.g. 1234-5678-9012-3456" />
                </div>
                <div className="space-y-1.5">
                  <Label>Licence type</Label>
                  <select value={profileDraft.sia_type}
                    onChange={e => setProfileDraft(d => ({ ...d, sia_type: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">—</option>
                    <option value="Door Supervisor">Door Supervisor</option>
                    <option value="Security Guard">Security Guard</option>
                    <option value="CCTV (Public Space Surveillance)">CCTV (Public Space Surveillance)</option>
                    <option value="Close Protection">Close Protection</option>
                    <option value="Cash and Valuables in Transit">Cash and Valuables in Transit</option>
                    <option value="Key Holding">Key Holding</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Expiry date</Label>
                  <Input type="date" value={profileDraft.sia_expiry}
                    onChange={e => setProfileDraft(d => ({ ...d, sia_expiry: e.target.value }))} />
                </div>
              </section>

              {/* CSCS Card */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1.5 flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5" />CSCS Card
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Card number</Label>
                    <Input value={profileDraft.cscs_number}
                      onChange={e => setProfileDraft(d => ({ ...d, cscs_number: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Expiry date</Label>
                    <Input type="date" value={profileDraft.cscs_expiry}
                      onChange={e => setProfileDraft(d => ({ ...d, cscs_expiry: e.target.value }))} />
                  </div>
                </div>
              </section>

              {/* Right to Work */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1.5 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />Right to Work
                </p>
                <div className="space-y-1.5">
                  <Label>Visa / RTW type</Label>
                  <Input value={profileDraft.rtw_type}
                    onChange={e => setProfileDraft(d => ({ ...d, rtw_type: e.target.value }))}
                    placeholder="e.g. Skilled Worker Visa, ILR, British Citizen..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Expiry date <span className="font-normal text-muted-foreground">(leave blank if British)</span></Label>
                  <Input type="date" value={profileDraft.rtw_expiry}
                    onChange={e => setProfileDraft(d => ({ ...d, rtw_expiry: e.target.value }))} />
                </div>
              </section>
            </div>

            <div className="flex gap-2 border-t px-5 py-4">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={saveEdit} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Move to Ex-Staff confirm ── */}
      {exConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <UserX className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Move {staff.name} to Ex-Staff?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Their folder will be kept as a record — nothing is permanently deleted.
                  You can restore them any time from Staff → Ex-Staff.
                </p>
              </div>
            </div>
            {exError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{exError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setExConfirm(false)}>Cancel</Button>
              <Button variant="destructive" className="flex-1 gap-2" disabled={exMoving} onClick={moveToExStaff}>
                {exMoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
                {exMoving ? "Moving…" : "Move to Ex-Staff"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
