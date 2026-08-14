import { Outlet, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Button } from "@/components/ui/button"
import { LogOut, Camera, Loader2, Sun, Moon, Bell, MessageSquare } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [showMsgBell, setShowMsgBell] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getBlob("/api/me/photo")
      .then(blob => { if (blob) setMyPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    function fetchUnread() {
      api.get<{ ok: boolean; unread: number }>("/api/my-messages")
        .then(d => { if (d?.ok) setUnreadMsgs(d.unread ?? 0) })
        .catch(() => {})
    }
    fetchUnread()
    const id = setInterval(fetchUnread, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowMsgBell(false)
    }
    if (showMsgBell) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showMsgBell])

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
      <header className="flex h-16 items-center gap-3 border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 md:px-8">
        <img
          src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
          alt="GuardTec"
          className="h-9 w-auto"
        />
        <div>
          <p className="text-sm font-bold leading-tight">GuardTec</p>
          <p className="text-[10px] leading-tight opacity-40">Staff Portal</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Bell — unread messages from manager */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => setShowMsgBell(prev => !prev)}
              className="relative rounded-full p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              title="Messages"
            >
              <Bell className="h-4 w-4" />
              {unreadMsgs > 0 && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white ring-2 ring-sidebar">
                  {unreadMsgs > 9 ? "9+" : unreadMsgs}
                </span>
              )}
            </button>

            {showMsgBell && (
              <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-sidebar-border bg-sidebar shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
                  <p className="text-sm font-semibold">Messages</p>
                </div>
                <div className="p-3">
                  {unreadMsgs > 0 ? (
                    <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/10 p-3">
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                      <div>
                        <p className="text-sm font-medium text-blue-400">
                          {unreadMsgs} unread message{unreadMsgs !== 1 ? "s" : ""} from your manager
                        </p>
                        <p className="mt-0.5 text-xs opacity-60">Scroll down to Messages tab to read</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-center text-sm opacity-50 py-2">No new messages</p>
                  )}
                </div>
              </div>
            )}
          </div>

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
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme} title={isDark ? "Light mode" : "Dark mode"}
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleLogout}
            className="text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive" title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="w-full flex-1 px-4 py-8 md:px-6">
        <Outlet />
      </main>
    </div>
  )
}
