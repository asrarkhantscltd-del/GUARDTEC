import { Outlet, useNavigate } from "react-router-dom"
import { OfflineBanner } from "@/components/OfflineBanner"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Button } from "@/components/ui/button"
import { LogOut, Camera, Loader2, Sun, Moon, MessageSquare, BellRing, BellOff, KeyRound } from "lucide-react"
import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import { pushSupported, getExistingSubscription, enablePush, disablePush } from "@/lib/push"
import { toast } from "sonner"
import ChangePasswordModal from "@/components/ChangePasswordModal"

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  // Push notifications — so a message from a manager still reaches this
  // staff member even with the app fully closed. `null` while the
  // existing-subscription check is in flight.
  const [pushOn, setPushOn] = useState<boolean | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const canUsePush = pushSupported()

  useEffect(() => {
    if (!canUsePush) return
    getExistingSubscription().then(sub => setPushOn(!!sub)).catch(() => setPushOn(false))
  }, [canUsePush])

  async function togglePush() {
    setPushBusy(true)
    try {
      if (pushOn) {
        await disablePush()
        setPushOn(false)
        toast.success("Push notifications turned off")
      } else {
        await enablePush()
        setPushOn(true)
        toast.success("Push notifications enabled — you'll get alerts even when this tab is closed")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update push notifications")
    } finally {
      setPushBusy(false)
    }
  }

  useEffect(() => {
    api.getBlob("/api/me/photo")
      .then(blob => { if (blob) setMyPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    function fetchUnread() {
      api.get<{ ok: boolean; unread: number }>("/api/my-messages?peek=1")
        .then(d => { if (d?.ok) setUnreadMsgs(d.unread ?? 0) })
        .catch(() => {})
    }
    fetchUnread()
    const id = setInterval(fetchUnread, 30000)
    return () => clearInterval(id)
  }, [])

  async function handleMyPhotoUpload(file: File | null) {
    if (!file) return
    setUploadingPhoto(true)
    try {
      await api.post("/api/me/photo", file)
      const blob = await api.getBlob("/api/me/photo")
      if (blob) {
        if (myPhotoUrl) URL.revokeObjectURL(myPhotoUrl)
        setMyPhotoUrl(URL.createObjectURL(blob))
      }
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 pt-[env(safe-area-inset-top)] md:px-8">
        <img
          src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
          alt="GuardTec"
          className="h-10 w-auto"
        />
        <div>
          <p className="font-display text-sm font-bold leading-tight tracking-wider uppercase">
            Guard<span className="text-primary">Tec</span>
          </p>
          <p className="font-display text-[9px] leading-tight tracking-[0.2em] opacity-40 uppercase">Staff Portal</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Messages — labelled, highlighted button that opens the Messages tab directly */}
          <button
            onClick={() => { setUnreadMsgs(0); navigate("/?tab=messages") }}
            title="Messages from your manager"
            className={`relative inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
              unreadMsgs > 0
                ? "bg-primary text-white shadow-[0_4px_14px_-2px_rgba(228,6,19,0.5)] hover:bg-primary/90"
                : "border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25"
            }`}>
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Messages</span>
            {unreadMsgs > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold text-primary">
                {unreadMsgs > 9 ? "9+" : unreadMsgs}
              </span>
            )}
          </button>

          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{user?.full_name}</p>
            <p className="text-[11px] leading-tight opacity-40">My Profile</p>
          </div>
          <label className="relative h-8 w-8 shrink-0 cursor-pointer group" title="Change profile photo">
            {myPhotoUrl
              ? <img src={myPhotoUrl} alt="Profile" className="h-8 w-8 rounded-full object-cover" />
              : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-white">
                  {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                </div>}
            <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {uploadingPhoto ? <Loader2 className="h-3 w-3 text-white animate-spin" /> : <Camera className="h-3 w-3 text-white" />}
            </div>
            <input type="file" accept="image/*" className="hidden"
              disabled={uploadingPhoto}
              onChange={e => handleMyPhotoUpload(e.target.files?.[0] ?? null)} />
          </label>
          {canUsePush && pushOn !== null && (
            <Button variant="ghost" size="icon-sm" onClick={togglePush} disabled={pushBusy}
              title={pushOn ? "Turn off push notifications on this device" : "Get notified even when this tab is closed"}
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground">
              {pushBusy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : pushOn ? <BellRing className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme} title={isDark ? "Light mode" : "Dark mode"}
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setShowChangePassword(true)}
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" title="Change password">
            <KeyRound className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleLogout}
            className="text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive" title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="w-full flex-1 px-4 pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] md:px-6">
        <OfflineBanner />
        <Outlet />
      </main>
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  )
}
