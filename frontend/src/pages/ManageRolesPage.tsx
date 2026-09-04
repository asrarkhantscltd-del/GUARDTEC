import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  Plus, Pencil, Trash2, X, Users, Truck, MapPin,
  ShieldCheck, ClipboardCheck, Lock, UserCog, UserX, CalendarDays,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Role {
  slug: string
  name: string
  is_system: boolean
  permissions: Record<string, boolean>
}

const MODULES = [
  { key: "staff",               label: "Staff",               icon: Users },
  { key: "fleet",                label: "Fleet",                icon: Truck },
  { key: "sites",                label: "Sites",                icon: MapPin },
  { key: "compliance",           label: "Compliance",           icon: ShieldCheck },
  { key: "compliance_calendar",  label: "Compliance Calendar",  icon: CalendarDays },
  { key: "pending_review",       label: "Pending Review",       icon: ClipboardCheck },
  { key: "edit_staff",           label: "Edit Staff",           icon: UserCog },
  { key: "delete_staff",         label: "Ex-Staff",             icon: UserX },
] as const

const BLANK_PERMISSIONS = { staff: false, fleet: false, sites: false, compliance: false, compliance_calendar: false, pending_review: false, edit_staff: false, delete_staff: false }

export default function ManageRolesPage() {
  const [roles, setRoles]     = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState("")

  const [panel, setPanel]           = useState(false)
  const [editing, setEditing]       = useState<Role | null>(null)
  const [name, setName]             = useState("")
  const [permissions, setPermissions] = useState<Record<string, boolean>>(BLANK_PERMISSIONS)
  const [saving, setSaving]         = useState(false)
  const [panelError, setPanelError] = useState("")

  const [deleteRole, setDeleteRole] = useState<Role | null>(null)
  const [deleting, setDeleting]     = useState(false)
  const [deleteError, setDeleteError] = useState("")

  async function load() {
    setLoading(true)
    try {
      const d = await api.get<{ roles: Role[] }>("/api/roles")
      setRoles((d.roles ?? []).filter((role: Role) => role.slug !== "staff"))
    } catch {
      setError("Failed to load roles.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openAdd() {
    setEditing(null); setName(""); setPermissions(BLANK_PERMISSIONS); setPanelError(""); setPanel(true)
  }
  function openEdit(role: Role) {
    setEditing(role); setName(role.name)
    setPermissions({ ...BLANK_PERMISSIONS, ...role.permissions })
    setPanelError(""); setPanel(true)
  }
  function closePanel() { setPanel(false); setEditing(null); setPanelError("") }
  function toggle(key: string) { setPermissions(p => ({ ...p, [key]: !p[key] })) }

  const isLocked = editing?.slug === "director"

  async function save() {
    if (!name.trim()) { setPanelError("Role name is required."); return }
    setSaving(true); setPanelError("")
    try {
      const body = { name: name.trim(), permissions }
      if (editing) await api.patch(`/api/roles/${editing.slug}`, body)
      else await api.post("/api/roles", body)
      toast.success(editing ? "Role updated" : "Role created")
      await load(); closePanel()
    } catch {
      setPanelError("Network error.")
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteRole) return
    setDeleting(true); setDeleteError("")
    try {
      await api.delete(`/api/roles/${deleteRole.slug}`)
      toast.success("Role deleted")
      setDeleteRole(null); await load()
    } catch {
      setDeleteError("Network error.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Manage Roles</h2>
          <p className="text-sm text-muted-foreground">
            Decide which pages each role can see — {roles.length} roles
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Add role
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        Team Access &amp; Manage Roles always stay Director-only — no role can be given the power to manage other accounts or roles.
      </p>

      {error && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</th>
                {MODULES.map((m) => (
                  <th key={m.key} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <div className="flex flex-col items-center gap-1">
                      <m.icon className="h-3.5 w-3.5" />
                      {m.label}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roles.map((role) => (
                <tr key={role.slug} className="transition-colors hover:bg-muted/20">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{role.name}</p>
                      {role.is_system && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">System</span>
                      )}
                    </div>
                  </td>
                  {MODULES.map((m) => (
                    <td key={m.key} className="px-3 py-3 text-center">
                      {role.slug === "director" || role.permissions?.[m.key] ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground/40">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(role)} title="Edit role"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!role.is_system && (
                        <button onClick={() => { setDeleteRole(role); setDeleteError("") }} title="Delete role"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add / Edit panel ── */}
      {panel && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h3 className="text-base font-semibold">{editing ? "Edit role" : "Add new role"}</h3>
            <button onClick={closePanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {panelError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{panelError}</p>}

              {isLocked && (
                <p className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" /> Director always has full access to every module — this can't be changed.
                </p>
              )}

              <div className="space-y-1.5">
                <Label>Role name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Regional Manager" disabled={isLocked} />
                {editing && (
                  <p className="text-xs text-muted-foreground">
                    Internal ID: <span className="font-mono">{editing.slug}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Which pages can this role see?</Label>
                <div className="space-y-2">
                  {MODULES.map((m) => (
                    <label key={m.key}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                        isLocked ? "opacity-50" : "cursor-pointer hover:bg-muted/40"
                      } ${permissions[m.key] ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                      <input type="checkbox" checked={isLocked || !!permissions[m.key]}
                        disabled={isLocked}
                        onChange={() => toggle(m.key)}
                        className="h-4 w-4 rounded border-input accent-primary" />
                      <m.icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>
          </div>

          <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-5 py-4">
            <Button variant="outline" className="flex-1" onClick={closePanel}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving || isLocked}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create role"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Delete "{deleteRole.name}"?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This role will be permanently removed. If anyone currently has this role, reassign them in Team Access first.
                </p>
              </div>
            </div>
            {deleteError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{deleteError}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteRole(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" disabled={deleting} onClick={confirmDelete}>
                {deleting ? "Deleting…" : "Delete role"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
