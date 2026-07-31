import { Outlet, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 items-center gap-3 border-b bg-sidebar px-4 text-sidebar-foreground md:px-8">
        <img src="/logo-white.png" alt="GuardTec" className="h-9 w-auto" />
        <div>
          <p className="text-sm font-bold leading-tight text-white">GuardTec</p>
          <p className="text-[10px] leading-tight text-white/40">Staff Portal</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-white">{user?.full_name}</p>
            <p className="text-[11px] leading-tight text-white/40">My Profile</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-white">
            {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={handleLogout}
            className="text-white/70 hover:bg-white/10 hover:text-white" title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:px-6">
        <Outlet />
      </main>
    </div>
  )
}
