import { Outlet, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { LogOut, Camera, Loader2, Sun, Moon } from "lucide-react"
import { useState, useEffect } from "react"

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"))

  function toggleTheme() {
    const html = document.documentElement
    if (html.classList.contains("dark")) {
      html.classList.remove("dark"); html.classList.add("light")
      localStorage.setItem("theme", "light"); setIsDark(false)
    } else {
      html.classList.remove("light"); html.classList.add("dark")
      localStorage.setItem("theme", "dark"); setIsDark(true)
    }
  }

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
            className="text-white/70 hover:bg-white/10 hover:text-white">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
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
