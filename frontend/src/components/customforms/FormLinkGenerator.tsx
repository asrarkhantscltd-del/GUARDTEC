import { useState } from "react"
import { toast } from "sonner"
import { Copy, Check, Link as LinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CustomFormLinkedEntityType } from "@/types/agency"

// Builds the respondent-facing fill link for a published custom form.
// Unlike event_instructions/acknowledgment_forms (Feature 2, plan §2.5),
// custom forms have no secure-token mechanism — the link is a plain URL,
// gated only by is_published plus whatever auth CustomFormFillPage's route
// requires once wired up. entityType/entityId are optional context for
// forms filled BY one party ABOUT another (e.g. an agency admin filling the
// "Guard Emergency Contact Update" form for one of their agency_staff, plan
// §3.6) — omit both for a self-service or fully anonymous form.
export function FormLinkGenerator({
  formId, entityType, entityId,
}: {
  formId: string
  entityType?: CustomFormLinkedEntityType
  entityId?: string
}) {
  const [copied, setCopied] = useState(false)

  const params = new URLSearchParams()
  if (entityType) params.set("entityType", entityType)
  if (entityId) params.set("entityId", entityId)
  const query = params.toString()
  const url = `${window.location.origin}/custom-forms/${formId}/fill${query ? `?${query}` : ""}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Link copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select and copy the link manually")
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input readOnly value={url} onFocus={e => e.target.select()}
          className="min-w-0 flex-1 bg-transparent text-xs text-muted-foreground outline-none" />
        <Button type="button" size="sm" variant="outline" onClick={copyLink} className="shrink-0 gap-1.5">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Anyone with this link can open the form. It does not expire — unpublish the form to stop accepting responses.
      </p>
    </div>
  )
}
