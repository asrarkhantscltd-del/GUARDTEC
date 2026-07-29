import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import { useAuth, type UserRole } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, Users, Truck, ShieldCheck, LogOut,
  Menu, X, ChevronDown, MapPin, FileWarning, BarChart3,
  Car, UserCheck,
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
    label: "Compliance",
    to: "/compliance",
    icon: <ShieldCheck className="h-4 w-4" />,
    roles: ["director","ops_manager","hr_manager","supervisor"],
  },
]

function roleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    director: "Director", ops_manager: "Ops Manager", hr_manager: "HR Manager",
    office_manager: "Office Manager", accounts: "Accounts", media: "Media",
    supervisor: "Supervisor", fleet_manager: "Fleet Manager",
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

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform md:relative md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <button
          onClick={() => { navigate("/"); setSidebarOpen(false) }}
          className="flex h-20 w-full items-center gap-3 border-b px-4 transition-colors hover:bg-sidebar-accent/10"
        >
          <img src="/logo-white.png" alt="GuardTec" className="h-14 w-auto shrink-0" />
          <div className="text-left">
            <p className="text-sm font-bold leading-tight">GuardTec</p>
            <p className="text-xs leading-tight text-sidebar-foreground/60">Security Ltd</p>
            <p className="mt-0.5 text-[10px] leading-tight text-sidebar-foreground/40">Compliance Portal</p>
          </div>
        </button>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {visibleNav.map((item) => {
            if (!item.children) {
              return (
                <NavLink key={item.to} to={item.to} end={item.to === "/"}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive ? "bg-sidebar-accent text-sidebar-accent-foreground"
                               : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`
                  }>
                  {item.icon}{item.label}
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
                <div className="flex items-center gap-1">
                  <NavLink to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive ? "bg-sidebar-accent text-sidebar-accent-foreground"
                               : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`}>
                    {item.icon}{item.label}
                  </NavLink>
                  <button
                    onClick={toggleExpanded}
                    className={`rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/50 ${
                      isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground"
                    }`}>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-accent/30 pl-3">
                    {item.children!.map((child) => (
                      <NavLink key={child.to} to={child.to}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive: ca }) =>
                          `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                            ca ? "bg-sidebar-accent/70 text-sidebar-accent-foreground"
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

        <div className="border-t p-3">
          <div className="mb-2 px-3">
            <p className="text-sm font-medium">{user?.full_name}</p>
            <p className="text-xs text-muted-foreground">{user ? roleLabel(user.role) : ""}</p>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />Sign out
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <h1 className="text-lg font-semibold">GuardTec Compliance</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
