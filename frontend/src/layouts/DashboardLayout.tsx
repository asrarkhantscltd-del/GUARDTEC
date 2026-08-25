import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { useAuth, type Permissions } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Button } from "@/components/ui/button"
import { downloadExport } from "@/lib/utils"
import { api } from "@/lib/api"
import {
  LayoutDashboard, Users, Truck, ShieldCheck, LogOut,
  Menu, X, MapPin,
  KeyRound, Bell, ClipboardCheck, Shield,
  Camera, Loader2, Sun, Moon, AlertTriangle, XCircle,
  ChevronDown, UserCog, Eye, EyeOff, FileSpreadsheet,
  Building2, CalendarDays, FileText, ListChecks,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
// import AiChat from "@/components/AiChat" — see the note by its (commented-out) render call below

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  permission?: keyof Permissions
  directorOnly?: boolean
  group?: "core" | "operations" | "compliance" | "admin"
}

const navGroups = [
  { key: "core",       label: null },
  { key: "operations", label: "Operations" },
  { key: "compliance", label: "Compliance" },
  { key: "admin",      label: "Administration" },
] as const

const navItems: NavItem[] = [
  { label: "Dashboard",        to: "/",                icon: <LayoutDashboard className="h-4 w-4" />,  group: "core" },
  { label: "Staff",            to: "/staff",           icon: <Users className="h-4 w-4" />,            permission: "staff",          group: "operations" },
  { label: "Fleet",            to: "/fleet",           icon: <Truck className="h-4 w-4" />,            permission: "fleet",          group: "operations" },
  { label: "Sites",            to: "/sites",           icon: <MapPin className="h-4 w-4" />,           permission: "sites",          group: "operations" },
  { label: "Compliance",       to: "/compliance",      icon: <ShieldCheck className="h-4 w-4" />,      permission: "compliance",     group: "compliance" },
  { label: "Pending Review",   to: "/pending-review",  icon: <ClipboardCheck className="h-4 w-4" />,  permission: "pending_review", group: "compliance" },
  { label: "Incident Reports", to: "/incident-reports",icon: <AlertTriangle className="h-4 w-4" />,    permission: "staff",          group: "compliance" },
  { label: "Agencies",         to: "/admin/agencies",           icon: <Building2 className="h-4 w-4" />,     permission: "staff",  group: "operations" },
  { label: "Agency Deployments", to: "/admin/deployments",       icon: <CalendarDays className="h-4 w-4" />, permission: "staff",  group: "operations" },
  { label: "Agency Performance", to: "/admin/agencies-dashboard", icon: <ShieldCheck className="h-4 w-4" />, permission: "staff",  group: "compliance" },
  { label: "Event Instructions", to: "/admin/event-instructions", icon: <ListChecks className="h-4 w-4" />,  permission: "staff",  group: "compliance" },
  { label: "Custom Forms",     to: "/custom-forms",              icon: <FileText className="h-4 w-4" />,     permission: "staff",  group: "admin" },
  { label: "Team Access",      to: "/users",           icon: <KeyRound className="h-4 w-4" />,         directorOnly: true,           group: "admin" },
  { label: "Manage Roles",     to: "/roles",           icon: <Shield className="h-4 w-4" />,           directorOnly: true,           group: "admin" },
]

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [alertCount, setAlertCount] = useState(0)
  const [notifications, setNotifications] = useState<{
    id: string; type: string; actor_name: string; summary: string
    link_staff_id?: string; link_tab?: string; link_incident_id?: string; link_agency_id?: string; created_at: string
  }[]>([])
  const [showAlerts, setShowAlerts] = useState(false)
  const alertsRef = useRef<HTMLDivElement>(null)
  const [showProfile, setShowProfile] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const [showReports, setShowReports] = useState(false)
  const [reportType, setReportType] = useState<"staff" | "fleet" | "drivers" | null>(null)
  const [reportSites, setReportSites] = useState<{ id: string; name: string }[]>([])
  const [staffFilters, setStaffFilters] = useState({ deployStatus: "", site: "", overall: "" })
  const [vehicleFilters, setVehicleFilters] = useState({ status: "", type: "" })
  const [driverFilters, setDriverFilters] = useState({ status: "" })
  const reportsRef = useRef<HTMLDivElement>(null)
  const [ringHidden, setRingHidden] = useState(() => localStorage.getItem("guardtec_ring_hidden") === "true")
  const [complianceHidden, setComplianceHidden] = useState(() => localStorage.getItem("guardtec_compliance_hidden") === "true")

  function toggleRing() {
    const next = !ringHidden
    setRingHidden(next)
    localStorage.setItem("guardtec_ring_hidden", String(next))
  }

  function toggleComplianceHidden() {
    const next = !complianceHidden
    setComplianceHidden(next)
    localStorage.setItem("guardtec_compliance_hidden", String(next))
  }

  useEffect(() => {
    api.getBlob("/api/me/photo")
      .then(blob => { if (blob) setMyPhotoUrl(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    api.get<{ total: number }>("/api/compliance/alerts")
      .then(d => { if (d) setAlertCount(d.total ?? 0) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    function fetchNotifs() {
      api.get<{ ok: boolean; notifications: typeof notifications }>("/api/notifications")
        .then(d => { if (d?.ok) setNotifications(d.notifications ?? []) })
        .catch(() => {})
    }
    fetchNotifs()
    const id = setInterval(fetchNotifs, 30000)
    return () => clearInterval(id)
  }, [])

  function clearAllNotifications() {
    setNotifications([])
    api.post('/api/notifications/seen-all').catch(() => {})
  }

  function goToNotification(n: { id: string; type: string; link_staff_id?: string; link_tab?: string; link_incident_id?: string; link_agency_id?: string }) {
    setNotifications(prev => prev.filter(x => x.id !== n.id))
    api.post(`/api/notifications/${n.id}/seen`).catch(() => {})
    setShowAlerts(false)
    if (n.type === "incident_report") navigate("/incident-reports")
    else if (n.type === "profile_submission") navigate("/pending-review")
    else if (n.link_agency_id) navigate(`/admin/agencies/${n.link_agency_id}${n.link_tab ? `?tab=${n.link_tab}` : ""}`)
    else if (n.link_staff_id) navigate(`/staff/${n.link_staff_id}${n.link_tab ? `?tab=${n.link_tab}` : ""}`)
  }

  useEffect(() => {
    if (reportType !== "staff" || reportSites.length > 0) return
    api.get<{ sites: { id: string; name: string }[] }>("/api/sites")
      .then(d => { if (d?.sites) setReportSites(d.sites) })
      .catch(() => {})
  }, [reportType, reportSites.length])

  function closeReports() {
    setShowReports(false)
    setReportType(null)
    setStaffFilters({ deployStatus: "", site: "", overall: "" })
    setVehicleFilters({ status: "", type: "" })
    setDriverFilters({ status: "" })
  }

  function buildReportUrl(): { url: string; filename: string } {
    if (reportType === "staff") {
      const p = new URLSearchParams()
      if (staffFilters.deployStatus) p.set("deployStatus", staffFilters.deployStatus)
      if (staffFilters.deployStatus === "onsite" && staffFilters.site) p.set("site", staffFilters.site)
      if (staffFilters.overall) p.set("overall", staffFilters.overall)
      const q = p.toString()
      return { url: `/api/staff/export${q ? `?${q}` : ""}`, filename: "GuardTec-Staff-Report.xlsx" }
    }
    if (reportType === "fleet") {
      const p = new URLSearchParams()
      if (vehicleFilters.status) p.set("status", vehicleFilters.status)
      if (vehicleFilters.type) p.set("type", vehicleFilters.type)
      const q = p.toString()
      return { url: `/api/vehicles/export${q ? `?${q}` : ""}`, filename: "GuardTec-Fleet-Report.xlsx" }
    }
    const p = new URLSearchParams()
    if (driverFilters.status) p.set("status", driverFilters.status)
    const q = p.toString()
    return { url: `/api/drivers/export${q ? `?${q}` : ""}`, filename: "GuardTec-Drivers-Report.xlsx" }
  }

  function generateReport() {
    const { url, filename } = buildReportUrl()
    downloadExport(url, filename).catch(() => toast.error("Failed to generate report"))
    closeReports()
  }

  // Close alert dropdown when clicking outside — also mark all as seen on close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) {
        clearAllNotifications()
        setShowAlerts(false)
      }
    }
    if (showAlerts) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showAlerts])

  // Close reports dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (reportsRef.current && !reportsRef.current.contains(e.target as Node)) {
        closeReports()
      }
    }
    if (showReports) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showReports])

  // Close profile dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfile(false)
      }
    }
    if (showProfile) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showProfile])

  async function handleMyPhotoUpload(file: File | null) {
    if (!file) return
    setUploadingPhoto(true)
    try {
      await api.post("/api/me/photo", file)
      const blob = await api.getBlob("/api/me/photo")
      if (blob) {
        if (myPhotoUrl) URL.revokeObjectURL(myPhotoUrl)
        setMyPhotoUrl(URL.createObjectURL(blob))
      }
    } finally {
      setUploadingPhoto(false)
    }
  }

  const visibleNav = navItems.filter((item) => {
    if (!user) return false
    if (item.directorOnly) return user.role === "director"
    if (!item.permission) return true
    return user.role === "director" || !!user.permissions?.[item.permission]
  })

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  const bellBadgeTotal = (complianceHidden ? 0 : alertCount) + notifications.length

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar — uses CSS vars so it switches with dark/light mode ── */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:relative md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>

        {/* Logo area — full-width brand zone */}
        <button
          onClick={() => { navigate("/"); setSidebarOpen(false) }}
          className="relative flex w-full shrink-0 flex-col items-center justify-center gap-1 overflow-hidden border-b border-sidebar-border py-5 transition-colors hover:bg-sidebar-accent"
        >
          {/* Red glow behind logo */}
          <div className="glow-blob absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 opacity-40" />
          {/* The logo SVGs carry their own background — clip to the container */}
          <img
            src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
            alt="GuardTec Security"
            className="relative z-10 w-[220px] h-auto"
          />
          <span className="relative z-10 font-display text-[9px] font-medium tracking-[0.35em] text-sidebar-foreground/40 uppercase mt-1">
            Compliance Platform
          </span>
        </button>

        {/* Nav — grouped by area */}
        <nav className="flex-1 overflow-y-auto p-3">
          {(() => {
            let navIdx = 0
            return navGroups.map(({ key, label }) => {
              const items = visibleNav.filter(item => (item.group ?? "core") === key)
              if (items.length === 0) return null
              return (
                <div key={key} className="mb-1">
                  {label && (
                    <p className="px-3 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/30">
                      {label}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {items.map((item) => {
                      const delay = navIdx++ * 0.05
                      return (
                        <motion.div
                          key={item.to}
                          initial={{ opacity: 0, x: -16 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <NavLink to={item.to} end={item.to === "/"}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) =>
                              `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                                isActive
                                  ? "bg-gradient-to-r from-primary to-primary/80 text-white shadow-[0_4px_14px_-2px_rgba(228,6,19,0.4)]"
                                  : "hover:translate-x-0.5 hover:bg-sidebar-accent"
                              }`
                            }>
                            {({ isActive }) => (
                              <>
                                {isActive && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-primary" />}
                                <span className={`transition-transform duration-200 ${!isActive ? "group-hover:scale-110" : ""}`}>{item.icon}</span>
                                {item.label}
                              </>
                            )}
                          </NavLink>
                        </motion.div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          })()}
        </nav>

        {/* Footer — user info + actions */}
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2.5 bg-sidebar-accent">
            <button
              className="relative h-9 w-9 shrink-0 cursor-pointer group rounded-full overflow-hidden"
              title="Change profile photo"
              onClick={() => photoInputRef.current?.click()}
            >
              {myPhotoUrl
                ? <img src={myPhotoUrl} alt="Profile" className="h-9 w-9 rounded-full object-cover" />
                : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-bold text-white shadow-[0_2px_8px_rgba(228,6,19,0.35)]">
                    {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>}
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" /> : <Camera className="h-3.5 w-3.5 text-white" />}
              </div>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user?.full_name}</p>
              <p className="truncate text-xs leading-tight opacity-50">{user?.role_name ?? ""}</p>
            </div>
            <span className="h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm"
              className="flex-1 justify-start gap-2 opacity-80 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
              onClick={handleLogout}>
              <LogOut className="h-4 w-4" />Sign out
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="shrink-0 opacity-60 hover:opacity-100 hover:bg-sidebar-accent">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="relative z-10 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-md md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          {/* Brand — logo on mobile (sidebar hidden), dot + name on desktop */}
          <div className="flex items-center gap-3">
            <img
              src={isDark ? "/logo-on-dark.svg" : "/logo-on-light.svg"}
              alt="GuardTec"
              className="h-9 w-auto md:hidden rounded-sm"
            />
            <div className="hidden md:flex items-center gap-3">
              <div className="relative">
                <div className="h-2.5 w-2.5 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-success animate-ping opacity-40" />
              </div>
              <h1 className="font-display text-lg font-bold tracking-wider uppercase">
                Guard<span className="text-primary">Tec</span>
              </h1>
              <div className="h-4 w-px bg-border" />
              <span className="font-display text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase">Compliance Platform</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <p className="hidden text-xs text-muted-foreground md:block">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            </p>

            {/* ── Generate Report — shows dropdown on click ── */}
            {(user?.role === "director" || user?.permissions?.staff || user?.permissions?.fleet) && (
              <div className="relative" ref={reportsRef}>
                <button
                  onClick={() => setShowReports(prev => !prev)}
                  className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Generate Report"
                >
                  <FileSpreadsheet className="h-4.5 w-4.5" />
                </button>

                {/* Reports dropdown panel */}
                {showReports && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 top-12 z-50 w-72 rounded-2xl glass shadow-2xl overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                      <div className="flex items-center gap-2">
                        {reportType && (
                          <button onClick={() => setReportType(null)}
                            className="rounded-md px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                            ←
                          </button>
                        )}
                        <p className="text-sm font-semibold">Generate Report</p>
                      </div>
                      <button onClick={closeReports}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {!reportType && (
                      <div className="p-2 space-y-0.5">
                        <button onClick={() => setReportType("staff")}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                          Staff Report
                        </button>
                        <button onClick={() => setReportType("fleet")}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                          Fleet Report
                        </button>
                        <button onClick={() => setReportType("drivers")}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                          Driver Report
                        </button>
                      </div>
                    )}

                    {reportType === "staff" && (
                      <div className="p-4 space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Deployment Status</label>
                          <select
                            value={staffFilters.deployStatus}
                            onChange={(e) => setStaffFilters(p => ({ ...p, deployStatus: e.target.value, site: "" }))}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">All staff</option>
                            <option value="onsite">Onsite</option>
                            <option value="available">Available</option>
                            <option value="offduty">Off Duty</option>
                          </select>
                        </div>
                        {staffFilters.deployStatus === "onsite" && (
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Location</label>
                            <select
                              value={staffFilters.site}
                              onChange={(e) => setStaffFilters(p => ({ ...p, site: e.target.value }))}
                              className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              <option value="">All locations</option>
                              {reportSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Compliance Status</label>
                          <select
                            value={staffFilters.overall}
                            onChange={(e) => setStaffFilters(p => ({ ...p, overall: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">All</option>
                            <option value="green">Compliant</option>
                            <option value="amber">Action Required</option>
                            <option value="red">Non-Compliant</option>
                          </select>
                        </div>
                        <Button size="sm" className="w-full" onClick={generateReport}>Generate Report</Button>
                      </div>
                    )}

                    {reportType === "fleet" && (
                      <div className="p-4 space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Vehicle Status</label>
                          <select
                            value={vehicleFilters.status}
                            onChange={(e) => setVehicleFilters(p => ({ ...p, status: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">All vehicles</option>
                            <option value="active">Active</option>
                            <option value="off_road">Off Road</option>
                            <option value="maintenance">Maintenance</option>
                            <option value="sold">Sold</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Vehicle Type</label>
                          <select
                            value={vehicleFilters.type}
                            onChange={(e) => setVehicleFilters(p => ({ ...p, type: e.target.value }))}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">All types</option>
                            <option value="patrol_car">Patrol Car</option>
                            <option value="response_van">Response Van</option>
                            <option value="supervisor_car">Supervisor Car</option>
                            <option value="support_van">Support Van</option>
                            <option value="minibus">Minibus</option>
                            <option value="personal_use">Personal Use</option>
                            <option value="official_use">Official Use</option>
                          </select>
                        </div>
                        <Button size="sm" className="w-full" onClick={generateReport}>Generate Report</Button>
                      </div>
                    )}

                    {reportType === "drivers" && (
                      <div className="p-4 space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Driver Status</label>
                          <select
                            value={driverFilters.status}
                            onChange={(e) => setDriverFilters({ status: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">All drivers</option>
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                            <option value="on_leave">On Leave</option>
                          </select>
                        </div>
                        <Button size="sm" className="w-full" onClick={generateReport}>Generate Report</Button>
                      </div>
                    )}
                </motion.div>
                )}
              </div>
            )}

            {/* ── Bell — shows dropdown on click ── */}
            <div className="relative" ref={alertsRef}>
              <button
                onClick={() => setShowAlerts(prev => !prev)}
                className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Notifications"
              >
                <Bell className="h-4.5 w-4.5" />
                {bellBadgeTotal > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white ring-2 ring-background">
                    {bellBadgeTotal > 9 ? "9+" : bellBadgeTotal}
                  </span>
                )}
              </button>

              {/* Notifications dropdown panel */}
              {showAlerts && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-12 z-50 w-80 rounded-2xl glass shadow-2xl overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold">Notifications</p>
                    <div className="flex items-center gap-1">
                      {notifications.length > 0 && (
                        <button onClick={clearAllNotifications}
                          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                          Clear all
                        </button>
                      )}
                      <button onClick={() => { clearAllNotifications(); setShowAlerts(false) }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-3 space-y-2 max-h-[420px] overflow-y-auto">

                    {/* ── Per-event notifications: messages, uploads, reports ── */}
                    {notifications.map((n) => {
                      const style = n.type === "incident_report"
                        ? { border: "border-warning/20", bg: "bg-warning/5 hover:bg-warning/10", icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />, text: "text-warning" }
                        : { border: "border-blue-500/20", bg: "bg-blue-500/5 hover:bg-blue-500/10", icon: <Bell className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />, text: "text-blue-600 dark:text-blue-400" }
                      return (
                        <button key={n.id} onClick={() => goToNotification(n)}
                          className={`flex w-full items-start gap-3 rounded-xl border ${style.border} ${style.bg} p-3 text-left transition-colors`}>
                          {style.icon}
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium ${style.text}`}>
                              {n.actor_name} <span className="font-normal text-foreground">{n.summary}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {new Date(n.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </button>
                      )
                    })}

                    {/* ── Compliance section — persists until the real issue is fixed, not a dismissible event ── */}
                    {alertCount > 0 && (
                      <div className="flex w-full items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-left transition-colors">
                        <button
                          onClick={() => { if (complianceHidden) return; navigate("/compliance"); setShowAlerts(false) }}
                          className={`flex flex-1 items-start gap-3 text-left ${complianceHidden ? "cursor-default" : "hover:opacity-80"}`}
                        >
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <div>
                            <p className="text-sm font-medium text-destructive">
                              {complianceHidden ? "Compliance attention hidden" : `${alertCount} officer${alertCount !== 1 ? "s" : ""} need compliance attention`}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {complianceHidden ? "Tap the eye to reveal" : "Tap to open Compliance Dashboard"}
                            </p>
                          </div>
                        </button>
                        <button
                          onClick={toggleComplianceHidden}
                          title={complianceHidden ? "Show compliance count" : "Hide compliance count"}
                          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        >
                          {complianceHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    )}

                    {/* All clear */}
                    {alertCount === 0 && notifications.length === 0 && (
                      <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/5 p-3">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
                        <p className="text-sm font-medium text-success">All clear — no new notifications</p>
                      </div>
                    )}
                  </div>

                </motion.div>
              )}
            </div>

            {/* Profile dropdown trigger */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setShowProfile(prev => !prev)}
                className="flex items-center gap-2 rounded-xl border border-transparent px-2 py-1.5 transition-all hover:border-border hover:bg-muted"
              >
                {/* Avatar */}
                <div className="relative h-7 w-7 shrink-0 rounded-full overflow-hidden">
                  {myPhotoUrl
                    ? <img src={myPhotoUrl} alt="Profile" className="h-7 w-7 object-cover" />
                    : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-[10px] font-bold text-white shadow-sm">
                        {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                      </div>}
                  {uploadingPhoto && (
                    <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                      <Loader2 className="h-3 w-3 text-white animate-spin" />
                    </div>
                  )}
                </div>
                {/* Name — hidden on very small screens */}
                <div className="hidden sm:flex flex-col items-start leading-none">
                  <span className="text-xs font-semibold text-foreground truncate max-w-[120px]">
                    {user?.full_name?.split(" ")[0]}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                    {user?.role_name ?? user?.role}
                  </span>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${showProfile ? "rotate-180" : ""}`} />
              </button>

              {/* Profile dropdown panel */}
              <AnimatePresence>
                {showProfile && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 top-12 z-50 w-72 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
                  >
                    {/* Header — user info */}
                    <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-4">
                      <button
                        className="relative h-12 w-12 shrink-0 cursor-pointer group rounded-full overflow-hidden"
                        title="Change photo"
                        onClick={() => photoInputRef.current?.click()}
                      >
                        {myPhotoUrl
                          ? <img src={myPhotoUrl} alt="Profile" className="h-12 w-12 object-cover" />
                          : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-white shadow-md">
                              {user?.full_name?.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                            </div>}
                        <div className="absolute inset-0 rounded-full bg-black/55 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          {uploadingPhoto ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Camera className="h-4 w-4 text-white" />}
                        </div>
                      </button>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{user?.full_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user?.role_name ?? user?.role}</p>
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success border border-success/20">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          Active
                        </span>
                      </div>
                    </div>

                    {/* Account management section */}
                    <div className="p-2 space-y-0.5">
                      {/* Director-only: Team Access + Manage Roles */}
                      {user?.role === "director" && (
                        <>
                          <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Account Management
                          </p>
                          <button
                            onClick={() => { navigate("/users"); setShowProfile(false) }}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
                          >
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                              <Users className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <div className="text-left">
                              <p className="font-medium text-sm">Team Access</p>
                              <p className="text-[11px] text-muted-foreground">Manage user accounts & logins</p>
                            </div>
                          </button>
                          <button
                            onClick={() => { navigate("/roles"); setShowProfile(false) }}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
                          >
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                              <UserCog className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <div className="text-left">
                              <p className="font-medium text-sm">Manage Roles</p>
                              <p className="text-[11px] text-muted-foreground">Set permissions per department</p>
                            </div>
                          </button>
                          <div className="my-1 mx-3 border-t border-border" />
                        </>
                      )}

                      {/* Settings & appearance */}
                      <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Preferences
                      </p>
                      {/* Theme toggle */}
                      <button
                        onClick={toggleTheme}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                          {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                        </div>
                        <div className="text-left flex-1">
                          <p className="font-medium text-sm">{isDark ? "Light Mode" : "Dark Mode"}</p>
                          <p className="text-[11px] text-muted-foreground">Switch appearance theme</p>
                        </div>
                        <div className={`h-5 w-9 rounded-full transition-colors ${isDark ? "bg-primary" : "bg-muted-foreground/30"} relative`}>
                          <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${isDark ? "translate-x-4" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                      {/* Change photo */}
                      <button
                        onClick={() => { photoInputRef.current?.click(); setShowProfile(false) }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                          <Camera className="h-3.5 w-3.5" />
                        </div>
                        <div className="text-left">
                          <p className="font-medium text-sm">Change Photo</p>
                          <p className="text-[11px] text-muted-foreground">Upload a new profile picture</p>
                        </div>
                      </button>
                      {/* Compliance ring toggle */}
                      <button
                        onClick={toggleRing}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                          {ringHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </div>
                        <div className="text-left flex-1">
                          <p className="font-medium text-sm">{ringHidden ? "Show Compliance Ring" : "Hide Compliance Ring"}</p>
                          <p className="text-[11px] text-muted-foreground">Dashboard compliance circle</p>
                        </div>
                        <div className={`h-5 w-9 rounded-full transition-colors ${!ringHidden ? "bg-primary" : "bg-muted-foreground/30"} relative`}>
                          <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${!ringHidden ? "translate-x-4" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                    </div>

                    {/* Sign out */}
                    <div className="border-t border-border p-2">
                      <button
                        onClick={() => { setShowProfile(false); handleLogout() }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10">
                          <LogOut className="h-3.5 w-3.5 text-destructive" />
                        </div>
                        <p className="font-medium text-sm">Sign Out</p>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet context={{ ringHidden, toggleRing }} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Single always-mounted file input — shared by sidebar + dropdown */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploadingPhoto}
        onChange={e => handleMyPhotoUpload(e.target.files?.[0] ?? null)}
      />

      {/* AI Compliance Assistant — floating chat widget, hidden 2026-08-20:
          the n8n webhook it calls (/api/ai-chat -> N8N_AI_WEBHOOK) is
          returning 404, so every question just failed. Pulled from view
          rather than deleted — the plan is a rebuilt version answering
          directly off Postgres (no n8n hop), not restoring this one as-is. */}
      {/* <AiChat /> */}
    </div>
  )
}
