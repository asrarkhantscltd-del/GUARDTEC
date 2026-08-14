import { useState, type FormEvent } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Loader2, ShieldCheck, Eye, EyeOff,
  Users, Radio, Camera, CalendarDays, AlertCircle,
} from "lucide-react"

const SERVICES = [
  { icon: Users,        title: "Security Guarding",  desc: "Access control & 24/7 monitoring" },
  { icon: Radio,        title: "Mobile Response",     desc: "Rapid alarm & keyholding services" },
  { icon: Camera,       title: "CCTV & Drone",        desc: "Mobile CCTV & drone patrols" },
  { icon: CalendarDays, title: "Events Security",     desc: "Crowd management & VIP protection" },
]

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

      {/* ══ LEFT PANEL — GuardTec Brand ══════════════════════════════════════ */}
      <div
        className="relative hidden lg:flex lg:w-[54%] flex-col overflow-hidden"
        style={{ background: "linear-gradient(160deg, #080a0c 0%, #0e1014 40%, #0a0203 100%)" }}
      >
        {/* Layered red glows */}
        <div className="pointer-events-none absolute -top-40 right-0 h-[600px] w-[600px] rounded-full opacity-[0.18] animate-glow-pulse"
          style={{ background: "radial-gradient(circle, #E40613 0%, transparent 65%)" }} />
        <div className="pointer-events-none absolute bottom-0 -left-40 h-[400px] w-[400px] rounded-full opacity-[0.10]"
          style={{ background: "radial-gradient(circle, #E40613 0%, transparent 65%)", animationDelay: "1.5s" }} />

        {/* Top hairline */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#E40613]/60 to-transparent" />
        {/* Bottom red bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#E40613]" />

        {/* Dot grid overlay */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.022] bg-dot-grid text-white" />

        <div className="relative z-10 flex h-full flex-col justify-between p-14">

          {/* Logo — logo-on-dark.svg has its own black background, displays perfectly on dark panel */}
          <div>
            <img
              src="/logo-on-dark.svg"
              alt="GuardTec Security & Patrol"
              className="h-auto w-72 rounded-sm"
            />
          </div>

          {/* Hero copy */}
          <div>
            <div className="mb-7 flex items-center gap-3">
              <div className="h-px w-10 bg-[#E40613]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.4em] text-[#E40613]">
                Compliance Portal
              </span>
            </div>

            <h1 className="text-[4.2rem] font-black leading-[0.95] tracking-[-0.025em] text-white">
              Smart<br />
              Security.<br />
              <span className="text-[#E40613]">Real</span><br />
              Response.
            </h1>

            <p className="mt-8 max-w-[340px] text-[14px] leading-relaxed text-white/40">
              Professional compliance management — keeping your officers certified,
              deployed, and audit-ready across every site.
            </p>

            {/* Credential pills */}
            <div className="mt-8 flex flex-wrap gap-2">
              {["SIA Licensed", "ACS Approved", "GDPR Compliant", "Multi-Role Access"].map(f => (
                <span key={f}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-white/50">
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-white/[0.07] pt-6">
            <div className="flex items-center gap-2 text-white/25">
              <ShieldCheck className="h-4 w-4 text-[#E40613]/80" />
              <span className="text-xs">
                GuardTec Security &amp; Patrol Ltd — UK Manned Guarding &amp; CCTV Services
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ══ RIGHT PANEL — Login form ══════════════════════════════════════════ */}
      <div className="flex flex-1 flex-col bg-background">
        {/* Top red accent stripe */}
        <div className="h-[3px] w-full bg-gradient-to-r from-[#E40613] via-[#E40613]/50 to-transparent" />

        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-12">
          <div className="w-full max-w-[340px]">

            {/* Mobile logo */}
            <div className="mb-8 flex justify-center lg:hidden">
              <img
                src="/logo-on-dark.svg"
                alt="GuardTec"
                className="h-auto w-56 rounded-sm"
              />
            </div>

            {/* Secure Access badge */}
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-glow-pulse" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                Secure Access
              </span>
            </div>

            {/* Heading */}
            <div className="mb-8">
              <h2 className="text-[2rem] font-black tracking-tight text-foreground leading-tight">
                Welcome Back
              </h2>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                Sign in to your compliance dashboard
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
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
                  className="h-11 rounded-xl"
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
                    className="h-11 rounded-xl pr-10"
                    required
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setShowPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="mt-2 h-11 w-full rounded-xl text-sm font-semibold"
                disabled={submitting}
              >
                {submitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</>
                  : "Sign In"}
              </Button>
            </form>

            <div className="mt-4 rounded-xl border border-muted bg-muted/30 px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground">Forgotten your password?</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
                Contact your Director or System Administrator — they can reset it via the Team Access portal.
              </p>
            </div>

            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              New staff member?{" "}
              <Link to="/register" className="font-semibold text-primary hover:underline">
                Set up your account
              </Link>
            </p>
          </div>

          {/* Services — compact grid */}
          <div className="mt-12 w-full max-w-[400px]">
            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground/60">
                Our Services
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {SERVICES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="surface flex items-start gap-3 p-3.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-tight">{title}</p>
                    <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 text-center text-[10px] text-muted-foreground/35">
              GuardTec Security &amp; Patrol Ltd © {new Date().getFullYear()} · UK Manned Guarding &amp; CCTV Services
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
