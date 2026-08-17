import { useEffect, useRef, useState } from "react"
import { ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProgressBar } from "./ProgressBar"
import { InstructionStep } from "./InstructionStep"
import type { AckStep } from "@/pages/AcknowledgmentFormPage"

// Sequential reading gate: renders exactly one step at a time and can only
// move forward. There is no "back" or step-jump control by design — the plan
// requires the signature step to be unreachable until every instruction step
// has been marked read (§2.5), and the server independently re-enforces this
// with GREATEST()/WHERE current_step checks, so this component only needs to
// not offer a way to skip, not to be the actual security boundary.
export function SecureFormRenderer({
  steps,
  currentStep,
  advancing,
  onAdvance,
}: {
  steps: AckStep[]
  currentStep: number
  advancing: boolean
  onAdvance: (nextStep: number, readSecondsThisStep: number) => void
}) {
  const stepStartRef = useRef(Date.now())

  useEffect(() => {
    stepStartRef.current = Date.now()
  }, [currentStep])

  const [confirmedRead, setConfirmedRead] = useState(false)
  useEffect(() => setConfirmedRead(false), [currentStep])

  const step = steps[currentStep]
  const isLastStep = currentStep === steps.length - 1
  if (!step) return null

  function handleNext() {
    const readSeconds = Math.max(1, Math.round((Date.now() - stepStartRef.current) / 1000))
    onAdvance(currentStep + 1, readSeconds)
  }

  return (
    <div className="space-y-4">
      <ProgressBar current={currentStep} total={steps.length} />
      <InstructionStep step={step} />

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3">
        <input
          type="checkbox"
          checked={confirmedRead}
          onChange={e => setConfirmedRead(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="text-sm leading-relaxed">I have read and understood this {isLastStep ? "section" : "step"}.</span>
      </label>

      <Button className="w-full" disabled={!confirmedRead || advancing} onClick={handleNext}>
        {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
        {isLastStep ? "Continue to signature" : "Next step"}
      </Button>
    </div>
  )
}
