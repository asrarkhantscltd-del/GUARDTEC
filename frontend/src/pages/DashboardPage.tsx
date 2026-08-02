import { useAuth } from "@/contexts/AuthContext"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Users, ShieldCheck, AlertTriangle, Truck, XCircle, MapPin, UserCheck,
  ArrowUpRight, Sparkles,
} from "lucide-react"

interface DashboardStats {
  totalStaff: number
  compliant: number
  expiringSoon: number
  expired: number
  vehicles: number
  activeSites: number
  drivers: number
}

interface Site {
  id: string
  name: string
  type: string
  client_name: string
  address: string
  supervisor_name: string
  status: string
}

const TYPE_LABELS: Record<string, string> = {
  construction: "Construction",
  parking: "Parking",
  events: "Events",
  retail: "Retail",
  corporate: "Corporate",
  other: "Other",
}

const TYPE_COLORS: Record<string, string> = {
  construction: "bg-amber-100 text-amber-800",
  parking: "bg-blue-100 text-blue-800",
  events: "bg-purple-100 text-purple-800",
  retail: "bg-teal-100 text-teal-800",
  corporate: "bg-gray-100 text-gray-700",
  other: "bg-gray-100 text-gray-700",
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("")
}

const AV_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-teal-100 text-teal-700",
  "bg-pink-100 text-pink-700",
  "bg-amber-100 text-amber-800",
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [sites, setSites] = useState<Site[]>([])

  useEffect(() => {
    fetch("/api/dashboard/stats", { credentials: "include" })
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})

    fetch("/api/sites", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setSites((d.sites ?? []).filter((s: Site) => s.status !== "inactive")))
      .catch(() => {})
  }, [])

  const compliancePct = stats && stats.totalStaff > 0
    ? Math.round((stats.compliant / stats.totalStaff) * 100)
    : null

  return (
    <div className="space-y-6">

      {/* ── Hero banner ── */}
      <div className="relative overflow-hidden rounded-2xl p-8"
        style={{ background: "linear-gradient(135deg, #0c0d0e 0%, #17191f 55%, #100f13 100%)" }}>

        <div className="glow-blob absolute -right-16 -top-24 h-72 w-72 animate-glow-pulse" />
        <div className="glow-blob absolute -bottom-20 left-1/3 h-56 w-56 opacity-60" />
        <div className="bg-dot-grid absolute inset-0 text-white opacity-[0.04]" />

        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              </span>
            </div>
            <h2 className="text-3xl font-black tracking-tight text-white md:text-4xl"
              style={{ fontFamily: "'Orbitron', sans-serif" }}>
              {greeting()}, {user?.full_name?.split(" ")[0]}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/50">
              Here's your live operations overview — officers, sites and fleet, all in one place.
            </p>
          </div>

          {/* Compliance ring */}
          {compliancePct !== null && (
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-sm">
              <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(#22c55e ${compliancePct * 3.6}deg, rgba(255,255,255,0.1) 0deg)`,
                }}>
                <div className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-[#0c0d0e]">
                  <span className="text-lg font-bold text-white">{compliancePct}%</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Staff Compliance</p>
                <p className="mt-0.5 text-sm text-white/60">{stats?.compliant ?? 0} of {stats?.totalStaff ?? 0} officers</p>
                <p className="mt-0.5 text-xs text-white/30">fully documented &amp; deployable</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total staff"
          value={stats?.totalStaff ?? "--"}
          sub="across all sites"
          icon={<Users className="h-5 w-5" />}
          tint="blue"
          onClick={() => navigate("/staff")}
          clickable
        />
        <StatCard
          label="Active sites"
          value={stats?.activeSites ?? "--"}
          sub="currently running"
          icon={<MapPin className="h-5 w-5" />}
          tint="teal"
          onClick={() => navigate("/sites")}
          clickable
        />
        <StatCard
          label="Vehicles"
          value={stats?.vehicles ?? "--"}
          sub="in fleet"
          icon={<Truck className="h-5 w-5" />}
          tint="amber"
          onClick={() => navigate("/fleet?tab=vehicles")}
          clickable
        />
        <StatCard
          label="Drivers"
          value={stats?.drivers ?? "--"}
          sub="registered"
          icon={<UserCheck className="h-5 w-5" />}
          tint="purple"
          onClick={() => navigate("/fleet?tab=drivers")}
          clickable
        />
        <StatCard
          label="Compliant"
          value={stats?.compliant ?? "--"}
          sub="all docs valid"
          icon={<ShieldCheck className="h-5 w-5" />}
          tint="green"
        />
        {stats && stats.expired > 0 ? (
          <StatCard
            label="Expired"
            value={stats.expired}
            sub="immediate action"
            icon={<XCircle className="h-5 w-5" />}
            tint="red"
            highlight
          />
        ) : (
          <StatCard
            label="Expiring soon"
            value={stats?.expiringSoon ?? "--"}
            sub="within 90 days"
            icon={<AlertTriangle className="h-5 w-5" />}
            tint={stats && stats.expiringSoon > 0 ? "amber" : "gray"}
          />
        )}
      </div>

      {/* Sites overview */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Active sites — operations</h3>
          <button
            onClick={() => navigate("/sites")}
            className="group flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Manage sites <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        </div>

        {sites.length === 0 ? (
          <div className="surface rounded-xl border-dashed p-8 text-center text-sm text-muted-foreground">
            No active sites yet.{" "}
            <button onClick={() => navigate("/sites")} className="text-primary hover:underline">
              Add your first site
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((site, i) => (
              <div
                key={site.id}
                onClick={() => navigate("/sites")}
                className="surface surface-hover animate-fade-in-up cursor-pointer p-4"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{site.name}</p>
                    {site.client_name && (
                      <p className="text-xs text-muted-foreground truncate">{site.client_name}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      TYPE_COLORS[site.type] ?? TYPE_COLORS.other
                    }`}
                  >
                    {TYPE_LABELS[site.type] ?? "Other"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {site.supervisor_name ? (
                    <>
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                          AV_COLORS[i % AV_COLORS.length]
                        }`}
                      >
                        {initials(site.supervisor_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{site.supervisor_name}</p>
                        <p className="text-[10px] text-muted-foreground">Supervisor</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No supervisor assigned</p>
                  )}
                </div>

                {site.address && (
                  <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {site.address}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type Tint = "blue" | "teal" | "amber" | "purple" | "green" | "red" | "gray"

const TINTS: Record<Tint, { bg: string; text: string }> = {
  blue:   { bg: "bg-blue-500/10",   text: "text-blue-600 dark:text-blue-400" },
  teal:   { bg: "bg-teal-500/10",   text: "text-teal-600 dark:text-teal-400" },
  amber:  { bg: "bg-amber-500/10",  text: "text-amber-600 dark:text-amber-400" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400" },
  green:  { bg: "bg-success/10",    text: "text-success" },
  red:    { bg: "bg-destructive/10", text: "text-destructive" },
  gray:   { bg: "bg-muted",         text: "text-muted-foreground" },
}

interface StatCardProps {
  label: string
  value: number | string
  sub: string
  icon: React.ReactNode
  tint: Tint
  highlight?: boolean
  clickable?: boolean
  onClick?: () => void
}

function StatCard({ label, value, sub, icon, tint, highlight, clickable, onClick }: StatCardProps) {
  const t = TINTS[tint]
  return (
    <div
      onClick={onClick}
      className={`surface p-4 ${highlight ? "border-destructive/30" : ""} ${clickable ? "surface-hover cursor-pointer" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${t.bg} ${t.text}`}>{icon}</div>
        {clickable && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <p className={`text-2xl font-bold tracking-tight ${highlight ? "text-destructive" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-[11px] text-muted-foreground/70">{sub}</p>
    </div>
  )
}
