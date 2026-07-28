import { Outlet, NavLink, useNavigate } from "react-router-dom"
import { useAuth, type UserRole } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard,
  Users,
  Truck,
  ShieldCheck,
  LogOut,
  Menu,
  X,
} from "lucide-react"
import { useState } from "react"

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles: UserRole[]
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    to: "/",
    icon: <LayoutDashboard className="h-4 w-4" />,
    roles: [
      "director",
      "ops_manager",
      "hr_manager",
      "office_manager",
      "accounts",
      "media",
      "supervisor",
      "fleet_manager",
    ],
  },
  {
    label: "Staff",
    to: "/staff",
    icon: <Users className="h-4 w-4" />,
    roles: [
      "director",
      "ops_manager",
      "hr_manager",
      "office_manager",
      "accounts",
      "supervisor",
    ],
  },
  {
    label: "Fleet",
    to: "/fleet",
    icon: <Truck className="h-4 w-4" />,
    roles: ["director", "fleet_manager", "ops_manager"],
  },
  {
    label: "Compliance",
    to: "/compliance",
    icon: <ShieldCheck className="h-4 w-4" />,
    roles: ["director", "ops_manager", "hr_manager", "supervisor"],
  },
]

function roleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    director: "Director",
    ops_manager: "Ops Manager",
    hr_manager: "HR Manager",
    office_manager: "Office Manager",
    accounts: "Accounts",
    media: "Media",
    supervisor: "Supervisor",
    fleet_manager: "Fleet Manager",
  }
  return labels[role]
}

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const visibleNav = navItems.filter(
    (item) => user && item.roles.includes(user.role)
  )

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform md:relative md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <img src="/logo-white.png" alt="GuardTec" className="h-8 w-auto" />
          <span className="text-lg font-semibold">GuardTec</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t p-3">
          <div className="mb-2 px-3">
            <p className="text-sm font-medium">{user?.full_name}</p>
            <p className="text-xs text-muted-foreground">
              {user ? roleLabel(user.role) : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
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
