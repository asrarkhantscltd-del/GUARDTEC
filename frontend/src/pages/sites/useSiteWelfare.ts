import { useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { type WelfareItem, type Site, BLANK_ITEM } from "./shared"

export function useSiteWelfare() {
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

  return {
    welfareSite,
    setWelfareSite,
    welfareItems,
    setWelfareItems,
    welfareLoading,
    setWelfareLoading,
    itemPanel,
    setItemPanel,
    editingItem,
    setEditingItem,
    itemDraft,
    setItemDraft,
    itemSaving,
    setItemSaving,
    itemError,
    setItemError,
    deleteItemId,
    setDeleteItemId,
    pendingImage,
    setPendingImage,
    imagePreview,
    setImagePreview,
    viewImageUrl,
    setViewImageUrl,
    openWelfare,
    closeWelfare,
    refreshWelfare,
    openAddItem,
    openEditItem,
    closeItemPanel,
    setIF,
    handleImagePick,
    saveItem,
    removeItemImage,
    confirmDeleteItem }
}
