import { Plus, Pencil, Trash2, X, Package, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CONDITION_COLORS, QUICK_ITEMS } from "./shared"
import type { useSiteWelfare } from "./useSiteWelfare"

export default function SiteWelfarePanel({ siteWelfare, canDelete }: {
  siteWelfare: ReturnType<typeof useSiteWelfare>
  canDelete: boolean
}) {
  const { welfareSite, welfareItems, welfareLoading, itemPanel, editingItem, itemDraft, itemSaving, itemError, deleteItemId, setDeleteItemId, setPendingImage, imagePreview, setImagePreview, viewImageUrl, setViewImageUrl, closeWelfare, openAddItem, openEditItem, closeItemPanel, setIF, handleImagePick, saveItem, removeItemImage, confirmDeleteItem } = siteWelfare
  return (
    <>
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
                        {canDelete && (
                          <button onClick={() => setDeleteItemId(item.id)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
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
    </>
  )
}
