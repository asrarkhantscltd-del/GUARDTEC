import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
  Truck, Users, AlertTriangle, CheckCircle2,
  Search, Plus, Car, UserCheck,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

// ── Types ──────────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string
  registration: string
  make: string
  model: string
  year: number
  colour: string
  type: string
  status: "active" | "off_road" | "maintenance" | "sold"
  assignedDriverId?: string
  mot_expiry?: string
  insurance_expiry?: string
  road_tax_expiry?: string
  service_due?: string
  mileage?: number
  fuelType?: string
  notes?: string
}

interface StaffMember {
  id: string
  first_name: string
  last_name: string
  role?: string
  drivingLicence?: {
    licenceNumber?: string
    expiry?: string
    categories?: string[]
    cpcCard?: string
    cpcExpiry?: string
    tachoCard?: string
    tachoExpiry?: string
    medicalExpiry?: string
    dbsDate?: string
    lastAssessment?: string
    status?: string
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return Math.floor((d.getTime() - Date.now()) / 86400000)
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function ComplianceChip({ label, dateStr }: { label: string; dateStr?: string }) {
  const days = daysUntil(dateStr)
  if (days === null)
    return <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] bg-muted text-muted-foreground">No {label}</span>
  if (days < 0)
    return <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">EXPIRED</span>
  if (days <= 30)
    return <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">{days}d left</span>
  if (days <= 60)
    return <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">{days}d left</span>
  return <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">{formatDate(dateStr)}</span>
}

function worstDays(dates: (string | undefined)[]): number | null {
  return dates.reduce<number | null>((min, d) => {
    const days = daysUntil(d)
    if (days === null) return min
    return min === null ? days : Math.min(min, days)
  }, null)
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  patrol_car: "Patrol Car",
  response_van: "Response Van",
  supervisor_car: "Supervisor Car",
  support_van: "Support Van",
  minibus: "Minibus",
}

const VEHICLE_STATUS_STYLE: Record<string, string> = {
  active:      "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  off_road:    "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  maintenance: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  sold:        "bg-muted text-muted-foreground",
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FleetPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab") as "vehicles" | "drivers" | null
  const [activeTab, setActiveTab] = useState<"vehicles" | "drivers">(tabParam ?? "vehicles")

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")

  function switchTab(tab: "vehicles" | "drivers") {
    setActiveTab(tab)
    setSearch("")
    setSearchParams({ tab })
  }

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) setActiveTab(tabParam)
  }, [tabParam])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [vRes, sRes] = await Promise.all([
          fetch("/api/vehicles"),
          fetch("/api/staff"),
        ])
        if (cancelled) return
        if (vRes.ok) {
          const data = await vRes.json()
          setVehicles(Array.isArray(data) ? data : (data.vehicles ?? []))
        }
        if (sRes.ok) {
          const data = await sRes.json()
          setStaff(Array.isArray(data) ? data : (data.staff ?? []))
        }
        if (!vRes.ok && !sRes.ok) setApiError(true)
      } catch {
        if (!cancelled) setApiError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = vehicles.length
    const active = vehicles.filter(v => v.status === "active").length
    const complianceAlerts = vehicles.filter(v => {
      const d = worstDays([v.mot_expiry, v.insurance_expiry, v.road_tax_expiry])
      return d !== null && d <= 30
    }).length
    const activeDrivers = staff.filter(s => s.drivingLicence).length
    return { total, active, complianceAlerts, activeDrivers }
  }, [vehicles, staff])

  // ── Filtered vehicles ─────────────────────────────────────────────────────────

  const filteredVehicles = useMemo(() => {
    const q = search.toLowerCase()
    return vehicles.filter(v => {
      if (q && ![v.registration, v.make, v.model, v.colour, VEHICLE_TYPE_LABELS[v.type] ?? v.type]
        .some(s => s?.toLowerCase().includes(q))) return false
      if (statusFilter !== "all" && v.status !== statusFilter) return false
      if (typeFilter !== "all" && v.type !== typeFilter) return false
      return true
    })
  }, [vehicles, search, statusFilter, typeFilter])

  // ── Filtered drivers ──────────────────────────────────────────────────────────

  const filteredDrivers = useMemo(() => {
    const q = search.toLowerCase()
    return staff.filter(s => {
      if (!q) return true
      return `${s.first_name ?? ""} ${s.last_name ?? ""}`.toLowerCase().includes(q) ||
        (s.drivingLicence?.licenceNumber ?? "").toLowerCase().includes(q)
    })
  }, [staff, search])

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Truck className="mx-auto mb-3 h-10 w-10 animate-pulse opacity-30" />
        <p className="text-sm">Loading fleet data…</p>
      </div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Fleet Management</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Vehicle compliance, driver records &amp; transport operations
          </p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5">
          <Plus className="h-4 w-4" />Add Vehicle
        </Button>
      </div>

      {apiError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Backend not reachable — Docker container may not be running. Showing empty state.
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Truck className="h-5 w-5" />}
          label="Total Vehicles" value={stats.total}
          colorClass="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Active Vehicles" value={stats.active}
          colorClass="bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Compliance Alerts" value={stats.complianceAlerts}
          colorClass={stats.complianceAlerts > 0
            ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
            : "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400"}
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Fleet Drivers" value={stats.activeDrivers}
          colorClass="bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400"
        />
      </div>

      {/* Tab bar */}
      <div className="flex w-fit gap-0 rounded-lg border bg-muted/40 p-1">
        {(["vehicles", "drivers"] as const).map(tab => (
          <button key={tab} onClick={() => switchTab(tab)}
            className={`flex items-center gap-1.5 rounded-md px-5 py-1.5 text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}>
            {tab === "vehicles"
              ? <><Car className="h-3.5 w-3.5" />Vehicles ({vehicles.length})</>
              : <><UserCheck className="h-3.5 w-3.5" />Drivers ({staff.length})</>
            }
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={activeTab === "vehicles"
              ? "Search reg, make, model, colour…"
              : "Search by name or licence number…"}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {activeTab === "vehicles" && (
          <>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="off_road">Off Road</option>
              <option value="maintenance">Maintenance</option>
              <option value="sold">Sold</option>
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="all">All Types</option>
              <option value="patrol_car">Patrol Car</option>
              <option value="response_van">Response Van</option>
              <option value="supervisor_car">Supervisor Car</option>
              <option value="support_van">Support Van</option>
              <option value="minibus">Minibus</option>
            </select>
          </>
        )}
      </div>

      {/* ── Vehicles tab ── */}
      {activeTab === "vehicles" && (
        filteredVehicles.length === 0
          ? <EmptyState icon={<Truck className="h-12 w-12" />}
              title={vehicles.length === 0 ? "No vehicles on record" : "No vehicles match your filters"}
              description={vehicles.length === 0
                ? "Add your first company vehicle to start tracking MOT, insurance, and road tax compliance."
                : "Try adjusting your search or filter criteria."} />
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredVehicles.map(v =>
                <VehicleCard key={v.id} v={v} staff={staff} />
              )}
            </div>
      )}

      {/* ── Drivers tab ── */}
      {activeTab === "drivers" && (
        filteredDrivers.length === 0
          ? <EmptyState icon={<Users className="h-12 w-12" />}
              title="No drivers found"
              description="No staff members match your search." />
          : <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Driver</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Licence No.</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Categories</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Lic. Expiry</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">CPC Card</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Tachograph</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Medical Cert</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">DBS Date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Vehicle</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.map(s => (
                    <DriverRow key={s.id} s={s} vehicles={vehicles} />
                  ))}
                </tbody>
              </table>
            </div>
      )}
    </div>
  )
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────

function VehicleCard({ v, staff }: { v: Vehicle; staff: StaffMember[] }) {
  const driver = v.assignedDriverId ? staff.find(s => s.id === v.assignedDriverId) : null
  const worst = worstDays([v.mot_expiry, v.insurance_expiry, v.road_tax_expiry])

  const borderClass =
    worst !== null && worst < 0   ? "border-red-400 dark:border-red-700" :
    worst !== null && worst <= 30 ? "border-amber-400 dark:border-amber-700" :
    "border-border"

  return (
    <div className={`rounded-xl border-2 ${borderClass} bg-card p-4 shadow-sm transition-all hover:shadow-md`}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="font-bold tracking-widest" style={{ fontSize: "1.1rem", letterSpacing: "0.12em" }}>
            {v.registration || "—"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {[v.year, v.make, v.model, v.colour].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${VEHICLE_STATUS_STYLE[v.status] ?? VEHICLE_STATUS_STYLE.active}`}>
            {v.status.replace("_", " ")}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {VEHICLE_TYPE_LABELS[v.type] ?? v.type}
          </span>
        </div>
      </div>

      {/* Compliance grid */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <ComplianceCell label="MOT" dateStr={v.mot_expiry} />
        <ComplianceCell label="Insurance" dateStr={v.insurance_expiry} />
        <ComplianceCell label="Road Tax" dateStr={v.road_tax_expiry} />
        <ComplianceCell label="Service Due" dateStr={v.service_due} />
      </div>

      {/* Driver row */}
      <div className="flex items-center gap-2 border-t pt-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
          {driver
            ? `${driver.first_name[0]}${driver.last_name[0]}`
            : <Car className="h-3.5 w-3.5 opacity-50" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">
            {driver ? `${driver.first_name} ${driver.last_name}` : "Unassigned"}
          </div>
          <div className="text-[10px] text-muted-foreground">Assigned Driver</div>
        </div>
        {v.mileage != null && (
          <div className="text-right">
            <div className="text-xs font-semibold">{v.mileage.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">miles</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ComplianceCell({ label, dateStr }: { label: string; dateStr?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <ComplianceChip label={label} dateStr={dateStr} />
    </div>
  )
}

// ── Driver Row ────────────────────────────────────────────────────────────────

function DriverRow({ s, vehicles }: { s: StaffMember; vehicles: Vehicle[] }) {
  const dl = s.drivingLicence
  const assignedVehicle = vehicles.find(v => v.assignedDriverId === s.id)

  const worst = dl
    ? worstDays([dl.expiry, dl.cpcExpiry, dl.tachoExpiry, dl.medicalExpiry])
    : null

  const rowBg =
    worst !== null && worst < 0   ? "bg-red-50/60 dark:bg-red-950/10" :
    worst !== null && worst <= 30 ? "bg-amber-50/60 dark:bg-amber-950/10" :
    ""

  const driverStatus = dl?.status ?? (dl ? "active" : "no_licence")
  const statusStyle =
    driverStatus === "active"    ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" :
    driverStatus === "suspended" ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" :
    "bg-muted text-muted-foreground"

  return (
    <tr className={`border-b transition-colors hover:bg-muted/30 ${rowBg}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {s.first_name[0]}{s.last_name[0]}
          </div>
          <div>
            <div className="font-medium">{s.first_name} {s.last_name}</div>
            <div className="text-xs text-muted-foreground">{s.role ?? "Security Officer"}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs">
          {dl?.licenceNumber ?? <span className="text-muted-foreground">Not on file</span>}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {dl?.categories?.length
            ? dl.categories.map(c => (
                <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold">{c}</span>
              ))
            : <span className="text-xs text-muted-foreground">—</span>
          }
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <ComplianceChip label="expiry" dateStr={dl?.expiry} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-[11px] font-mono text-muted-foreground mb-0.5">{dl?.cpcCard ?? "—"}</div>
        <ComplianceChip label="CPC" dateStr={dl?.cpcExpiry} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-[11px] font-mono text-muted-foreground mb-0.5">{dl?.tachoCard ?? "—"}</div>
        <ComplianceChip label="Tacho" dateStr={dl?.tachoExpiry} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <ComplianceChip label="Medical" dateStr={dl?.medicalExpiry} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-xs">{formatDate(dl?.dbsDate)}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {assignedVehicle
          ? <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-bold">{assignedVehicle.registration}</span>
          : <span className="text-xs text-muted-foreground">Unassigned</span>
        }
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyle}`}>
          {driverStatus.replace("_", " ")}
        </span>
      </td>
    </tr>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function StatCard({ icon, label, value, colorClass }: {
  icon: React.ReactNode; label: string; value: number; colorClass: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>
        {icon}
      </div>
      <div className="mt-3 text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function EmptyState({ icon, title, description }: {
  icon: React.ReactNode; title: string; description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 text-center">
      <div className="mb-4 text-muted-foreground/25">{icon}</div>
      <h3 className="font-semibold text-muted-foreground">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground/70">{description}</p>
    </div>
  )
}
