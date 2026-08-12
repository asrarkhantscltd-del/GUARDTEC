import { useEffect, useState, useRef } from "react"
import { toast } from "sonner"
import { discTypeLabels, discTypeCls } from "@/lib/utils"
import {
  ShieldCheck, AlertTriangle, Clock, Camera, ImageOff,
  Loader2, Save, User as UserIcon, Upload, BadgeAlert, Flag, EyeOff, Eye,
  Paperclip, X, FileVideo, FileText, Image as ImageIcon,
  MessageSquare, Package, Send, Pencil,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

interface EmergencyContact { name?: string; phone?: string; relationship?: string }
interface Ref { name?: string; company?: string; email?: string; phone?: string; status?: string }
interface DiscRecord { id: string; incident_date: string; type: string; description: string; action_taken?: string }
interface IncidentReport { id: string; report_date: string; incident_type: string; status: string; description: string; resolution_notes?: string; attachment_count?: number }
interface IncidentAttachment { id: string; filename: string; original_name: string; mime_type: string; size_bytes: number }

interface Profile {
  id: string
  name: string
  email?: string
  phone?: string
  address?: string
  emergencyContact?: EmergencyContact
  sia?:  { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
  references?: { ref1?: Ref; ref2?: Ref }
  pending_submission?: { submitted_at?: string; photo_pending?: boolean }
  rejection_reason?: string
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
  const [messages, setMessages]       = useState<{id:string;message:string;sender_name:string;sender_role:string;created_at:string;is_read:boolean}[]>([])
  const [msgDraft, setMsgDraft]       = useState("")
  const [msgSending, setMsgSending]   = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const msgEndRef                     = useRef<HTMLDivElement>(null)

  // Provisions
  const [provisions, setProvisions] = useState<{id:string;item:string;provided:boolean;date_given:string|null;date_returned:string|null;notes:string|null}[]>([])

  // Contract
  const [contractExists, setContractExists] = useState(false)

  // Form minimize — collapses to summary after submit
  const [formExpanded, setFormExpanded] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/my-profile", { credentials: "include" })
      const d = await r.json()
      if (d.ok) setProfile(d.profile)
    } finally {
      setLoading(false)
    }
  }

  async function loadMyHR() {
    const [discRes, repRes, msgRes, provRes, contractRes] = await Promise.all([
      fetch("/api/my-disciplinary",      { credentials: "include" }),
      fetch("/api/my-incident-reports",  { credentials: "include" }),
      fetch("/api/my-messages",          { credentials: "include" }),
      fetch("/api/my-provisions",        { credentials: "include" }),
      fetch("/api/my-contract/info",     { credentials: "include" }),
    ])
    const discData     = await discRes.json()
    const repData      = await repRes.json()
    const msgData      = await msgRes.json()
    const provData     = await provRes.json()
    const contractData = await contractRes.json()
    if (discData.ok)     setDiscRecords(discData.records)
    if (repData.ok)      setMyReports(repData.reports)
    if (msgData.ok)      { setMessages(msgData.messages); setUnreadCount(msgData.unread) }
    if (provData.ok)     setProvisions(provData.provisions)
    if (contractData.ok) setContractExists(contractData.exists)
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 150)
  }

  async function sendMyMessage() {
    if (!msgDraft.trim()) return
    setMsgSending(true)
    try {
      const res = await fetch("/api/my-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msgDraft }),
      })
      const d = await res.json()
      if (!d.ok) { toast.error(d.error ?? "Failed to send."); return }
      setMsgDraft("")
      await loadMyHR()
    } finally {
      setMsgSending(false)
    }
  }

  async function submitIncident(e: React.FormEvent) {
    e.preventDefault()
    if (!incidentDraft.description.trim()) { setIncidentError("Description is required."); return }
    setIncidentSaving(true); setIncidentError("")
    try {
      const res = await fetch("/api/incident-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(incidentDraft),
      })
      const d = await res.json()
      if (!d.ok) { setIncidentError(d.error ?? "Failed to submit."); return }

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError("")
    setSuccess(false)
    try {
      const res = await fetch("/api/my-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone: profile.phone, address: profile.address,
          emergencyContact: profile.emergencyContact,
          sia: profile.sia, cscs: profile.cscs, visa: profile.visa,
          references: profile.references,
        }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || "Failed to submit"); setSaving(false); return }

      if (photo) {
        const photoRes = await fetch("/api/my-profile/photo", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": photo.type || "application/octet-stream" },
          body: photo,
        })
        if (!photoRes.ok) toast.error("Profile saved but photo upload failed — please try again.")
      }

      await load()
      setPhoto(null)
      if (photoPreview) URL.revokeObjectURL(photoPreview)
      setPhotoPreview(null)
      setSuccess(true)
      setFormExpanded(false)
    } catch {
      setError("Network error — please try again.")
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
        {/* GuardTec shield watermark */}
        <div className="pointer-events-none absolute -right-6 -top-6 opacity-[0.08]" aria-hidden>
          <svg viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg" className="w-36 h-36">
            <path d="M100 5 L190 40 L190 110 C190 165 155 210 100 225 C45 210 10 165 10 110 L10 40 Z" fill="white" />
            <text x="100" y="130" textAnchor="middle" fontSize="36" fontWeight="bold" fill="#b91c1c" fontFamily="sans-serif">GT</text>
            <text x="100" y="158" textAnchor="middle" fontSize="12" fill="#b91c1c" fontFamily="sans-serif" letterSpacing="2">SECURITY</text>
          </svg>
        </div>
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
            ].map(({ label, status, expiry }) => (
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
          </div>
        </div>
      )}

      {activeTab === "details" && formExpanded && (
        <form onSubmit={handleSubmit} className="space-y-5">
        {error && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

        {/* Photo */}
        <Section title="Photo">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed bg-muted/40">
              {photoPreview
                ? <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                : profile.id
                  ? <img src={`/api/staff/${profile.id}/photo`} alt={profile.name}
                      className="h-full w-full object-cover"
                      onError={e => { e.currentTarget.style.display = "none" }} />
                  : <ImageOff className="h-6 w-6 text-muted-foreground/40" />}
            </div>
            <div className="flex-1">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                <Camera className="h-3.5 w-3.5" />
                {photo ? "Change photo" : "Upload new photo"}
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => pickPhoto(e.target.files?.[0] ?? null)} />
              </label>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                JPG or PNG. Your new photo will show once your manager approves it.
              </p>
            </div>
          </div>
        </Section>

        {/* Personal */}
        <Section title="Personal Details">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={profile.name} disabled className="opacity-60" />
            </Field>
            <Field label="Email">
              <Input value={profile.email ?? ""} disabled className="opacity-60" />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={profile.phone ?? ""}
                onChange={e => set("phone", e.target.value)} />
            </Field>
            <Field label="Address">
              <Input value={profile.address ?? ""}
                onChange={e => set("address", e.target.value)} />
            </Field>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserIcon className="h-3 w-3" />Name and email are managed by your office — contact them to change these.
          </p>
        </Section>

        {/* Emergency contact */}
        <Section title="Emergency Contact">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input value={profile.emergencyContact?.name ?? ""}
                onChange={e => set("emergencyContact", { ...profile.emergencyContact, name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={profile.emergencyContact?.phone ?? ""}
                onChange={e => set("emergencyContact", { ...profile.emergencyContact, phone: e.target.value })} />
            </Field>
            <Field label="Relationship">
              <Input value={profile.emergencyContact?.relationship ?? ""}
                onChange={e => set("emergencyContact", { ...profile.emergencyContact, relationship: e.target.value })} />
            </Field>
          </div>
        </Section>

        {/* SIA */}
        <Section title="SIA Licence">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Licence number">
              <Input className="font-mono" value={profile.sia?.number ?? ""}
                onChange={e => set("sia", { ...profile.sia, number: e.target.value })} />
            </Field>
            <Field label="Licence type">
              <Input value={profile.sia?.type ?? ""} placeholder="e.g. Door Supervisor"
                onChange={e => set("sia", { ...profile.sia, type: e.target.value })} />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={profile.sia?.expiry ?? ""}
                onChange={e => set("sia", { ...profile.sia, expiry: e.target.value })} />
            </Field>
          </div>
        </Section>

        {/* CSCS */}
        <Section title="CSCS Card">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Card number">
              <Input className="font-mono" value={profile.cscs?.number ?? ""}
                onChange={e => set("cscs", { ...profile.cscs, number: e.target.value })} />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={profile.cscs?.expiry ?? ""}
                onChange={e => set("cscs", { ...profile.cscs, expiry: e.target.value })} />
            </Field>
          </div>
        </Section>

        {/* Right to Work */}
        <Section title="Right to Work / Visa">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Visa / status type">
              <Input value={profile.visa?.type ?? ""} placeholder="e.g. British citizen, Skilled Worker visa"
                onChange={e => set("visa", { ...profile.visa, type: e.target.value })} />
            </Field>
            <Field label="Expiry date (if applicable)">
              <Input type="date" value={profile.visa?.expiry ?? ""}
                onChange={e => set("visa", { ...profile.visa, expiry: e.target.value })} />
            </Field>
          </div>
        </Section>

        {/* References */}
        <Section title="References">
          {(["ref1", "ref2"] as const).map((key, i) => (
            <div key={key} className={i > 0 ? "mt-4 border-t pt-4" : ""}>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Reference {i + 1}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={profile.references?.[key]?.name ?? ""}
                    onChange={e => set("references", { ...profile.references, [key]: { ...profile.references?.[key], name: e.target.value } })} />
                </Field>
                <Field label="Company">
                  <Input value={profile.references?.[key]?.company ?? ""}
                    onChange={e => set("references", { ...profile.references, [key]: { ...profile.references?.[key], company: e.target.value } })} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={profile.references?.[key]?.email ?? ""}
                    onChange={e => set("references", { ...profile.references, [key]: { ...profile.references?.[key], email: e.target.value } })} />
                </Field>
                <Field label="Phone">
                  <Input type="tel" value={profile.references?.[key]?.phone ?? ""}
                    onChange={e => set("references", { ...profile.references, [key]: { ...profile.references?.[key], phone: e.target.value } })} />
                </Field>
              </div>
            </div>
          ))}
        </Section>

        {/* Documents */}
        {profile.id && (
          <Section title="Supporting Documents">
            <p className="mb-4 text-xs text-muted-foreground">
              Upload copies of your compliance documents. Files are stored securely and reviewed by your manager.
            </p>
            <div className="space-y-3">
              {DOC_UPLOADS.map((doc) => (
                <DocUploadRow
                  key={doc.key}
                  label={doc.label}
                  hint={doc.hint}
                  staffId={profile.id}
                  docKey={doc.key}
                />
              ))}
            </div>
          </Section>
        )}

        <div className="sticky bottom-4 flex justify-end">
          <Button type="submit" disabled={saving} className="gap-2 shadow-lg">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Submitting…" : "Submit for review"}
          </Button>
        </div>
      </form>
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
              return (
                <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-sm rounded-2xl px-4 py-2.5 text-sm shadow-sm ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border text-foreground rounded-tl-sm"}`}>
                    <p className="text-[11px] font-semibold mb-1 opacity-60">{m.sender_name}</p>
                    <p className="leading-snug">{m.message}</p>
                    <p className="text-[10px] mt-1.5 opacity-50 text-right">
                      {new Date(m.created_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                    </p>
                  </div>
                </div>
              )
            })}
            <div ref={msgEndRef} />
          </div>
          <div className="border-t flex gap-2 p-4 bg-background">
            <input value={msgDraft} onChange={e => setMsgDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMyMessage() } }}
              placeholder="Type a reply…"
              className="flex-1 h-10 rounded-lg border border-input bg-muted/30 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <Button disabled={msgSending || !msgDraft.trim()} onClick={sendMyMessage} className="gap-1.5 h-10 px-5">
              {msgSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Document uploads ──────────────────────────────────────────────────────────

const DOC_UPLOADS = [
  { key: "siaPhysical",     label: "SIA Licence Copy",   hint: "Front of your SIA licence card — PDF, JPG or PNG" },
  { key: "passport",        label: "Passport / Photo ID", hint: "Photo page of your passport or national ID" },
  { key: "brpCard",         label: "BRP Card",            hint: "Biometric Residence Permit — if applicable" },
  { key: "proofOfAddress1", label: "Proof of Address",    hint: "Utility bill or bank statement (within 3 months)" },
]

function DocUploadRow({ label, hint, staffId, docKey }: {
  label: string; hint: string; staffId: string; docKey: string
}) {
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const res = await fetch(`/api/staff/${staffId}/documents/${docKey}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      const data = await res.json()
      if (data.ok) {
        setUploaded(true)
        toast.success(`${label} uploaded`)
      } else {
        toast.error(data.error ?? `Failed to upload ${label}`)
      }
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="shrink-0">
        {uploaded ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400">
            <ShieldCheck className="h-3 w-3" /> Uploaded
          </span>
        ) : (
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted ${uploading ? "pointer-events-none opacity-50" : ""}`}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Uploading…" : "Upload"}
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
        )}
      </div>
    </div>
  )
}

function Section({ title, icon, badge, children }: { title: string; icon?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="surface p-5">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}{title}{badge}
      </h3>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
