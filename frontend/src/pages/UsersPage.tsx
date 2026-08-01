import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import {
  Plus, Pencil, Trash2, X, KeyRound, ShieldCheck,
  ShieldOff, UserCog, Mail, Eye, EyeOff, User,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// ── Types ──────────────────────────────────────────────────────────────────────

interface PortalUser {
  id: string
  username: string
  full_name: string
  role: string
  email: string
  is_active: boolean
  created_at: string
}

interface RoleOption {
  slug: string
  name: string
  is_system: boolean
}

const KNOWN_ROLE_COLORS: Record<string, string> = {
  director:       "bg-red-100 text-red-800",
  ops_manager:    "bg-orange-100 text-orange-800",
  hr_manager:     "bg-purple-100 text-purple-800",
  office_manager: "bg-blue-100 text-blue-800",
  accounts:       "bg-teal-100 text-teal-800",
  media:          "bg-pink-100 text-pink-800",
  supervisor:     "bg-amber-100 text-amber-800",
  fleet_manager:  "bg-gray-100 text-gray-700",
  staff:          "bg-slate-100 text-slate-600",
}

const FALLBACK_ROLE_COLORS = [
  "bg-indigo-100 text-indigo-800", "bg-cyan-100 text-cyan-800",
  "bg-lime-100 text-lime-800", "bg-fuchsia-100 text-fuchsia-800",
  "bg-rose-100 text-rose-800", "bg-emerald-100 text-emerald-800",
]

function roleColor(slug: string) {
  if (KNOWN_ROLE_COLORS[slug]) return KNOWN_ROLE_COLORS[slug]
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0
  return FALLBACK_ROLE_COLORS[hash % FALLBACK_ROLE_COLORS.length]
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join("")
}

const AV_COLORS = [
  "bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700",
  "bg-teal-100 text-teal-700", "bg-pink-100 text-pink-700",
  "bg-amber-100 text-amber-800", "bg-orange-100 text-orange-800",
]

function UserPhotoCircle({ userId, name, colorClass, onClick }: {
  userId: string; name: string; colorClass: string; onClick: () => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/users/${userId}/photo`, { credentials: "include" })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => { if (blob) setSrc(URL.createObjectURL(blob)) })
      .catch(() => {})
  }, [userId])
  return (
    <button onClick={onClick} title="View profile photo"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden text-xs font-semibold cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all ${src ? "" : colorClass}`}>
      {src
        ? <img src={src} alt={name} className="h-8 w-8 rounded-full object-cover" />
        : initials(name)}
    </button>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

const BLANK_DRAFT = { full_name: "", username: "", role: "supervisor", email: "", password: "", is_active: true }

export default function UsersPage() {
  const { user: me } = useAuth()

  const [users, setUsers]     = useState<PortalUser[]>([])
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState("")

  function roleLabel(role: string) {
    return roleOptions.find((r) => r.slug === role)?.name ?? role
  }

  // Add / Edit panel
  const [panel, setPanel]           = useState(false)
  const [editing, setEditing]       = useState<PortalUser | null>(null)
  const [draft, setDraft]           = useState(BLANK_DRAFT)
  const [showPw, setShowPw]         = useState(false)
  const [saving, setSaving]         = useState(false)
  const [panelError, setPanelError] = useState("")

  // Reset password modal
  const [resetUser, setResetUser]     = useState<PortalUser | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [showNewPw, setShowNewPw]     = useState(false)
  const [resetting, setResetting]     = useState(false)
  const [resetError, setResetError]   = useState("")

  // Delete confirm
  const [deleteUser, setDeleteUser] = useState<PortalUser | null>(null)

  // View profile photo modal
  const [viewUser, setViewUser]         = useState<PortalUser | null>(null)
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null)
  const [viewPhotoLoading, setViewPhotoLoading] = useState(false)

  async function openViewPhoto(u: PortalUser) {
    setViewUser(u); setViewPhotoUrl(null); setViewPhotoLoading(true)
    try {
      const res = await fetch(`/api/users/${u.id}/photo`, { credentials: "include" })
      if (res.ok) setViewPhotoUrl(URL.createObjectURL(await res.blob()))
    } finally { setViewPhotoLoading(false) }
  }

  function closeViewPhoto() {
    if (viewPhotoUrl) URL.revokeObjectURL(viewPhotoUrl)
    setViewUser(null); setViewPhotoUrl(null)
  }

  // ── Loaders ────────────────────────────────────────────────────────────────

  async function loadUsers() {
    setLoading(true)
    try {
      const [uRes, rRes] = await Promise.all([
        fetch("/api/users", { credentials: "include" }),
        fetch("/api/roles", { credentials: "include" }),
      ])
      const uData = await uRes.json()
      const rData = await rRes.json()
      setUsers(uData.users ?? [])
      setRoleOptions(rData.roles ?? [])
    } catch {
      setError("Failed to load users.")
    }
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  // ── Panel helpers ──────────────────────────────────────────────────────────

  function openAdd() {
    setEditing(null); setDraft(BLANK_DRAFT); setPanelError(""); setShowPw(false); setPanel(true)
  }
  function openEdit(u: PortalUser) {
    setEditing(u)
    setDraft({ full_name: u.full_name, username: u.username, role: u.role, email: u.email ?? "", password: "", is_active: u.is_active })
    setPanelError(""); setShowPw(false); setPanel(true)
  }
  function closePanel() { setPanel(false); setEditing(null); setPanelError("") }
  function setF(f: keyof typeof BLANK_DRAFT, v: string | boolean) { setDraft((d) => ({ ...d, [f]: v })) }

  async function save() {
    if (!draft.full_name.trim()) { setPanelError("Full name is required."); return }
    if (!draft.username.trim())  { setPanelError("Username is required."); return }
    if (!editing && draft.password.length < 6) { setPanelError("Password must be at least 6 characters."); return }
    setSaving(true); setPanelError("")
    try {
      const method = editing ? "PATCH" : "POST"
      const url    = editing ? `/api/users/${editing.id}` : "/api/users"
      const body: Record<string, unknown> = {
        full_name: draft.full_name.trim(),
        username:  draft.username.trim(),
        role:      draft.role,
        email:     draft.email.trim(),
        is_active: draft.is_active,
      }
      if (!editing) body.password = draft.password
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!d.ok) { setPanelError(d.error ?? "Failed to save."); setSaving(false); return }
      await loadUsers(); closePanel()
    } catch { setPanelError("Network error.") }
    setSaving(false)
  }

  // ── Reset password ─────────────────────────────────────────────────────────

  function openReset(u: PortalUser) { setResetUser(u); setNewPassword(""); setResetError(""); setShowNewPw(false) }
  function closeReset() { setResetUser(null); setNewPassword("") }

  async function confirmReset() {
    if (newPassword.length < 6) { setResetError("Password must be at least 6 characters."); return }
    setResetting(true); setResetError("")
    try {
      const r = await fetch(`/api/users/${resetUser!.id}/reset-password`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      })
      const d = await r.json()
      if (!d.ok) { setResetError(d.error ?? "Failed to reset password."); setResetting(false); return }
      closeReset()
    } catch { setResetError("Network error.") }
    setResetting(false)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteUser) return
    await fetch(`/api/users/${deleteUser.id}`, { method: "DELETE", credentials: "include" })
    setDeleteUser(null); await loadUsers()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Team Access</h2>
          <p className="text-sm text-muted-foreground">
            Manage portal accounts for your team — {users.filter((u) => u.is_active).length} active
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Add user
        </Button>
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {/* Users list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <UserCog className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No portal users yet</p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden md:table-cell">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden lg:table-cell">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u, i) => (
                <tr key={u.id} className={`transition-colors hover:bg-muted/20 ${!u.is_active ? "opacity-50" : ""}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <UserPhotoCircle userId={u.id} name={u.full_name}
                        colorClass={AV_COLORS[i % AV_COLORS.length]}
                        onClick={() => openViewPhoto(u)} />
                      <div>
                        <p className="font-medium leading-tight">
                          {u.full_name}
                          {String(u.id) === String(me?.id) && (
                            <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">You</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${roleColor(u.role)}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {u.email ? (
                      <a href={`mailto:${u.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Mail className="h-3 w-3" />{u.email}
                      </a>
                    ) : (
                      <span className="text-xs italic text-muted-foreground/50">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                        <ShieldCheck className="h-3.5 w-3.5" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <ShieldOff className="h-3.5 w-3.5" /> Suspended
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openReset(u)} title="Reset password"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openEdit(u)} title="Edit user"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {String(u.id) !== String(me?.id) && (
                        <button onClick={() => setDeleteUser(u)} title="Delete user"
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
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/40" onClick={closePanel} />
          <div className="flex w-full max-w-md flex-col bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-base font-semibold">{editing ? "Edit user" : "Add new user"}</h3>
              <button onClick={closePanel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {panelError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{panelError}</p>}

              <div className="space-y-1.5">
                <Label>Full name *</Label>
                <Input value={draft.full_name} onChange={(e) => setF("full_name", e.target.value)}
                  placeholder="e.g. James Hughes" />
              </div>

              <div className="space-y-1.5">
                <Label>Username * <span className="font-normal text-muted-foreground">(used to sign in)</span></Label>
                <Input value={draft.username} onChange={(e) => setF("username", e.target.value.toLowerCase())}
                  placeholder="e.g. james.hughes" disabled={!!editing} />
                {editing && <p className="text-xs text-muted-foreground">Username cannot be changed after creation.</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Role</Label>
                <select value={draft.role} onChange={(e) => setF("role", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  {roleOptions.filter((r) => r.slug !== "staff").map((r) => (
                    <option key={r.slug} value={r.slug}>{r.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Need a different role? Create it under <span className="font-medium">Manage Roles</span> first.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Email address <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={draft.email} onChange={(e) => setF("email", e.target.value)}
                    placeholder="james@guardtec-security.co.uk" className="pl-8" type="email" />
                </div>
              </div>

              {!editing && (
                <div className="space-y-1.5">
                  <Label>Password * <span className="font-normal text-muted-foreground">(min. 6 characters)</span></Label>
                  <div className="relative">
                    <Input type={showPw ? "text" : "password"} value={draft.password}
                      onChange={(e) => setF("password", e.target.value)}
                      placeholder="Set a secure password" className="pr-10" />
                    <button type="button" onClick={() => setShowPw((p) => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

              {editing && (
                <div className="space-y-1.5">
                  <Label>Account status</Label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setF("is_active", true)}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                        draft.is_active
                          ? "border-success bg-success/10 text-success"
                          : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}>
                      Active
                    </button>
                    <button type="button" onClick={() => setF("is_active", false)}
                      disabled={String(editing?.id) === String(me?.id)}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        !draft.is_active
                          ? "border-destructive bg-destructive/10 text-destructive"
                          : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}>
                      Suspended
                    </button>
                  </div>
                  {String(editing?.id) === String(me?.id) && (
                    <p className="text-xs text-muted-foreground">You cannot suspend your own account.</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 border-t px-5 py-4">
              <Button variant="outline" className="flex-1" onClick={closePanel}>Cancel</Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create user"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset password modal ── */}
      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Reset password</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Set a new password for <strong>{resetUser.full_name}</strong>.
                  Please share it with them securely.
                </p>
              </div>
            </div>
            {resetError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{resetError}</p>}
            <div className="space-y-1.5">
              <Label>New password</Label>
              <div className="relative">
                <Input type={showNewPw ? "text" : "password"} value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 6 characters" className="pr-10" />
                <button type="button" onClick={() => setShowNewPw((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={closeReset}>Cancel</Button>
              <Button className="flex-1" onClick={confirmReset} disabled={resetting}>
                {resetting ? "Resetting…" : "Reset password"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── View profile photo modal ── */}
      {viewUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={closeViewPhoto}>
          <div className="w-full max-w-xs rounded-2xl bg-background shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <p className="font-semibold leading-tight">{viewUser.full_name}</p>
                <p className="text-xs text-muted-foreground">@{viewUser.username}</p>
              </div>
              <button onClick={closeViewPhoto} className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex items-center justify-center bg-muted/30 py-8">
              {viewPhotoLoading ? (
                <div className="flex h-40 w-40 items-center justify-center rounded-full bg-muted">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : viewPhotoUrl ? (
                <img src={viewPhotoUrl} alt={viewUser.full_name}
                  className="h-40 w-40 rounded-full object-cover shadow-lg ring-4 ring-background" />
              ) : (
                <div className="flex h-40 w-40 flex-col items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <User className="h-12 w-12 opacity-30" />
                  <p className="mt-2 text-xs">No photo yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-background border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Trash2 className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Delete user?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <strong>{deleteUser.full_name}</strong>'s portal account will be permanently removed.
                  This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteUser(null)}>Cancel</Button>
              <Button variant="destructive" className="flex-1" onClick={confirmDelete}>Delete account</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
