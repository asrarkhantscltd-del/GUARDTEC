import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { api, ApiError } from "@/lib/api"
import { pushSupported, getExistingSubscription, enablePush, disablePush } from "@/lib/push"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Camera, Loader2, KeyRound, BellRing, Sun, Moon, User } from "lucide-react"
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
