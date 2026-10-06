import { useState } from "react"
import { toast } from "sonner"
import { KeyRound, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api"

// Self-service password change, available to every role (staff/agency/
// office/director) — see POST /api/account/change-password in server.js.
// Distinct from the director-only Team Access "Reset Password" action,
// which skips the current-password check (that's the "I forgot it"
// recovery path; this is the "I know it, just want to change it" path).
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword]         = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [saving, setSaving]                   = useState(false)
  const [error, setError]                     = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (newPassword.length < 10) { setError("New password must be at least 10 characters."); return }
    if (newPassword !== confirmPassword) { setError("New password and confirmation don't match."); return }

    setSaving(true)
    try {
      await api.post("/api/account/change-password", { currentPassword, newPassword })
      toast.success("Password changed successfully")
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password — please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-primary" /> Change Password
          </p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{error}</p>}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Current password</label>
            <input type="password" required autoFocus value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">New password</label>
            <input type="password" required minLength={10} value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            <p className="mt-1 text-[11px] text-muted-foreground">At least 10 characters.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Confirm new password</label>
            <input type="password" required value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Change Password"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
