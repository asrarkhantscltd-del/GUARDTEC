import { Outlet, useNavigate } from "react-router-dom"
import { OfflineBanner } from "@/components/OfflineBanner"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Button } from "@/components/ui/button"
import { LogOut, Sun, Moon, MessageSquare } from "lucide-react"
import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import { useMyMessagesUnread } from "@/hooks/useMyMessagesUnread"
import { initials } from "@/lib/utils"

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const unreadMsgs = useMyMessagesUnread()

  useEffect(() => {
    api.getBlob("/api/me/photo")
      .then(blob => { if (blob) setMyPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [])

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 pt-[env(safe-area-inset-top)] md:px-8">
        <img
          src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
          alt="GuardTec"
          className="h-10 w-auto"
        />
        <div className="hidden sm:block">
          <p className="font-display text-sm font-bold leading-tight tracking-wider uppercase">
            Guard<span className="text-primary">Tec</span>
          </p>
          <p className="font-display text-[9px] leading-tight tracking-[0.2em] opacity-40 uppercase">Staff Portal</p>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
          {/* Messages — labelled, highlighted button that opens the Messages tab directly */}
          <button
            onClick={() => navigate("/?tab=messages")}
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
            <p className="text-[11px] leading-tight opacity-40">My Account</p>
          </div>

          {/* Avatar — tap to open Account Settings */}
          <button onClick={() => navigate("/account-settings")} title="Account Settings"
            className="relative h-8 w-8 shrink-0 rounded-full ring-2 ring-transparent hover:ring-primary/50 transition-all">
            {myPhotoUrl
              ? <img src={myPhotoUrl} alt="Profile" className="h-8 w-8 rounded-full object-cover" />
              : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-white">
                  {initials(user?.full_name ?? "")}
                </div>}
          </button>

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

      <main className="w-full flex-1 overflow-y-auto px-4 pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] md:px-6">
        <OfflineBanner />
        <Outlet />
      </main>
    </div>
  )
}
