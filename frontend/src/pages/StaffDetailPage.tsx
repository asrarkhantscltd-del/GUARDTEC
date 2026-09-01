import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/contexts/AuthContext"
import type { StaffMember, DiscRecord, TrainingItem, ExtraTrainingItem, TrainingRecord, EmploymentHistoryEntry } from "@/types/staff"
import { RoleChipPicker, parseRoles } from "@/components/ui/role-picker"
import { daysUntil, fmtDate, discTypeLabels, discTypeCls } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  ArrowLeft, Phone, Mail, User, ShieldCheck, CreditCard, FileText,
  Loader2, Upload, Eye, CheckCircle2, AlertCircle, Clock, FileQuestion,
  Fingerprint, Building2, GraduationCap, ClipboardList, UserCheck,
  HeartPulse, Flame, Swords, HardHat, Camera, Briefcase, Car,
  MapPin, Contact, BadgeAlert, Pencil, Trash2, Plus, X as XIcon,
  KeyRound, Copy, RefreshCw, Check, UserX,
  MessageSquare, Package, Send,
  Paperclip, FileVideo, Image as ImageIcon, Download, Landmark, ShieldAlert,
} from "lucide-react"
import { ConfidentialDocManagerRow, CONFIDENTIAL_STAFF_DOCS } from "@/components/profile/ProfileShared"

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
  icon, label, status, uploadedDate, expiry, note, onEdit, viewUrl,
  onDelete, confirmingDelete, onConfirmDelete, onCancelDelete, deleting,
}: {
  icon: React.ReactNode; label: string; status: DocStatus
  uploadedDate?: string; expiry?: string; note?: string
  onEdit?: () => void
  viewUrl?: string
  onDelete?: () => void
  confirmingDelete?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
  deleting?: boolean
}) {
  return (
    <div className="border-b last:border-0">
      <div className="flex items-center gap-3 py-2.5">
        <div className="text-muted-foreground w-5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {uploadedDate && <p className="text-xs text-muted-foreground">Uploaded {fmtDate(uploadedDate)}</p>}
          {expiry && <p className="text-xs text-muted-foreground">Expires {fmtDate(expiry)}</p>}
          {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DocStatusChip status={status} />
          {viewUrl && (
            <a href={viewUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="View document">
              <Eye className="h-3.5 w-3.5" />
            </a>
          )}
          {viewUrl && (
            <a href={viewUrl} download
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Download document">
              <Download className="h-3.5 w-3.5" />
            </a>
          )}
          {onEdit && (
            <button onClick={onEdit}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit / Upload">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {viewUrl && onDelete && (
            <button onClick={onDelete}
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete document">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {confirmingDelete && (
        <div className="mb-2.5 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">Remove this document? The staff member will need to re-upload it.</p>
          <div className="flex shrink-0 gap-2">
            <button onClick={onCancelDelete} className="rounded px-2.5 py-1 text-xs border hover:bg-muted transition-colors">Cancel</button>
            <button onClick={onConfirmDelete} disabled={deleting}
              className="rounded bg-destructive px-2.5 py-1 text-xs text-white hover:bg-destructive/90 transition-colors disabled:opacity-50">
              {deleting ? "Removing…" : "Yes, remove"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


function AcsCheckRow({ label, done, note, viewUrl }: { label: string; done?: boolean; note?: string; viewUrl?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-md px-3 py-2.5 ${done ? "bg-success/5" : "bg-destructive/5"}`}>
      {done
        ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
        : <AlertCircle  className="h-4 w-4 text-destructive mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {viewUrl && (
        <a href={viewUrl} target="_blank" rel="noopener noreferrer"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0" title="View document">
          <Eye className="h-3.5 w-3.5" />
        </a>
      )}
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
  { id: "hr",         label: "HR Records",   Icon: BadgeAlert },
  { id: "provisions", label: "Provisions",   Icon: Package },
  { id: "messages",   label: "Messages",     Icon: MessageSquare },
] as const

type TabId = typeof TABS[number]["id"]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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

  // Disciplinary records
  const [discRecords, setDiscRecords]   = useState<DiscRecord[]>([])
  const [discLoading, setDiscLoading]   = useState(false)
  const [discForm, setDiscForm]         = useState(false)
  const [discDraft, setDiscDraft]       = useState({ incident_date: "", type: "warning", description: "", action_taken: "" })
  const [discSaving, setDiscSaving]     = useState(false)
  const [discError, setDiscError]       = useState("")

  // Messages
  const [messages, setMessages]       = useState<{
    id: string; message: string; sender_name: string; sender_role: string; created_at: string
    attachment_id?: string; attachment_filename?: string; attachment_original_name?: string
    attachment_mime_type?: string; attachment_size?: number
  }[]>([])
  const [msgLoading, setMsgLoading]   = useState(false)
  const [msgDraft, setMsgDraft]       = useState("")
  const [msgSending, setMsgSending]   = useState(false)
  const [msgFile, setMsgFile]         = useState<File | null>(null)
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null)
  const [deletingMsg, setDeletingMsg] = useState(false)
  const msgFileInputRef               = useRef<HTMLInputElement>(null)
  const msgEndRef                     = useRef<HTMLDivElement>(null)

  // Provisions
  const [provisions, setProvisions]       = useState<{id:string;item:string;provided:boolean;date_given:string|null;date_returned:string|null;notes:string|null}[]>([])
  const [provLoading, setProvLoading]     = useState(false)
  const [provForm, setProvForm]           = useState(false)
  const [provDraft, setProvDraft]         = useState({ itemType: "Security Jacket", quantity: 1, provided: true, date_given: "", date_returned: "", notes: "" })
  const [provSaving, setProvSaving]       = useState(false)

  // Contract
  const [contractExists, setContractExists]       = useState(false)
  const [contractUploading, setContractUploading] = useState(false)

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

  // Document editing
  const [editingDocKey, setEditingDocKey] = useState<string | null>(null)
  const [docDraft, setDocDraft]           = useState<{ uploaded: boolean; date: string }>({ uploaded: false, date: "" })
  const [docSaving, setDocSaving]         = useState(false)
  const [uploadingDoc, setUploadingDoc]   = useState(false)
  const [docFileName, setDocFileName]     = useState("")
  const docFileInputRef                   = useRef<HTMLInputElement>(null)
  const [confirmDeleteDocKey, setConfirmDeleteDocKey] = useState<string | null>(null)
  const [deletingDoc, setDeletingDoc]     = useState(false)
  const [confirmDeleteCertKey, setConfirmDeleteCertKey] = useState<string | null>(null)
  const [deletingCert, setDeletingCert]   = useState(false)

  // Vetting editing
  const [editingVetting, setEditingVetting] = useState<"dbs" | "bs7858" | "ref1" | "ref2" | "driver" | null>(null)
  const [vettingDraft, setVettingDraft]     = useState<Record<string, string | boolean>>({})
  const [vettingSaving, setVettingSaving]   = useState(false)
  const [newHistoryEntry, setNewHistoryEntry] = useState("")
  const [historyAdding, setHistoryAdding]   = useState(false)

  useEffect(() => {
    api.get<StaffMember[]>("/api/staff")
      .then((data) => {
        const found = data.find((s) => s.id === id) ?? null
        setStaff(found)
        if (found?.training) setTrainingData(found.training)
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    api.getBlob(`/api/staff/${id}/photo`)
      .then((blob) => { if (blob) setPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (tab === "hr")         loadDiscRecords()
    if (tab === "messages")   loadMessages()
    if (tab === "provisions") loadProvisions()
    if (tab === "hr")         loadContractInfo()
  }, [tab, id])

  // Deep-link support: /staff/:id?tab=messages (used by the notification bell)
  useEffect(() => {
    const t = searchParams.get("tab")
    if (t && TABS.some(x => x.id === t)) setTab(t as TabId)
  }, [searchParams])

  // Deep-link support: /staff/:id?edit=1 (used by the Staff Overview quick-edit action)
  useEffect(() => {
    if (searchParams.get("edit") === "1" && staff && canEdit) {
      openEdit()
      const next = new URLSearchParams(searchParams)
      next.delete("edit")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, staff])

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
      ec_name:     staff.emergencyContact?.name ?? "",
      ec_phone:    staff.emergencyContact?.phone ?? "",
      ec_rel:      staff.emergencyContact?.relationship ?? "",
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
        emergencyContact: {
          name:         profileDraft.ec_name || undefined,
          phone:        profileDraft.ec_phone || undefined,
          relationship: profileDraft.ec_rel || undefined,
        },
      }
      await api.put(`/api/staff/${id}`, body)
      await refreshStaffRecord()
      setEditOpen(false)
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Network error.")
    } finally {
      setEditSaving(false)
    }
  }

  useEffect(() => {
    if (!canManagePortalAccess || !id) return
    api.get<{ ok: boolean; code: string; claimed: boolean }>(`/api/staff/${id}/registration-code`)
      .then((d) => { if (d.ok) { setRegCode(d.code); setRegClaimed(d.claimed) } })
      .catch(() => {})
  }, [id, canManagePortalAccess])

  async function regenerateCode() {
    setRegLoading(true)
    try {
      const d = await api.post<{ ok: boolean; code: string }>(`/api/staff/${id}/registration-code/regenerate`)
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
      await api.post(`/api/staff/${id}/photo`, file)
      const blob = await api.getBlob(`/api/staff/${id}/photo`)
      if (blob) {
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
      await api.delete(`/api/staff/${id}`)
      navigate("/staff", { replace: true })
    } catch (err) {
      setExError(err instanceof ApiError ? err.message : "Network error.")
      setExMoving(false)
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

  // ── Generic field patcher ──
  async function patchField(updates: Partial<StaffMember>) {
    if (!staff || !id) return
    const merged = { ...staff, ...updates }
    await api.put(`/api/staff/${id}`, merged)
    await refreshStaffRecord()
  }

  // ── Document helpers ──
  function openDocEdit(docKey: string) {
    const existing = (staff?.documents as Record<string, { uploaded?: boolean; date?: string }>)?.[docKey]
    setEditingDocKey(docKey)
    setDocDraft({ uploaded: existing?.uploaded ?? false, date: existing?.date ?? "" })
    setDocFileName("")
  }

  async function uploadDocFile(file: File) {
    if (!editingDocKey || !id) return
    setUploadingDoc(true)
    try {
      const d = await api.post<{ ok: boolean; date: string }>(`/api/staff/${id}/documents/${editingDocKey}`, file)
      if (d.ok) {
        setDocDraft({ uploaded: true, date: d.date })
        setDocFileName(file.name)
        await refreshStaffRecord()
      }
    } finally {
      setUploadingDoc(false)
    }
  }

  async function saveDoc() {
    if (!editingDocKey || !staff) return
    setDocSaving(true)
    const updatedDocs = {
      ...staff.documents,
      [editingDocKey]: { uploaded: docDraft.uploaded, date: docDraft.date || undefined },
    }
    await patchField({ documents: updatedDocs })
    setEditingDocKey(null)
    setDocSaving(false)
  }

  async function refreshStaffRecord() {
    if (!id) return
    const data = await api.get<StaffMember[]>("/api/staff")
    const updated = data.find(s => s.id === id) ?? null
    setStaff(updated)
    if (updated?.training) setTrainingData(updated.training)
  }

  async function deleteDocFile(docKey: string) {
    if (!id) return
    setDeletingDoc(true)
    try {
      await api.delete(`/api/staff/${id}/documents/${docKey}`)
      await refreshStaffRecord()
      toast.success("Document removed")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setDeletingDoc(false)
      setConfirmDeleteDocKey(null)
    }
  }

  function docDeleteProps(docKey: string) {
    return {
      onDelete: canDelete ? () => setConfirmDeleteDocKey(docKey) : undefined,
      confirmingDelete: confirmDeleteDocKey === docKey,
      onConfirmDelete: () => deleteDocFile(docKey),
      onCancelDelete: () => setConfirmDeleteDocKey(null),
      deleting: deletingDoc,
    }
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

  // ── Vetting helpers ──
  function openVettingEdit(section: "dbs" | "bs7858" | "ref1" | "ref2" | "driver") {
    if (!staff) return
    setEditingVetting(section)
    if (section === "dbs") {
      setVettingDraft({
        type:          staff.dbs?.type ?? "",
        checkDate:     staff.dbs?.checkDate ?? "",
        certificateNo: staff.dbs?.certificateNo ?? "",
      })
    } else if (section === "driver") {
      setVettingDraft({
        fuelCardNumber: staff.driverAssignment?.fuelCardNumber ?? "",
        tachoCard:      staff.driverAssignment?.tachoCard ?? "",
        tachoExpiry:    staff.driverAssignment?.tachoExpiry ?? "",
        dbsNumber:      staff.driverAssignment?.dbsNumber ?? "",
        dbsDate:        staff.driverAssignment?.dbsDate ?? "",
        lastAssessment: staff.driverAssignment?.lastAssessment ?? "",
        status:         staff.driverAssignment?.status ?? "active",
        notes:          staff.driverAssignment?.notes ?? "",
      })
    } else if (section === "bs7858") {
      setVettingDraft({
        completed:       staff.bs7858?.completed ?? false,
        completionDate:  staff.bs7858?.completionDate ?? "",
        reviewer:        staff.bs7858?.reviewer ?? "",
      })
    } else {
      const ref = staff.references?.[section]
      setVettingDraft({
        name:        ref?.name ?? "",
        company:     ref?.company ?? "",
        email:       ref?.email ?? "",
        phone:       ref?.phone ?? "",
        status:      ref?.status ?? "Not Started",
      })
    }
  }

  async function saveVetting() {
    if (!editingVetting || !staff) return
    setVettingSaving(true)
    if (editingVetting === "dbs") {
      await patchField({
        dbs: {
          type:          (vettingDraft.type as string) || undefined,
          checkDate:     (vettingDraft.checkDate as string) || undefined,
          certificateNo: (vettingDraft.certificateNo as string) || undefined,
        },
      })
    } else if (editingVetting === "bs7858") {
      await patchField({
        bs7858: {
          completed:      vettingDraft.completed as boolean,
          completionDate: (vettingDraft.completionDate as string) || undefined,
          reviewer:       (vettingDraft.reviewer as string) || undefined,
        },
      })
    } else if (editingVetting === "driver") {
      await patchField({
        driverAssignment: {
          fuelCardNumber: (vettingDraft.fuelCardNumber as string) || undefined,
          tachoCard:      (vettingDraft.tachoCard as string) || undefined,
          tachoExpiry:    (vettingDraft.tachoExpiry as string) || undefined,
          dbsNumber:      (vettingDraft.dbsNumber as string) || undefined,
          dbsDate:        (vettingDraft.dbsDate as string) || undefined,
          lastAssessment: (vettingDraft.lastAssessment as string) || undefined,
          status:         (vettingDraft.status as "active" | "suspended" | "on_leave") || "active",
          notes:          (vettingDraft.notes as string) || undefined,
        },
      })
    } else {
      await patchField({
        references: {
          ...staff.references,
          [editingVetting]: {
            name:    (vettingDraft.name as string) || undefined,
            company: (vettingDraft.company as string) || undefined,
            email:   (vettingDraft.email as string) || undefined,
            phone:   (vettingDraft.phone as string) || undefined,
            status:  (vettingDraft.status as string) || undefined,
          },
        },
      })
    }
    setEditingVetting(null)
    setVettingSaving(false)
  }

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

  async function loadMessages() {
    if (!id) return
    setMsgLoading(true)
    try {
      const d = await api.get<{ ok: boolean; messages: typeof messages }>(`/api/staff/${id}/messages`)
      if (d.ok) {
        setMessages(d.messages)
        setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
      }
    } finally {
      setMsgLoading(false)
    }
  }

  async function sendMessage() {
    if (!msgDraft.trim() && !msgFile) return
    setMsgSending(true)
    try {
      const d = await api.post<{ ok: boolean; message: { id: string } }>(`/api/staff/${id}/messages`, { message: msgDraft.trim() || `📎 ${msgFile?.name}` })
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
      await loadMessages()
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

  async function deleteMessage(messageId: string) {
    setDeletingMsg(true)
    try {
      await api.delete(`/api/messages/${messageId}`)
      setMessages(prev => prev.filter(m => m.id !== messageId))
      toast.success("Message removed")
    } finally {
      setDeletingMsg(false)
      setConfirmDeleteMsgId(null)
    }
  }

  function msgAttachIcon(mime?: string) {
    if (!mime) return <FileText className="h-3.5 w-3.5 shrink-0" />
    if (mime.startsWith("video/")) return <FileVideo className="h-3.5 w-3.5 shrink-0" />
    if (mime.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5 shrink-0" />
    return <FileText className="h-3.5 w-3.5 shrink-0" />
  }

  async function loadProvisions() {
    if (!id) return
    setProvLoading(true)
    try {
      const d = await api.get<{ ok: boolean; provisions: any[] }>(`/api/staff/${id}/provisions`)
      if (d.ok) setProvisions(d.provisions)
    } finally {
      setProvLoading(false)
    }
  }

  async function addProvision() {
    setProvSaving(true)
    try {
      const itemStr = `${provDraft.itemType} × ${provDraft.quantity}`
      const d = await api.post<{ ok: boolean; error?: string }>(`/api/staff/${id}/provisions`, { item: itemStr, provided: provDraft.provided, date_given: provDraft.date_given, date_returned: provDraft.date_returned, notes: provDraft.notes })
      if (!d.ok) { toast.error(d.error ?? "Failed to save."); return }
      setProvForm(false)
      setProvDraft({ itemType: "Security Jacket", quantity: 1, provided: true, date_given: "", date_returned: "", notes: "" })
      await loadProvisions()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save.")
    } finally {
      setProvSaving(false)
    }
  }

  async function loadContractInfo() {
    if (!id) return
    try {
      const d = await api.get<{ ok: boolean; exists: boolean }>(`/api/staff/${id}/contract/info`)
      if (d.ok) setContractExists(d.exists)
    } catch {}
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

  async function deleteProvision(provId: string) {
    await api.delete(`/api/provisions/${provId}`)
    await loadProvisions()
  }

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

  // Office-based login roles (Director/Ops Manager/HR Manager/Office Manager/
  // Accounts) are never deployed as a guard, so SIA/CSCS/training checkpoints
  // don't apply to them — auto-pass rather than flag as missing.
  const isOfficeExempt = ["director", "ops_manager", "hr_manager", "office_manager", "accounts", "media", "fleet_manager"].includes(staff.linkedRole ?? "")

  // ACS audit — computed pass/fail for each point
  const acs = {
    siaValid:          isOfficeExempt || !!(staff.sia?.number && (daysUntil(staff.sia.expiry) ?? 1) >= 0),
    siaType:           isOfficeExempt || !!(staff.sia?.type),
    rtwVerified:       !!(staff.visa?.type || staff.nationality?.toLowerCase().includes("british")),
    dbsChecked:        !!(staff.dbs?.checkDate),
    bs7858:            !!(staff.bs7858?.completed),
    twoRefs:           !!(staff.references?.ref1?.status === "Satisfactory" && staff.references?.ref2?.status === "Satisfactory"),
    contractSigned:    !!(staff.contract && staff.contract.toLowerCase() !== "not signed"),
    // A staff member uploading their certificate (certUploaded) is real
    // evidence for audit purposes, same as a manager manually ticking
    // "completed" — checking `completed` alone meant an uploaded cert never
    // flipped this checkpoint to pass.
    firstAid:          isOfficeExempt || !!(training.firstAid?.completed || training.firstAid?.certUploaded),
    conflictMgmt:      isOfficeExempt || !!(training.conflictManagement?.completed || training.conflictManagement?.certUploaded),
    siaPhysicalCopy:   isOfficeExempt || !!(docs.siaPhysical?.uploaded),
    passportOnFile:    !!(docs.passport?.uploaded),
    addressProof:      !!(docs.proofOfAddress1?.uploaded),
    assignmentInstr:   !!(docs.assignmentInstructions?.uploaded),
    emergencyContact:  !!(staff.emergencyContact?.name),
  }

  const acsScore = Object.values(acs).filter(Boolean).length
  const acsTotal = Object.values(acs).length

  return (
    <div className="space-y-4">
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
              <h2 className="font-display text-xl font-bold truncate">{staff.name}</h2>
              {staff.jobRole && (
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {parseRoles(staff.jobRole).map(r => (
                    <span key={r} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">{r}</span>
                  ))}
                </div>
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
        <motion.div key="overview" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
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
                { label: "UTR",                val: staff.utrNotApplicable ? "Not applicable" : staff.uniqueTaxpayerReference },
                { label: "Previous Names",     val: staff.previousNames },
                { label: "Driving Licence",    val: staff.drivingLicence },
                { label: "Address",            val: staff.address },
                { label: "Years at Address",   val: staff.yearsAtCurrentAddress != null ? String(staff.yearsAtCurrentAddress) : null },
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-4 w-4" />Bank Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
              {staff.bankDetails?.accountNumber ? (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Account Holder</p>
                    <p className="mt-0.5">{staff.bankDetails.accountHolderName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Bank</p>
                    <p className="mt-0.5">{staff.bankDetails.bankName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Sort Code</p>
                    <p className="mt-0.5 font-mono">{staff.bankDetails.sortCode || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Account Number</p>
                    <p className="mt-0.5 font-mono">{staff.bankDetails.accountNumber}</p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground italic sm:col-span-2">Not provided yet — staff can add this from their own portal.</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ════════ DOCUMENTS ════════ */}
      {tab === "documents" && (
        <motion.div key="documents" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          {/* Inline doc edit / upload form */}
          {editingDocKey && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <p className="text-sm font-semibold">Edit document record</p>

              {/* ── File upload section ── */}
              <div className="rounded-md border border-dashed border-border bg-background p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upload file</p>
                <input ref={docFileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadDocFile(f) }} />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => docFileInputRef.current?.click()}
                    disabled={uploadingDoc}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
                    <Upload className="h-3.5 w-3.5" />
                    {uploadingDoc ? "Uploading…" : "Choose file"}
                  </button>
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                    {docFileName || (docDraft.uploaded ? "File already uploaded" : "PDF, JPG, or PNG")}
                  </span>
                </div>
                {docDraft.uploaded && (
                  <a href={`/api/staff/${id}/documents/${editingDocKey}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Eye className="h-3 w-3" />View current document
                  </a>
                )}
              </div>

              {/* ── Manual mark as on file ── */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Or mark manually</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={docDraft.uploaded}
                    onChange={e => setDocDraft(p => ({ ...p, uploaded: e.target.checked }))}
                    className="rounded" />
                  Document is on file
                </label>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Date received / uploaded</p>
                  <input type="date" value={docDraft.date}
                    onChange={e => setDocDraft(p => ({ ...p, date: e.target.value }))}
                    className="rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={saveDoc} disabled={docSaving}>
                  {docSaving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingDocKey(null)}>Cancel</Button>
              </div>
            </div>
          )}

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
      )}

      {/* ════════ VETTING (BS 7858) ════════ */}
      {tab === "vetting" && (
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
                const ref = staff.references?.[key]
                const isEditing = editingVetting === key
                return (
                  <div key={key} className="py-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reference {i + 1}</p>
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
          {(staff.employmentHistoryDetail ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />5-Year Employment History
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-3">
                {(staff.employmentHistoryDetail as EmploymentHistoryEntry[]).map(e => (
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
          )}

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
      )}

      {/* ════════ TRAINING ════════ */}
      {tab === "training" && (
        <motion.div key="training" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
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
                          <p className="mt-0.5 text-xs text-muted-foreground/60">No certificate uploaded by staff yet</p>
                        )}
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
        </motion.div>
      )}

      {/* ════════ ACS AUDIT ════════ */}
      {tab === "acs" && (
        <motion.div key="acs" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
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
              <AcsCheckRow label="Physical SIA copy on file"        done={acs.siaPhysicalCopy} note="Scanned front and back of badge"
                viewUrl={docs.siaPhysical?.uploaded ? `/api/staff/${id}/documents/siaPhysical` : undefined} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Identity &amp; Right to Work</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="Right to Work verified"           done={acs.rtwVerified}    note="Passport, BRP, or share code confirmed" />
              <AcsCheckRow label="Passport copy on file"           done={acs.passportOnFile}  note="Required for BS 7858 identity check"
                viewUrl={docs.passport?.uploaded ? `/api/staff/${id}/documents/passport` : undefined} />
              <AcsCheckRow label="Proof of address on file"        done={acs.addressProof}    note="Two documents within last 3 months"
                viewUrl={docs.proofOfAddress1?.uploaded ? `/api/staff/${id}/documents/proofOfAddress1` : undefined} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Vetting (BS 7858)</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="DBS check obtained"              done={acs.dbsChecked}      note="Enhanced DBS recommended for security roles"
                viewUrl={docs.dbsCertificate?.uploaded ? `/api/staff/${id}/documents/dbsCertificate` : undefined} />
              <AcsCheckRow label="BS 7858 screening complete"      done={acs.bs7858}          note="Full 5-year employment history + references verified" />
              <AcsCheckRow label="Two satisfactory references"     done={acs.twoRefs}         note="Both references marked Satisfactory" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Training &amp; Competency</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="First Aid certificate held"       done={acs.firstAid}       note="Emergency First Aid at Work — valid 3 years"
                viewUrl={training.firstAid?.certUploaded ? `/api/staff/${id}/training/firstAid/certificate` : undefined} />
              <AcsCheckRow label="Conflict management trained"      done={acs.conflictMgmt}   note="Mandatory for Door Supervisors under SIA guidance"
                viewUrl={training.conflictManagement?.certUploaded ? `/api/staff/${id}/training/conflictManagement/certificate` : undefined} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Employment &amp; Operations</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-3">
              <AcsCheckRow label="Employment contract signed"       done={acs.contractSigned}   note="Signed copy on file"
                viewUrl={contractExists ? `/api/staff/${id}/contract` : undefined} />
              <AcsCheckRow label="Assignment instructions signed"   done={acs.assignmentInstr}  note="Site-specific — legally required by SIA"
                viewUrl={docs.assignmentInstructions?.uploaded ? `/api/staff/${id}/documents/assignmentInstructions` : undefined} />
              <AcsCheckRow label="Emergency contact recorded"       done={acs.emergencyContact} note="Name, phone, and relationship" />
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ════════ HR RECORDS ════════ */}
      {tab === "hr" && (
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
                          {me?.role === "director" && (
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
      )}

      {/* ── Provisions tab ── */}
      {tab === "provisions" && (
        <motion.div key="provisions" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" /> Uniform & Equipment
                </CardTitle>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setProvForm(p => !p)}>
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {provForm && (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Item</Label>
                      <select value={provDraft.itemType}
                        onChange={e => setProvDraft(p => ({ ...p, itemType: e.target.value }))}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                        <option>Security Jacket</option>
                        <option>Fleece</option>
                        <option>Rain Pant</option>
                        <option>T-Shirt</option>
                        <option>Trouser</option>
                        <option>Hi-Vis Vest</option>
                        <option>ID Badge</option>
                        <option>Radio</option>
                        <option>Torch</option>
                        <option>Boots</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>Quantity</Label>
                      <Input type="number" min={1} max={20} value={provDraft.quantity}
                        onChange={e => setProvDraft(p => ({ ...p, quantity: Math.max(1, parseInt(e.target.value) || 1) }))} />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label>Status</Label>
                      <select value={provDraft.provided ? "yes" : "no"}
                        onChange={e => setProvDraft(p => ({ ...p, provided: e.target.value === "yes" }))}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                        <option value="yes">Provided / Given</option>
                        <option value="no">Not Provided</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>Date given</Label>
                      <Input type="date" value={provDraft.date_given}
                        onChange={e => setProvDraft(p => ({ ...p, date_given: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Date returned</Label>
                      <Input type="date" value={provDraft.date_returned}
                        onChange={e => setProvDraft(p => ({ ...p, date_returned: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Notes</Label>
                    <Input placeholder="e.g. Size L, serial number, condition"
                      value={provDraft.notes} onChange={e => setProvDraft(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setProvForm(false)}>Cancel</Button>
                    <Button size="sm" disabled={provSaving} onClick={addProvision}>
                      {provSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Save
                    </Button>
                  </div>
                </div>
              )}
              {provLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
              {!provLoading && provisions.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No items recorded yet.</p>
              )}
              {provisions.map(p => (
                <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border bg-muted/10 px-3 py-2.5">
                  <div className="space-y-0.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{p.item}</span>
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${p.provided ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                        {p.provided ? "Provided" : "Not Provided"}
                      </span>
                    </div>
                    {p.date_given && <p className="text-xs text-muted-foreground">Given: {fmtDate(p.date_given)}</p>}
                    {p.date_returned && <p className="text-xs text-muted-foreground">Returned: {fmtDate(p.date_returned)}</p>}
                    {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                  </div>
                  {canDelete && (
                    <button onClick={() => deleteProvision(p.id)}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Messages tab ── */}
      {tab === "messages" && (
        <motion.div key="messages" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
          <Card className="flex flex-col" style={{ minHeight: "480px" }}>
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Messages with {staff.name}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Messages are private between management and this staff member.</p>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 p-0">
              {/* Message list */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ maxHeight: "360px" }}>
                {msgLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
                {!msgLoading && messages.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Send the first one below.</p>
                )}
                {messages.map(m => {
                  const isStaff = m.sender_role === "staff"
                  const isImage = m.attachment_mime_type?.startsWith("image/")
                  return (
                    <div key={m.id} className={`group flex items-end gap-1.5 ${isStaff ? "justify-start" : "justify-end"}`}>
                      {!isStaff && canDelete && (
                        <button onClick={() => setConfirmDeleteMsgId(m.id)}
                          className="mb-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive hover:bg-destructive/10 group-hover:opacity-100">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      <div className={`max-w-xs rounded-2xl px-3.5 py-2 text-sm shadow-sm ${isStaff ? "bg-muted text-foreground rounded-tl-sm" : "bg-primary text-primary-foreground rounded-tr-sm"}`}>
                        <p className="text-[11px] font-medium mb-0.5 opacity-70">{m.sender_name}</p>
                        <p>{m.message}</p>
                        {m.attachment_filename && (
                          isImage ? (
                            <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" className="mt-1.5 block">
                              <img src={`/api/message-attachments/${m.attachment_filename}`} alt={m.attachment_original_name}
                                className="max-h-48 w-full rounded-lg object-cover" />
                            </a>
                          ) : (
                            <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" download={m.attachment_original_name}
                              className={`mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${isStaff ? "bg-background/60" : "bg-white/15"}`}>
                              {msgAttachIcon(m.attachment_mime_type)}
                              <span className="flex-1 truncate">{m.attachment_original_name}</span>
                              <Download className="h-3 w-3 shrink-0" />
                            </a>
                          )
                        )}
                        <p className={`text-[10px] mt-0.5 opacity-60 text-right`}>
                          {new Date(m.created_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                        </p>
                      </div>
                      {isStaff && canDelete && (
                        <button onClick={() => setConfirmDeleteMsgId(m.id)}
                          className="mb-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive hover:bg-destructive/10 group-hover:opacity-100">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )
                })}
                <div ref={msgEndRef} />
              </div>
              {confirmDeleteMsgId && (
                <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <p className="text-xs font-medium text-destructive">Remove this message for both sides?</p>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => setConfirmDeleteMsgId(null)} className="rounded px-2.5 py-1 text-xs border hover:bg-muted transition-colors">Cancel</button>
                    <button onClick={() => deleteMessage(confirmDeleteMsgId)} disabled={deletingMsg}
                      className="rounded bg-destructive px-2.5 py-1 text-xs text-white hover:bg-destructive/90 transition-colors disabled:opacity-50">
                      {deletingMsg ? "Removing…" : "Yes, remove"}
                    </button>
                  </div>
                </div>
              )}
              {/* Compose */}
              <div className="border-t px-4 py-3 space-y-2">
                {msgFile && (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                    {msgAttachIcon(msgFile.type)}
                    <span className="flex-1 truncate">{msgFile.name}</span>
                    <span className="text-muted-foreground shrink-0">{(msgFile.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button onClick={() => setMsgFile(null)} className="text-muted-foreground hover:text-destructive">
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <input ref={msgFileInputRef} type="file" hidden
                    accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx"
                    onChange={e => { pickMsgFile(e.target.files?.[0] ?? null); e.target.value = "" }} />
                  <button onClick={() => msgFileInputRef.current?.click()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted transition-colors" title="Attach file">
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input
                    value={msgDraft}
                    onChange={e => setMsgDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                    placeholder={`Message ${staff.name}…`}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button size="sm" disabled={msgSending || (!msgDraft.trim() && !msgFile)} onClick={sendMessage} className="gap-1.5">
                    {msgSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Edit Profile slide-over ── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">Edit Profile — {staff.name}</h3>
            <button onClick={() => setEditOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors">
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-6">
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
                  <RoleChipPicker
                    value={profileDraft.jobRole ?? ""}
                    onChange={v => setProfileDraft(d => ({ ...d, jobRole: v }))}
                  />
                  {profileDraft.jobRole && (
                    <p className="text-[11px] text-muted-foreground">
                      Selected: <span className="font-medium text-foreground">{profileDraft.jobRole}</span>
                    </p>
                  )}
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

              {/* Emergency Contact */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1.5 flex items-center gap-1.5">
                  <Contact className="h-3.5 w-3.5" />Emergency Contact
                </p>
                <div className="space-y-1.5">
                  <Label>Contact name</Label>
                  <Input value={profileDraft.ec_name}
                    onChange={e => setProfileDraft(d => ({ ...d, ec_name: e.target.value }))}
                    placeholder="Full name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={profileDraft.ec_phone}
                      onChange={e => setProfileDraft(d => ({ ...d, ec_phone: e.target.value }))}
                      placeholder="+44..." />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Relationship</Label>
                    <Input value={profileDraft.ec_rel}
                      onChange={e => setProfileDraft(d => ({ ...d, ec_rel: e.target.value }))}
                      placeholder="e.g. Spouse, Parent" />
                  </div>
                </div>
              </section>
          </div>

          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-5 py-4">
            <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={saveEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
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
