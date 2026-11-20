import { useEffect, useRef, useState } from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/contexts/AuthContext"
import type { StaffMember, TrainingRecord } from "@/types/staff"
import { RoleChipPicker, parseRoles } from "@/components/ui/role-picker"
import { daysUntil } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  ArrowLeft, Phone, Mail, User, ShieldCheck, CreditCard, FileText, Loader2, Upload, Eye,
  Fingerprint, GraduationCap, ClipboardList, Camera, Briefcase, MapPin, Contact, BadgeAlert,
  Pencil, X as XIcon, KeyRound, Copy, RefreshCw, Check, UserX, MessageSquare, Package,
} from "lucide-react"
import { usePermissions } from "@/hooks/usePermissions"
import OverviewTab from "./staff-detail/OverviewTab"
import DocumentsTab from "./staff-detail/DocumentsTab"
import VettingTab from "./staff-detail/VettingTab"
import AcsTab from "./staff-detail/AcsTab"
import TrainingTab from "./staff-detail/TrainingTab"
import HrTab from "./staff-detail/HrTab"
import ProvisionsTab from "./staff-detail/ProvisionsTab"
import MessagesTab from "./staff-detail/MessagesTab"
import {
  type AcsChecks, type DocTools, type VettingTools, type VettingSection,
} from "./staff-detail/shared"

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
  const { can, isDirector } = usePermissions()
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

  // Contract
  const [contractExists, setContractExists]       = useState(false)

  // Training management
  const [trainingData, setTrainingData]   = useState<TrainingRecord>({})

  // Profile edit panel
  const [editOpen, setEditOpen]       = useState(false)
  const [profileDraft, setProfileDraft] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving]   = useState(false)
  const [editError, setEditError]     = useState("")

  // Document editing
  const [editingDocKey, setEditingDocKey] = useState<string | null>(null)
  const [docDraft, setDocDraft]           = useState<{ uploaded: boolean; date: string }>({ uploaded: false, date: "" })
  const [uploadingDoc, setUploadingDoc]   = useState(false)
  const [docFileName, setDocFileName]     = useState("")
  const docFileInputRef                   = useRef<HTMLInputElement>(null)
  const [confirmDeleteDocKey, setConfirmDeleteDocKey] = useState<string | null>(null)
  const [deletingDoc, setDeletingDoc]     = useState(false)
  const docEditPanelRef                   = useRef<HTMLDivElement>(null)

  // Opening a document's Edit/Upload panel renders it at the top of the tab —
  // bring it into view so the user doesn't have to scroll up to find it.
  useEffect(() => {
    if (editingDocKey) {
      requestAnimationFrame(() => docEditPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
    }
  }, [editingDocKey])

  // Vetting editing
  const [editingVetting, setEditingVetting] = useState<VettingSection | null>(null)
  const [vettingDraft, setVettingDraft]     = useState<Record<string, string | boolean>>({})
  const [vettingSaving, setVettingSaving]   = useState(false)

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

  // Loaded up front, not on opening the HR tab — the ACS audit's contract check needs it too.
  useEffect(() => { loadContractInfo() }, [id])

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
  const canEdit   = can("edit_staff")
  const canDelete = can("delete_staff")

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
      ec_rel:      staff.emergencyContact?.relationship ?? "" })
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
        training:    trainingData,
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
          relationship: profileDraft.ec_rel || undefined } }
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

  // ── Generic field patcher ──
  async function patchField(updates: Partial<StaffMember>) {
    if (!staff || !id) return
    // Training is saved separately (PATCH .../training) and only updates
    // trainingData, so `staff.training` can be stale — always send the live
    // copy, or this full-record PUT silently wipes training edits.
    const merged = { ...staff, training: trainingData, ...updates }
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
      deleting: deletingDoc }
  }

  // ── Vetting helpers ──
  function openVettingEdit(section: VettingSection) {
    if (!staff) return
    setEditingVetting(section)
    if (section === "dbs") {
      setVettingDraft({
        type:          staff.dbs?.type ?? "",
        checkDate:     staff.dbs?.checkDate ?? "",
        certificateNo: staff.dbs?.certificateNo ?? "" })
    } else if (section === "driver") {
      setVettingDraft({
        fuelCardNumber: staff.driverAssignment?.fuelCardNumber ?? "",
        tachoCard:      staff.driverAssignment?.tachoCard ?? "",
        tachoExpiry:    staff.driverAssignment?.tachoExpiry ?? "",
        dbsNumber:      staff.driverAssignment?.dbsNumber ?? "",
        dbsDate:        staff.driverAssignment?.dbsDate ?? "",
        lastAssessment: staff.driverAssignment?.lastAssessment ?? "",
        status:         staff.driverAssignment?.status ?? "active",
        notes:          staff.driverAssignment?.notes ?? "" })
    } else if (section === "bs7858") {
      setVettingDraft({
        completed:       staff.bs7858?.completed ?? false,
        completionDate:  staff.bs7858?.completionDate ?? "",
        reviewer:        staff.bs7858?.reviewer ?? "" })
    } else {
      const ref = staff.references?.[section]
      setVettingDraft({
        name:        ref?.name ?? "",
        company:     ref?.company ?? "",
        email:       ref?.email ?? "",
        phone:       ref?.phone ?? "",
        status:      ref?.status ?? "Not Started" })
    }
  }

  async function saveVetting() {
    if (!editingVetting || !staff) return
    setVettingSaving(true)
    try {
      if (editingVetting === "dbs") {
        await patchField({
          dbs: {
            type:          (vettingDraft.type as string) || undefined,
            checkDate:     (vettingDraft.checkDate as string) || undefined,
            certificateNo: (vettingDraft.certificateNo as string) || undefined } })
      } else if (editingVetting === "bs7858") {
        await patchField({
          bs7858: {
            completed:      vettingDraft.completed as boolean,
            completionDate: (vettingDraft.completionDate as string) || undefined,
            reviewer:       (vettingDraft.reviewer as string) || undefined } })
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
            notes:          (vettingDraft.notes as string) || undefined } })
      } else {
        await patchField({
          references: {
            ...staff.references,
            [editingVetting]: {
              name:    (vettingDraft.name as string) || undefined,
              company: (vettingDraft.company as string) || undefined,
              email:   (vettingDraft.email as string) || undefined,
              phone:   (vettingDraft.phone as string) || undefined,
              status:  (vettingDraft.status as string) || undefined } } })
      }
      setEditingVetting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save — please try again")
      await refreshStaffRecord().catch(() => {})
    } finally {
      setVettingSaving(false)
    }
  }

  async function loadContractInfo() {
    if (!id) return
    try {
      const d = await api.get<{ ok: boolean; exists: boolean }>(`/api/staff/${id}/contract/info`)
      if (d.ok) setContractExists(d.exists)
    } catch {}
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

  // Office-based login roles are never deployed as a guard, so SIA/CSCS/training
  // checkpoints don't apply to them — auto-pass rather than flag as missing.
  const isOfficeExempt = !!staff.officeExempt

  // ACS audit — computed pass/fail for each point
  const acs: AcsChecks = {
    siaValid:          isOfficeExempt || !!(staff.sia?.number && (daysUntil(staff.sia.expiry) ?? 1) >= 0),
    siaType:           isOfficeExempt || !!(staff.sia?.type),
    // RTW needs actual evidence on file, not just a typed visa type — otherwise
    // deleting the BRP/share-code document left this checkpoint passing.
    // British: passport (or other RTW evidence). Everyone else: visa type + BRP/share-code doc.
    rtwVerified:       staff.nationality?.toLowerCase().includes("british")
                         ? !!(docs.passport?.uploaded || docs.brpCard?.uploaded)
                         : !!(staff.visa?.type && docs.brpCard?.uploaded),
    dbsChecked:        !!(staff.dbs?.checkDate),
    bs7858:            !!(staff.bs7858?.completed),
    twoRefs:           !!(staff.references?.ref1?.status === "Satisfactory" && staff.references?.ref2?.status === "Satisfactory"),
    // Needs the signed contract FILE uploaded — the free-text "Signed" field
    // alone isn't evidence (it passed with nothing on file).
    contractSigned:    contractExists,
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
    emergencyContact:  !!(staff.emergencyContact?.name) }

  const acsScore = Object.values(acs).filter(Boolean).length
  const acsTotal = Object.values(acs).length

  // Upload / edit panel for a staff document — rendered in whichever tab
  // opened it (Documents, or Vetting for the DBS certificate scan).
  const docEditPanel = editingDocKey ? (
      <div ref={docEditPanelRef} className="scroll-mt-20 rounded-lg border-2 border-primary/40 bg-muted/20 p-4 space-y-4">
        <p className="text-sm font-semibold">Upload document</p>

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

        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingDocKey(null)}>Close</Button>
        </div>
      </div>
  ) : null

  const docTools: DocTools = { canEdit, editingDocKey, openDocEdit, docDeleteProps, docEditPanel }
  const vettingTools: VettingTools = {
    editingVetting, setEditingVetting, vettingDraft, setVettingDraft, vettingSaving, openVettingEdit, saveVetting }

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

      {tab === "overview" && <OverviewTab staff={staff} />}

      {tab === "documents" && id && (
        <DocumentsTab staffId={id} staff={staff} docTools={docTools} vettingTools={vettingTools} onChanged={refreshStaffRecord} />
      )}

      {tab === "vetting" && id && (
        <VettingTab staffId={id} staff={staff} docTools={docTools} vettingTools={vettingTools} patchField={patchField} />
      )}

      {tab === "training" && id && (
        <TrainingTab staffId={id} training={trainingData} setTraining={setTrainingData} onChanged={refreshStaffRecord} />
      )}

      {tab === "acs" && id && (
        <AcsTab staffId={id} staff={staff} training={training} acs={acs} contractExists={contractExists} setTab={setTab} />
      )}

      {tab === "hr" && id && (
        <HrTab staffId={id} canEdit={canEdit} canDelete={canDelete} isDirector={isDirector}
          contractExists={contractExists} setContractExists={setContractExists} />
      )}

      {tab === "provisions" && id && <ProvisionsTab staffId={id} canDelete={canDelete} />}

      {/* ── Messages tab ── */}
      {tab === "messages" && id && <MessagesTab staffId={id} staffName={staff.name} canDelete={canDelete} />}

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
