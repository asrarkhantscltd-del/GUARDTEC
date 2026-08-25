import { useState } from "react"
import { toast } from "sonner"
import { Loader2, ShieldCheck } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ConfirmationCheckbox } from "@/components/acknowledgment/ConfirmationCheckbox"
import { fmtDate } from "@/lib/utils"
import type { AgencyDeployment } from "./DeploymentForm"

interface DeploymentAcknowledgmentProps {
  agencyId: string
  deployment: AgencyDeployment
  onAcknowledged: (deployment: AgencyDeployment) => void
}

// The agency admin's own "I understand + I've briefed my staff" confirmation
// (agency_deployments.agency_acknowledged) — a separate, simpler fact from an
// individual guard signing an acknowledgment form via the Feature 2 flow.
// Required before a deployment is considered acknowledged; the deployment
// itself isn't blocked from being created without it, but the UI surfaces it
// as an outstanding step.
export function DeploymentAcknowledgment({ agencyId, deployment, onAcknowledged }: DeploymentAcknowledgmentProps) {
  const [understood, setUnderstood] = useState(false)
  const [briefed, setBriefed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  if (deployment.agency_acknowledged) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <div className="text-sm">
          <p className="font-medium text-success">Acknowledged</p>
          <p className="text-xs text-muted-foreground">
            Confirmed {fmtDate(deployment.agency_acknowledged_at ?? undefined)}
          </p>
        </div>
      </div>
    )
  }

  async function handleConfirm() {
    setSaving(true); setError("")
    try {
      const d = await api.patch<{ ok: boolean; deployment: AgencyDeployment }>(
        `/api/agencies/${agencyId}/deployments/${deployment.id}/acknowledge`,
        { confirmed: true }
      )
      onAcknowledged(d.deployment)
      toast.success("Deployment acknowledged")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <ConfirmationCheckbox id="ack-understood" checked={understood} onChange={setUnderstood}
        label="I understand the assignment details for this deployment." />
      <ConfirmationCheckbox id="ack-briefed" checked={briefed} onChange={setBriefed}
        label="I've explained this assignment to my staff." />
      <Button className="w-full" disabled={!understood || !briefed || saving} onClick={handleConfirm}>
        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirming…</> : "Confirm acknowledgment"}
      </Button>
    </div>
  )
}
