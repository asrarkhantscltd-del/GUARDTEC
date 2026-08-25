import { useState } from "react"
import { toast } from "sonner"
import { Loader2, X, Building2, Copy, Check, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api"

// Client-assembled row for the caller's list — POST /api/agencies only
// returns { id, login_username, temp_password } (server.js:3234), not a full
// agency record, so this ships the fields the form itself already knows
// alongside the new id, rather than inventing a second round-trip.
export interface CreatedAgencySummary {
  id: string
  name: string
  email: string
  phone?: string
  status: "active"
  created_at: string
  staff_count: number
}

export interface CreateAgencyModalProps {
  open: boolean
  onClose: () => void
  onCreated: (agency: CreatedAgencySummary) => void
}

const BLANK = { name: "", email: "", phone: "" }

export default function CreateAgencyModal({ open, onClose, onCreated }: CreateAgencyModalProps) {
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ username: string; password: string } | null>(null)
  const [copied, setCopied] = useState<"username" | "password" | null>(null)

  if (!open) return null

  function handleClose() {
    setForm(BLANK); setError(""); setResult(null); setCopied(null)
    onClose()
  }

  async function handleCreate() {
    const name = form.name.trim()
    const email = form.email.trim()
    if (!name) { setError("Agency name is required."); return }
    if (!email) { setError("Agency email is required."); return }
    setSaving(true); setError("")
    try {
      const res = await api.post<{ ok: boolean; id: string; login_username: string; temp_password: string }>(
        "/api/agencies", { name, email, phone: form.phone.trim() || undefined }
      )
      setResult({ username: res.login_username, password: res.temp_password })
      onCreated({
        id: res.id, name, email, phone: form.phone.trim() || undefined,
        status: "active", created_at: new Date().toISOString(), staff_count: 0,
      })
      toast.success("Agency created")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again.")
    } finally {
      setSaving(false)
    }
  }

  function copy(value: string, which: "username" | "password") {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            {result ? "Agency created" : "Create agency"}
          </h2>
          {!result && (
            <p className="text-xs text-muted-foreground">Sets up the agency record and its login account</p>
          )}
        </div>
        <button onClick={handleClose} className="rounded-md p-1.5 hover:bg-muted transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          {result ? (
            <>
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
                This password is shown once and cannot be retrieved again — copy it now and share it with the agency securely.
              </p>
              <div className="space-y-1.5">
                <Label>Login username</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={result.username} className="font-mono" />
                  <Button type="button" size="icon" variant="outline" onClick={() => copy(result.username, "username")}>
                    {copied === "username" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Temporary password</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={result.password} className="font-mono" />
                  <Button type="button" size="icon" variant="outline" onClick={() => copy(result.password, "password")}>
                    {copied === "password" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> The agency should change this password after first login.
              </p>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Agency name *</Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Apex Security Cover Ltd" />
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="contact@agency.co.uk" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+44 7700 000000" />
              </div>
            </>
          )}
        </div>

        <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-6 py-4">
          {result ? (
            <Button className="flex-1" onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button className="flex-1" onClick={handleCreate} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create agency"}
              </Button>
            </>
          )}
        </div>
    </div>
  )
}
