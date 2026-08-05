import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Users, ShieldCheck, AlertTriangle, Truck, XCircle, MapPin, UserCheck,
  ArrowUpRight, Sparkles, ChevronRight, Eye, EyeOff,
} from "lucide-react"
import { ShaderGradientCanvas, ShaderGradient } from "@shadergradient/react"
import { motion } from "framer-motion"

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.07 } } },
  item: {
    initial: { opacity: 0, y: 20, scale: 0.96 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  },
}

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
  const { isDark } = useTheme()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [ringHidden, setRingHidden] = useState(() => localStorage.getItem("guardtec_ring_hidden") === "true")

  function toggleRing() {
    const next = !ringHidden
    setRingHidden(next)
    localStorage.setItem("guardtec_ring_hidden", String(next))
  }

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
      <div className={`relative overflow-hidden rounded-2xl p-8 ${isDark ? "text-white" : "text-[hsl(224_14%_10%)]"}`}
        style={{ minHeight: "200px" }}
      >
        {/* ShaderGradient canvas — full bleed behind all content */}
        <div className="absolute inset-0 z-0 rounded-2xl overflow-hidden">
          <ShaderGradientCanvas style={{ width: "100%", height: "100%" }}>
            {isDark ? (
              /* Preset #03 — Interstellar */
              <ShaderGradient
                animate="on" axesHelper="off"
                bgColor1="#000000" bgColor2="#000000"
                brightness={0.8}
                cAzimuthAngle={270} cDistance={0.5} cPolarAngle={180} cameraZoom={15.1}
                color1="#73bfc4" color2="#ff810a" color3="#8da0ce"
                destination="onCanvas" embedMode="off" envPreset="city"
                format="gif" fov={45} frameRate={10}
                gizmoHelper="hide" grain="on" lightType="env"
                pixelDensity={1}
                positionX={-0.1} positionY={0} positionZ={0}
                range="disabled" rangeEnd={40} rangeStart={0}
                reflection={0.4} rotationX={0} rotationY={130} rotationZ={70}
                shader="defaults" type="sphere"
                uAmplitude={3.2} uDensity={0.8} uFrequency={5.5}
                uSpeed={0.3} uStrength={0.3} uTime={0} wireframe={false}
              />
            ) : (
              /* Preset #09 — Cotton Candy */
              <ShaderGradient
                animate="on" axesHelper="off"
                bgColor1="#000000" bgColor2="#000000"
                brightness={1.2}
                cAzimuthAngle={180} cDistance={2.9} cPolarAngle={120} cameraZoom={1}
                color1="#ebedff" color2="#f3f2f8" color3="#dbf8ff"
                destination="onCanvas" embedMode="off" envPreset="city"
                format="gif" fov={45} frameRate={10}
                gizmoHelper="hide" grain="off" lightType="3d"
                pixelDensity={1}
                positionX={0} positionY={1.8} positionZ={0}
                range="disabled" rangeEnd={40} rangeStart={0}
                reflection={0.1} rotationX={0} rotationY={0} rotationZ={-90}
                shader="defaults" type="waterPlane"
                uAmplitude={0} uDensity={1} uFrequency={5.5}
                uSpeed={0.3} uStrength={3} uTime={0.2} wireframe={false}
              />
            )}
          </ShaderGradientCanvas>
        </div>

        {/* Dark overlay — improves text contrast over gradient */}
        <div className={`absolute inset-0 z-[1] rounded-2xl ${isDark ? "bg-black/40" : "bg-white/20"}`} />

        {/* Toggle ring button — top right */}
        <button
          onClick={toggleRing}
          title={ringHidden ? "Show compliance ring" : "Hide compliance ring"}
          className={`absolute right-4 top-4 z-[3] flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium backdrop-blur-sm transition-all ${
            isDark
              ? "border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
              : "border-black/10 bg-black/5 text-black/40 hover:bg-black/10 hover:text-black/60"
          }`}
        >
          {ringHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {ringHidden ? "Show ring" : "Hide ring"}
        </button>

        <div className="relative z-[2] flex flex-col gap-6 md:flex-row md:items-center md:justify-between">

          {/* Left: brand logo + greeting */}
          <div>
            <div className="mb-6">
              <img
                src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
                alt="GuardTec Security & Patrol"
                className="h-20 w-auto drop-shadow-lg"
              />
            </div>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              </span>
            </div>
            <h2 className="text-3xl font-black tracking-tight md:text-4xl">
              {greeting()}, {user?.full_name?.split(" ")[0]}
            </h2>
            <p className={`mt-2 max-w-md text-sm leading-relaxed ${isDark ? "text-white/60" : "text-black/55"}`}>
              Here's your live operations overview — officers, sites and fleet, all in one place.
            </p>
          </div>

          {/* Right: compliance ring — toggleable */}
          {compliancePct !== null && !ringHidden && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate("/compliance")}
                className={`group flex shrink-0 cursor-pointer items-center gap-4 rounded-2xl border px-6 py-4 backdrop-blur-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${
                  isDark
                    ? "border-white/10 bg-white/[0.06] hover:border-white/20 hover:bg-white/[0.10]"
                    : "border-black/10 bg-white/[0.50] hover:border-black/20 hover:bg-white/[0.70]"
                }`}
                title="Click to open Compliance Dashboard"
              >
                <div
                  className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(#22c55e ${compliancePct * 3.6}deg, rgba(128,128,128,0.2) 0deg)`,
                  }}
                >
                  <div className={`flex h-[62px] w-[62px] items-center justify-center rounded-full ${isDark ? "bg-black/60" : "bg-white/80"} backdrop-blur-sm`}>
                    <span className="text-lg font-bold">{compliancePct}%</span>
                  </div>
                </div>
                <div className="text-left">
                  <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-white/40" : "text-black/40"}`}>Staff Compliance</p>
                  <p className={`mt-0.5 text-sm ${isDark ? "text-white/70" : "text-black/60"}`}>
                    {stats?.compliant ?? 0} of {stats?.totalStaff ?? 0} officers
                  </p>
                  <p className={`mt-0.5 text-xs ${isDark ? "text-white/30" : "text-black/30"}`}>fully documented &amp; deployable</p>
                  <p className={`mt-1.5 flex items-center gap-0.5 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100 text-primary`}>
                    View compliance <ChevronRight className="h-3 w-3" />
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Ring hidden — show minimal pill link */}
          {compliancePct !== null && ringHidden && (
            <button
              onClick={() => navigate("/compliance")}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium backdrop-blur-sm transition-all hover:scale-[1.02] ${
                isDark
                  ? "border-white/10 bg-white/[0.06] text-white/70 hover:bg-white/10"
                  : "border-black/10 bg-white/50 text-black/60 hover:bg-white/70"
              }`}
            >
              <ShieldCheck className="h-4 w-4 text-success" />
              {compliancePct}% compliant — {stats?.compliant ?? 0}/{stats?.totalStaff ?? 0} officers
              <ChevronRight className="h-3.5 w-3.5 opacity-50" />
            </button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        variants={stagger.container}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={stagger.item}>
          <StatCard label="Total staff" value={stats?.totalStaff ?? "--"} sub="across all sites"
            icon={<Users className="h-5 w-5" />} tint="blue" onClick={() => navigate("/staff")} clickable />
        </motion.div>
        <motion.div variants={stagger.item}>
          <StatCard label="Active sites" value={stats?.activeSites ?? "--"} sub="currently running"
            icon={<MapPin className="h-5 w-5" />} tint="teal" onClick={() => navigate("/sites")} clickable />
        </motion.div>
        <motion.div variants={stagger.item}>
          <StatCard label="Vehicles" value={stats?.vehicles ?? "--"} sub="in fleet"
            icon={<Truck className="h-5 w-5" />} tint="amber" onClick={() => navigate("/fleet?tab=vehicles")} clickable />
        </motion.div>
        <motion.div variants={stagger.item}>
          <StatCard label="Drivers" value={stats?.drivers ?? "--"} sub="registered"
            icon={<UserCheck className="h-5 w-5" />} tint="purple" onClick={() => navigate("/fleet?tab=drivers")} clickable />
        </motion.div>
        <motion.div variants={stagger.item}>
          <StatCard label="Compliant" value={stats?.compliant ?? "--"} sub="all docs valid"
            icon={<ShieldCheck className="h-5 w-5" />} tint="green" />
        </motion.div>
        <motion.div variants={stagger.item}>
          {stats && stats.expired > 0 ? (
            <StatCard label="Expired" value={stats.expired} sub="immediate action"
              icon={<XCircle className="h-5 w-5" />} tint="red" highlight />
          ) : (
            <StatCard label="Expiring soon" value={stats?.expiringSoon ?? "--"} sub="within 90 days"
              icon={<AlertTriangle className="h-5 w-5" />} tint={stats && stats.expiringSoon > 0 ? "amber" : "gray"} />
          )}
        </motion.div>
      </motion.div>

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
          <motion.div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            variants={stagger.container}
            initial="initial"
            animate="animate"
          >
            {sites.map((site, i) => (
              <motion.div
                key={site.id}
                variants={stagger.item}
                onClick={() => navigate("/sites")}
                className="surface surface-hover cursor-pointer p-4"
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
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}

type Tint = "blue" | "teal" | "amber" | "purple" | "green" | "red" | "gray"

const TINTS: Record<Tint, { bg: string; text: string; strip: string }> = {
  blue:   { bg: "bg-blue-500/10",    text: "text-blue-500",              strip: "#3b82f6" },
  teal:   { bg: "bg-teal-500/10",    text: "text-teal-500",              strip: "#14b8a6" },
  amber:  { bg: "bg-amber-500/10",   text: "text-amber-500",             strip: "#f59e0b" },
  purple: { bg: "bg-purple-500/10",  text: "text-purple-500",            strip: "#a855f7" },
  green:  { bg: "bg-[#22c55e]/10",   text: "text-[#22c55e]",             strip: "#22c55e" },
  red:    { bg: "bg-[#ef4444]/10",   text: "text-[#ef4444]",             strip: "#ef4444" },
  gray:   { bg: "bg-muted",          text: "text-muted-foreground",      strip: "#6b7280" },
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
      className={`surface relative overflow-hidden p-4 pl-5 ${highlight ? "border-[#ef4444]/40" : ""} ${clickable ? "surface-hover cursor-pointer" : ""}`}
    >
      {/* Status strip — left border, Trust & Authority pattern */}
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: t.strip }} />

      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${t.bg} ${t.text}`}>{icon}</div>
        {clickable && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <p className={`text-3xl font-black tracking-tight tabular-nums ${highlight ? "text-[#ef4444]" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[11px] text-muted-foreground/60">{sub}</p>
    </div>
  )
}
