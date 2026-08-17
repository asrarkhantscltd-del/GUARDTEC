import { useState } from "react"
import { toast } from "sonner"
import { Loader2, PenLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Section, Field } from "@/components/profile/ProfileShared"
import { Input } from "@/components/ui/input"
import { api, ApiError } from "@/lib/api"
import { ConfirmationCheckbox } from "./ConfirmationCheckbox"
import { DigitalSignaturePad } from "./DigitalSignaturePad"
import type { AckForm } from "@/pages/AcknowledgmentFormPage"

export function SignatureSection({
  token,
  suggestedName,
  onSigned,
  onLinkInvalid,
}: {
  token: string
  suggestedName?: string
  onSigned: (form: AckForm) => void
  // 403 here means the link expired or got used elsewhere between page-load
  // and submit (debug note #8's race) — that's a full-page state change, not
  // an inline form error, so it's reported up to AcknowledgmentFormPage.
  onLinkInvalid: (message: string) => void
}) {
  const [fullName, setFullName] = useState(suggestedName || "")
  const [confirmed, setConfirmed] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = fullName.trim().length > 0 && confirmed && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const r = await api.post<{ ok: true; form: AckForm }>(`/api/acknowledge/${token}/sign`, {
        signer_name: fullName.trim(),
        signature_data: signatureData || undefined,
      })
      onSigned(r.form)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        onLinkInvalid(err.message)
      } else {
        toast.error(err instanceof ApiError ? err.message : "Network error — please try again")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Sign to Acknowledge" icon={<PenLine className="h-3.5 w-3.5" />}>
        <div className="space-y-4">
          <Field label="Full legal name">
            <Input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Type your full name"
              autoComplete="name"
            />
          </Field>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Signature (optional)</label>
            <DigitalSignaturePad onChange={setSignatureData} />
          </div>

          <ConfirmationCheckbox
            id="ack-confirm"
            checked={confirmed}
            onChange={setConfirmed}
            label="I confirm I have read, understood, and will comply with the instructions above."
          />

          <Button className="w-full" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Submitting…" : "Sign & Submit"}
          </Button>
        </div>
      </Section>
    </div>
  )
}
