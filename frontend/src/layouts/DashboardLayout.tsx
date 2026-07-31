import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import { useAuth, type UserRole } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, Users, Truck, ShieldCheck, LogOut,
  Menu, X, ChevronDown, MapPin, FileWarning, BarChart3,
  Car, UserCheck, KeyRound, Bell, ClipboardCheck,
} from "lucide-react"
import { useState, useEffect } from "react"

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles: UserRole[]
  children?: { label: string; to: string; icon: React.ReactNode }[]
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    to: "/",
    icon: <LayoutDashboard className="h-4 w-4" />,
    roles: ["director","ops_manager","hr_manager","office_manager","accounts","media","supervisor","fleet_manager"],
  },
  {
    label: "Staff",
    to: "/staff",
    icon: <Users className="h-4 w-4" />,
    roles: ["director","ops_manager","hr_manager","office_manager","accounts","supervisor"],
    children: [
      { label: "Compliance Status", to: "/staff?section=compliance", icon: <BarChart3 className="h-3.5 w-3.5" /> },
      { label: "Deployment",        to: "/staff?section=deployment", icon: <MapPin className="h-3.5 w-3.5" /> },
      { label: "Document Issues",   to: "/staff?section=documents",  icon: <FileWarning className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Fleet",
    to: "/fleet",
    icon: <Truck className="h-4 w-4" />,
    roles: ["director","fleet_manager","ops_manager"],
    children: [
      { label: "Vehicles",   to: "/fleet?tab=vehicles", icon: <Car className="h-3.5 w-3.5" /> },
      { label: "Drivers",    to: "/fleet?tab=drivers",  icon: <UserCheck className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Sites",
    to: "/sites",
    icon: <MapPin className="h-4 w-4" />,
    roles: ["director","ops_manager","hr_manager","office_manager","supervisor"],
  },
  {
    label: "Compliance",
    to: "/compliance",
    icon: <ShieldCheck className="h-4 w-4" />,
    roles: ["director","ops_manager","hr_manager","supervisor"],
  },
  {
    label: "Pending Review",
    to: "/pending-review",
    icon: <ClipboardCheck className="h-4 w-4" />,
    roles: ["director","ops_manager"],
  },
  {
    label: "Team Access",
    to: "/users",
    icon: <KeyRound className="h-4 w-4" />,
    roles: ["director"],
  },
]

function roleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    director: "Director", ops_manager: "Ops Manager", hr_manager: "HR Manager",
    office_manager: "Office Manager", accounts: "Accounts", media: "Media",
    supervisor: "Supervisor", fleet_manager: "Fleet Manager", staff: "Staff",
  }
  return labels[role]
}

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [staffExpanded, setStaffExpanded] = useState(false)
  const [fleetExpanded, setFleetExpanded] = useState(false)

  useEffect(() => {
    if (location.pathname.startsWith("/staff")) setStaffExpanded(true)
    if (location.pathname.startsWith("/fleet")) setFleetExpanded(true)
  }, [location.pathname])

  const visibleNav = navItems.filter((item) => user && item.roles.includes(user.role))

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  function isStaffActive() {
    return location.pathname.startsWith("/staff")
  }

  function isFleetActive() {
    return location.pathname.startsWith("/fleet")
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:relative md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <button
          onClick={() => { navigate("/"); setSidebarOpen(false) }}
          className="relative flex h-20 w-full shrink-0 items-center gap-3 overflow-hidden border-b border-sidebar-border px-4 transition-colors hover:bg-sidebar-accent/10"
        >
          <div className="glow-blob absolute -left-6 -top-10 h-24 w-24" />
          <img src="/logo-white.png" alt="GuardTec" className="relative z-10 h-14 w-auto shrink-0" />
          <div className="relative z-10 text-left">
            <p className="text-sm font-bold leading-tight tracking-tight">GuardTec</p>
            <p className="text-xs leading-tight text-sidebar-foreground/60">Security &amp; Patrol Ltd</p>
            <p className="mt-0.5 text-[10px] font-medium leading-tight tracking-wide text-primary/80">COMPLIANCE PORTAL</p>
          </div>
        </button>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {visibleNav.map((item) => {
            if (!item.children) {
              return (
                <NavLink key={item.to} to={item.to} end={item.to === "/"}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/80 text-sidebar-primary-foreground shadow-[0_4px_14px_-2px_rgba(228,6,19,0.4)]"
                        : "text-sidebar-foreground hover:translate-x-0.5 hover:bg-sidebar-accent/60"
                    }`
                  }>
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-sidebar-primary" />}
                      <span className={`transition-transform duration-200 ${!isActive ? "group-hover:scale-110" : ""}`}>{item.icon}</span>
                      {item.label}
                    </>
                  )}
                </NavLink>
              )
            }

            // ── Expandable sections (Staff, Fleet) ──
            const isActive = item.to.startsWith("/staff") ? isStaffActive() : isFleetActive()
            const isExpanded = item.to.startsWith("/staff") ? staffExpanded : fleetExpanded
            const toggleExpanded = item.to.startsWith("/staff")
              ? () => setStaffExpanded((p) => !p)
              : () => setFleetExpanded((p) => !p)

            return (
              <div key={item.to}>
                <div className="group relative flex items-center gap-1">
                  {isActive && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-sidebar-primary" />}
                  <NavLink to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/80 text-sidebar-primary-foreground shadow-[0_4px_14px_-2px_rgba(228,6,19,0.4)]"
                        : "text-sidebar-foreground hover:translate-x-0.5 hover:bg-sidebar-accent/60"
                    }`}>
                    <span className={`transition-transform duration-200 ${!isActive ? "group-hover:scale-110" : ""}`}>{item.icon}</span>
                    {item.label}
                  </NavLink>
                  <button
                    onClick={toggleExpanded}
                    className={`rounded-lg p-1.5 transition-colors hover:bg-sidebar-accent/50 ${
                      isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground"
                    }`}>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-accent/30 pl-3 animate-fade-in-up">
                    {item.children!.map((child) => (
                      <NavLink key={child.to} to={child.to}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive: ca }) =>
                          `flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                            ca ? "bg-sidebar-primary/80 text-sidebar-primary-foreground shadow-sm"
                               : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                          }`
                        }>
                        {child.icon}{child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-sidebar-accent/40 px-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-primary-foreground shadow-[0_2px_8px_rgba(228,6,19,0.35)]">
              {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user?.full_name}</p>
              <p className="truncate text-xs leading-tight text-sidebar-foreground/50">{user ? roleLabel(user.role) : ""}</p>
            </div>
            <span className="h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />Sign out
          </Button>
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
            <button className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Bell className="h-4.5 w-4.5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-primary-foreground shadow-sm">
              {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
