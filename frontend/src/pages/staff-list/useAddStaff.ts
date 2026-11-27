import { useState } from "react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api"
import { type SameNameConflict } from "./shared"

export function useAddStaff({ reloadStaff }: { reloadStaff: () => Promise<void> }) {
  // Add Staff panel
  const [addPanel, setAddPanel]   = useState(false)
  const [addForm, setAddForm]     = useState({ name: "", jobRole: "", email: "", phone: "", nationality: "" })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError]   = useState("")
  // Set when the backend finds an active profile with the exact same name —
  // two different people CAN genuinely share a name, so this isn't a hard
  // block: it shows a side-by-side comparison and lets the admin either open
  // the existing profile (the usual case) or confirm it's someone else.
  const [sameNameConflict, setSameNameConflict] = useState<SameNameConflict | null>(null)

  function openAddStaff() {
    setAddForm({ name: "", jobRole: "", email: "", phone: "", nationality: "" })
    setAddError("")
    setSameNameConflict(null)
    setAddPanel(true)
  }

  async function handleAddStaff(confirmDifferentPerson = false) {
    if (!addForm.name.trim()) { setAddError("Full name is required."); return }
    setAddSaving(true); setAddError("")
    try {
      await api.post("/api/staff", {
        name:        addForm.name.trim(),
        jobRole:     addForm.jobRole || undefined,
        email:       addForm.email.trim() || undefined,
        phone:       addForm.phone.trim() || undefined,
        nationality: addForm.nationality.trim() || undefined,
        overall:     "unknown",
        confirmDifferentPerson: confirmDifferentPerson || undefined })
      await reloadStaff()
      setAddPanel(false)
      setSameNameConflict(null)
      toast.success("Staff member added successfully")
    } catch (err) {
      const data = err instanceof ApiError
        ? (err.data as { sameNameConflict?: boolean; error?: string; existing?: SameNameConflict["existing"] } | undefined)
        : undefined
      if (err instanceof ApiError && err.status === 409 && data?.sameNameConflict) {
        setSameNameConflict({ error: data.error ?? err.message, existing: data.existing ?? null })
      } else {
        setAddError(err instanceof ApiError ? err.message : "Network error.")
      }
    } finally {
      setAddSaving(false)
    }
  }

  return {
    addPanel,
    setAddPanel,
    addForm,
    setAddForm,
    addSaving,
    setAddSaving,
    addError,
    setAddError,
    sameNameConflict,
    setSameNameConflict,
    openAddStaff,
    handleAddStaff }
}
