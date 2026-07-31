import { useAuth } from "@/contexts/AuthContext"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Users, ShieldCheck, AlertTriangle, Truck, XCircle, MapPin, UserCheck } from "lucide-react"

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Welcome back, {user?.full_name?.split(" ")[0]}
        </h2>
        <p className="text-muted-foreground text-sm">
          Here's your operations overview for today.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total staff"
          value={stats?.totalStaff ?? "--"}
          sub="across all sites"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Active sites"
          value={stats?.activeSites ?? "--"}
          sub="currently running"
          icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
          onClick={() => navigate("/sites")}
          clickable
        />
        <StatCard
          label="Vehicles"
          value={stats?.vehicles ?? "--"}
          sub="in fleet"
          icon={<Truck className="h-4 w-4 text-muted-foreground" />}
          onClick={() => navigate("/fleet?tab=vehicles")}
          clickable
        />
        <StatCard
          label="Drivers"
          value={stats?.drivers ?? "--"}
          sub="registered"
          icon={<UserCheck className="h-4 w-4 text-muted-foreground" />}
          onClick={() => navigate("/fleet?tab=drivers")}
          clickable
        />
        <StatCard
          label="Compliant"
          value={stats?.compliant ?? "--"}
          sub="all docs valid"
          icon={<ShieldCheck className="h-4 w-4 text-success" />}
          valueClass="text-success"
        />
        {stats && stats.expired > 0 ? (
          <StatCard
            label="Expired"
            value={stats.expired}
            sub="immediate action"
            icon={<XCircle className="h-4 w-4 text-destructive" />}
            valueClass="text-destructive"
            highlight
          />
        ) : (
          <StatCard
            label="Expiring soon"
            value={stats?.expiringSoon ?? "--"}
            sub="within 90 days"
            icon={<AlertTriangle className="h-4 w-4 text-warning" />}
            valueClass={stats && stats.expiringSoon > 0 ? "text-warning" : undefined}
          />
        )}
      </div>

      {/* Sites overview */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Active sites — operations</h3>
          <button
            onClick={() => navigate("/sites")}
            className="text-xs text-primary hover:underline"
          >
            Manage sites →
          </button>
        </div>

        {sites.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
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
                className="cursor-pointer rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
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

interface StatCardProps {
  label: string
  value: number | string
  sub: string
  icon: React.ReactNode
  valueClass?: string
  highlight?: boolean
  clickable?: boolean
  onClick?: () => void
}

function StatCard({ label, value, sub, icon, valueClass, highlight, clickable, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-4 ${
        highlight ? "border-destructive/40 bg-destructive/5" : "bg-card"
      } ${clickable ? "cursor-pointer transition-colors hover:bg-muted/40" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}
