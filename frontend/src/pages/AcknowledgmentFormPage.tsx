import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { AlertTriangle, CheckCircle2, Link2Off, Loader2, ShieldCheck } from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { formatDate } from "@/lib/utils"
import { TimeTracker } from "@/components/acknowledgment/TimeTracker"
import { SecureFormRenderer } from "@/components/acknowledgment/SecureFormRenderer"
import { SignatureSection } from "@/components/acknowledgment/SignatureSection"

// ─────────────────────────────────────────────────────────────────────────
// This page is PUBLIC and UNAUTHENTICATED by design (plan §"Key Security
// Considerations" #2 / server.js ~4425-4433): the 256-bit token in the URL
// IS the security boundary, not a login session. It must never assume
// req.user, never rely on the CSRF cookie (there isn't one here — the three
// /api/acknowledge/:token* routes are deliberately exempted from that check
// server-side too), and never redirect to /login. The shared `api` client's
// 401-redirect-to-/login behaviour (lib/api.ts) is harmless here in
// practice — none of these three routes ever return 401 — but is not relied
// on; every real failure path below is driven off explicit 403/404 handling.
//
// Shapes below are typed from the ACTUAL server.js handlers (lines
// ~4450-4534), not from the camelCase types in types/agency.ts — those three
// routes `res.json()` raw Postgres rows straight through with no camelCase
// mapping step, so the wire format is snake_case.
// ─────────────────────────────────────────────────────────────────────────

export interface AckRequirement {
  title: string
  description?: string
  mandatory: boolean
}

export interface AckInstruction {
  id: string
  site_id: string | null
  event_date: string | null
  title: string
  instructions_html: string | null
  requirements: AckRequirement[] | null
  document_file_url: string | null
  document_mime_type: string | null
  version: number
  status: string
}

export interface AckForm {
  id: string
  instruction_id: string
  instruction_version: number
  deployment_id: string | null
  respondent_type: "agency_staff" | "employee"
  respondent_id: string
  respondent_name_snapshot: string | null
  form_token: string
  link_expires_at: string
  form_opened_at: string | null
  form_read_at: string | null
  read_duration_seconds: number | null
  current_step: number
  signed_at: string | null
  signer_name: string | null
  signature_data: string | null
  created_at: string
}

// One page in the sequential reading flow — derived client-side from an
// instruction's free-text body plus its requirements checklist, since the
// backend stores those as one HTML blob + one JSONB array, not pre-split
// into steps.
export interface AckStep {
  key: string
  title: string
  html?: string
  description?: string
  mandatory?: boolean
}

function buildSteps(instruction: AckInstruction): AckStep[] {
  const steps: AckStep[] = []
  if (instruction.instructions_html && instruction.instructions_html.trim()) {
    steps.push({ key: "instructions", title: instruction.title || "Instructions", html: instruction.instructions_html })
  }
  for (const req of instruction.requirements || []) {
    steps.push({ key: `req-${steps.length}`, title: req.title, description: req.description, mandatory: req.mandatory })
  }
  if (!steps.length) {
    steps.push({ key: "instructions", title: instruction.title || "Instructions", html: "<p>Please review and confirm you have received this event instruction.</p>" })
  }
  return steps
}

type ErrorKind = "expired" | "signed" | "invalid" | "other"

function classifyError(message: string): ErrorKind {
  const m = message.toLowerCase()
  if (m.includes("expired")) return "expired"
  if (m.includes("already been signed") || m.includes("already used")) return "signed"
  if (m.includes("invalid link")) return "invalid"
  return "other"
}

