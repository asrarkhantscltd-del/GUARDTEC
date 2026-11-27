import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { api, ApiError } from "@/lib/api"
import { pushSupported, getExistingSubscription, enablePush, disablePush } from "@/lib/push"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Camera, Loader2, KeyRound, BellRing, Sun, Moon, User, MapPin, Phone, AlertCircle, Building2, Save } from "lucide-react"
import { initials } from "@/lib/utils"

export default function StaffAccountSettingsPage() {
  const { user } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()

  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pushOn, setPushOn] = useState<boolean | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const canUsePush = pushSupported()

  const [personal, setPersonal] = useState({
    phone: "", address: "",
    emergencyContact: { name: "", phone: "", relationship: "" },
    bankDetails: { accountHolderName: "", bankName: "", sortCode: "", accountNumber: "" },
  })
  const [personalSaving, setPersonalSaving] = useState(false)
  const [personalLoaded, setPersonalLoaded] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState("")

  useEffect(() => {
    api.getBlob("/api/me/photo")
      .then(blob => { if (blob) setMyPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!canUsePush) return
    getExistingSubscription().then(sub => setPushOn(!!sub)).catch(() => setPushOn(false))
  }, [canUsePush])

  useEffect(() => {
    api.get<{ ok: boolean; profile?: {
      phone?: string; address?: string;
      emergencyContact?: { name?: string; phone?: string; relationship?: string };
      bankDetails?: { accountHolderName?: string; bankName?: string; sortCode?: string; accountNumber?: string };
    }}>("/api/my-profile").then(data => {
      if (!data?.ok || !data.profile) return
      const p = data.profile
      setPersonal({
        phone: p.phone ?? "",
        address: p.address ?? "",
        emergencyContact: {
          name: p.emergencyContact?.name ?? "",
          phone: p.emergencyContact?.phone ?? "",
          relationship: p.emergencyContact?.relationship ?? "",
        },
        bankDetails: {
          accountHolderName: p.bankDetails?.accountHolderName ?? "",
          bankName: p.bankDetails?.bankName ?? "",
          sortCode: p.bankDetails?.sortCode ?? "",
          accountNumber: p.bankDetails?.accountNumber ?? "",
        },
      })
      setPersonalLoaded(true)
    }).catch(() => setPersonalLoaded(true))
  }, [])

  function setEc(field: string, value: string) {
    setPersonal(p => ({ ...p, emergencyContact: { ...p.emergencyContact, [field]: value } }))
  }
  function setBd(field: string, value: string) {
    setPersonal(p => ({ ...p, bankDetails: { ...p.bankDetails, [field]: value } }))
  }

  async function handleSavePersonal(e: React.FormEvent) {
    e.preventDefault()
    setPersonalSaving(true)
    try {
      await api.put("/api/me/personal", personal)
      toast.success("Personal details saved")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save personal details")
    } finally {
      setPersonalSaving(false)
    }
  }

  async function handlePhotoUpload(file: File | null) {
    if (!file) return
    setUploadingPhoto(true)
    try {
      await api.post("/api/me/photo", file)
      const blob = await api.getBlob("/api/me/photo")
      if (blob) {
        if (myPhotoUrl) URL.revokeObjectURL(myPhotoUrl)
        setMyPhotoUrl(URL.createObjectURL(blob))
      }
      toast.success("Profile photo updated")
    } catch {
      toast.error("Failed to upload photo")
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function togglePush() {
    setPushBusy(true)
    try {
      if (pushOn) {
        await disablePush(); setPushOn(false); toast.success("Push notifications turned off")
      } else {
        await enablePush(); setPushOn(true); toast.success("Push notifications enabled")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update push notifications")
    } finally {
      setPushBusy(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError("")
    if (newPassword.length < 10) { setPwError("New password must be at least 10 characters."); return }
    if (newPassword !== confirmPassword) { setPwError("Passwords don't match."); return }
    setPwSaving(true)
    try {
      await api.post("/api/account/change-password", { currentPassword, newPassword })
      toast.success("Password changed successfully")
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Failed to change password — please try again.")
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <button onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <h1 className="text-xl font-bold">Account Settings</h1>

      {/* Profile */}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <User className="h-4 w-4 text-primary" /> Profile
        </h2>
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            {myPhotoUrl
              ? <img src={myPhotoUrl} alt="Profile" className="h-20 w-20 rounded-full object-cover" />
              : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xl font-bold text-white">
                  {initials(user?.full_name ?? "")}
                </div>}
            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}
              className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow hover:bg-primary/90 transition-colors disabled:opacity-60">
              {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              disabled={uploadingPhoto}
              onChange={e => handlePhotoUpload(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <p className="font-semibold">{user?.full_name}</p>
            <p className="text-sm text-muted-foreground capitalize">{user?.role?.replace(/_/g, " ")}</p>
            <button onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}
              className="mt-1.5 text-xs text-primary hover:underline">
              Change photo
            </button>
          </div>
        </div>
      </section>

      {/* Personal Details */}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" /> Personal Details
        </h2>
        {!personalLoaded
          ? <p className="text-sm text-muted-foreground">Loading…</p>
          : (
          <form onSubmit={handleSavePersonal} className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Phone className="h-3 w-3" /> Phone / Mobile
                </label>
                <input type="tel" value={personal.phone}
                  onChange={e => setPersonal(p => ({ ...p, phone: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="+44 7700 000000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Address</label>
                <textarea value={personal.address}
                  onChange={e => setPersonal(p => ({ ...p, address: e.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Your current home address" />
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <AlertCircle className="h-3 w-3" /> Emergency Contact
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Name</label>
                  <input value={personal.emergencyContact.name}
                    onChange={e => setEc("name", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Full name" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Phone</label>
                  <input type="tel" value={personal.emergencyContact.phone}
                    onChange={e => setEc("phone", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="+44 7700 000000" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Relationship</label>
                  <input value={personal.emergencyContact.relationship}
                    onChange={e => setEc("relationship", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="e.g. Spouse, Parent" />
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Building2 className="h-3 w-3" /> Bank Details
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Account holder name</label>
                  <input value={personal.bankDetails.accountHolderName}
                    onChange={e => setBd("accountHolderName", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Full name on account" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Bank name</label>
                  <input value={personal.bankDetails.bankName}
                    onChange={e => setBd("bankName", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="e.g. Barclays, Lloyds" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Sort code</label>
                  <input value={personal.bankDetails.sortCode}
                    onChange={e => setBd("sortCode", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="12-34-56" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Account number</label>
                  <input value={personal.bankDetails.accountNumber}
                    onChange={e => setBd("accountNumber", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="12345678" />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" size="sm" disabled={personalSaving} className="gap-1.5">
                {personalSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {personalSaving ? "Saving…" : "Save Details"}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Change Password */}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" /> Change Password
        </h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          {pwError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{pwError}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Current password</label>
            <input type="password" required autoComplete="current-password" value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">New password</label>
            <input type="password" required minLength={10} autoComplete="new-password" value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            <p className="mt-1 text-[11px] text-muted-foreground">At least 10 characters.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Confirm new password</label>
            <input type="password" required autoComplete="new-password" value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit" size="sm" disabled={pwSaving} className="gap-1.5">
              {pwSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              {pwSaving ? "Saving…" : "Change Password"}
            </Button>
          </div>
        </form>
      </section>

      {/* Notifications */}
      {canUsePush && pushOn !== null && (
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" /> Notifications
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Push Notifications</p>
              <p className="text-xs text-muted-foreground">Get alerts even when this tab is closed</p>
            </div>
            <button onClick={togglePush} disabled={pushBusy}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${pushOn ? "bg-primary" : "bg-muted"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${pushOn ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        </section>
      )}

      {/* Appearance */}
      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          {isDark ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-primary" />}
          Appearance
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{isDark ? "Dark Mode" : "Light Mode"}</p>
            <p className="text-xs text-muted-foreground">Switch between light and dark theme</p>
          </div>
          <button onClick={toggleTheme}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isDark ? "bg-primary" : "bg-muted"}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isDark ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </section>
    </div>
  )
}
