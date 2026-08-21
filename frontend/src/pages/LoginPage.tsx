import { useState, useEffect, type FormEvent } from "react"
import { useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Loader2, ShieldCheck, Eye, EyeOff,
  Users, Radio, Camera, CalendarDays, AlertCircle,
  MapPin, Phone, Mail, Globe, Award, Shield, CheckCircle2,
} from "lucide-react"

const SERVICES = [
  { icon: Users,        title: "Security Guarding",  desc: "Access control & 24/7 monitoring" },
  { icon: Radio,        title: "Mobile Response",     desc: "Rapid alarm & keyholding services" },
  { icon: Camera,       title: "CCTV & Drone",        desc: "Mobile CCTV & drone patrols" },
  { icon: CalendarDays, title: "Events Security",     desc: "Crowd management & VIP protection" },
]

const CERTS = [
  { icon: Shield,       label: "SIA Licensed" },
  { icon: Award,        label: "ACS Approved" },
  { icon: ShieldCheck,  label: "GDPR Compliant" },
  { icon: CheckCircle2, label: "BS 7858 Vetted" },
]

const fade = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] },
})

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.backgroundColor
    html.style.backgroundColor = "#0a0203"
    return () => { html.style.backgroundColor = prev }
  }, [])

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
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10"
      style={{ background: "linear-gradient(160deg, #0c0e12 0%, #111318 30%, #0a0203 100%)" }}
    >
      {/* ── Animated background effects ─────────────────────────────────── */}
      <motion.div
        className="pointer-events-none absolute -top-40 -right-40 h-[800px] w-[800px] rounded-full"
        style={{ background: "radial-gradient(circle, #E40613 0%, transparent 55%)" }}
        animate={{ opacity: [0.1, 0.2, 0.1], scale: [1, 1.1, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full"
        style={{ background: "radial-gradient(circle, #E40613 0%, transparent 55%)" }}
        animate={{ opacity: [0.06, 0.15, 0.06], scale: [1, 1.08, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />
      <motion.div
        className="pointer-events-none absolute top-1/4 left-1/4 h-[400px] w-[400px] rounded-full"
        style={{ background: "radial-gradient(circle, #00A99D 0%, transparent 60%)" }}
        animate={{ opacity: [0.02, 0.07, 0.02] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 4 }}
      />

      {/* Top + bottom red bars */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#E40613] via-[#E40613] to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#E40613] to-[#E40613]" />

      {/* Scan line */}
      <div className="scan-line absolute inset-0 pointer-events-none" />

      {/* Dot grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.018] bg-dot-grid text-white" />

      {/* Grid lines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      {/* ── Logo — large and centred ────────────────────────────────────── */}
      <motion.div
        className="relative z-10 mb-8"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="glow-blob absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 opacity-60" />
        <img
          src="/logo-on-dark.svg"
          alt="GuardTec Security & Patrol"
          className="relative z-10 h-auto w-72 sm:w-80 md:w-96"
        />
      </motion.div>

      {/* ── Tagline ─────────────────────────────────────────────────────── */}
      <motion.div className="relative z-10 mb-10 text-center" {...fade(0.2)}>
        <div className="mb-4 flex items-center justify-center gap-3">
          <div className="h-px w-10 bg-[#E40613]" />
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.5em] text-[#E40613]">
            Compliance Portal
          </span>
          <div className="h-px w-10 bg-[#E40613]" />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-black tracking-wider text-white uppercase leading-tight">
          Smart Security.{" "}
          <span className="text-[#E40613]">Real</span> Response.
        </h1>
      </motion.div>

      {/* ── Login card — glass panel ────────────────────────────────────── */}
      <motion.div
        className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.04] p-8 shadow-2xl backdrop-blur-xl"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Red top accent on card */}
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-[#E40613]/50 to-transparent" />

        {/* Badge */}
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#E40613]/25 bg-[#E40613]/10 px-3.5 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E40613] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E40613]" />
          </span>
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.25em] text-[#E40613]">
            Secure Access
          </span>
        </div>

        {/* Heading */}
        <h2 className="font-display text-2xl font-bold tracking-wider text-white uppercase mb-1.5">
          Welcome Back
        </h2>
        <p className="mb-6 text-sm text-white/40">
          Sign in to your compliance dashboard
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <motion.div
              className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-sm font-medium text-white/70">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              className="h-11 rounded-xl border-white/10 bg-white/[0.06] text-white placeholder:text-white/25 focus:border-[#E40613]/50 focus:ring-[#E40613]/30"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium text-white/70">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="h-11 rounded-xl border-white/10 bg-white/[0.06] text-white placeholder:text-white/25 pr-10 focus:border-[#E40613]/50 focus:ring-[#E40613]/30"
                required
              />
              <button type="button" tabIndex={-1}
                onClick={() => setShowPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="mt-2 h-11 w-full rounded-xl bg-[#E40613] font-display text-sm font-semibold uppercase tracking-wider text-white hover:bg-[#c80511] transition-colors"
            disabled={submitting}
          >
            {submitting
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in…</>
              : "Sign In"}
          </Button>
        </form>

        <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
          <p className="text-xs font-semibold text-white/50">Forgotten your password?</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/25">
            Contact your Director or System Administrator — they can reset it via the Team Access portal.
          </p>
        </div>

        <p className="mt-4 text-center text-[13px] text-white/40">
          New staff member?{" "}
          <Link to="/register" className="font-semibold text-[#E40613] hover:text-[#ff2438] hover:underline transition-colors">
            Set up your account
          </Link>
        </p>
      </motion.div>

      {/* ── Certification badges ────────────────────────────────────────── */}
      <motion.div
        className="relative z-10 mt-10 flex flex-wrap items-center justify-center gap-3"
        {...fade(0.7)}
      >
        {CERTS.map(({ icon: Icon, label }, i) => (
          <motion.div
            key={label}
            className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-2 backdrop-blur-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.8 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <Icon className="h-3.5 w-3.5 text-[#E40613]" />
            <span className="text-[11px] font-medium text-white/50">{label}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* ── Services row ────────────────────────────────────────────────── */}
      <motion.div
        className="relative z-10 mt-10 w-full max-w-3xl"
        {...fade(0.95)}
      >
        <div className="mb-4 flex items-center justify-center gap-3">
          <div className="h-px flex-1 max-w-20 bg-white/[0.06]" />
          <span className="font-display text-[9px] font-medium uppercase tracking-[0.3em] text-white/20">
            Our Services
          </span>
          <div className="h-px flex-1 max-w-20 bg-white/[0.06]" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SERVICES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              className="flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 text-center backdrop-blur-sm"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.0 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E40613]/10">
                <Icon className="h-4 w-4 text-[#E40613]" />
              </div>
              <p className="text-xs font-semibold text-white/70">{title}</p>
              <p className="text-[10px] leading-tight text-white/30">{desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── Footer — company info ───────────────────────────────────────── */}
      <motion.div className="relative z-10 mt-10 text-center space-y-2" {...fade(1.1)}>
        <div className="flex items-center justify-center gap-2 text-white/20">
          <ShieldCheck className="h-3.5 w-3.5 text-[#E40613]/60" />
          <span className="font-display text-[9px] font-medium tracking-[0.3em] uppercase">
            GuardTec Security & Patrol Ltd
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[10px] text-white/20">
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> 268 Bath Road, Slough, SL1 4DE
          </span>
          <span className="flex items-center gap-1.5">
            <Phone className="h-3 w-3" /> +44 (0) 203 821 1992
          </span>
          <span className="flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> info@guardtec-security.co.uk
          </span>
          <span className="flex items-center gap-1.5">
            <Globe className="h-3 w-3" /> guardtec-security.co.uk
          </span>
        </div>
        <p className="text-[10px] text-[#E40613]/70 font-display tracking-wider">
          © {new Date().getFullYear()} GuardTec Security Ltd
        </p>
        <p className="text-[9px] text-[#E40613]/70 font-display uppercase tracking-[0.25em]">
          Designed &amp; Built by Asrar Khan
        </p>
      </motion.div>
    </div>
  )
}
