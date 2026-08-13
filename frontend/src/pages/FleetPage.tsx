import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  Truck, Users, AlertTriangle, CheckCircle2, Search, Plus,
  Car, UserCheck, Trash2, X, Save, Loader2, Camera, ImageOff,
  FileText, Download, Upload, Pencil,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { downloadExport } from "@/lib/utils"

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
  has_photo?: boolean
}

const BLANK_VEHICLE: Omit<Vehicle, "id"> = {
  registration: "", make: "", model: "", year: new Date().getFullYear(),
  colour: "", type: "patrol_car", status: "active", assignedDriverId: "",
  mot_expiry: "", insurance_expiry: "", road_tax_expiry: "", service_due: "",
  mileage: undefined,
}

interface FleetDriver {
  id: string
  first_name: string
  last_name: string
  phone?: string
  email?: string
  licenceNumber?: string
  licenceExpiry?: string
  licenceCategories?: string[]
  cpcCard?: string
  cpcExpiry?: string
  tachoCard?: string
  tachoExpiry?: string
  medicalExpiry?: string
  dbsNumber?: string
  dbsDate?: string
  lastAssessment?: string
  assignedVehicleId?: string
  status: "active" | "suspended" | "on_leave"
  notes?: string
}

const BLANK_DRIVER: Omit<FleetDriver, "id"> = {
  first_name: "", last_name: "", phone: "", email: "",
  licenceNumber: "", licenceExpiry: "", licenceCategories: [],
  cpcCard: "", cpcExpiry: "", tachoCard: "", tachoExpiry: "",
  medicalExpiry: "", dbsNumber: "", dbsDate: "", lastAssessment: "",
  assignedVehicleId: "", status: "active", notes: "",
}

const LICENCE_CATS = ["B", "B+E", "C1", "C1+E", "C", "C+E", "D1", "D1+E", "D", "AM"]

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

