import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api"
import { initials, AV_COLORS } from "@/lib/utils"
import {
  MapPin, Plus, Pencil, Trash2, X, Phone, Mail, Package, ChevronRight, Users, FileText,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePermissions } from "@/hooks/usePermissions"
import { type Site, BLANK_SITE, SITE_TYPES, typeInfo } from "./sites/shared"
import { useSiteDocs } from "./sites/useSiteDocs"
import SiteDocsPanel from "./sites/SiteDocsPanel"
import { useSiteStaff } from "./sites/useSiteStaff"
import SiteStaffPanel from "./sites/SiteStaffPanel"
import { useSiteWelfare } from "./sites/useSiteWelfare"
import SiteWelfarePanel from "./sites/SiteWelfarePanel"

// ── Component ─────────────────────────────────────────────────────────────────

export default function SitesPage() {
  const { can } = usePermissions()
  const canDelete = can("delete_sites")
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
  const [deleteSiteError, setDeleteSiteError] = useState("")
  const [deleteSiteBusy, setDeleteSiteBusy] = useState(false)

  const siteWelfare = useSiteWelfare()
  const { openWelfare } = siteWelfare

  const siteDocs = useSiteDocs()
  const { openDocsPanel } = siteDocs

  const siteStaff = useSiteStaff({ loadSites })
  const { openStaffPanel } = siteStaff

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
    setDeleteSiteBusy(true); setDeleteSiteError("")
    try {
      await api.delete(`/api/sites/${deleteId}`)
      setDeleteId(null)
      await loadSites()
      toast.success("Site deleted")
    } catch (err) {
      // Kept open (not toasted-and-closed) so the specific reason — e.g.
      // "2 deployment(s) and 1 event instruction(s) still reference it" —
      // stays visible next to the Delete button instead of flashing by.
      setDeleteSiteError(err instanceof ApiError ? err.message : "Failed to delete site — network error.")
    } finally {
      setDeleteSiteBusy(false)
    }
  }




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
                  {canDelete && (
                    <button onClick={() => { setDeleteId(site.id); setDeleteSiteError("") }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Delete site">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
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

      <SiteStaffPanel siteStaff={siteStaff} canDelete={canDelete} />

      <SiteWelfarePanel siteWelfare={siteWelfare} canDelete={canDelete} />

      <SiteDocsPanel siteDocs={siteDocs} canDelete={canDelete} />


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
            {deleteSiteError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
                {deleteSiteError}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setDeleteId(null); setDeleteSiteError("") }}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={deleteSite} disabled={deleteSiteBusy}>
                {deleteSiteBusy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}


    </div>
  )
}
