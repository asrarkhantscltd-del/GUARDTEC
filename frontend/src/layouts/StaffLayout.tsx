import { Outlet, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Button } from "@/components/ui/button"
import { LogOut, Camera, Loader2, Sun, Moon } from "lucide-react"
import { useState, useEffect } from "react"

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  useEffect(() => {
    fetch("/api/me/photo", { credentials: "include" })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => { if (blob) setMyPhotoUrl(URL.createObjectURL(blob)) })
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

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className={`flex h-16 items-center gap-3 border-b px-4 md:px-8 ${
        isDark
          ? "border-[hsl(228_12%_11%)] bg-[hsl(228_14%_7%)] text-[hsl(220_14%_72%)]"
          : "border-[hsl(220_13%_91%)] bg-white text-[hsl(224_14%_15%)]"
      }`}>
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

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:px-6">
        <Outlet />
      </main>
    </div>
  )
}
