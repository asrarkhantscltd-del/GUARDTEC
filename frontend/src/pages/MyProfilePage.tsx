import { useEffect, useState, useRef } from "react"
import { toast } from "sonner"
import {
  ShieldCheck, AlertTriangle, Clock, Camera, ImageOff,
  Loader2, Save, User as UserIcon, Upload,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

interface EmergencyContact { name?: string; phone?: string; relationship?: string }
interface Ref { name?: string; company?: string; email?: string; phone?: string; status?: string }

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

  useEffect(() => { load() }, [])

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Keep your compliance details up to date. Changes are reviewed by your manager before they go live.
        </p>
      </div>

      {profile.rejection_reason && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Your last submission needs changes</p>
            <p className="mt-0.5 text-destructive/80">{profile.rejection_reason}</p>
          </div>
        </div>
      )}

      {isPending && !success && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
          <Clock className="h-4 w-4 shrink-0" />
          <p>Your submitted changes are pending review by your manager. You can still update and resubmit below.</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/8 px-4 py-3 text-sm text-success">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <p>Submitted — your manager will review these changes shortly.</p>
        </div>
      )}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
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
