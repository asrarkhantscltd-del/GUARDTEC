import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ShieldCheck, Eye, EyeOff, KeyRound } from "lucide-react"

export default function RegisterPage() {
  const { refreshUser } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ registration_code: code, username, password }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || "Registration failed")

      await refreshUser()
      navigate("/", { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen">

      {/* ── Left panel — GuardTec branding ── */}
      <div className="relative hidden lg:flex lg:w-[55%] flex-col overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0c0d0e 0%, #161820 50%, #0f1014 100%)" }}>

        <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #E40613 0%, transparent 70%)" }} />
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#E40613]" />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />

        <div className="relative z-10 flex h-full flex-col justify-between p-14">
          <div className="flex items-center gap-3">
            <img src="/logo-white.png" alt="GuardTec" className="h-12 w-auto" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">GuardTec</p>
              <p className="text-[10px] text-white/25 tracking-widest">SECURITY &amp; PATROL LTD</p>
            </div>
          </div>

          <div>
            <div className="mb-6 flex items-center gap-2">
              <div className="h-px w-8 bg-[#E40613]" />
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E40613]">Staff Portal</span>
            </div>
            <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-white"
              style={{ fontFamily: "'Orbitron', sans-serif" }}>
              Set Up<br />
              Your<br />
              <span className="text-[#E40613]">Own</span><br />
              Access.
            </h1>
            <p className="mt-8 max-w-sm text-base leading-relaxed text-white/50">
              Use the registration code your manager gave you to create your own login,
              then keep your SIA, CSCS and Right to Work details up to date yourself.
            </p>
          </div>

          <div className="border-t border-white/8 pt-6">
            <div className="flex items-center gap-2 text-white/30">
              <ShieldCheck className="h-4 w-4 text-[#E40613]" />
              <span className="text-xs">GuardTec Security &amp; Patrol Ltd — UK Manned Guarding &amp; CCTV Services</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel — Registration form ── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-8 py-12">
        <div className="w-full max-w-sm">

          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/logo-white.png" alt="GuardTec" className="h-16 w-auto" />
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight"
              style={{ fontFamily: "'Orbitron', sans-serif" }}>
              Staff Registration
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the code your manager gave you to set up your portal login
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="code" className="text-sm font-medium">Registration code</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="code"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 7F3KQ9M2"
                  className="h-11 pl-9 font-mono uppercase tracking-widest"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-medium">Choose a username</Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. john.smith"
                autoComplete="username"
                className="h-11"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">Choose a password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  autoComplete="new-password"
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

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm password</Label>
              <Input
                id="confirmPassword"
                type={showPw ? "text" : "password"}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className="h-11"
                required
              />
            </div>

            <Button type="submit" className="h-11 w-full text-sm font-semibold" disabled={submitting}>
              {submitting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</>
                : "Create My Account"}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Already registered? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
