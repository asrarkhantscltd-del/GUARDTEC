import { useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { type AssignedStaff, type AllStaff, type Site } from "./shared"

export function useSiteStaff({ loadSites }: { loadSites: () => Promise<void> }) {
  // Staff panel
  const [staffSite, setStaffSite]           = useState<Site | null>(null)
  const [assignedStaff, setAssignedStaff]   = useState<AssignedStaff[]>([])
  const [allStaff, setAllStaff]             = useState<AllStaff[]>([])
  const [staffLoading, setStaffLoading]     = useState(false)
  const [staffSearch, setStaffSearch]       = useState("")
  const [deleteStaffId, setDeleteStaffId]   = useState<string | null>(null)

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

  return {
    staffSite,
    setStaffSite,
    assignedStaff,
    setAssignedStaff,
    allStaff,
    setAllStaff,
    staffLoading,
    setStaffLoading,
    staffSearch,
    setStaffSearch,
    deleteStaffId,
    setDeleteStaffId,
    openStaffPanel,
    closeStaffPanel,
    refreshSiteStaff,
    assignStaff,
    confirmRemoveStaff,
    assignedIds,
    unassigned }
}
