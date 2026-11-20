import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { toast } from "sonner"
import { fmtDate } from "@/lib/utils"
import { api, ApiError } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Trash2, Plus, Package } from "lucide-react"

export default function ProvisionsTab({ staffId, canDelete }: { staffId: string; canDelete: boolean }) {
  const id = staffId
  // Provisions
  const [provisions, setProvisions]       = useState<{id:string;item:string;provided:boolean;date_given:string|null;date_returned:string|null;notes:string|null}[]>([])
  const [provLoading, setProvLoading]     = useState(false)
  const [provForm, setProvForm]           = useState(false)
  const [provDraft, setProvDraft]         = useState({ itemType: "Security Jacket", quantity: 1, provided: true, date_given: "", date_returned: "", notes: "" })
  const [provSaving, setProvSaving]       = useState(false)

  useEffect(() => { loadProvisions() }, [staffId])

  async function loadProvisions() {
    if (!id) return
    setProvLoading(true)
    try {
      const d = await api.get<{ ok: boolean; provisions: any[] }>(`/api/staff/${id}/provisions`)
      if (d.ok) setProvisions(d.provisions)
    } finally {
      setProvLoading(false)
    }
  }

  async function addProvision() {
    setProvSaving(true)
    try {
      const itemStr = `${provDraft.itemType} × ${provDraft.quantity}`
      const d = await api.post<{ ok: boolean; error?: string }>(`/api/staff/${id}/provisions`, { item: itemStr, provided: provDraft.provided, date_given: provDraft.date_given, date_returned: provDraft.date_returned, notes: provDraft.notes })
      if (!d.ok) { toast.error(d.error ?? "Failed to save."); return }
      setProvForm(false)
      setProvDraft({ itemType: "Security Jacket", quantity: 1, provided: true, date_given: "", date_returned: "", notes: "" })
      await loadProvisions()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save.")
    } finally {
      setProvSaving(false)
    }
  }

  async function deleteProvision(provId: string) {
    await api.delete(`/api/provisions/${provId}`)
    await loadProvisions()
  }

  return (
    <motion.div key="provisions" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" /> Uniform & Equipment
            </CardTitle>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setProvForm(p => !p)}>
              <Plus className="h-3.5 w-3.5" /> Add Item
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {provForm && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Item</Label>
                  <select value={provDraft.itemType}
                    onChange={e => setProvDraft(p => ({ ...p, itemType: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>Security Jacket</option>
                    <option>Fleece</option>
                    <option>Rain Pant</option>
                    <option>T-Shirt</option>
                    <option>Trouser</option>
                    <option>Hi-Vis Vest</option>
                    <option>ID Badge</option>
                    <option>Radio</option>
                    <option>Torch</option>
                    <option>Boots</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Quantity</Label>
                  <Input type="number" min={1} max={20} value={provDraft.quantity}
                    onChange={e => setProvDraft(p => ({ ...p, quantity: Math.max(1, parseInt(e.target.value) || 1) }))} />
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Status</Label>
                  <select value={provDraft.provided ? "yes" : "no"}
                    onChange={e => setProvDraft(p => ({ ...p, provided: e.target.value === "yes" }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="yes">Provided / Given</option>
                    <option value="no">Not Provided</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Date given</Label>
                  <Input type="date" value={provDraft.date_given}
                    onChange={e => setProvDraft(p => ({ ...p, date_given: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Date returned</Label>
                  <Input type="date" value={provDraft.date_returned}
                    onChange={e => setProvDraft(p => ({ ...p, date_returned: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input placeholder="e.g. Size L, serial number, condition"
                  value={provDraft.notes} onChange={e => setProvDraft(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setProvForm(false)}>Cancel</Button>
                <Button size="sm" disabled={provSaving} onClick={addProvision}>
                  {provSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Save
                </Button>
              </div>
            </div>
          )}
          {provLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {!provLoading && provisions.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No items recorded yet.</p>
          )}
          {provisions.map(p => (
            <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border bg-muted/10 px-3 py-2.5">
              <div className="space-y-0.5 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{p.item}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${p.provided ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                    {p.provided ? "Provided" : "Not Provided"}
                  </span>
                </div>
                {p.date_given && <p className="text-xs text-muted-foreground">Given: {fmtDate(p.date_given)}</p>}
                {p.date_returned && <p className="text-xs text-muted-foreground">Returned: {fmtDate(p.date_returned)}</p>}
                {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
              </div>
              {canDelete && (
                <button onClick={() => deleteProvision(p.id)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  )
}
