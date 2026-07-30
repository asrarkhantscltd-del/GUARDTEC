import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ShieldCheck, Eye, EyeOff } from "lucide-react"

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      await login(username, password)
      navigate("/", { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen">

      {/* ── Left panel — GuardTec branding ── */}
      <div className="relative hidden lg:flex lg:w-[55%] flex-col overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0c0d0e 0%, #161820 50%, #0f1014 100%)" }}>

        {/* Subtle red glow top-right */}
        <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #E40613 0%, transparent 70%)" }} />

        {/* Red accent bottom bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#E40613]" />

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />

        <div className="relative z-10 flex h-full flex-col justify-between p-14">

          {/* Top: Logo */}
          <div className="flex items-center gap-3">
            <img src="/logo-white.png" alt="GuardTec" className="h-12 w-auto" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">GuardTec</p>
              <p className="text-[10px] text-white/25 tracking-widest">SECURITY LTD</p>
            </div>
          </div>

          {/* Middle: Tagline */}
          <div>
            <div className="mb-6 flex items-center gap-2">
              <div className="h-px w-8 bg-[#E40613]" />
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E40613]">Compliance Portal</span>
            </div>
            <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-white"
              style={{ fontFamily: "'Orbitron', sans-serif" }}>
              Smart<br />
              Security.<br />
              <span className="text-[#E40613]">Real</span><br />
              Response.
            </h1>
            <p className="mt-8 max-w-sm text-base leading-relaxed text-white/50">
              Professional compliance management — keeping your officers certified,
              deployed, and audit-ready across every site.
            </p>

            {/* Feature pills */}
            <div className="mt-8 flex flex-wrap gap-2">
              {["SIA Licensed", "ACS Approved", "GDPR Compliant", "Multi-Role Access"].map(f => (
                <span key={f} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom: company footer */}
          <div className="border-t border-white/8 pt-6">
            <div className="flex items-center gap-2 text-white/30">
              <ShieldCheck className="h-4 w-4 text-[#E40613]" />
              <span className="text-xs">GuardTec Security Ltd — UK Manned Guarding &amp; CCTV Services</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel — Login form ── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-8 py-12">
        <div className="w-full max-w-sm">

          {/* Mobile logo (hidden on desktop) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/logo-white.png" alt="GuardTec" className="h-16 w-auto" />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight"
              style={{ fontFamily: "'Orbitron', sans-serif" }}>
              Welcome Back
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to access your compliance dashboard
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-medium">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                className="h-11"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="h-11 pr-10"
                  required
                />
                <button type="button" tabIndex={-1}
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="h-11 w-full text-sm font-semibold" disabled={submitting}>
              {submitting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</>
                : "Sign In"}
            </Button>
          </form>

          {/* Footer */}
          <p className="mt-8 text-center text-xs text-muted-foreground/60">
            GuardTec Security Ltd &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  )
}
