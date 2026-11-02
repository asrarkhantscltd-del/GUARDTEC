import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Plus, Pencil, Trash2, X, Search, ShoppingCart, Clock, CheckCircle2, PackageCheck,
  PoundSterling, ArrowUpRight, Paperclip, Upload, XCircle, ChevronRight, Loader2, RotateCcw,
} from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import { fmtDate } from "@/lib/utils"
import { fmtMoney, uploadFile, openBlobInNewTab, UPLOAD_ACCEPT } from "@/lib/procurement"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type PoStatus = "requested" | "approved" | "ordered" | "received" | "paid" | "rejected"

interface LineItem { item: string; qty: number; unit_price: number; line_total?: number }
interface PurchaseOrder {
  id: string
  po_number: string
  request_date: string
  requested_by: string
  supplier_id: string | null
  supplier_name: string
  supplier_status?: string | null
  description: string
  items: LineItem[]
  total: string | number
  status: PoStatus
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string
  notes: string
  attachment_name: string | null
  created_at: string
}
interface SupplierOption { id: string; name: string; status: string }

const STATUS_META: Record<PoStatus, { label: string; cls: string }> = {
  requested: { label: "Requested", cls: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  approved:  { label: "Approved",  cls: "bg-success/15 text-success border-success/30" },
  ordered:   { label: "Ordered",   cls: "bg-violet-500/15 text-violet-500 border-violet-500/30" },
  received:  { label: "Received",  cls: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30" },
  paid:      { label: "Paid",      cls: "bg-muted text-foreground border-border" },
  rejected:  { label: "Rejected",  cls: "bg-destructive/15 text-destructive border-destructive/30" },
}
const NEXT_ACTION: Partial<Record<PoStatus, string>> = {
  approved: "Mark ordered", ordered: "Mark received", received: "Mark paid", rejected: "Resubmit",
}
const STEPS: PoStatus[] = ["requested", "approved", "ordered", "received", "paid"]

type Filter = "all" | "pending" | "open" | "paid" | "rejected"

function StatusPill({ status }: { status: PoStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.requested
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
}

function StatCard({ icon, label, value, colorClass, strip, onClick, active }: {
  icon: React.ReactNode; label: string; value: string | number; colorClass: string; strip: string; onClick?: () => void; active?: boolean
}) {
  return (
    <div onClick={onClick} className={`surface relative overflow-hidden p-4 pl-5 ${onClick ? "surface-hover cursor-pointer" : ""} ${active ? "ring-2 ring-primary/40" : ""}`}>
      <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl" style={{ background: strip }} />
      <div className="mb-3 flex items-center justify-between">
        <div className={`icon-badge ${colorClass}`}>{icon}</div>
        {active
          ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colorClass}`}>Filtered</span>
          : onClick && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
      <p className="font-display text-2xl font-black tracking-tight tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

function blankDraft(name: string) {
  return {
    request_date: new Date().toISOString().slice(0, 10),
    requested_by: name,
    supplier_id: "",
    supplier_name: "",
    description: "",
    notes: "",
    items: [{ item: "", qty: 1, unit_price: 0 }] as LineItem[],
  }
}

export default function PurchaseOrdersPage() {
  const { user } = useAuth()
  const canApprove = user?.role === "director" || !!user?.permissions?.approve_purchase_orders
  const isDirector = user?.role === "director"

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  const [panel, setPanel] = useState(false)
  const [editing, setEditing] = useState<PurchaseOrder | null>(null)
  const [draft, setDraft] = useState(() => blankDraft(""))
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [panelError, setPanelError] = useState("")

  const [viewing, setViewing] = useState<PurchaseOrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const d = await api.get<{ purchase_orders: PurchaseOrder[] }>("/api/purchase-orders")
      setOrders(d.purchase_orders ?? [])
    } catch {
      toast.error("Failed to load purchase orders")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    api.get<{ suppliers: SupplierOption[] }>("/api/suppliers/options").then(d => setSuppliers(d.suppliers ?? [])).catch(() => {})
  }, [])

  const stats = useMemo(() => {
    const pending = orders.filter(o => o.status === "requested")
    const open = orders.filter(o => ["approved", "ordered", "received"].includes(o.status))
    const paid = orders.filter(o => o.status === "paid")
    const year = new Date().getFullYear()
    const spend = orders
      .filter(o => ["approved", "ordered", "received", "paid"].includes(o.status) && String(o.request_date).startsWith(String(year)))
      .reduce((a, o) => a + Number(o.total || 0), 0)
    return { pending: pending.length, open: open.length, paid: paid.length, spend, year }
  }, [orders])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter(o => {
      if (filter === "pending" && o.status !== "requested") return false
      if (filter === "open" && !["approved", "ordered", "received"].includes(o.status)) return false
      if (filter === "paid" && o.status !== "paid") return false
      if (filter === "rejected" && o.status !== "rejected") return false
      if (!q) return true
      return [o.po_number, o.supplier_name, o.description, o.requested_by, ...(o.items ?? []).map(i => i.item)]
        .some(v => String(v ?? "").toLowerCase().includes(q))
    })
  }, [orders, search, filter])

  function toggleFilter(f: Filter) { setFilter(prev => (prev === f ? "all" : f)) }

  function openAdd() {
    setEditing(null); setDraft(blankDraft(user?.full_name ?? "")); setPendingFile(null); setPanelError(""); setPanel(true)
  }
  function openEdit(o: PurchaseOrder) {
    setEditing(o)
    setDraft({
      request_date: String(o.request_date).slice(0, 10),
      requested_by: o.requested_by,
      supplier_id: o.supplier_id ?? "",
      supplier_name: o.supplier_id ? "" : o.supplier_name,
      description: o.description,
      notes: o.notes,
      items: o.items?.length ? o.items.map(i => ({ item: i.item, qty: Number(i.qty), unit_price: Number(i.unit_price) })) : [{ item: "", qty: 1, unit_price: 0 }],
    })
    setPendingFile(null); setPanelError(""); setViewing(null); setPanel(true)
  }

  function setItem(i: number, patch: Partial<LineItem>) {
    setDraft(d => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }))
  }
  const draftTotal = draft.items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0)

  async function save() {
    const items = draft.items.filter(it => it.item.trim())
    if (!draft.description.trim() && !items.length) { setPanelError("Add a description or at least one item."); return }
    setSaving(true); setPanelError("")
    try {
      const body = { ...draft, items, supplier_id: draft.supplier_id || null }
      const d = editing
        ? await api.patch<{ purchase_order: PurchaseOrder }>(`/api/purchase-orders/${editing.id}`, body)
        : await api.post<{ purchase_order: PurchaseOrder }>("/api/purchase-orders", body)
      if (pendingFile) {
        try { await uploadFile(`/api/purchase-orders/${d.purchase_order.id}/attachment`, pendingFile) }
        catch (e) { toast.error(e instanceof ApiError ? e.message : "Attachment upload failed") }
      }
      toast.success(editing ? `${d.purchase_order.po_number} updated` : `${d.purchase_order.po_number} created`)
      if (editing && editing.status !== "requested" && editing.status !== "rejected" && editing.status !== "paid") {
        toast.info("Changes sent back for re-approval")
      }
      setPanel(false); await load()
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  function replaceInList(po: PurchaseOrder) {
    setOrders(prev => prev.map(o => (o.id === po.id ? { ...o, ...po } : o)))
    setViewing(v => (v && v.id === po.id ? { ...v, ...po } : v))
  }

  async function decide(decision: "approved" | "rejected") {
    if (!viewing) return
    if (decision === "rejected" && !rejectReason.trim()) { toast.error("Give a reason for rejecting"); return }
    setBusy(true)
    try {
      const d = await api.post<{ purchase_order: PurchaseOrder }>(`/api/purchase-orders/${viewing.id}/decision`, { decision, reason: rejectReason })
      replaceInList(d.purchase_order)
      toast.success(decision === "approved" ? "Approved" : "Rejected")
      setRejecting(false); setRejectReason("")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
    } finally { setBusy(false) }
  }

  async function advance() {
    if (!viewing) return
    setBusy(true)
    try {
      const d = await api.post<{ purchase_order: PurchaseOrder }>(`/api/purchase-orders/${viewing.id}/advance`)
      replaceInList(d.purchase_order)
      toast.success(`Status: ${STATUS_META[d.purchase_order.status].label}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
    } finally { setBusy(false) }
  }

  async function uploadAttachment(file: File) {
    if (!viewing) return
    setBusy(true)
    try {
      const d = await uploadFile<{ purchase_order: PurchaseOrder }>(`/api/purchase-orders/${viewing.id}/attachment`, file)
      replaceInList(d.purchase_order)
      toast.success("Attachment uploaded")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Upload failed")
    } finally { setBusy(false) }
  }

  async function viewAttachment(o: PurchaseOrder) {
    const blob = await api.getBlob(`/api/purchase-orders/${o.id}/attachment`)
    if (!openBlobInNewTab(blob)) toast.error("Could not open attachment")
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await api.delete(`/api/purchase-orders/${deleteTarget.id}`)
      toast.success(`${deleteTarget.po_number} deleted`)
      setDeleteTarget(null); setViewing(null); await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Delete failed")
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">Purchase Order Register</h2>
          <p className="text-sm text-muted-foreground">Every purchase request, approval and order in one place — {orders.length} total</p>
        </div>
        <Button onClick={openAdd} size="sm" className="shrink-0 gap-1.5">
          <Plus className="h-4 w-4" /> New request
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Clock className="h-4 w-4" />} label="Awaiting approval" value={stats.pending}
          colorClass="bg-blue-500/15 text-blue-500" strip="#3b82f6" onClick={() => toggleFilter("pending")} active={filter === "pending"} />
        <StatCard icon={<ShoppingCart className="h-4 w-4" />} label="In progress" value={stats.open}
          colorClass="bg-violet-500/15 text-violet-500" strip="#8b5cf6" onClick={() => toggleFilter("open")} active={filter === "open"} />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Paid" value={stats.paid}
          colorClass="bg-success/15 text-success" strip="#22c55e" onClick={() => toggleFilter("paid")} active={filter === "paid"} />
        <StatCard icon={<PoundSterling className="h-4 w-4" />} label={`Committed ${stats.year}`} value={fmtMoney(stats.spend)}
          colorClass="bg-primary/15 text-primary" strip="hsl(var(--primary))" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO number, supplier, item…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "pending", "open", "paid", "rejected"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {f === "pending" ? "Awaiting approval" : f === "open" ? "In progress" : f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
      ) : filtered.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 p-10 text-center">
          <ShoppingCart className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{orders.length ? "No purchase orders match your filters." : "No purchase orders yet — raise the first request."}</p>
        </div>
      ) : (
        <div className="surface" style={{ overflowX: "auto" }}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/30">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">PO number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(o => (
                <tr key={o.id} onClick={() => { setViewing(o); setRejecting(false); setRejectReason("") }} className="cursor-pointer transition-colors hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{o.po_number}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(o.request_date)}</td>
                  <td className="px-4 py-3">{o.supplier_name || <span className="italic text-muted-foreground/60">Not set</span>}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-muted-foreground">{o.description || o.items?.map(i => i.item).join(", ")}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(o.total)}</td>
                  <td className="px-4 py-3"><StatusPill status={o.status} /></td>
                  <td className="px-2 py-3 text-muted-foreground/50"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail drawer ── */}
      {viewing && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground">{viewing.po_number}</p>
              <h3 className="truncate text-base font-semibold">{viewing.supplier_name || "Purchase request"}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {viewing.status !== "paid" && (
                <button onClick={() => openEdit(viewing)} title="Edit" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button>
              )}
              {isDirector && (
                <button onClick={() => setDeleteTarget(viewing)} title="Delete" className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              )}
              <button onClick={() => setViewing(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {/* progress */}
            {viewing.status === "rejected" ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-destructive"><XCircle className="h-4 w-4" /> Rejected by {viewing.approved_by}</p>
                {viewing.rejected_reason && <p className="mt-1 text-muted-foreground">{viewing.rejected_reason}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                {STEPS.map((s, i) => {
                  const reached = STEPS.indexOf(viewing.status) >= i
                  return (
                    <div key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div className={`h-1.5 w-full rounded-full ${reached ? "bg-primary" : "bg-muted"}`} />
                      <span className={`truncate text-[10px] font-medium uppercase tracking-wide ${reached ? "text-foreground" : "text-muted-foreground/60"}`}>{STATUS_META[s].label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Request date</p><p className="font-medium">{fmtDate(viewing.request_date)}</p></div>
              <div><p className="text-xs text-muted-foreground">Requested by</p><p className="font-medium">{viewing.requested_by || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Status</p><StatusPill status={viewing.status} /></div>
              {viewing.approved_by && viewing.status !== "rejected" && (
                <div><p className="text-xs text-muted-foreground">Approved by</p><p className="font-medium">{viewing.approved_by}{viewing.approved_at ? ` · ${fmtDate(viewing.approved_at)}` : ""}</p></div>
              )}
              {viewing.supplier_id && viewing.supplier_status && viewing.supplier_status !== "approved" && (
                <div className="col-span-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">This supplier is not currently on the approved list ({viewing.supplier_status.replace("_", " ")}).</div>
              )}
              {!viewing.supplier_id && viewing.supplier_name && (
                <div className="col-span-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">Supplier isn't in the Approved Supplier Register.</div>
              )}
            </div>

            {viewing.description && <div><p className="text-xs text-muted-foreground">Description</p><p className="whitespace-pre-wrap text-sm">{viewing.description}</p></div>}

            {viewing.items?.length > 0 && (
              <div className="rounded-lg border" style={{ overflowX: "auto" }}>
                <table className="w-full min-w-[380px] text-sm">
                  <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                    <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit</th><th className="px-3 py-2 text-right">Total</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {viewing.items.map((it, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{it.item}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(it.unit_price)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(it.line_total ?? Number(it.qty) * Number(it.unit_price))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">Total</span>
              <span className="font-display text-xl font-black tabular-nums">{fmtMoney(viewing.total)}</span>
            </div>

            {viewing.notes && <div><p className="text-xs text-muted-foreground">Notes</p><p className="whitespace-pre-wrap text-sm">{viewing.notes}</p></div>}

            <div className="flex flex-wrap items-center gap-2">
              {viewing.attachment_name ? (
                <button onClick={() => viewAttachment(viewing)} className="flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                  <Paperclip className="h-4 w-4 shrink-0" /><span className="truncate">{viewing.attachment_name}</span>
                </button>
              ) : <span className="text-xs text-muted-foreground">No quote or invoice attached</span>}
              <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.target.value = "" }} />
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />{viewing.attachment_name ? "Replace" : "Attach quote/invoice"}
              </Button>
            </div>

            {rejecting && (
              <div className="space-y-1.5">
                <Label>Reason for rejecting *</Label>
                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="e.g. Get a second quote first" />
              </div>
            )}
          </div>

          <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2 border-t px-5 py-4">
            {viewing.status === "requested" && canApprove ? (
              rejecting ? (
                <>
                  <Button variant="outline" className="flex-1" onClick={() => setRejecting(false)}>Cancel</Button>
                  <Button variant="destructive" className="flex-1" disabled={busy} onClick={() => decide("rejected")}>Confirm reject</Button>
                </>
              ) : (
                <>
                  <Button variant="outline" className="flex-1 gap-1.5" disabled={busy} onClick={() => setRejecting(true)}><XCircle className="h-4 w-4" />Reject</Button>
                  <Button className="flex-1 gap-1.5" disabled={busy} onClick={() => decide("approved")}><CheckCircle2 className="h-4 w-4" />Approve</Button>
                </>
              )
            ) : viewing.status === "requested" ? (
              <p className="flex-1 text-center text-sm text-muted-foreground">Waiting for a Director to approve.</p>
            ) : NEXT_ACTION[viewing.status] ? (
              <Button className="flex-1 gap-1.5" disabled={busy} onClick={advance}>
                {viewing.status === "rejected" ? <RotateCcw className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />}
                {NEXT_ACTION[viewing.status]}
              </Button>
            ) : (
              <p className="flex-1 text-center text-sm text-muted-foreground">Completed — paid in full.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Add / Edit panel ── */}
      {panel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">{editing ? `Edit ${editing.po_number}` : "New purchase request"}</h3>
            <button onClick={() => setPanel(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>
          <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {panelError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{panelError}</p>}
            {editing && !["requested", "rejected", "paid"].includes(editing.status) && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">Saving changes sends this order back for re-approval.</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Request date</Label>
                <Input type="date" value={draft.request_date} onChange={e => setDraft(d => ({ ...d, request_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Requested by</Label>
                <Input value={draft.requested_by} onChange={e => setDraft(d => ({ ...d, requested_by: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <select value={draft.supplier_id} onChange={e => setDraft(d => ({ ...d, supplier_id: e.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">— Not in register / other —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.status !== "approved" ? ` (${s.status.replace("_", " ")})` : ""}</option>)}
              </select>
              {!draft.supplier_id && (
                <Input value={draft.supplier_name} onChange={e => setDraft(d => ({ ...d, supplier_name: e.target.value }))} placeholder="Supplier name (if not in register)" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>What is it for?</Label>
              <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="e.g. Hi-vis jackets for new starters" />
            </div>

            <div className="space-y-2">
              <Label>Items</Label>
              {draft.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_80px_110px_auto] sm:items-center sm:border-0 sm:p-0">
                  <Input value={it.item} onChange={e => setItem(i, { item: e.target.value })} placeholder="Item" className="col-span-3 sm:col-span-1" />
                  <Input type="number" min={0} step="1" value={it.qty} onChange={e => setItem(i, { qty: Number(e.target.value) })} placeholder="Qty" aria-label="Quantity" />
                  <Input type="number" min={0} step="0.01" value={it.unit_price} onChange={e => setItem(i, { unit_price: Number(e.target.value) })} placeholder="Unit £" aria-label="Unit price" />
                  <button onClick={() => setDraft(d => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, idx) => idx !== i) : [{ item: "", qty: 1, unit_price: 0 }] }))}
                    className="justify-self-end rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove item"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDraft(d => ({ ...d, items: [...d.items, { item: "", qty: 1, unit_price: 0 }] }))}>
                  <Plus className="h-3.5 w-3.5" />Add item
                </Button>
                <p className="text-sm">Total <span className="font-display text-lg font-black tabular-nums">{fmtMoney(draftTotal)}</span></p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Quote / invoice <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <input type="file" accept={UPLOAD_ACCEPT} onChange={e => setPendingFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" />
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-5 py-4">
            <Button variant="outline" className="flex-1" onClick={() => setPanel(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Submit request"}</Button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm space-y-4 rounded-xl border bg-background p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10"><Trash2 className="h-5 w-5 text-destructive" /></div>
              <div>
                <p className="font-semibold">Permanently delete {deleteTarget.po_number}?</p>
                <p className="mt-1 text-sm text-muted-foreground">This removes the order and its attachment for good. It is recorded in the Audit Trail.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" disabled={busy} onClick={confirmDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
