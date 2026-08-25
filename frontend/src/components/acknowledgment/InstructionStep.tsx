import DOMPurify from "dompurify"
import { AlertTriangle } from "lucide-react"
import { Section } from "@/components/profile/ProfileShared"
import type { AckStep } from "@/pages/AcknowledgmentFormPage"

// instructions_html is authored by GuardTec management (EventInstructionsPanel,
// out of scope here), never by the anonymous respondent viewing this page, so
// rendering it as HTML is the same trust level as any other admin-authored
// content already rendered elsewhere in this app. Still sanitized before
// render — this page is reached via a public, unauthenticated token link, so
// a compromised or careless management account shouldn't be able to run a
// script in front of every signee.
export function InstructionStep({ step }: { step: AckStep }) {
  return (
    <Section
      title={step.title}
      badge={
        step.mandatory ? (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-warning">
            <AlertTriangle className="h-3 w-3" /> Mandatory
          </span>
        ) : undefined
      }
    >
      {step.html ? (
        <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(step.html) }} />
      ) : (
        <p className="text-sm leading-relaxed text-foreground">{step.description || "No further detail provided for this requirement."}</p>
      )}
    </Section>
  )
}
