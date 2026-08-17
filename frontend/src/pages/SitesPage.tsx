import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { initials, AV_COLORS } from "@/lib/utils"
import {
  MapPin, Plus, Pencil, Trash2, X, Building2, Car, Layers,
  Briefcase, Store, MoreHorizontal, Phone, Mail, Package,
  Monitor, Smartphone, Sofa, Utensils, ChevronRight, Users, Search,
  FileText, Upload, Loader2, Eye, FolderUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// ── Types ─────────────────────────────────────────────────────────────────────

interface WelfareItem {
  id: string
  name: string
  quantity: number
  condition: "good" | "fair" | "poor"
  serial_number: string
  notes: string
  image_ext?: string
}

interface SiteDoc {
  filename: string
  originalName: string
  category: string
  size: number
  uploadedAt: string
}

const DOC_CATEGORY_LABELS: Record<string, string> = {
  documentation: "Documentation",
  presentation:  "Presentation",
  induction:     "Induction Pack",
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

interface AssignedStaff {
  id: string
  name: string
  overall: string
}

interface AllStaff {
  id: string
  name: string
  overall: string
}

interface Site {
  id: string
  name: string
  type: string
  client_name: string
  client_phone: string
  client_email: string
  address: string
  supervisor_name: string
  supervisor_phone: string
  supervisor_email: string
  status: string
  notes: string
  welfare_items?: WelfareItem[]
  assigned_staff?: string[]
}

const BLANK_SITE: Site = {
  id: "", name: "", type: "construction", client_name: "",
  client_phone: "", client_email: "",
  address: "", supervisor_name: "", supervisor_phone: "",
  supervisor_email: "", status: "active", notes: "",
}

const BLANK_ITEM: WelfareItem = {
  id: "", name: "", quantity: 1, condition: "good", serial_number: "", notes: "", image_ext: "",
}

// ── Static data ───────────────────────────────────────────────────────────────

const SITE_TYPES = [
  { value: "construction", label: "Construction", icon: Building2, color: "bg-amber-100 text-amber-800" },
  { value: "parking",      label: "Parking",      icon: Car,        color: "bg-blue-100 text-blue-800" },
  { value: "events",       label: "Events",       icon: Layers,     color: "bg-purple-100 text-purple-800" },
  { value: "retail",       label: "Retail",       icon: Store,      color: "bg-teal-100 text-teal-800" },
  { value: "corporate",    label: "Corporate",    icon: Briefcase,  color: "bg-gray-100 text-gray-700" },
  { value: "other",        label: "Other",        icon: MoreHorizontal, color: "bg-gray-100 text-gray-600" },
]

const CONDITION_COLORS = {
  good: "bg-green-100 text-green-700",
  fair: "bg-amber-100 text-amber-700",
  poor: "bg-red-100 text-red-700",
}

const OVERALL_DOT: Record<string, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red:   "bg-red-500",
  grey:  "bg-gray-400",
}

const QUICK_ITEMS = [
  { name: "Microwave",     icon: Utensils },
  { name: "Laptop",        icon: Monitor },
  { name: "Mobile phone",  icon: Smartphone },
  { name: "Desk phone",    icon: Phone },
  { name: "Chair",         icon: Sofa },
  { name: "Table / Desk",  icon: Sofa },
  { name: "First aid kit", icon: Package },
  { name: "CCTV monitor",  icon: Monitor },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeInfo(type: string) {
  return SITE_TYPES.find((t) => t.value === type) ?? SITE_TYPES[SITE_TYPES.length - 1]
}
// ── Component ─────────────────────────────────────────────────────────────────

export default function SitesPage() {
  const [sites, setSites]         = useState<Site[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<"all" | "active" | "inactive">("all")

  // Site add/edit panel
  const [sitePanel, setSitePanel]     = useState(false)
  const [editingSite, setEditingSite] = useState<Site | null>(null)
  const [siteDraft, setSiteDraft]     = useState<Site>(BLANK_SITE)
  const [siteSaving, setSiteSaving]   = useState(false)
  const [siteError, setSiteError]     = useState("")
  const [deleteId, setDeleteId]       = useState<string | null>(null)

  // Welfare panel
  const [welfareSite, setWelfareSite]       = useState<Site | null>(null)
  const [welfareItems, setWelfareItems]     = useState<WelfareItem[]>([])
  const [welfareLoading, setWelfareLoading] = useState(false)
  const [itemPanel, setItemPanel]           = useState(false)
  const [editingItem, setEditingItem]       = useState<WelfareItem | null>(null)
  const [itemDraft, setItemDraft]           = useState<WelfareItem>(BLANK_ITEM)
  const [itemSaving, setItemSaving]         = useState(false)
  const [itemError, setItemError]           = useState("")
  const [deleteItemId, setDeleteItemId]     = useState<string | null>(null)
  const [pendingImage, setPendingImage]     = useState<File | null>(null)
  const [imagePreview, setImagePreview]     = useState<string | null>(null)
  const [viewImageUrl, setViewImageUrl]     = useState<string | null>(null)

  // Documents panel
  const [docsSite, setDocsSite]             = useState<Site | null>(null)
  const [docs, setDocs]                     = useState<SiteDoc[]>([])
  const [docsLoading, setDocsLoading]       = useState(false)
  const [uploadDocFiles, setUploadDocFiles] = useState<File[]>([])
  const [uploadDocCategory, setUploadDocCategory] = useState("documentation")
  const [uploadingDoc, setUploadingDoc]     = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [docError, setDocError]             = useState("")

  // Staff panel
  const [staffSite, setStaffSite]           = useState<Site | null>(null)
  const [assignedStaff, setAssignedStaff]   = useState<AssignedStaff[]>([])
  const [allStaff, setAllStaff]             = useState<AllStaff[]>([])
  const [staffLoading, setStaffLoading]     = useState(false)
  const [staffSearch, setStaffSearch]       = useState("")
  const [deleteStaffId, setDeleteStaffId]   = useState<string | null>(null)

  // ── Data loaders ────────────────────────────────────────────────────────────

  async function loadSites() {
    try {
      const d = await api.get<{ sites: Site[] }>("/api/sites")
      setSites(d.sites ?? [])
    } catch {
      toast.error("Failed to load sites")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSites() }, [])

  // ── Site CRUD ───────────────────────────────────────────────────────────────

  function openAdd() {
    setEditingSite(null); setSiteDraft(BLANK_SITE); setSiteError(""); setSitePanel(true)
  }
  function openEdit(site: Site) {
    setEditingSite(site); setSiteDraft({ ...site }); setSiteError(""); setSitePanel(true)
  }
  function closeSitePanel() { setSitePanel(false); setEditingSite(null); setSiteError("") }
  function setSF(f: keyof Site, v: string) { setSiteDraft((d) => ({ ...d, [f]: v })) }

  async function saveSite() {
    if (!siteDraft.name.trim()) { setSiteError("Site name is required"); return }
    setSiteSaving(true); setSiteError("")
    try {
      if (editingSite) {
        await api.patch(`/api/sites/${editingSite.id}`, siteDraft)
      } else {
        await api.post("/api/sites", siteDraft)
      }
      await loadSites(); closeSitePanel()
      toast.success(editingSite ? "Site updated" : "Site added")
    } catch { setSiteError("Network error") }
    setSiteSaving(false)
  }

  async function deleteSite() {
    if (!deleteId) return
    try {
      await api.delete(`/api/sites/${deleteId}`)
      setDeleteId(null)
      await loadSites()
      toast.success("Site deleted")
    } catch {
      toast.error("Failed to delete site")
      setDeleteId(null)
    }
  }

  // ── Welfare CRUD ─────────────────────────────────────────────────────────────

  async function openWelfare(site: Site) {
    setWelfareSite(site); setWelfareLoading(true)
    const d = await api.get<{ items: WelfareItem[] }>(`/api/sites/${site.id}/welfare`)
    setWelfareItems(d.items ?? []); setWelfareLoading(false)
  }
  function closeWelfare() { setWelfareSite(null); setWelfareItems([]) }

  async function refreshWelfare(siteId: string) {
    const d = await api.get<{ items: WelfareItem[] }>(`/api/sites/${siteId}/welfare`)
    setWelfareItems(d.items ?? [])
  }

  function openAddItem(quickName?: string) {
    setEditingItem(null); setItemDraft({ ...BLANK_ITEM, name: quickName ?? "" })
    setItemError(""); setPendingImage(null); setImagePreview(null); setItemPanel(true)
  }
  function openEditItem(item: WelfareItem) {
    setEditingItem(item); setItemDraft({ ...item })
    setItemError(""); setPendingImage(null); setImagePreview(null); setItemPanel(true)
  }
  function closeItemPanel() {
    setItemPanel(false); setEditingItem(null); setItemError("")
    setPendingImage(null); setImagePreview(null)
  }
  function setIF(f: keyof WelfareItem, v: string | number) { setItemDraft((d) => ({ ...d, [f]: v })) }

  function handleImagePick(file: File) {
    setPendingImage(file)
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function saveItem() {
    if (!itemDraft.name.trim()) { setItemError("Item name is required"); return }
    if (!welfareSite) return
    setItemSaving(true); setItemError("")
    try {
      let savedId = editingItem?.id
      if (editingItem) {
        await api.patch(`/api/sites/${welfareSite.id}/welfare/${editingItem.id}`, itemDraft)
      } else {
        const d = await api.post<{ item?: WelfareItem }>(`/api/sites/${welfareSite.id}/welfare`, itemDraft)
        savedId = d.item?.id
      }
      // Upload image if one was picked
      if (pendingImage && savedId) {
        await api.post(`/api/sites/${welfareSite.id}/welfare/${savedId}/image`, pendingImage)
      }
      await refreshWelfare(welfareSite.id); closeItemPanel()
      toast.success(editingItem ? "Item updated" : "Item added")
    } catch { setItemError("Network error") }
    setItemSaving(false)
  }

  async function removeItemImage(item: WelfareItem) {
    if (!welfareSite) return
    await api.delete(`/api/sites/${welfareSite.id}/welfare/${item.id}/image`)
    await refreshWelfare(welfareSite.id)
    toast.success("Image removed")
  }

  async function confirmDeleteItem() {
    if (!deleteItemId || !welfareSite) return
    try {
      await api.delete(`/api/sites/${welfareSite.id}/welfare/${deleteItemId}`)
      setDeleteItemId(null)
      await refreshWelfare(welfareSite.id)
      toast.success("Item removed")
    } catch {
      toast.error("Failed to remove item")
      setDeleteItemId(null)
    }
  }

  // ── Documents CRUD ───────────────────────────────────────────────────────────

  async function openDocsPanel(site: Site) {
    setDocsSite(site); setDocsLoading(true); setDocError("")
    setUploadDocFiles([]); setUploadDocCategory("documentation")
    try {
      const d = await api.get<{ items: SiteDoc[] }>(`/api/sites/${site.id}/documents`)
      setDocs(d.items ?? [])
    } finally {
      setDocsLoading(false)
    }
  }
  function closeDocsPanel() { setDocsSite(null); setDocs([]); setUploadDocFiles([]); setDocError("") }

  async function handleUploadDocs() {
    if (!uploadDocFiles.length || !docsSite) return
    setUploadingDoc(true); setDocError("")
    setUploadProgress({ done: 0, total: uploadDocFiles.length })
    const uploaded: SiteDoc[] = []
    let failed = 0
    try {
      for (let i = 0; i < uploadDocFiles.length; i++) {
        const file = uploadDocFiles[i]
        try {
          const res = await fetch(`/api/sites/${docsSite.id}/documents`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "X-Filename": encodeURIComponent(file.name),
              "X-Doc-Category": uploadDocCategory,
            },
            body: file,
          })
          const d = await res.json()
          if (d.ok) uploaded.push(d.doc); else failed++
        } catch {
          failed++
        }
        setUploadProgress({ done: i + 1, total: uploadDocFiles.length })
      }
      if (uploaded.length) setDocs(prev => [...prev, ...uploaded])
      if (failed > 0) {
        setDocError(`${uploaded.length} of ${uploadDocFiles.length} file(s) uploaded — ${failed} failed.`)
      } else {
        toast.success(uploaded.length > 1 ? `${uploaded.length} files uploaded` : "File uploaded")
      }
      setUploadDocFiles([])
    } finally {
      setUploadingDoc(false)
      setUploadProgress(null)
    }
  }

  async function handleDeleteDoc(filename: string) {
    if (!docsSite) return
    try {
      await api.delete(`/api/sites/${docsSite.id}/documents/${filename}`)
      setDocs(prev => prev.filter(d => d.filename !== filename))
      toast.success("Document removed")
    } catch {
      toast.error("Failed to delete document")
    }
  }

  // ── Staff CRUD ───────────────────────────────────────────────────────────────

  async function openStaffPanel(site: Site) {
    setStaffSite(site); setStaffLoading(true); setStaffSearch("")
    const [assignedData, allData] = await Promise.all([
      api.get<{ staff: AssignedStaff[] }>(`/api/sites/${site.id}/staff`),
      api.get<AllStaff[]>("/api/staff"),
    ])
    setAssignedStaff(assignedData.staff ?? [])
    setAllStaff(Array.isArray(allData) ? allData : [])
    setStaffLoading(false)
  }

  function closeStaffPanel() { setStaffSite(null); setAssignedStaff([]); setAllStaff([]) }

  async function refreshSiteStaff(siteId: string) {
    const d = await api.get<{ staff: AssignedStaff[] }>(`/api/sites/${siteId}/staff`)
    setAssignedStaff(d.staff ?? [])
    await loadSites()
  }

  async function assignStaff(staffId: string) {
    if (!staffSite) return
    try {
      await api.post(`/api/sites/${staffSite.id}/staff`, { staff_id: staffId })
      await refreshSiteStaff(staffSite.id)
      toast.success("Staff assigned to site")
    } catch {
      toast.error("Failed to assign staff")
    }
  }

  async function confirmRemoveStaff() {
    if (!deleteStaffId || !staffSite) return
    try {
      await api.delete(`/api/sites/${staffSite.id}/staff/${deleteStaffId}`)
      setDeleteStaffId(null)
      await refreshSiteStaff(staffSite.id)
      toast.success("Staff removed from site")
    } catch {
      toast.error("Failed to remove staff")
      setDeleteStaffId(null)
    }
  }

  const assignedIds = useMemo(
    () => new Set(assignedStaff.map((s) => s.id)),
    [assignedStaff]
  )
  const unassigned = useMemo(
    () => allStaff.filter(
      (s) => !assignedIds.has(s.id) &&
        (!staffSearch || s.name.toLowerCase().includes(staffSearch.toLowerCase()))
    ),
    [allStaff, assignedIds, staffSearch]
  )

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filtered   = sites.filter((s) =>
    filter === "active" ? s.status !== "inactive" :
    filter === "inactive" ? s.status === "inactive" : true
  )
  const activeCt   = sites.filter((s) => s.status !== "inactive").length
  const inactiveCt = sites.filter((s) => s.status === "inactive").length

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Sites</h2>
          <p className="text-sm text-muted-foreground">{activeCt} active · {inactiveCt} inactive</p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Add site
        </Button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "active", "inactive"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}>
            {f === "all" ? `All (${sites.length})` : f === "active" ? `Active (${activeCt})` : `Inactive (${inactiveCt})`}
          </button>
        ))}
      </div>

      {/* Sites grid */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <MapPin className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No sites yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Click "Add site" to add your first site.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((site, i) => {
            const t            = typeInfo(site.type)
            const TypeIcon     = t.icon
            const welfareCount = site.welfare_items?.length ?? 0
            const staffCount   = site.assigned_staff?.length ?? 0
            return (
              <div key={site.id}
                className={`surface surface-hover animate-fade-in-up flex flex-col gap-3 p-4 ${site.status === "inactive" ? "opacity-60" : ""}`}
                style={{ animationDelay: `${i * 40}ms` }}>

                {/* Name + type badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <p className="truncate text-sm font-semibold">{site.name}</p>
                    </div>
                    {site.client_name && (
                      <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{site.client_name}</p>
                    )}
                    {site.client_phone && (
                      <a href={`tel:${site.client_phone}`}
                        className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}>
                        <Phone className="h-2.5 w-2.5" />{site.client_phone}
                      </a>
                    )}
                    {site.client_email && (
                      <a href={`mailto:${site.client_email}`}
                        className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}>
                        <Mail className="h-2.5 w-2.5" />{site.client_email}
                      </a>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${t.color}`}>
                    {t.label}
                  </span>
                </div>

                {/* Location */}
                {site.address ? (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-2">{site.address}</span>
                  </div>
                ) : (
                  <p className="text-xs italic text-muted-foreground/50">No location set</p>
                )}

                <div className="border-t" />

                {/* Supervisor */}
                {site.supervisor_name ? (
                  <div className="flex items-start gap-2">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${AV_COLORS[i % AV_COLORS.length]}`}>
                      {initials(site.supervisor_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{site.supervisor_name}</p>
                      <p className="text-[10px] text-muted-foreground">Supervisor</p>
                      {site.supervisor_phone && (
                        <a href={`tel:${site.supervisor_phone}`}
                          className="mt-0.5 flex items-center gap-1 text-[10px] text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}>
                          <Phone className="h-2.5 w-2.5" />{site.supervisor_phone}
                        </a>
                      )}
                      {site.supervisor_email && (
                        <a href={`mailto:${site.supervisor_email}`}
                          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}>
                          <Mail className="h-2.5 w-2.5" />{site.supervisor_email}
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs italic text-muted-foreground/50">No supervisor assigned</p>
                )}

                {/* Staff on site button */}
                <button onClick={() => openStaffPanel(site)}
                  className="flex w-full items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs font-medium hover:bg-muted transition-colors">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    Staff on site
                    {staffCount > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {staffCount}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                {/* Welfare & assets button */}
                <button onClick={() => openWelfare(site)}
                  className="flex w-full items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs font-medium hover:bg-muted transition-colors">
                  <span className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    Welfare &amp; assets
                    {welfareCount > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {welfareCount}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                {/* Site documents button */}
                <button onClick={() => openDocsPanel(site)}
                  className="flex w-full items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs font-medium hover:bg-muted transition-colors">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    Site documentation
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>

                {/* Edit / Delete */}
                <div className="flex justify-end gap-1.5 pt-0.5">
                  <button onClick={() => openEdit(site)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Edit site">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeleteId(site.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Delete site">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SITE ADD / EDIT PANEL
      ═════════════════════════════════════════════════════════════════════════ */}
      {sitePanel && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">{editingSite ? "Edit site" : "Add new site"}</h3>
            <button onClick={closeSitePanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {siteError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{siteError}</p>}

              <div className="space-y-1.5">
                <Label>Site name *</Label>
                <Input value={siteDraft.name} onChange={(e) => setSF("name", e.target.value)}
                  placeholder="e.g. Westfield Construction Site A" />
              </div>

              <div className="space-y-1.5">
                <Label>Site type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {SITE_TYPES.map((t) => {
                    const Icon = t.icon
                    return (
                      <button key={t.value} type="button" onClick={() => setSF("type", t.value)}
                        className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                          siteDraft.type === t.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                        }`}>
                        <Icon className="h-4 w-4" />{t.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Client name</Label>
                <Input value={siteDraft.client_name} onChange={(e) => setSF("client_name", e.target.value)}
                  placeholder="e.g. ABC Builders Ltd" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Client phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={siteDraft.client_phone} onChange={(e) => setSF("client_phone", e.target.value)}
                      placeholder="07700 900000" className="pl-8" type="tel" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Client email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={siteDraft.client_email} onChange={(e) => setSF("client_email", e.target.value)}
                      placeholder="client@company.co.uk" className="pl-8" type="email" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Location / Address</Label>
                <Input value={siteDraft.address} onChange={(e) => setSF("address", e.target.value)}
                  placeholder="e.g. 123 High Street, London E1 6RF" />
              </div>

              <div className="space-y-1.5">
                <Label>Supervisor name</Label>
                <Input value={siteDraft.supervisor_name} onChange={(e) => setSF("supervisor_name", e.target.value)}
                  placeholder="e.g. James Hughes" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Supervisor phone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={siteDraft.supervisor_phone} onChange={(e) => setSF("supervisor_phone", e.target.value)}
                      placeholder="07700 900123" className="pl-8" type="tel" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Supervisor email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={siteDraft.supervisor_email} onChange={(e) => setSF("supervisor_email", e.target.value)}
                      placeholder="james@guardtec.co.uk" className="pl-8" type="email" />
                  </div>
                </div>
              </div>

              {/* Status — FIXED: inactive = red, active = green */}
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSF("status", "active")}
                    className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                      siteDraft.status === "active"
                        ? "border-success bg-success/10 text-success"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}>
                    Active
                  </button>
                  <button type="button" onClick={() => setSF("status", "inactive")}
                    className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                      siteDraft.status === "inactive"
                        ? "border-destructive bg-destructive/10 text-destructive"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}>
                    Inactive
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <textarea value={siteDraft.notes} onChange={(e) => setSF("notes", e.target.value)}
                  placeholder="Any additional info about this site…" rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
              </div>
          </div>

          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-5 py-4">
            <Button variant="outline" className="flex-1" onClick={closeSitePanel}>Cancel</Button>
            <Button className="flex-1" onClick={saveSite} disabled={siteSaving}>
              {siteSaving ? "Saving…" : editingSite ? "Save changes" : "Add site"}
            </Button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          STAFF ON SITE PANEL
      ═════════════════════════════════════════════════════════════════════════ */}
      {staffSite && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Staff on site</h3>
                <p className="text-xs text-muted-foreground">{staffSite.name} · {assignedStaff.length} assigned</p>
              </div>
              <button onClick={closeStaffPanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {staffLoading ? (
                <p className="text-sm text-muted-foreground">Loading staff…</p>
              ) : (
                <>
                  {/* Assigned staff list */}
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Assigned staff ({assignedStaff.length})
                    </p>
                    {assignedStaff.length === 0 ? (
                      <div className="rounded-xl border border-dashed p-6 text-center">
                        <Users className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No staff assigned yet.</p>
                        <p className="text-xs text-muted-foreground">Search below to assign staff to this site.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {assignedStaff.map((s) => (
                          <div key={s.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${OVERALL_DOT[s.overall] ?? OVERALL_DOT.grey}`} />
                            <p className="flex-1 text-sm font-medium">{s.name}</p>
                            <button onClick={() => setDeleteStaffId(s.id)}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Search to add staff */}
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Add staff from roster
                    </p>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)}
                        placeholder="Search by name…" className="pl-8" />
                    </div>
                    {unassigned.length === 0 ? (
                      <p className="text-center text-xs text-muted-foreground py-4">
                        {staffSearch ? "No matching staff found" : "All staff already assigned to this site"}
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto">
                        {unassigned.slice(0, 30).map((s) => (
                          <div key={s.id}
                            className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 hover:bg-muted/40 transition-colors">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${OVERALL_DOT[s.overall] ?? OVERALL_DOT.grey}`} />
                            <p className="flex-1 text-sm">{s.name}</p>
                            <button onClick={() => assignStaff(s.id)}
                              className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                              + Assign
                            </button>
                          </div>
                        ))}
                        {unassigned.length > 30 && (
                          <p className="text-center text-xs text-muted-foreground pt-1">
                            Showing 30 of {unassigned.length} — type to filter
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          WELFARE & ASSETS PANEL
      ═════════════════════════════════════════════════════════════════════════ */}
      {welfareSite && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Welfare &amp; assets</h3>
                <p className="text-xs text-muted-foreground">{welfareSite.name}</p>
              </div>
              <button onClick={closeWelfare} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Quick add */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Quick add</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_ITEMS.map((q) => (
                    <button key={q.name} onClick={() => openAddItem(q.name)}
                      className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      <q.icon className="h-3 w-3" />{q.name}
                    </button>
                  ))}
                  <button onClick={() => openAddItem()}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                    <Plus className="h-3 w-3" /> Custom item
                  </button>
                </div>
              </div>

              {/* Items list */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Items on site ({welfareItems.length})
                </p>
                {welfareLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : welfareItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <Package className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No items recorded yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {welfareItems.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-3">
                        {/* Thumbnail */}
                        {item.image_ext ? (
                          <button
                            onClick={() => setViewImageUrl(`/api/sites/${welfareSite!.id}/welfare/${item.id}/image`)}
                            className="shrink-0 h-14 w-14 rounded-md overflow-hidden border hover:opacity-80 transition-opacity"
                          >
                            <img
                              src={`/api/sites/${welfareSite!.id}/welfare/${item.id}/image`}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="shrink-0 h-14 w-14 rounded-md border border-dashed bg-muted/40 flex items-center justify-center">
                            <Package className="h-5 w-5 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{item.name}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${CONDITION_COLORS[item.condition]}`}>
                              {item.condition}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span>Qty: <strong className="text-foreground">{item.quantity}</strong></span>
                            {item.serial_number && <span>S/N: {item.serial_number}</span>}
                            {item.notes && <span className="truncate">{item.notes}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button onClick={() => openEditItem(item)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setDeleteItemId(item.id)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SITE DOCUMENTATION PANEL
      ═════════════════════════════════════════════════════════════════════════ */}
      {docsSite && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Site documentation</h3>
                <p className="text-xs text-muted-foreground">{docsSite.name}</p>
              </div>
              <button onClick={closeDocsPanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-6">

              {/* Upload section */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Upload</p>
                <div className="space-y-3">
                  <div>
                    <Label className="mb-1 block text-xs font-medium text-muted-foreground">Category</Label>
                    <select value={uploadDocCategory} onChange={(e) => setUploadDocCategory(e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                      {Object.entries(DOC_CATEGORY_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs transition-colors hover:bg-muted/40">
                      <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">Choose file(s)</span>
                      <input type="file" multiple className="hidden" accept=".pdf,.ppt,.pptx,.doc,.docx"
                        onChange={(e) => { setUploadDocFiles(Array.from(e.target.files ?? [])); setDocError("") }} />
                    </label>
                    <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs transition-colors hover:bg-muted/40">
                      <FolderUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">Choose folder</span>
                      <input type="file" multiple className="hidden"
                        {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
                        onChange={(e) => { setUploadDocFiles(Array.from(e.target.files ?? [])); setDocError("") }} />
                    </label>
                  </div>

                  {uploadDocFiles.length > 0 && (
                    <div className="rounded-md border bg-muted/20 px-3 py-2">
                      <p className="text-xs font-medium">
                        {uploadDocFiles.length} file{uploadDocFiles.length !== 1 ? "s" : ""} selected
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {uploadDocFiles.slice(0, 3).map(f => f.name).join(", ")}
                        {uploadDocFiles.length > 3 ? `, +${uploadDocFiles.length - 3} more` : ""}
                      </p>
                    </div>
                  )}

                  {docError && <p className="text-xs text-destructive">{docError}</p>}

                  <Button onClick={handleUploadDocs} disabled={!uploadDocFiles.length || uploadingDoc} className="w-full gap-2">
                    {uploadingDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploadingDoc
                      ? `Uploading ${uploadProgress?.done ?? 0} of ${uploadProgress?.total ?? uploadDocFiles.length}…`
                      : uploadDocFiles.length > 1 ? `Upload ${uploadDocFiles.length} files` : "Upload file"}
                  </Button>
                </div>
              </div>

              {/* Stored docs list */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Stored files {!docsLoading && `(${docs.length})`}
                </p>
                {docsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : docs.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">Site documentation, presentations, induction packs — upload above.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {docs.map((doc) => (
                      <div key={doc.filename} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{doc.originalName}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {DOC_CATEGORY_LABELS[doc.category] ?? doc.category}
                            {" · "}{formatBytes(doc.size)}
                            {" · "}{new Date(doc.uploadedAt).toLocaleDateString("en-GB")}
                          </div>
                        </div>
                        <a href={`/api/sites/${docsSite.id}/documents/${doc.filename}`}
                          target="_blank" rel="noopener noreferrer"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="View">
                          <Eye className="h-3.5 w-3.5" />
                        </a>
                        <button onClick={() => handleDeleteDoc(doc.filename)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Delete">
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

      {/* ════════════════════════════════════════════════════════════════════════
          ADD / EDIT ITEM PANEL
      ═════════════════════════════════════════════════════════════════════════ */}
      {itemPanel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">{editingItem ? "Edit item" : "Add item"}</h3>
            <button onClick={closeItemPanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {itemError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{itemError}</p>}
              <div className="space-y-1.5">
                <Label>Item name *</Label>
                <Input value={itemDraft.name} onChange={(e) => setIF("name", e.target.value)}
                  placeholder="e.g. Microwave, Laptop, Chair…" />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input type="number" min={1} value={itemDraft.quantity}
                  onChange={(e) => setIF("quantity", parseInt(e.target.value) || 1)} />
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <div className="flex gap-2">
                  {(["good", "fair", "poor"] as const).map((c) => (
                    <button key={c} type="button" onClick={() => setIF("condition", c)}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-colors ${
                        itemDraft.condition === c
                          ? c === "good" ? "border-success bg-success/10 text-success"
                            : c === "fair" ? "border-warning bg-warning/10 text-warning"
                            : "border-destructive bg-destructive/10 text-destructive"
                          : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Serial number <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input value={itemDraft.serial_number} onChange={(e) => setIF("serial_number", e.target.value)}
                  placeholder="e.g. SN123456" />
              </div>
              <div className="space-y-1.5">
                <Label>Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <textarea value={itemDraft.notes} onChange={(e) => setIF("notes", e.target.value)}
                  placeholder="Any extra details…" rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
              </div>

              {/* Image upload */}
              <div className="space-y-1.5">
                <Label>Photo <span className="font-normal text-muted-foreground">(optional)</span></Label>
                {/* Show existing saved image when editing */}
                {editingItem?.image_ext && !imagePreview && (
                  <div className="relative w-full rounded-lg overflow-hidden border">
                    <img
                      src={`/api/sites/${welfareSite!.id}/welfare/${editingItem.id}/image`}
                      alt={editingItem.name}
                      className="w-full max-h-48 object-contain bg-muted/30"
                    />
                    <button
                      type="button"
                      onClick={() => removeItemImage(editingItem)}
                      className="absolute top-2 right-2 rounded-full bg-destructive/90 p-1 text-white hover:bg-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {/* Preview of newly picked image */}
                {imagePreview && (
                  <div className="relative w-full rounded-lg overflow-hidden border">
                    <img src={imagePreview} alt="Preview" className="w-full max-h-48 object-contain bg-muted/30" />
                    <button
                      type="button"
                      onClick={() => { setPendingImage(null); setImagePreview(null) }}
                      className="absolute top-2 right-2 rounded-full bg-destructive/90 p-1 text-white hover:bg-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {!imagePreview && (
                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-center hover:border-primary hover:bg-primary/5 transition-colors">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Click to upload a photo of this item<br />
                      <span className="text-[10px]">JPG or PNG</span>
                    </span>
                    <input
                      type="file" accept="image/jpeg,image/png" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImagePick(f) }}
                    />
                  </label>
                )}
              </div>
          </div>
          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-5 py-4">
            <Button variant="outline" className="flex-1" onClick={closeItemPanel}>Cancel</Button>
            <Button className="flex-1" onClick={saveItem} disabled={itemSaving}>
              {itemSaving ? "Saving…" : editingItem ? "Save changes" : "Add item"}
            </Button>
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {viewImageUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          onClick={() => setViewImageUrl(null)}
        >
          <button
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
            onClick={() => setViewImageUrl(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={viewImageUrl}
            alt="Item photo"
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Delete site ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Delete site?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sites.find((s) => s.id === deleteId)?.name ?? "This site"} will be permanently removed including all welfare records.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={deleteSite}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove staff from site ── */}
      {deleteStaffId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Users className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Remove from site?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {assignedStaff.find((s) => s.id === deleteStaffId)?.name ?? "This staff member"} will be removed from {staffSite?.name}.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteStaffId(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={confirmRemoveStaff}>Remove</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete welfare item ── */}
      {deleteItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Remove item?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {welfareItems.find((i) => i.id === deleteItemId)?.name ?? "This item"} will be removed from the welfare list.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteItemId(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={confirmDeleteItem}>Remove</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
