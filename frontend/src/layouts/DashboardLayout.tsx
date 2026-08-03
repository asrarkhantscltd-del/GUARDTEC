import { Outlet, NavLink, useNavigate } from "react-router-dom"
import { useAuth, type Permissions } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, Users, Truck, ShieldCheck, LogOut,
  Menu, X, MapPin,
  KeyRound, Bell, ClipboardCheck, Shield,
  Camera, Loader2, Sun, Moon,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  permission?: keyof Permissions
  directorOnly?: boolean
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    to: "/",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    label: "Staff",
    to: "/staff",
    icon: <Users className="h-4 w-4" />,
    permission: "staff",
  },
  {
    label: "Fleet",
    to: "/fleet",
    icon: <Truck className="h-4 w-4" />,
    permission: "fleet",
  },
  {
    label: "Sites",
    to: "/sites",
    icon: <MapPin className="h-4 w-4" />,
    permission: "sites",
  },
  {
    label: "Compliance",
    to: "/compliance",
    icon: <ShieldCheck className="h-4 w-4" />,
    permission: "compliance",
  },
  {
    label: "Pending Review",
    to: "/pending-review",
    icon: <ClipboardCheck className="h-4 w-4" />,
    permission: "pending_review",
  },
  {
    label: "Team Access",
    to: "/users",
    icon: <KeyRound className="h-4 w-4" />,
    directorOnly: true,
  },
  {
    label: "Manage Roles",
    to: "/roles",
    icon: <Shield className="h-4 w-4" />,
    directorOnly: true,
  },
]

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    fetch("/api/me/photo", { credentials: "include" })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => { if (blob) setMyPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/compliance/alerts", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setAlertCount(d.total ?? 0) })
      .catch(() => {})
  }, [])

  async function handleMyPhotoUpload(file: File | null) {
    if (!file) return
    setUploadingPhoto(true)
    try {
      await fetch("/api/me/photo", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      const res = await fetch("/api/me/photo", { credentials: "include" })
      if (res.ok) {
        const blob = await res.blob()
        if (myPhotoUrl) URL.revokeObjectURL(myPhotoUrl)
        setMyPhotoUrl(URL.createObjectURL(blob))
      }
    } finally {
      setUploadingPhoto(false)
    }
  }

  const visibleNav = navItems.filter((item) => {
    if (!user) return false
    if (item.directorOnly) return user.role === "director"
    if (!item.permission) return true
    return user.role === "director" || !!user.permissions?.[item.permission]
  })

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r transition-transform md:relative md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      } ${isDark
        ? "border-[hsl(228_12%_11%)] bg-[hsl(228_14%_7%)] text-[hsl(220_14%_72%)]"
        : "border-[hsl(220_13%_91%)] bg-white text-[hsl(224_14%_15%)]"
      }`}>
        <button
          onClick={() => { navigate("/"); setSidebarOpen(false) }}
          className={`relative flex h-20 w-full shrink-0 items-center justify-center overflow-hidden border-b px-4 transition-colors ${
            isDark
              ? "border-[hsl(228_12%_11%)] hover:bg-white/5"
              : "border-[hsl(220_13%_91%)] hover:bg-black/5"
          }`}
        >
          <div className="glow-blob absolute -left-6 -top-10 h-24 w-24" />
          <img
            src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
            alt="GuardTec"
            className="relative z-10 h-12 w-auto"
          />
        </button>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {visibleNav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-[hsl(354_96%_46%)] to-[hsl(354_96%_46%)]/80 text-white shadow-[0_4px_14px_-2px_rgba(228,6,19,0.4)]"
                    : isDark
                      ? "hover:translate-x-0.5 hover:bg-white/8"
                      : "hover:translate-x-0.5 hover:bg-black/5"
                }`
              }>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-[hsl(354_96%_46%)]" />}
                  <span className={`transition-transform duration-200 ${!isActive ? "group-hover:scale-110" : ""}`}>{item.icon}</span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className={`border-t p-3 ${isDark ? "border-[hsl(228_12%_11%)]" : "border-[hsl(220_13%_91%)]"}`}>
          <div className={`mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 ${
            isDark ? "bg-white/5" : "bg-black/5"
          }`}>
            <label className="relative h-9 w-9 shrink-0 cursor-pointer group" title="Change profile photo">
              {myPhotoUrl
                ? <img src={myPhotoUrl} alt="Profile" className="h-9 w-9 rounded-full object-cover" />
                : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-white shadow-[0_2px_8px_rgba(228,6,19,0.35)]">
                    {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>}
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" /> : <Camera className="h-3.5 w-3.5 text-white" />}
              </div>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
                disabled={uploadingPhoto}
                onChange={e => handleMyPhotoUpload(e.target.files?.[0] ?? null)} />
            </label>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user?.full_name}</p>
              <p className="truncate text-xs leading-tight opacity-50">{user?.role_name ?? ""}</p>
            </div>
            <span className="h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="flex-1 justify-start gap-2 opacity-80 hover:bg-destructive/10 hover:text-destructive hover:opacity-100" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />Sign out
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className={`shrink-0 opacity-60 hover:opacity-100 ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"}`}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-md md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <div className="hidden h-2 w-2 rounded-full bg-success shadow-[0_0_6px_rgba(34,197,94,0.8)] sm:block" />
            <h1 className="text-lg font-semibold tracking-tight">GuardTec Compliance</h1>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <p className="hidden text-xs text-muted-foreground md:block">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <button onClick={() => navigate("/compliance")}
              className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Compliance alerts">
              <Bell className="h-4.5 w-4.5" />
              {alertCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white ring-2 ring-background">
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </button>
            <button onClick={() => photoInputRef.current?.click()}
              className="relative h-8 w-8 shrink-0 cursor-pointer group rounded-full overflow-hidden"
              title="Change profile photo">
              {myPhotoUrl
                ? <img src={myPhotoUrl} alt="Profile" className="h-8 w-8 rounded-full object-cover" />
                : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-primary-foreground shadow-sm">
                    {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>}
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingPhoto ? <Loader2 className="h-3 w-3 text-white animate-spin" /> : <Camera className="h-3 w-3 text-white" />}
              </div>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
