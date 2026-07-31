import { useState, type FormEvent } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ShieldCheck, Eye, EyeOff, Users, Radio, Camera, CalendarDays, Bot, Zap, Plane } from "lucide-react"

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
              <p className="text-[10px] text-white/25 tracking-widest">SECURITY &amp; PATROL LTD</p>
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
              <span className="text-xs">GuardTec Security &amp; Patrol Ltd — UK Manned Guarding &amp; CCTV Services</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel — Login form + About ── */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto bg-background px-8 py-12">
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

          <div className="mt-5 rounded-lg border border-muted bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              Forgotten your password?
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">
              Please contact your Director or System Administrator to have your password reset via the Team Access portal.
            </p>
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            New staff member with a registration code?{" "}
            <Link to="/register" className="text-primary hover:underline">Set up your account</Link>
          </p>
        </div>

        {/* ── About GuardTec section ── */}
        <div className="mt-12 w-full max-w-lg">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">About Us</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Tagline */}
          <div className="mb-6 text-center">
            <p className="text-lg font-bold tracking-tight" style={{ fontFamily: "'Orbitron', sans-serif" }}>
              Smart Security.{" "}
              <span style={{ color: "#E40613" }}>Real Response.</span>{" "}
              Complete Protection.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              GuardTec delivers professional, technology-driven security solutions for large sites,
              small &amp; medium businesses, and major national events.
            </p>
          </div>

          {/* Services grid */}
          <div className="mb-6 grid grid-cols-2 gap-3">
            {[
              { icon: Users,       title: "Security Guarding",        desc: "Access control, AI CCTV towers & 24/7 monitoring for large sites" },
              { icon: Radio,       title: "Mobile Response",           desc: "Rapid alarm response, mobile patrols & keyholding services" },
              { icon: Camera,      title: "CCTV & Drone Security",     desc: "Mobile CCTV & drone patrols for remote or complex environments" },
              { icon: CalendarDays, title: "Event & Media Security",   desc: "Crowd management, VIP protection & event control for festivals & sports" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border bg-muted/30 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10">
                    <Icon className="h-3.5 w-3.5" style={{ color: "#E40613" }} />
                  </div>
                  <p className="text-xs font-semibold">{title}</p>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>

          {/* Key strengths */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: ShieldCheck, label: "SIA Licensed Officers" },
              { icon: Bot,         label: "AI-Assisted CCTV" },
              { icon: Zap,         label: "20–30 Min Response" },
              { icon: Plane,       label: "Drone-Ready Patrols" },
              { icon: Users,       label: "ACS Approved" },
              { icon: Camera,      label: "24/7 Monitoring" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 rounded-lg border bg-muted/20 px-2.5 py-2">
                <Icon className="h-3 w-3 shrink-0 text-muted-foreground" style={{ color: "#E40613" }} />
                <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <p className="mt-8 text-center text-xs text-muted-foreground/50">
            GuardTec Security &amp; Patrol Ltd &copy; {new Date().getFullYear()} · UK Manned Guarding &amp; CCTV Services
          </p>
        </div>
      </div>
    </div>
  )
}