export default function FleetPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab") as "vehicles" | "drivers" | null
  // Derived straight from the URL — no separate useState to fall out of sync with it
  const activeTab: "vehicles" | "drivers" = tabParam ?? "vehicles"

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<FleetDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [alertsOnly, setAlertsOnly] = useState(false)

  // Row selection for Excel export
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set())
  const [selectedDriverIds, setSelectedDriverIds] = useState<Set<string>>(new Set())

  // Add/Delete state — drivers
  const [showPanel, setShowPanel] = useState(false)
  const [editDriver, setEditDriver] = useState<Omit<FleetDriver, "id">>(BLANK_DRIVER)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  function switchTab(tab: "vehicles" | "drivers") {
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
    if (activeTab === "vehicles") {
      const ids = selectedVehicleIds.size > 0 ? [...selectedVehicleIds] : filteredVehicles.map(v => v.id)
      downloadExport(`/api/vehicles/export?ids=${ids.join(",")}`, "GuardTec-Fleet-Report.xlsx")
        .catch(() => toast.error("Failed to generate report"))
    } else {
      const ids = selectedDriverIds.size > 0 ? [...selectedDriverIds] : filteredDrivers.map(d => d.id)
      downloadExport(`/api/drivers/export?ids=${ids.join(",")}`, "GuardTec-Drivers-Report.xlsx")
        .catch(() => toast.error("Failed to generate report"))
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [vRes, dRes] = await Promise.all([
          fetch("/api/vehicles", { credentials: "include" }),
          fetch("/api/fleet-drivers", { credentials: "include" }),
        ])
        if (cancelled) return
        if (vRes.ok) {
          const data = await vRes.json()
          setVehicles(Array.isArray(data) ? data : (data.vehicles ?? []))
        }
        if (dRes.ok) {
          const data = await dRes.json()
          setDrivers(Array.isArray(data) ? data : [])
        }
        if (!vRes.ok && !dRes.ok) setApiError(true)
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
    const alerts = vehicles.filter(v => {
      const d = worstDays([v.mot_expiry, v.insurance_expiry, v.road_tax_expiry])
      return d !== null && d <= 30
    }).length
    return { total, active, alerts, driverCount: drivers.length }
  }, [vehicles, drivers])

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

  const filteredDrivers = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return drivers
    return drivers.filter(d =>
      `${d.first_name ?? ""} ${d.last_name ?? ""}`.toLowerCase().includes(q) ||
      (d.licenceNumber ?? "").toLowerCase().includes(q)
    )
  }, [drivers, search])

  // ── Add driver ────────────────────────────────────────────────────────────────

  async function handleAddDriver(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/fleet-drivers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDriver),
      })
      if (res.ok) {
        const { driver } = await res.json()
        setDrivers(prev => [...prev, driver])
        setShowPanel(false)
        setEditDriver(BLANK_DRIVER)
        toast.success("Driver added successfully")
      } else {
        toast.error("Failed to add driver")
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Delete driver ─────────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/fleet-drivers/${deleteId}`, { method: "DELETE", credentials: "include" })
      if (res.ok) {
        setDrivers(prev => prev.filter(d => d.id !== deleteId))
        setDeleteId(null)
        toast.success("Driver removed")
      } else {
        toast.error("Failed to remove driver")
      }
    } finally {
      setDeleting(false)
    }
  }

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
        const res = await fetch(`/api/vehicles/${editingVehicleId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editVehicle),
        })
        if (!res.ok) { toast.error("Failed to update vehicle"); return }
        const { vehicle } = await res.json()

        if (vehiclePhoto) {
          await fetch(`/api/vehicles/${editingVehicleId}/photo`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": vehiclePhoto.type || "application/octet-stream" },
            body: vehiclePhoto,
          })
          vehicle.has_photo = true
        }

        setVehicles(prev => prev.map(v => v.id === editingVehicleId ? vehicle : v))
        closeVehiclePanel()
        toast.success("Vehicle updated")
      } else {
        // ── Add mode ──
        const res = await fetch("/api/vehicles", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editVehicle),
        })
        if (!res.ok) { toast.error("Failed to add vehicle"); return }
        const { vehicle } = await res.json()

        if (vehiclePhoto) {
          await fetch(`/api/vehicles/${vehicle.id}/photo`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": vehiclePhoto.type || "application/octet-stream" },
            body: vehiclePhoto,
          })
          vehicle.has_photo = true
        }

        setVehicles(prev => [...prev, vehicle])
        closeVehiclePanel()
        toast.success("Vehicle added successfully")
      }
    } finally {
      setSavingVehicle(false)
    }
  }

  // ── Delete vehicle ────────────────────────────────────────────────────────────

  async function confirmDeleteVehicle() {
    if (!deleteVehicleId) return
    setDeletingVehicle(true)
    try {
      const res = await fetch(`/api/vehicles/${deleteVehicleId}`, { method: "DELETE", credentials: "include" })
      if (res.ok) {
        setVehicles(prev => prev.filter(v => v.id !== deleteVehicleId))
        setDeleteVehicleId(null)
        toast.success("Vehicle removed")
      } else {
        toast.error("Failed to remove vehicle")
      }
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
      const res = await fetch(`/api/vehicles/${vehicleId}/docs`, { credentials: "include" })
      if (res.ok) setDocs(await res.json())
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
      const res = await fetch(`/api/vehicles/${docsVehicleId}/docs/${filename}`, {
        method: "DELETE",
        credentials: "include",
      })
      if ((await res.json()).ok) {
        setDocs(prev => prev.filter(d => d.filename !== filename))
      }
    } catch {
      toast.error("Failed to delete document")
    }
  }

  // ── Toggle licence category ───────────────────────────────────────────────────

  function toggleCat(cat: string) {
    setEditDriver(prev => {
      const cats = prev.licenceCategories ?? []
      return {
        ...prev,
        licenceCategories: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat],
      }
    })
  }

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Truck className="mx-auto mb-3 h-10 w-10 animate-pulse opacity-30" />
        <p className="text-sm">Loading fleet data…</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Fleet Management</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Vehicle compliance, driver records &amp; transport operations</p>
        </div>
        {activeTab === "drivers" && (
          <Button size="sm" className="gap-1.5 shrink-0" onClick={() => { setEditDriver(BLANK_DRIVER); setShowPanel(true) }}>
            <Plus className="h-4 w-4" />Add Driver
          </Button>
        )}
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Truck className="h-5 w-5" />} label="Total Vehicles" value={stats.total}
          colorClass="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400" onClick={goToAllVehicles} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Active Vehicles" value={stats.active}
          colorClass="bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400" onClick={goToActiveVehicles} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Compliance Alerts" value={stats.alerts}
          colorClass={stats.alerts > 0
            ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
            : "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400"} onClick={goToAlertVehicles} />
        <StatCard icon={<Users className="h-5 w-5" />} label="Fleet Drivers" value={stats.driverCount}
          colorClass="bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400" onClick={() => switchTab("drivers")} />
      </div>

      {/* Tabs */}
      <div className="flex w-fit gap-0 rounded-lg border bg-muted/40 p-1">
        {(["vehicles", "drivers"] as const).map(tab => (
          <button key={tab} onClick={() => switchTab(tab)}
            className={`flex items-center gap-1.5 rounded-md px-5 py-1.5 text-sm font-medium transition-all ${
              activeTab === tab ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {tab === "vehicles"
              ? <><Car className="h-3.5 w-3.5" />Vehicles ({vehicles.length})</>
              : <><UserCheck className="h-3.5 w-3.5" />Drivers ({drivers.length})</>}
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

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={activeTab === "vehicles" ? "Search reg, make, model…" : "Search by name or licence number…"}
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
          {activeTab === "vehicles"
            ? (selectedVehicleIds.size > 0 ? `Export Selected (${selectedVehicleIds.size})` : "Export Report")
            : (selectedDriverIds.size > 0 ? `Export Selected (${selectedDriverIds.size})` : "Export Report")}
        </button>
      </div>

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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredVehicles.map(v => (
                  <VehicleCard key={v.id} v={v} drivers={drivers}
                    selected={selectedVehicleIds.has(v.id)}
                    onToggleSelect={() => toggleSelected(v.id, setSelectedVehicleIds)}
                    onEdit={() => openEditVehicle(v)}
                    onDelete={() => setDeleteVehicleId(v.id)}
                    onDocs={() => openDocsPanel(v.id)} />
                ))}
              </div>
            </div>
      )}

      {/* Drivers tab */}
      {activeTab === "drivers" && (
        filteredDrivers.length === 0
          ? <EmptyState icon={<Users className="h-12 w-12" />}
              title={drivers.length === 0 ? "No drivers on record" : "No drivers match your search"}
              description={drivers.length === 0
                ? "Click 'Add Driver' to add your first fleet driver."
                : "Try adjusting your search."} />
          : <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                      <input
                        type="checkbox"
                        checked={filteredDrivers.length > 0 && filteredDrivers.every(d => selectedDriverIds.has(d.id))}
                        onChange={() => toggleSelectAll(filteredDrivers.map(d => d.id), selectedDriverIds, setSelectedDriverIds)}
                        className="h-4 w-4 rounded border-border"
                      />
                    </th>
                    {["Driver","Licence No.","Categories","Lic. Expiry","CPC","Tachograph","Medical","DBS Date","Vehicle","Status",""].map(h => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.map(d => (
                    <DriverRow key={d.id} d={d} vehicles={vehicles}
                      selected={selectedDriverIds.has(d.id)}
                      onToggleSelect={() => toggleSelected(d.id, setSelectedDriverIds)}
                      onDelete={() => setDeleteId(d.id)} />
                  ))}
                </tbody>
              </table>
            </div>
      )}

      {/* ── Add Driver slide-over panel ── */}
      {showPanel && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setShowPanel(false)} />
          <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Add Fleet Driver</h2>
              <button onClick={() => setShowPanel(false)} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddDriver} className="flex flex-1 flex-col gap-0 overflow-y-auto">
              <div className="space-y-5 px-6 py-5">

                {/* Personal Info */}
                <Section title="Personal Information">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First Name *">
                      <Input required value={editDriver.first_name}
                        onChange={e => setEditDriver(p => ({ ...p, first_name: e.target.value }))} />
                    </Field>
                    <Field label="Last Name *">
                      <Input required value={editDriver.last_name}
                        onChange={e => setEditDriver(p => ({ ...p, last_name: e.target.value }))} />
                    </Field>
                    <Field label="Phone">
                      <Input type="tel" value={editDriver.phone ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, phone: e.target.value }))} />
                    </Field>
                    <Field label="Email">
                      <Input type="email" value={editDriver.email ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, email: e.target.value }))} />
                    </Field>
                  </div>
                </Section>

                {/* Driving Licence */}
                <Section title="Driving Licence">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Licence Number">
                      <Input className="font-mono uppercase" value={editDriver.licenceNumber ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, licenceNumber: e.target.value.toUpperCase() }))} />
                    </Field>
                    <Field label="Licence Expiry">
                      <Input type="date" value={editDriver.licenceExpiry ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, licenceExpiry: e.target.value }))} />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Licence Categories</label>
                    <div className="flex flex-wrap gap-2">
                      {LICENCE_CATS.map(cat => {
                        const active = editDriver.licenceCategories?.includes(cat)
                        return (
                          <button key={cat} type="button" onClick={() => toggleCat(cat)}
                            className={`rounded-md border px-3 py-1 text-xs font-bold transition-colors ${
                              active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
                            }`}>
                            {cat}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </Section>

                {/* Professional Certifications */}
                <Section title="Professional Certifications">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="CPC Card Number">
                      <Input className="font-mono" value={editDriver.cpcCard ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, cpcCard: e.target.value }))} />
                    </Field>
                    <Field label="CPC Expiry">
                      <Input type="date" value={editDriver.cpcExpiry ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, cpcExpiry: e.target.value }))} />
                    </Field>
                    <Field label="Tachograph Card No.">
                      <Input className="font-mono" value={editDriver.tachoCard ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, tachoCard: e.target.value }))} />
                    </Field>
                    <Field label="Tachograph Expiry">
                      <Input type="date" value={editDriver.tachoExpiry ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, tachoExpiry: e.target.value }))} />
                    </Field>
                    <Field label="Medical Cert Expiry">
                      <Input type="date" value={editDriver.medicalExpiry ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, medicalExpiry: e.target.value }))} />
                    </Field>
                    <Field label="Last Assessment">
                      <Input type="date" value={editDriver.lastAssessment ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, lastAssessment: e.target.value }))} />
                    </Field>
                  </div>
                </Section>

                {/* Background Checks */}
                <Section title="Background Checks">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="DBS Certificate No.">
                      <Input className="font-mono" value={editDriver.dbsNumber ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, dbsNumber: e.target.value }))} />
                    </Field>
                    <Field label="DBS Issue Date">
                      <Input type="date" value={editDriver.dbsDate ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, dbsDate: e.target.value }))} />
                    </Field>
                  </div>
                </Section>

                {/* Assignment */}
                <Section title="Vehicle & Status">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Assign Vehicle">
                      <select value={editDriver.assignedVehicleId ?? ""}
                        onChange={e => setEditDriver(p => ({ ...p, assignedVehicleId: e.target.value }))}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                        <option value="">Unassigned</option>
                        {vehicles.filter(v => v.status === "active").map(v => (
                          <option key={v.id} value={v.id}>{v.registration} — {v.make} {v.model}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Status">
                      <select value={editDriver.status}
                        onChange={e => setEditDriver(p => ({ ...p, status: e.target.value as FleetDriver["status"] }))}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="on_leave">On Leave</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Notes" className="mt-3">
                    <textarea rows={2} value={editDriver.notes ?? ""}
                      onChange={e => setEditDriver(p => ({ ...p, notes: e.target.value }))}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none" />
                  </Field>
                </Section>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 flex gap-3 border-t bg-background px-6 py-4">
                <Button type="submit" disabled={saving} className="flex-1 gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? "Saving…" : "Save Driver"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowPanel(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirm dialog ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-2xl">
            <h3 className="text-base font-semibold">Remove driver?</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This driver will be permanently removed from the fleet register. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="destructive" disabled={deleting} className="flex-1 gap-2" onClick={confirmDelete}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deleting ? "Removing…" : "Yes, Remove"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Vehicle slide-over panel ── */}
      {showVehiclePanel && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={closeVehiclePanel} />
          <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">{editingVehicleId ? "Edit Vehicle" : "Add Vehicle"}</h2>
              <button onClick={closeVehiclePanel} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVehicle} className="flex flex-1 flex-col gap-0 overflow-y-auto">
              <div className="space-y-5 px-6 py-5">

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
                        {drivers.filter(d => d.status === "active").map(d => (
                          <option key={d.id} value={d.id}>{d.first_name} {d.last_name}</option>
                        ))}
                      </select>
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
              <div className="sticky bottom-0 flex gap-3 border-t bg-background px-6 py-4">
                <Button type="submit" disabled={savingVehicle} className="flex-1 gap-2">
                  {savingVehicle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingVehicle ? "Saving…" : editingVehicleId ? "Update Vehicle" : "Save Vehicle"}
                </Button>
                <Button type="button" variant="outline" onClick={closeVehiclePanel}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Vehicle Documents slide-over panel ── */}
      {docsVehicleId && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={closeDocsPanel} />
          <div className="flex h-full w-full max-w-lg flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">Vehicle Documents</h2>
                <p className="text-xs text-muted-foreground">
                  {vehicles.find(v => v.id === docsVehicleId)?.registration ?? ""}
                  {" · "}
                  {vehicles.find(v => v.id === docsVehicleId)?.make ?? ""}
                  {" "}
                  {vehicles.find(v => v.id === docsVehicleId)?.model ?? ""}
                </p>
              </div>
              <button onClick={closeDocsPanel} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 px-6 py-5">

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

function VehicleCard({ v, drivers, selected, onToggleSelect, onEdit, onDelete, onDocs }: {
  v: Vehicle; drivers: FleetDriver[]; selected: boolean; onToggleSelect: () => void
  onEdit: () => void; onDelete: () => void; onDocs: () => void
}) {
  const driver = v.assignedDriverId ? drivers.find(d => d.id === v.assignedDriverId) : null
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

        <div className="flex items-center gap-2 border-t pt-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
            {driver ? `${driver.first_name?.[0] ?? "?"}${driver.last_name?.[0] ?? ""}` : <Car className="h-3.5 w-3.5 opacity-50" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">
              {driver ? `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unknown" : "Unassigned"}
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

// ── Driver Row ────────────────────────────────────────────────────────────────

function DriverRow({ d, vehicles, selected, onToggleSelect, onDelete }: {
  d: FleetDriver; vehicles: Vehicle[]; selected: boolean; onToggleSelect: () => void; onDelete: () => void
}) {
  const assignedVehicle = d.assignedVehicleId ? vehicles.find(v => v.id === d.assignedVehicleId) : null
  const worst = worstDays([d.licenceExpiry, d.cpcExpiry, d.tachoExpiry, d.medicalExpiry])

  const rowBg =
    worst !== null && worst < 0   ? "bg-red-50/60 dark:bg-red-950/10" :
    worst !== null && worst <= 30 ? "bg-amber-50/60 dark:bg-amber-950/10" : ""

  const statusStyle =
    d.status === "active"    ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" :
    d.status === "suspended" ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" :
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"

  return (
    <tr className={`border-b transition-colors hover:bg-muted/30 ${rowBg}`}>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onToggleSelect() }}
          className="h-4 w-4 rounded border-border"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {d.first_name?.[0] ?? "?"}{d.last_name?.[0] ?? ""}
          </div>
          <div>
            <div className="font-medium">{d.first_name ?? ""} {d.last_name ?? ""}</div>
            {d.phone && <div className="text-xs text-muted-foreground">{d.phone}</div>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs">{d.licenceNumber || <span className="text-muted-foreground">—</span>}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {d.licenceCategories?.length
            ? d.licenceCategories.map(c => <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold">{c}</span>)
            : <span className="text-xs text-muted-foreground">—</span>}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap"><ComplianceChip label="expiry" dateStr={d.licenceExpiry} /></td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-[11px] font-mono text-muted-foreground mb-0.5">{d.cpcCard || "—"}</div>
        <ComplianceChip label="CPC" dateStr={d.cpcExpiry} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-[11px] font-mono text-muted-foreground mb-0.5">{d.tachoCard || "—"}</div>
        <ComplianceChip label="Tacho" dateStr={d.tachoExpiry} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap"><ComplianceChip label="Medical" dateStr={d.medicalExpiry} /></td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-xs">{d.dbsDate ? formatDate(d.dbsDate) : <span className="text-muted-foreground">—</span>}</div>
        {d.dbsNumber && <div className="font-mono text-[10px] text-muted-foreground">{d.dbsNumber}</div>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {assignedVehicle
          ? <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-bold">{assignedVehicle.registration}</span>
          : <span className="text-xs text-muted-foreground">Unassigned</span>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyle}`}>
          {d.status.replace("_", " ")}
        </span>
      </td>
      <td className="px-4 py-3">
        <button onClick={onDelete}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
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

function StatCard({ icon, label, value, colorClass, onClick }: {
  icon: React.ReactNode; label: string; value: number; colorClass: string; onClick?: () => void
}) {
  return (
    <div onClick={onClick}
      className={`rounded-xl border bg-card p-4 shadow-sm ${onClick ? "cursor-pointer transition-colors hover:bg-muted/40" : ""}`}>
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>{icon}</div>
      <div className="mt-3 text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
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
