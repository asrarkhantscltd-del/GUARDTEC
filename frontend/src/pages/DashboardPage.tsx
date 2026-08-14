import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { useNavigate, useOutletContext } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { initials, AV_COLORS } from "@/lib/utils"
import {
  Users, ShieldCheck, AlertTriangle, Truck, XCircle, MapPin, UserCheck,
  ArrowUpRight, Sparkles, ChevronRight,
} from "lucide-react"
import { ShaderGradientCanvas, ShaderGradient } from "@shadergradient/react"
import { motion } from "framer-motion"
import { makeStagger } from "@/lib/motion"

const stagger = makeStagger(0.07, 0.4)

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

const TYPE_STRIP: Record<string, string> = {
  construction: "#f59e0b",
  parking:      "#3b82f6",
  events:       "#a855f7",
  retail:       "#14b8a6",
  corporate:    "#64748b",
  other:        "#6b7280",
}

const TYPE_COLORS: Record<string, string> = {
  construction: "bg-amber-100 text-amber-800",
  parking: "bg-blue-100 text-blue-800",
  events: "bg-purple-100 text-purple-800",
  retail: "bg-teal-100 text-teal-800",
  corporate: "bg-gray-100 text-gray-700",
  other: "bg-gray-100 text-gray-700",
}

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
  const { ringHidden } = useOutletContext<{ ringHidden: boolean; toggleRing: () => void }>()

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api.get<DashboardStats>("/api/dashboard/stats"),
  })

  const { data: sitesData } = useQuery({
    queryKey: ["sites"],
    queryFn: () => api.get<{ sites: Site[] }>("/api/sites"),
  })
  const sites = (sitesData?.sites ?? []).filter((s) => s.status !== "inactive")

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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <ShaderGradient {...({
                animate: "on", bgColor1: "#000000", bgColor2: "#000000",
                brightness: 0.8,
                cAzimuthAngle: 270, cDistance: 0.5, cPolarAngle: 180, cameraZoom: 15.1,
                color1: "#73bfc4", color2: "#ff810a", color3: "#8da0ce",
                destination: "onCanvas", embedMode: "off", envPreset: "city",
                format: "gif", fov: 45, frameRate: 10,
                gizmoHelper: "hide", grain: "on", lightType: "env",
                pixelDensity: 1,
                positionX: -0.1, positionY: 0, positionZ: 0,
                range: "disabled", rangeEnd: 40, rangeStart: 0,
                reflection: 0.4, rotationX: 0, rotationY: 130, rotationZ: 70,
                shader: "defaults", type: "sphere",
                uAmplitude: 3.2, uDensity: 0.8, uFrequency: 5.5,
                uSpeed: 0.3, uStrength: 0.3, uTime: 0, wireframe: false,
              } as any)} />
            ) : (
              /* Preset #09 — Cotton Candy */
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <ShaderGradient {...({
                animate: "on", bgColor1: "#000000", bgColor2: "#000000",
                brightness: 1.2,
                cAzimuthAngle: 180, cDistance: 2.9, cPolarAngle: 120, cameraZoom: 1,
                color1: "#ebedff", color2: "#f3f2f8", color3: "#dbf8ff",
                destination: "onCanvas", embedMode: "off", envPreset: "city",
                format: "gif", fov: 45, frameRate: 10,
                gizmoHelper: "hide", grain: "off", lightType: "3d",
                pixelDensity: 1,
                positionX: 0, positionY: 1.8, positionZ: 0,
                range: "disabled", rangeEnd: 40, rangeStart: 0,
                reflection: 0.1, rotationX: 0, rotationY: 0, rotationZ: -90,
                shader: "defaults", type: "waterPlane",
                uAmplitude: 0, uDensity: 1, uFrequency: 5.5,
                uSpeed: 0.3, uStrength: 3, uTime: 0.2, wireframe: false,
              } as any)} />
            )}
          </ShaderGradientCanvas>
        </div>

        {/* Dark overlay — improves text contrast over gradient */}
        <div className={`absolute inset-0 z-[1] rounded-2xl ${isDark ? "bg-black/40" : "bg-white/20"}`} />

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
            {stats && (
              <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${isDark ? "text-white/50" : "text-black/45"}`}>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_4px_rgba(34,197,94,0.8)]" />
                  {stats.totalStaff} officers
                </span>
                <span className={`h-3 w-px ${isDark ? "bg-white/15" : "bg-black/15"}`} />
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_4px_rgba(34,197,94,0.8)]" />
                  {stats.activeSites} active sites
                </span>
                <span className={`h-3 w-px ${isDark ? "bg-white/15" : "bg-black/15"}`} />
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_4px_rgba(34,197,94,0.8)]" />
                  {stats.vehicles} vehicles
                </span>
              </div>
            )}
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

      {/* Compliance snapshot bar */}
      {stats && stats.totalStaff > 0 && (
        <div className="surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Compliance snapshot</p>
            <button
              onClick={() => navigate("/compliance")}
              className="group flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Full report <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </div>
          <div className="space-y-2.5">
            {([
              { label: "Compliant",     value: stats.compliant,    color: "#22c55e" },
              { label: "Expiring soon", value: stats.expiringSoon, color: "#f59e0b" },
              { label: "Expired",       value: stats.expired,      color: "#ef4444" },
            ] as const).map(({ label, value, color }) => (
              <div key={label} className="flex items-center gap-3">
                <p className="w-24 shrink-0 text-xs text-muted-foreground">{label}</p>
                <div className="flex-1 overflow-hidden rounded-full bg-muted" style={{ height: "6px" }}>
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{
                      width: `${Math.min(100, Math.round((value / stats.totalStaff) * 100))}%`,
                      background: color,
                    }}
                  />
                </div>
                <p className="w-7 shrink-0 text-right text-xs font-bold tabular-nums" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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
                className="surface surface-hover cursor-pointer overflow-hidden"
              >
                {/* Type colour bar */}
                <div className="h-[3px] w-full" style={{ background: TYPE_STRIP[site.type] ?? TYPE_STRIP.other }} />

                <div className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-sm">{site.name}</p>
                      {site.client_name && (
                        <p className="text-xs text-muted-foreground truncate">{site.client_name}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        TYPE_COLORS[site.type] ?? TYPE_COLORS.other
                      }`}
                    >
                      {TYPE_LABELS[site.type] ?? "Other"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/40 pt-3">
                    {site.supervisor_name ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                            AV_COLORS[i % AV_COLORS.length]
                          }`}
                        >
                          {initials(site.supervisor_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium leading-tight">{site.supervisor_name}</p>
                          <p className="text-[10px] leading-tight text-muted-foreground">Supervisor</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs italic text-muted-foreground">No supervisor assigned</p>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_4px_rgba(34,197,94,0.8)]" />
                      <span className="text-[10px] text-muted-foreground">Active</span>
                    </div>
                  </div>

                  {site.address && (
                    <p className="mt-2 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {site.address}
                    </p>
                  )}
                </div>
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
      {/* Status strip */}
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: t.strip }} />
      {/* Gradient bleed from strip */}
      <div className="pointer-events-none absolute left-0 top-0 h-full w-20 opacity-[0.06]"
        style={{ background: `linear-gradient(90deg, ${t.strip}, transparent)` }} />

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
