import { Outlet, NavLink, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, Users, CalendarDays, MessageSquare,
  LogOut, Menu, X, Sun, Moon, KeyRound,
} from "lucide-react"
import { useState } from "react"
import ChangePasswordModal from "@/components/ChangePasswordModal"

// Distinct, minimal shell for the 'agency' role — an external staffing
// agency's own self-service portal. Deliberately NOT DashboardLayout with a
// filtered nav: an agency user should never see Staff/Fleet/Sites/Compliance
// (GuardTec's own internal modules) at all, only its own four sections. Modeled
// on DashboardLayout's sidebar shell for visual consistency with the rest of
// the app, trimmed down to a fixed, unfiltered nav (no permission system for
// this role — every agency account gets the same four pages).
const NAV_ITEMS = [
  { label: "Dashboard",   to: "/",            icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: "Staff",       to: "/staff",       icon: <Users className="h-4 w-4" /> },
  { label: "Deployments", to: "/deployments", icon: <CalendarDays className="h-4 w-4" /> },
  { label: "Messages",    to: "/messages",    icon: <MessageSquare className="h-4 w-4" /> },
]

export default function AgencyLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:relative md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <div className="flex shrink-0 flex-col items-center justify-center gap-1 border-b border-sidebar-border py-5">
          <img
            src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
            alt="GuardTec Security"
            className="w-[180px] h-auto"
          />
          <span className="font-display text-[9px] font-medium tracking-[0.35em] text-sidebar-foreground/40 uppercase mt-1">
            Agency Portal
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-primary to-primary/80 text-white shadow-[0_4px_14px_-2px_rgba(228,6,19,0.4)]"
                    : "hover:translate-x-0.5 hover:bg-sidebar-accent"
                }`
              }>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-primary" />}
                  {item.icon}
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 bg-sidebar-accent">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-white">
              {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user?.full_name}</p>
              <p className="truncate text-xs leading-tight opacity-50">Agency account</p>
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm"
              className="flex-1 justify-start gap-2 opacity-80 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
              onClick={handleLogout}>
              <LogOut className="h-4 w-4" />Sign out
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowChangePassword(true)}
              title="Change password"
              className="shrink-0 opacity-60 hover:opacity-100 hover:bg-sidebar-accent">
              <KeyRound className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="shrink-0 opacity-60 hover:opacity-100 hover:bg-sidebar-accent">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </aside>
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="relative z-10 flex h-14 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-md md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <img
            src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
            alt="GuardTec"
            className="h-8 w-auto rounded-sm"
          />
        </header>

        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
