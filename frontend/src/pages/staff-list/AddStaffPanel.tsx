import { useNavigate } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Loader2, X, Briefcase } from "lucide-react"
import { RoleChipPicker } from "@/components/ui/role-picker"
import type { useAddStaff } from "./useAddStaff"

export default function AddStaffPanel({ addStaff, navigate }: {
  addStaff: ReturnType<typeof useAddStaff>
  navigate: ReturnType<typeof useNavigate>
}) {
  const { addPanel, setAddPanel, addForm, setAddForm, addSaving, addError, sameNameConflict, setSameNameConflict, handleAddStaff } = addStaff
  return (
    <>
    {/* ── Add Staff panel ── */}
    {addPanel && (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{sameNameConflict ? "Same name already on file" : "Add new staff member"}</h2>
            <p className="text-xs text-muted-foreground">
              {sameNameConflict ? "Confirm whether this is the same person or someone else" : "Basic details — full compliance data is added from their profile page"}
            </p>
          </div>
          <button onClick={() => { setAddPanel(false); setSameNameConflict(null) }} className="rounded-md p-1.5 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {sameNameConflict ? (
          <>
            <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{sameNameConflict.error}</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 rounded-lg border p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Existing profile</p>
                  <p className="text-sm font-medium">{sameNameConflict.existing?.name ?? addForm.name}</p>
                  <p className="text-xs text-muted-foreground">{sameNameConflict.existing?.jobRole || "No role set"}</p>
                  <p className="text-xs text-muted-foreground">{sameNameConflict.existing?.email || "No email on file"}</p>
                  <p className="text-xs text-muted-foreground">{sameNameConflict.existing?.phone || "No phone on file"}</p>
                  <p className="text-xs text-muted-foreground">{sameNameConflict.existing?.nationality || "No nationality on file"}</p>
                </div>
                <div className="space-y-1 rounded-lg border border-primary/30 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What you just entered</p>
                  <p className="text-sm font-medium">{addForm.name}</p>
                  <p className="text-xs text-muted-foreground">{addForm.jobRole || "No role set"}</p>
                  <p className="text-xs text-muted-foreground">{addForm.email || "No email"}</p>
                  <p className="text-xs text-muted-foreground">{addForm.phone || "No phone"}</p>
                  <p className="text-xs text-muted-foreground">{addForm.nationality || "No nationality"}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                If the email or phone above are different, this is very likely a different person who just happens to share a name — not the person you already have on file.
              </p>
            </div>

            <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 border-t px-6 py-4">
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setSameNameConflict(null)}>
                  Back
                </Button>
                {sameNameConflict.existing && (
                  <Button variant="outline" className="flex-1" onClick={() => {
                    const id = sameNameConflict.existing!.id
                    setAddPanel(false); setSameNameConflict(null)
                    navigate(`/staff/${id}`)
                  }}>
                    Open existing profile
                  </Button>
                )}
              </div>
              <Button className="w-full gap-2" onClick={() => handleAddStaff(true)} disabled={addSaving}>
                {addSaving ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : "Yes — different person, create anyway"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {addError && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{addError}</p>
                )}

                <div className="space-y-1.5">
                  <Label>Full name *</Label>
                  <Input
                    value={addForm.name}
                    onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. James Okafor"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                    Job role
                  </Label>
                  <RoleChipPicker
                    value={addForm.jobRole}
                    onChange={v => setAddForm(p => ({ ...p, jobRole: v }))}
                  />
                  {addForm.jobRole && (
                    <p className="text-[11px] text-muted-foreground">
                      Selected: <span className="font-medium text-foreground">{addForm.jobRole}</span>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={addForm.email}
                      onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder="email@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input
                      type="tel"
                      value={addForm.phone}
                      onChange={(e) => setAddForm((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="+44 7700 000000"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Nationality</Label>
                  <Input
                    value={addForm.nationality}
                    onChange={(e) => setAddForm((p) => ({ ...p, nationality: e.target.value }))}
                    placeholder="e.g. British"
                  />
                </div>

                <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                  SIA licence, CSCS, Right to Work, documents and training are added from the staff member's profile page after creation.
                </p>
            </div>

            <div className="mx-auto flex w-full max-w-2xl gap-2 border-t px-6 py-4">
              <Button variant="outline" className="flex-1" onClick={() => setAddPanel(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={() => handleAddStaff()} disabled={addSaving}>
                {addSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</> : "Add staff member"}
              </Button>
            </div>
          </>
        )}
      </div>
    )}
    </>
  )
}
