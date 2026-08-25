import { useState, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { makeStagger } from "@/lib/motion"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  Truck, AlertTriangle, CheckCircle2, Search, Plus, ArrowUpRight,
  Car, Trash2, X, Save, Loader2, Camera, ImageOff,
  FileText, Download, Upload, Pencil, MapPin, CircleParking, KeyRound, Route,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { downloadExport, daysUntil, formatDate } from "@/lib/utils"
import { api } from "@/lib/api"
import { parseRoles } from "@/components/ui/role-picker"

// ── Types ──────────────────────────────────────────────────────────────────────

// A driver is just a staff member carrying the "Driver" role (see the
// driver/staff unification) — there is no separate fleet-drivers collection
// anymore. This is the shape FleetPage needs for the vehicle-assignment
// picker and for resolving an assignedDriverId back to a display name.
interface StaffOption { id: string; name: string; phone?: string; jobRole?: string; driverAssignment?: { status?: string } }

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
  has_photo?: boolean
  current_route?: string
  parking_location?: string
  key_location?: string
}

const BLANK_VEHICLE: Omit<Vehicle, "id"> = {
  registration: "", make: "", model: "", year: new Date().getFullYear(),
  colour: "", type: "patrol_car", status: "active", assignedDriverId: "",
  mot_expiry: "", insurance_expiry: "", road_tax_expiry: "", service_due: "",
  mileage: undefined,
  current_route: "", parking_location: "", key_location: "",
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ComplianceChip({ label, dateStr }: { label: string; dateStr?: string }) {
  const days = daysUntil(dateStr)
  if (days === null)
    return <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] bg-muted text-muted-foreground">No {label}</span>
  if (days < 0)
    return <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">EXPIRED</span>
  if (days <= 30)
    return <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">{days}d left</span>
  if (days <= 60)
    return <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">{days}d left</span>
  return <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">{formatDate(dateStr)}</span>
}

function worstDays(dates: (string | undefined)[]): number | null {
  return dates.reduce<number | null>((min, d) => {
    const days = daysUntil(d)
    if (days === null) return min
    return min === null ? days : Math.min(min, days)
  }, null)
}

interface VehicleDoc {
  filename: string
  originalName: string
  docType: string
  size: number
  uploadedAt: string
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  patrol_car: "Patrol Car", response_van: "Response Van",
  supervisor_car: "Supervisor Car", support_van: "Support Van", minibus: "Minibus",
  personal_use: "Personal Use",
  official_use: "Official Use",
}

