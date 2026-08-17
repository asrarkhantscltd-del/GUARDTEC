import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { useAuth } from "@/contexts/AuthContext"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/utils"
import { makeStagger } from "@/lib/motion"
import {
  Users, ShieldCheck, AlertTriangle, XCircle, ArrowUpRight, ChevronRight,
  CalendarClock, MapPin, ClipboardCheck, Loader2,
} from "lucide-react"
import type { AgencyStaffRecord } from "@/components/agency/AgencyStaffForm"
import { ComplianceBadge } from "@/components/agency/ComplianceBadge"

const stagger = makeStagger(0.06, 0.35)

// See the identical note in AgencyPortalStaffPage.tsx — agency_id isn't on
// AuthContext's User type yet; that's wired up in the integration step right
// after this stage.
function useAgencyId(): string {
  const { user } = useAuth()
  return String((user as unknown as { agency_id?: string } | null)?.agency_id ?? "")
}

// Real row shape returned by GET /api/agencies/:agencyId/deployments (server.js):
// SELECT d.*, COUNT(a.id) AS guard_count ... plus row.site = getSiteById(row.site_id).
interface AgencyDeploymentRow {
  id: string
  agency_id: string
  site_id: string
  event_date: string
  agency_acknowledged: boolean
  agency_acknowledged_by?: string
  agency_acknowledged_at?: string
  status: "scheduled" | "completed" | "cancelled"
  created_at?: string
  updated_at?: string
  guard_count?: string | number
  site?: { id: string; name: string; address?: string } | null
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

type Tint = "blue" | "green" | "amber" | "red"
const TINTS: Record<Tint, { bg: string; text: string; strip: string }> = {
  blue:  { bg: "bg-blue-500/10",   text: "text-blue-500",   strip: "#3b82f6" },
  green: { bg: "bg-success/10",    text: "text-success",    strip: "#22c55e" },
  amber: { bg: "bg-warning/10",    text: "text-warning",    strip: "#f59e0b" },
  red:   { bg: "bg-destructive/10", text: "text-destructive", strip: "#ef4444" },
}

function StatTile({ label, value, sub, icon, tint, onClick }: {
  label: string; value: number | string; sub: string; icon: React.ReactNode; tint: Tint; onClick?: () => void
}) {
  const t = TINTS[tint]
  return (
    <div onClick={onClick} className={`surface relative overflow-hidden p-4 pl-5 ${onClick ? "surface-hover cursor-pointer" : ""}`}>
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: t.strip }} />
      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${t.bg} ${t.text}`}>{icon}</div>
        {onClick && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <p className="font-display text-3xl font-black tracking-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[11px] text-muted-foreground/60">{sub}</p>
    </div>
  )
}

export default function AgencyPortalDashboardPage() {
  const { user } = useAuth()
  const agencyId = useAgencyId()
  const navigate = useNavigate()

  const [staff, setStaff] = useState<AgencyStaffRecord[]>([])
  const [deployments, setDeployments] = useState<AgencyDeploymentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agencyId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.get<{ ok: boolean; staff: AgencyStaffRecord[] }>(`/api/agencies/${agencyId}/staff`).catch(() => ({ ok: false, staff: [] })),
      api.get<{ ok: boolean; deployments: AgencyDeploymentRow[] }>(`/api/agencies/${agencyId}/deployments`).catch(() => ({ ok: false, deployments: [] })),
    ]).then(([staffRes, deployRes]) => {
      if (cancelled) return
      setStaff(staffRes.staff ?? [])
      setDeployments(deployRes.deployments ?? [])
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agencyId])

  const counts = {
    total: staff.length,
    compliant: staff.filter(s => s.compliance_status === "COMPLIANT").length,
    actionNeeded: staff.filter(s => s.compliance_status === "ACTION_NEEDED").length,
    expired: staff.filter(s => s.compliance_status === "EXPIRED").length,
  }

  // Worst-first: a guard who is EXPIRED needs attention before one that's
  // merely ACTION_NEEDED or INCOMPLETE.
  const severityRank: Record<string, number> = { EXPIRED: 0, ACTION_NEEDED: 1, INCOMPLETE: 2 }
  const needsAttention = staff
    .filter(s => (s.compliance_status ?? "INCOMPLETE") !== "COMPLIANT")
    .sort((a, b) => (severityRank[a.compliance_status ?? "INCOMPLETE"] ?? 3) - (severityRank[b.compliance_status ?? "INCOMPLETE"] ?? 3))
    .slice(0, 8)

  const pendingAcks = deployments
    .filter(d => d.status === "scheduled" && !d.agency_acknowledged)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))

  if (!agencyId) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No agency linked to this account.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{greeting()}, {user?.full_name?.split(" ")[0] ?? "there"}</h2>
        <p className="text-muted-foreground text-sm">Here's what needs your attention today.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading overview...</span>
        </div>
      ) : (
        <>
          <motion.div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" variants={stagger.container} initial="initial" animate="animate">
            <motion.div variants={stagger.item}>
              <StatTile label="Total guards" value={counts.total} sub="registered with this agency"
                icon={<Users className="h-5 w-5" />} tint="blue" onClick={() => navigate("/agency/staff")} />
            </motion.div>
            <motion.div variants={stagger.item}>
              <StatTile label="Compliant" value={counts.compliant} sub="fully documented"
                icon={<ShieldCheck className="h-5 w-5" />} tint="green" onClick={() => navigate("/agency/staff?filter=COMPLIANT")} />
            </motion.div>
            <motion.div variants={stagger.item}>
              <StatTile label="Action needed" value={counts.actionNeeded} sub="documents expiring soon"
                icon={<AlertTriangle className="h-5 w-5" />} tint="amber" onClick={() => navigate("/agency/staff?filter=ACTION_NEEDED")} />
            </motion.div>
            <motion.div variants={stagger.item}>
              <StatTile label="Expired" value={counts.expired} sub="cannot be deployed"
                icon={<XCircle className="h-5 w-5" />} tint="red" onClick={() => navigate("/agency/staff?filter=EXPIRED")} />
            </motion.div>
          </motion.div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Needs attention ── */}
            <div className="surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-display text-sm font-semibold tracking-wide">Guards needing attention</p>
                <button onClick={() => navigate("/agency/staff")} className="group flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  View all <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>
              </div>
              {needsAttention.length === 0 ? (
                <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Every guard is fully compliant.
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {needsAttention.map(s => (
                    <button key={s.id} onClick={() => navigate(`/agency/staff?edit=${s.id}`)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.job_role === "Other" ? s.custom_role : s.job_role}</p>
                      </div>
                      <ComplianceBadge status={s.compliance_status} />
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Pending deployment acknowledgments ── */}
            <div className="surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-display text-sm font-semibold tracking-wide">Pending acknowledgments</p>
                <button onClick={() => navigate("/agency/deployments")} className="group flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Deployments <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>
              </div>
              {pendingAcks.length === 0 ? (
                <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  Nothing waiting on your sign-off.
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {pendingAcks.map(d => (
                    <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                      <ClipboardCheck className="h-4 w-4 shrink-0 text-warning" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.site?.name ?? "Unassigned site"}</p>
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" />{fmtDate(d.event_date)}</span>
                          {d.site?.address && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" />{d.site.address}</span>}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-warning/15 border border-warning/30 px-2 py-0.5 text-[10px] font-medium text-warning">
                        {Number(d.guard_count ?? 0)} guard{Number(d.guard_count ?? 0) === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