export default function AcknowledgmentFormPage() {
  const { token = "" } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [instruction, setInstruction] = useState<AckInstruction | null>(null)
  const [form, setForm] = useState<AckForm | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [advancing, setAdvancing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [signedForm, setSignedForm] = useState<AckForm | null>(null)

  const steps = useMemo(() => (instruction ? buildSteps(instruction) : []), [instruction])

  const reportFailure = useCallback((err: unknown) => {
    if (err instanceof ApiError) setErrorMessage(err.message)
    else setErrorMessage("Something went wrong loading this link. Please try again.")
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await api.get<{ ok: true; form: AckForm; instruction: AckInstruction }>(`/api/acknowledge/${token}`)
        if (cancelled) return
        setForm(r.form)
        setInstruction(r.instruction)
        setStepIndex(Math.min(r.form.current_step, buildSteps(r.instruction).length))
      } catch (err) {
        if (!cancelled) reportFailure(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token, reportFailure])

  const handleAdvance = useCallback(async (nextStep: number, readSecondsThisStep: number) => {
    setAdvancing(true)
    try {
      const r = await api.post<{ ok: true; form: AckForm }>(`/api/acknowledge/${token}/progress`, {
        current_step: nextStep,
        read_duration_seconds: readSecondsThisStep,
      })
      setForm(r.form)
      setStepIndex(Math.min(r.form.current_step, steps.length))
    } catch (err) {
      reportFailure(err)
    } finally {
      setAdvancing(false)
    }
  }, [token, steps.length, reportFailure])

  // Display-only fallback: before the first API response lands, use the
  // ?expires= query param the link was generated with; once the server has
  // answered, prefer the authoritative link_expires_at from the DB row.
  const displayExpiresAt = form?.link_expires_at
    ?? (searchParams.get("expires") ? new Date(Number(searchParams.get("expires"))).toISOString() : null)

  if (loading) {
    return (
      <CenteredShell>
        <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Loading your acknowledgment form…</p>
        </div>
      </CenteredShell>
    )
  }

  if (signedForm) {
    return (
      <CenteredShell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="icon-badge bg-success/15"><CheckCircle2 className="h-6 w-6 text-success" /></span>
          <h2 className="text-lg font-semibold">Signature Recorded</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Thank you, {signedForm.signer_name}. Your acknowledgment was recorded at{" "}
            {signedForm.signed_at ? new Date(signedForm.signed_at).toLocaleString("en-GB") : "just now"}. You can now close this page.
          </p>
        </div>
      </CenteredShell>
    )
  }

  if (errorMessage) {
    const kind = classifyError(errorMessage)
    const icon = kind === "signed"
      ? <CheckCircle2 className="h-6 w-6 text-success" />
      : kind === "expired"
        ? <Link2Off className="h-6 w-6 text-warning" />
        : <AlertTriangle className="h-6 w-6 text-destructive" />
    const badgeCls = kind === "signed" ? "bg-success/15" : kind === "expired" ? "bg-warning/15" : "bg-destructive/15"
    const heading = kind === "signed" ? "Already Signed" : kind === "expired" ? "Link Expired" : "Link Not Valid"
    return (
      <CenteredShell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className={`icon-badge ${badgeCls}`}>{icon}</span>
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{errorMessage}</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            If you still need to acknowledge this instruction, contact your GuardTec office for a fresh link.
          </p>
        </div>
      </CenteredShell>
    )
  }

  if (!instruction || !form) return null // unreachable — loading/error/success cover every other state

  const showSignature = stepIndex >= steps.length

  return (
    <CenteredShell wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{instruction.title}</h1>
          <p className="text-xs text-muted-foreground">
            {instruction.event_date ? `Event date: ${formatDate(instruction.event_date)}` : "Standalone instruction"}
            {form.respondent_name_snapshot ? ` · For ${form.respondent_name_snapshot}` : ""}
          </p>
        </div>
        {displayExpiresAt && (
          <TimeTracker expiresAt={displayExpiresAt} onExpire={() => setErrorMessage("This link has expired.")} />
        )}
      </div>

      {instruction.document_file_url && (
        <a
          href={instruction.document_file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> View attached reference document
        </a>
      )}

      {showSignature ? (
        <SignatureSection
          token={token}
          suggestedName={form.respondent_name_snapshot || undefined}
          onSigned={setSignedForm}
          onLinkInvalid={setErrorMessage}
        />
      ) : (
        <SecureFormRenderer
          steps={steps}
          currentStep={stepIndex}
          advancing={advancing}
          onAdvance={handleAdvance}
        />
      )}
    </CenteredShell>
  )
}

function CenteredShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 py-10 sm:items-center">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="mb-5 flex items-center justify-center gap-2 text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-[0.2em]">GuardTec Compliance</span>
        </div>
        <div className="surface p-6">{children}</div>
      </div>
    </div>
  )
}