const DOC_TYPE_LABELS: Record<string, string> = {
  mot:        "MOT Certificate",
  road_tax:   "Road Tax",
  insurance:  "Insurance Certificate",
  workshop:   "Workshop Receipt",
  mechanic:   "Mechanic Invoice",
  inspection: "Vehicle Inspection",
  other:      "Other Document",
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

const VEHICLE_STATUS_STYLE: Record<string, string> = {
  active:      "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  off_road:    "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  maintenance: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  sold:        "bg-muted text-muted-foreground",
}

// ── Main component ─────────────────────────────────────────────────────────────

const fleetStagger = makeStagger(0.07, 0.4)

export default function FleetPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab") as "vehicles" | "operations" | null
  const activeTab: "vehicles" | "operations" = tabParam ?? "vehicles"

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [alertsOnly, setAlertsOnly] = useState(false)

  // Row selection for Excel export
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set())

  // Staff — used to resolve/pick a vehicle's assigned driver (anyone
  // carrying the "Driver" role, see the driver/staff unification)
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])

  // Add/Edit/Delete state — vehicles
  const [showVehiclePanel, setShowVehiclePanel] = useState(false)
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null)
  const [editVehicle, setEditVehicle] = useState<Omit<Vehicle, "id">>(BLANK_VEHICLE)
  const [vehiclePhoto, setVehiclePhoto] = useState<File | null>(null)
  const [vehiclePhotoPreview, setVehiclePhotoPreview] = useState<string | null>(null)
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [deleteVehicleId, setDeleteVehicleId] = useState<string | null>(null)
  const [deletingVehicle, setDeletingVehicle] = useState(false)

  // Docs panel state
  const [docsVehicleId, setDocsVehicleId] = useState<string | null>(null)
  const [docs, setDocs] = useState<VehicleDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploadDocFile, setUploadDocFile] = useState<File | null>(null)
  const [uploadDocType, setUploadDocType] = useState("mot")
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [docError, setDocError] = useState("")

  // Operations tab state
  const [opsEditing, setOpsEditing] = useState<Record<string, { current_route: string; parking_location: string; key_location: string }>>({})
  const [opsSaving, setOpsSaving] = useState<Set<string>>(new Set())

  function switchTab(tab: "vehicles" | "operations") {
    setSearch(""); setSearchParams({ tab })
  }

  function goToAllVehicles() {
    switchTab("vehicles"); setStatusFilter("all"); setAlertsOnly(false)
  }
  function goToActiveVehicles() {
    switchTab("vehicles"); setStatusFilter("active"); setAlertsOnly(false)
  }
  function goToAlertVehicles() {
    switchTab("vehicles"); setStatusFilter("all"); setAlertsOnly(true)
  }

  function toggleSelected(id: string, setFn: React.Dispatch<React.SetStateAction<Set<string>>>) {
    setFn(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll(ids: string[], selected: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>) {
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id))
    setFn(prev => {
      const next = new Set(prev)
      if (allSelected) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  function exportFleetReport() {
    const ids = selectedVehicleIds.size > 0 ? [...selectedVehicleIds] : filteredVehicles.map(v => v.id)
    downloadExport(`/api/vehicles/export?ids=${ids.join(",")}`, "GuardTec-Fleet-Report.xlsx")
      .catch(() => toast.error("Failed to generate report"))
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [vRes, sRes] = await Promise.allSettled([
          api.get<Vehicle[] | { vehicles?: Vehicle[] }>("/api/vehicles"),
          api.get<StaffOption[]>("/api/staff"),
        ])
        if (cancelled) return
        if (vRes.status === "fulfilled") {
          const data = vRes.value
          setVehicles(Array.isArray(data) ? data : (data.vehicles ?? []))
        }
        if (sRes.status === "fulfilled") {
          setStaffOptions(Array.isArray(sRes.value) ? sRes.value : [])
        }
        if (vRes.status === "rejected" && sRes.status === "rejected") setApiError(true)
      } catch {
        if (!cancelled) setApiError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Staff eligible to be assigned as a driver — carries the "Driver" role
  // and isn't suspended from driving duties.
  const driverStaff = useMemo(() => (
    staffOptions.filter(s => parseRoles(s.jobRole).includes("Driver") && s.driverAssignment?.status !== "suspended")
  ), [staffOptions])

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = vehicles.length
    const active = vehicles.filter(v => v.status === "active").length
    const alerts = vehicles.filter(v => {
      const d = worstDays([v.mot_expiry, v.insurance_expiry, v.road_tax_expiry])
      return d !== null && d <= 30
    }).length
    return { total, active, alerts }
  }, [vehicles])

  // ── Filtered lists ────────────────────────────────────────────────────────────

  const filteredVehicles = useMemo(() => {
    const q = search.toLowerCase()
    return vehicles.filter(v => {
      if (q && ![v.registration, v.make, v.model, v.colour, VEHICLE_TYPE_LABELS[v.type] ?? v.type]
        .some(s => s?.toLowerCase().includes(q))) return false
      if (statusFilter !== "all" && v.status !== statusFilter) return false
      if (typeFilter !== "all" && v.type !== typeFilter) return false
      if (alertsOnly) {
        const d = worstDays([v.mot_expiry, v.insurance_expiry, v.road_tax_expiry])
        if (d === null || d > 30) return false
      }
      return true
    })
  }, [vehicles, search, statusFilter, typeFilter, alertsOnly])

  // ── Add vehicle ───────────────────────────────────────────────────────────────

  function openAddVehicle() {
    setEditingVehicleId(null)
    setEditVehicle(BLANK_VEHICLE)
    setVehiclePhoto(null)
    setVehiclePhotoPreview(null)
    setShowVehiclePanel(true)
  }

  function openEditVehicle(v: Vehicle) {
    setEditingVehicleId(v.id)
    setEditVehicle({
      registration: v.registration, make: v.make, model: v.model,
      year: v.year, colour: v.colour, type: v.type, status: v.status,
      assignedDriverId: v.assignedDriverId ?? "",
      mot_expiry: v.mot_expiry ?? "", insurance_expiry: v.insurance_expiry ?? "",
      road_tax_expiry: v.road_tax_expiry ?? "", service_due: v.service_due ?? "",
      mileage: v.mileage,
      current_route: v.current_route ?? "", parking_location: v.parking_location ?? "",
      key_location: v.key_location ?? "",
    })
    setVehiclePhoto(null)
    if (vehiclePhotoPreview) URL.revokeObjectURL(vehiclePhotoPreview)
    setVehiclePhotoPreview(v.has_photo ? `/api/vehicles/${v.id}/photo` : null)
    setShowVehiclePanel(true)
  }

  function closeVehiclePanel() {
    setShowVehiclePanel(false)
    setEditingVehicleId(null)
    if (vehiclePhoto && vehiclePhotoPreview) URL.revokeObjectURL(vehiclePhotoPreview)
    setVehiclePhoto(null)
    setVehiclePhotoPreview(null)
  }

  function pickVehiclePhoto(file: File | null) {
    if (vehiclePhoto && vehiclePhotoPreview) URL.revokeObjectURL(vehiclePhotoPreview)
    setVehiclePhoto(file)
    setVehiclePhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  async function handleSaveVehicle(e: React.FormEvent) {
    e.preventDefault()
    setSavingVehicle(true)
    try {
      if (editingVehicleId) {
        // ── Edit mode ──
        const { vehicle } = await api.patch<{ vehicle: Vehicle }>(`/api/vehicles/${editingVehicleId}`, editVehicle)

        if (vehiclePhoto) {
          await api.post(`/api/vehicles/${editingVehicleId}/photo`, vehiclePhoto)
          vehicle.has_photo = true
        }

        setVehicles(prev => prev.map(v => v.id === editingVehicleId ? vehicle : v))
        closeVehiclePanel()
        toast.success("Vehicle updated")
      } else {
        // ── Add mode ──
        const { vehicle } = await api.post<{ vehicle: Vehicle }>("/api/vehicles", editVehicle)

        if (vehiclePhoto) {
          await api.post(`/api/vehicles/${vehicle.id}/photo`, vehiclePhoto)
          vehicle.has_photo = true
        }

        setVehicles(prev => [...prev, vehicle])
        closeVehiclePanel()
        toast.success("Vehicle added successfully")
      }
    } catch {
      toast.error(editingVehicleId ? "Failed to update vehicle" : "Failed to add vehicle")
    } finally {
      setSavingVehicle(false)
    }
  }

  // ── Delete vehicle ────────────────────────────────────────────────────────────

  async function confirmDeleteVehicle() {
    if (!deleteVehicleId) return
    setDeletingVehicle(true)
    try {
      await api.delete(`/api/vehicles/${deleteVehicleId}`)
      setVehicles(prev => prev.filter(v => v.id !== deleteVehicleId))
      setDeleteVehicleId(null)
      toast.success("Vehicle removed")
    } catch {
      toast.error("Failed to remove vehicle")
    } finally {
      setDeletingVehicle(false)
    }
  }

  // ── Vehicle Documents ─────────────────────────────────────────────────────────

  async function openDocsPanel(vehicleId: string) {
    setDocsVehicleId(vehicleId)
    setDocError("")
    setUploadDocFile(null)
    setUploadDocType("mot")
    setDocs([])
    setDocsLoading(true)
    try {
      setDocs(await api.get<VehicleDoc[]>(`/api/vehicles/${vehicleId}/docs`))
    } catch {
    } finally {
      setDocsLoading(false)
    }
  }

  function closeDocsPanel() {
    setDocsVehicleId(null)
    setDocs([])
    setUploadDocFile(null)
    setDocError("")
  }

  async function handleUploadDoc() {
    if (!uploadDocFile || !docsVehicleId) return
    setUploadingDoc(true)
    setDocError("")
    try {
      const res = await fetch(`/api/vehicles/${docsVehicleId}/docs`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": uploadDocFile.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(uploadDocFile.name),
          "X-Doc-Type": uploadDocType,
        },
        body: uploadDocFile,
      })
      const d = await res.json()
      if (!d.ok) { setDocError(d.error ?? "Upload failed."); return }
      setDocs(prev => [...prev, d.doc])
      setUploadDocFile(null)
      toast.success("Document uploaded")
    } catch {
      setDocError("Network error — please try again.")
    } finally {
      setUploadingDoc(false)
    }
  }

  async function handleDeleteDoc(filename: string) {
    if (!docsVehicleId) return
    try {
      const data = await api.delete<{ ok: boolean }>(`/api/vehicles/${docsVehicleId}/docs/${filename}`)
      if (data.ok) {
        setDocs(prev => prev.filter(d => d.filename !== filename))
      }
    } catch {
      toast.error("Failed to delete document")
    }
  }

  // ── Operations helpers ────────────────────────────────────────────────────────

  function startOpsEdit(v: Vehicle) {
    setOpsEditing(prev => ({
      ...prev,
      [v.id]: {
        current_route: v.current_route ?? "",
        parking_location: v.parking_location ?? "",
        key_location: v.key_location ?? "",
      },
    }))
  }

  function cancelOpsEdit(id: string) {
    setOpsEditing(prev => { const next = { ...prev }; delete next[id]; return next })
  }

  async function saveOps(id: string) {
    const draft = opsEditing[id]
    if (!draft) return
    setOpsSaving(prev => new Set(prev).add(id))
    try {
      const { vehicle } = await api.patch<{ vehicle: Vehicle }>(`/api/vehicles/${id}`, draft)
      setVehicles(prev => prev.map(v => v.id === id ? vehicle : v))
      cancelOpsEdit(id)
      toast.success("Operations updated")
    } catch {
      toast.error("Failed to update")
    } finally {
      setOpsSaving(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Truck className="mx-auto mb-3 h-10 w-10 animate-pulse opacity-30" />
        <p className="text-sm">Loading fleet data…</p>
      </div>
    </div>
  )

  const docsVehicle = vehicles.find(v => v.id === docsVehicleId)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Fleet Management</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Vehicle compliance, driver records &amp; transport operations</p>
        </div>
        {activeTab === "vehicles" && (
          <Button size="sm" className="gap-1.5 shrink-0" onClick={openAddVehicle}>
            <Plus className="h-4 w-4" />Add Vehicle
          </Button>
        )}
      </div>

      {apiError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Backend not reachable — Docker container may not be running.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={<Truck className="h-5 w-5" />} label="Total Vehicles" value={stats.total}
          colorClass="bg-blue-500/10 text-blue-500" strip="#3b82f6" onClick={goToAllVehicles} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Active Vehicles" value={stats.active}
          colorClass="bg-success/10 text-success" strip="#22c55e" onClick={goToActiveVehicles} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Compliance Alerts" value={stats.alerts}
          colorClass={stats.alerts > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}
          strip={stats.alerts > 0 ? "#ef4444" : "#22c55e"} onClick={goToAlertVehicles} />
      </div>

      {/* Tabs */}
      <div className="flex w-fit gap-0 rounded-lg border bg-muted/40 p-1">
        {(["vehicles", "operations"] as const).map(tab => (
          <button key={tab} onClick={() => switchTab(tab)}
            className={`flex items-center gap-1.5 rounded-md px-5 py-1.5 text-sm font-medium transition-all ${
              activeTab === tab ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {tab === "vehicles" && <><Car className="h-3.5 w-3.5" />Vehicles ({vehicles.length})</>}
            {tab === "operations" && <><Route className="h-3.5 w-3.5" />Operations</>}
          </button>
        ))}
      </div>

      {alertsOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Showing only vehicles needing attention (MOT/insurance/tax due within 30 days)
          <button onClick={() => setAlertsOnly(false)} className="ml-auto text-xs underline hover:no-underline">Clear</button>
        </div>
      )}

      {/* Search + filters (hidden on Operations tab) */}
      {activeTab !== "operations" && <div className="flex flex-wrap gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search reg, make, model…"
            value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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
              <option value="personal_use">Personal Use</option>
              <option value="official_use">Official Use</option>
            </select>
          </>
        )}
        <button onClick={exportFleetReport}
          className="flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Download className="h-4 w-4" />
          {selectedVehicleIds.size > 0 ? `Export Selected (${selectedVehicleIds.size})` : "Export Report"}
        </button>
      </div>}

      {/* Vehicles tab */}
      {activeTab === "vehicles" && (
        filteredVehicles.length === 0
          ? <EmptyState icon={<Truck className="h-12 w-12" />}
              title={vehicles.length === 0 ? "No vehicles on record" : "No vehicles match your filters"}
              description="Add your first company vehicle to start tracking compliance." />
          : <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <input
                  type="checkbox"
                  checked={filteredVehicles.length > 0 && filteredVehicles.every(v => selectedVehicleIds.has(v.id))}
                  onChange={() => toggleSelectAll(filteredVehicles.map(v => v.id), selectedVehicleIds, setSelectedVehicleIds)}
                  className="h-4 w-4 rounded border-border"
                />
                <span className="text-xs text-muted-foreground">Select all</span>
              </div>
              <motion.div
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                variants={fleetStagger.container}
                initial="initial"
                animate="animate"
              >
                {filteredVehicles.map(v => (
                  <motion.div key={v.id} variants={fleetStagger.item}>
                    <VehicleCard v={v} staff={staffOptions}
                      selected={selectedVehicleIds.has(v.id)}
                      onToggleSelect={() => toggleSelected(v.id, setSelectedVehicleIds)}
                      onEdit={() => openEditVehicle(v)}
                      onDelete={() => setDeleteVehicleId(v.id)}
                      onDocs={() => openDocsPanel(v.id)} />
                  </motion.div>
                ))}
              </motion.div>
            </div>
      )}

      {/* Operations tab */}
      {activeTab === "operations" && (
        vehicles.length === 0
          ? <EmptyState icon={<Route className="h-12 w-12" />}
              title="No vehicles on record"
              description="Add vehicles first to track their operations." />
          : <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Track where each vehicle is operating, where it is parked, and where the keys are stored. Click Edit to update.
              </p>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Vehicle</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Operator / Driver</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-blue-500" />Current Route</span>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                        <span className="inline-flex items-center gap-1"><CircleParking className="h-3.5 w-3.5 text-amber-500" />Parked At</span>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                        <span className="inline-flex items-center gap-1"><KeyRound className="h-3.5 w-3.5 text-green-500" />Key Location</span>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map(v => {
                      const driver = v.assignedDriverId ? staffOptions.find(s => s.id === v.assignedDriverId) : null
                      const draft = opsEditing[v.id]
                      const isSaving = opsSaving.has(v.id)

                      return (
                        <tr key={v.id} className={`border-b transition-colors hover:bg-muted/30 ${draft ? "bg-blue-50/40 dark:bg-blue-950/10" : ""}`}>
                          {/* Vehicle */}
                          <td className="px-4 py-3">
                            <div className="font-bold tracking-wider">{v.registration}</div>
                            <div className="text-[11px] text-muted-foreground">{v.make} {v.model}</div>
                            <div className="text-[10px] text-muted-foreground">{VEHICLE_TYPE_LABELS[v.type] ?? v.type}</div>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${VEHICLE_STATUS_STYLE[v.status] ?? VEHICLE_STATUS_STYLE.active}`}>
                              {v.status.replace("_", " ")}
                            </span>
                          </td>

                          {/* Driver */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {driver ? (
                              <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                                  {driver.name?.[0] ?? "?"}
                                </div>
                                <div>
                                  <div className="text-xs font-medium">{driver.name}</div>
                                  {driver.phone && <div className="text-[10px] text-muted-foreground">{driver.phone}</div>}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Unassigned</span>
                            )}
                          </td>

                          {/* Route */}
                          <td className="px-4 py-3">
                            {draft ? (
                              <Input value={draft.current_route} placeholder="e.g. Canary Wharf shuttle"
                                className="h-8 text-xs"
                                onChange={e => setOpsEditing(p => ({ ...p, [v.id]: { ...p[v.id], current_route: e.target.value } }))} />
                            ) : (
                              <span className="text-xs">{v.current_route || <span className="text-muted-foreground">—</span>}</span>
                            )}
                          </td>

                          {/* Parking */}
                          <td className="px-4 py-3">
                            {draft ? (
                              <Input value={draft.parking_location} placeholder="e.g. Bay 3, SE1 depot"
                                className="h-8 text-xs"
                                onChange={e => setOpsEditing(p => ({ ...p, [v.id]: { ...p[v.id], parking_location: e.target.value } }))} />
                            ) : (
                              <span className="text-xs">{v.parking_location || <span className="text-muted-foreground">—</span>}</span>
                            )}
                          </td>

                          {/* Keys */}
                          <td className="px-4 py-3">
                            {draft ? (
                              <Input value={draft.key_location} placeholder="e.g. Key safe #2"
                                className="h-8 text-xs"
                                onChange={e => setOpsEditing(p => ({ ...p, [v.id]: { ...p[v.id], key_location: e.target.value } }))} />
                            ) : (
                              <span className="text-xs">{v.key_location || <span className="text-muted-foreground">—</span>}</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {draft ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={() => saveOps(v.id)} disabled={isSaving}
                                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  Save
                                </button>
                                <button onClick={() => cancelOpsEdit(v.id)}
                                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors">
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => startOpsEdit(v)}
                                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                <Pencil className="h-3 w-3" />Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
      )}

      {/* ── Add Vehicle slide-over panel ── */}
      {showVehiclePanel && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-semibold">{editingVehicleId ? "Edit Vehicle" : "Add Vehicle"}</h2>
            <button onClick={closeVehiclePanel} className="rounded-md p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSaveVehicle} className="flex flex-1 flex-col gap-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-5">

                {/* Photo upload */}
                <Section title="Vehicle Photo">
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/40">
                      {vehiclePhotoPreview
                        ? <img src={vehiclePhotoPreview} alt="Preview" className="h-full w-full object-cover" />
                        : <ImageOff className="h-6 w-6 text-muted-foreground/40" />}
                    </div>
                    <div className="flex-1">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                        <Camera className="h-3.5 w-3.5" />
                        {vehiclePhoto ? "Change photo" : "Upload photo"}
                        <input type="file" accept="image/*" className="hidden"
                          onChange={e => pickVehiclePhoto(e.target.files?.[0] ?? null)} />
                      </label>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">JPG or PNG, optional</p>
                    </div>
                  </div>
                </Section>

                {/* Vehicle details */}
                <Section title="Vehicle Details">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Registration *">
                      <Input required className="font-mono uppercase" value={editVehicle.registration}
                        onChange={e => setEditVehicle(p => ({ ...p, registration: e.target.value.toUpperCase() }))} />
                    </Field>
                    <Field label="Type">
                      <select value={editVehicle.type}
                        onChange={e => setEditVehicle(p => ({ ...p, type: e.target.value }))}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                        {Object.entries(VEHICLE_TYPE_LABELS).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Make">
                      <Input value={editVehicle.make}
                        onChange={e => setEditVehicle(p => ({ ...p, make: e.target.value }))} />
                    </Field>
                    <Field label="Model">
                      <Input value={editVehicle.model}
                        onChange={e => setEditVehicle(p => ({ ...p, model: e.target.value }))} />
                    </Field>
                    <Field label="Year">
                      <Input type="number" value={editVehicle.year}
                        onChange={e => setEditVehicle(p => ({ ...p, year: parseInt(e.target.value) || p.year }))} />
                    </Field>
                    <Field label="Colour">
                      <Input value={editVehicle.colour}
                        onChange={e => setEditVehicle(p => ({ ...p, colour: e.target.value }))} />
                    </Field>
                  </div>
                </Section>

                {/* Compliance dates */}
                <Section title="Compliance Dates">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="MOT Expiry">
                      <Input type="date" value={editVehicle.mot_expiry ?? ""}
                        onChange={e => setEditVehicle(p => ({ ...p, mot_expiry: e.target.value }))} />
                    </Field>
                    <Field label="Insurance Expiry">
                      <Input type="date" value={editVehicle.insurance_expiry ?? ""}
                        onChange={e => setEditVehicle(p => ({ ...p, insurance_expiry: e.target.value }))} />
                    </Field>
                    <Field label="Road Tax Expiry">
                      <Input type="date" value={editVehicle.road_tax_expiry ?? ""}
                        onChange={e => setEditVehicle(p => ({ ...p, road_tax_expiry: e.target.value }))} />
                    </Field>
                    <Field label="Service Due">
                      <Input type="date" value={editVehicle.service_due ?? ""}
                        onChange={e => setEditVehicle(p => ({ ...p, service_due: e.target.value }))} />
                    </Field>
                  </div>
                </Section>

                {/* Assignment */}
                <Section title="Assignment & Status">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Assign Driver">
                      <select value={editVehicle.assignedDriverId ?? ""}
                        onChange={e => setEditVehicle(p => ({ ...p, assignedDriverId: e.target.value }))}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                        <option value="">Unassigned</option>
                        {driverStaff.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      {driverStaff.length === 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          No staff currently hold the "Driver" role — assign it from Add/Edit Staff first.
                        </p>
                      )}
                    </Field>
                    <Field label="Status">
                      <select value={editVehicle.status}
                        onChange={e => setEditVehicle(p => ({ ...p, status: e.target.value as Vehicle["status"] }))}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                        <option value="active">Active</option>
                        <option value="off_road">Off Road</option>
                        <option value="maintenance">Maintenance</option>
                        <option value="sold">Sold</option>
                      </select>
                    </Field>
                    <Field label="Mileage">
                      <Input type="number" value={editVehicle.mileage ?? ""}
                        onChange={e => setEditVehicle(p => ({ ...p, mileage: e.target.value ? parseInt(e.target.value) : undefined }))} />
                    </Field>
                  </div>
                </Section>

              </div>

            {/* Footer */}
            <div className="sticky bottom-0 mx-auto flex w-full max-w-2xl gap-3 border-t bg-background px-6 py-4">
              <Button type="submit" disabled={savingVehicle} className="flex-1 gap-2">
                {savingVehicle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {savingVehicle ? "Saving…" : editingVehicleId ? "Update Vehicle" : "Save Vehicle"}
              </Button>
              <Button type="button" variant="outline" onClick={closeVehiclePanel}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Vehicle Documents slide-over panel ── */}
      {docsVehicleId && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">Vehicle Documents</h2>
              <p className="text-xs text-muted-foreground">
                {docsVehicle?.registration ?? ""}
                {" · "}
                {docsVehicle?.make ?? ""}
                {" "}
                {docsVehicle?.model ?? ""}
              </p>
            </div>
            <button onClick={closeDocsPanel} className="rounded-md p-1.5 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto space-y-6 px-6 py-5">

              {/* Upload section */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upload Document</h3>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Document Type</label>
                    <select value={uploadDocType} onChange={e => setUploadDocType(e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                      {Object.entries(DOC_TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">File</label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed bg-muted/20 px-4 py-3 text-sm transition-colors hover:bg-muted/40">
                      <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {uploadDocFile ? uploadDocFile.name : "Click to choose a file…"}
                      </span>
                      <input type="file" className="hidden"
                        onChange={e => { setUploadDocFile(e.target.files?.[0] ?? null); setDocError("") }} />
                    </label>
                  </div>
                  {docError && <p className="text-xs text-destructive">{docError}</p>}
                  <Button onClick={handleUploadDoc} disabled={!uploadDocFile || uploadingDoc} className="w-full gap-2">
                    {uploadingDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploadingDoc ? "Uploading…" : "Upload Document"}
                  </Button>
                </div>
              </div>

              {/* Stored docs list */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Stored Documents {!docsLoading && `(${docs.length})`}
                </h3>
                {docsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : docs.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed py-10 text-center">
                    <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/25" />
                    <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">MOT, road tax, workshop receipts — upload above.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {docs.map(doc => (
                      <div key={doc.filename} className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{doc.originalName}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
                            {" · "}{formatBytes(doc.size)}
                            {" · "}{new Date(doc.uploadedAt).toLocaleDateString("en-GB")}
                          </div>
                        </div>
                        <a href={`/api/vehicles/${docsVehicleId}/docs/${doc.filename}`}
                          download={doc.originalName}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Download">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        <button onClick={() => handleDeleteDoc(doc.filename)}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                          title="Delete document">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </div>
        </div>
      )}

      {/* ── Delete vehicle confirm dialog ── */}
      {deleteVehicleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-2xl">
            <h3 className="text-base font-semibold">Remove vehicle?</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This vehicle will be permanently removed from the fleet register, including its photo. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="destructive" disabled={deletingVehicle} className="flex-1 gap-2" onClick={confirmDeleteVehicle}>
                {deletingVehicle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deletingVehicle ? "Removing…" : "Yes, Remove"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setDeleteVehicleId(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────

function VehicleCard({ v, staff, selected, onToggleSelect, onEdit, onDelete, onDocs }: {
  v: Vehicle; staff: StaffOption[]; selected: boolean; onToggleSelect: () => void
  onEdit: () => void; onDelete: () => void; onDocs: () => void
}) {
  const driver = v.assignedDriverId ? staff.find(s => s.id === v.assignedDriverId) : null
  const worst = worstDays([v.mot_expiry, v.insurance_expiry, v.road_tax_expiry])
  const borderClass =
    worst !== null && worst < 0   ? "border-red-400 dark:border-red-700" :
    worst !== null && worst <= 30 ? "border-amber-400 dark:border-amber-700" : "border-border"

  return (
    <div className={`surface surface-hover overflow-hidden border-2 ${borderClass}`}>
      {/* Photo */}
      <div className="relative h-32 w-full bg-muted/50">
        {v.has_photo ? (
          <img src={`/api/vehicles/${v.id}/photo`} alt={v.registration}
            className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/30">
            <Car className="h-10 w-10" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); onToggleSelect() }}
            className="h-4 w-4 rounded border-border"
          />
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          <button onClick={onEdit} title="Edit vehicle details"
            className="rounded-md bg-black/40 p-1.5 text-white/80 backdrop-blur-sm transition-colors hover:bg-primary hover:text-white">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDocs} title="Manage documents"
            className="rounded-md bg-black/40 p-1.5 text-white/80 backdrop-blur-sm transition-colors hover:bg-blue-600 hover:text-white">
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} title="Delete vehicle"
            className="rounded-md bg-black/40 p-1.5 text-white/80 backdrop-blur-sm transition-colors hover:bg-destructive hover:text-white">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4">
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

        <div className="mb-3 grid grid-cols-2 gap-2">
          <ComplianceCell label="MOT" dateStr={v.mot_expiry} />
          <ComplianceCell label="Insurance" dateStr={v.insurance_expiry} />
          <ComplianceCell label="Road Tax" dateStr={v.road_tax_expiry} />
          <ComplianceCell label="Service Due" dateStr={v.service_due} />
        </div>

        {(v.current_route || v.parking_location || v.key_location) && (
          <div className="mb-3 space-y-1.5 border-t pt-3">
            {v.current_route && (
              <div className="flex items-start gap-2 text-xs">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                <div><span className="font-medium text-muted-foreground">Route:</span> {v.current_route}</div>
              </div>
            )}
            {v.parking_location && (
              <div className="flex items-start gap-2 text-xs">
                <CircleParking className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <div><span className="font-medium text-muted-foreground">Parked:</span> {v.parking_location}</div>
              </div>
            )}
            {v.key_location && (
              <div className="flex items-start gap-2 text-xs">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                <div><span className="font-medium text-muted-foreground">Keys:</span> {v.key_location}</div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 border-t pt-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
            {driver ? (driver.name?.[0] ?? "?") : <Car className="h-3.5 w-3.5 opacity-50" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">
              {driver ? driver.name || "Unknown" : "Unassigned"}
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

// ── Shared helpers ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function StatCard({ icon, label, value, colorClass, strip, onClick }: {
  icon: React.ReactNode; label: string; value: number; colorClass: string; strip: string; onClick?: () => void
}) {
  return (
    <div onClick={onClick} className={`surface relative overflow-hidden p-4 pl-5 ${onClick ? "surface-hover cursor-pointer" : ""}`}>
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: strip }} />
      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${colorClass}`}>{icon}</div>
        {onClick && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <p className="font-display text-3xl font-black tracking-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16 text-center">
      <div className="mb-4 text-muted-foreground/25">{icon}</div>
      <h3 className="font-semibold text-muted-foreground">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground/70">{description}</p>
    </div>
  )
}
