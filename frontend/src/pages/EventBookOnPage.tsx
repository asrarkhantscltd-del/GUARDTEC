import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import {
  ShieldCheck, Loader2, Camera, Check, AlertTriangle, CalendarDays, FileText, MapPin,
} from "lucide-react"
import { fmtDate } from "@/lib/utils"
import { DigitalSignaturePad } from "@/components/acknowledgment/DigitalSignaturePad"

interface Requirement { title: string; description?: string; mandatory?: boolean }
interface Instruction {
  id: string
  title: string
  instructions_html?: string
  requirements: Requirement[]
  event_date_from?: string
  event_date_to?: string
  has_document: boolean
  document_mime_type?: string
}
interface BookOnState {
  ok: boolean
  staff_name: string
  today: string
  assigned_dates: string[]
  booked_dates: string[]
  assigned_today: boolean
  booked_today: boolean
  event_ended: boolean
  can_book: boolean
  sia_required: boolean
  instruction: Instruction
  error?: string
}

// Downscale a camera/file image to a JPEG data URI no wider/taller than `max`,
// so the upload stays small — phones produce multi-MB photos otherwise.
function downscale(file: File, max = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height)
        width = Math.round(width * scale); height = Math.round(height * scale)
      }
      const canvas = document.createElement("canvas")
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) { reject(new Error("canvas unsupported")); return }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL("image/jpeg", quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")) }
    img.src = url
  })
}

export default function EventBookOnPage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<BookOnState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [selfie, setSelfie] = useState<string | null>(null)
  const [siaPhoto, setSiaPhoto] = useState<string | null>(null)
  const [siaNumber, setSiaNumber] = useState("")
  const [signature, setSignature] = useState<string | null>(null)
  const [readConfirmed, setReadConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const openedAt = useRef(Date.now())
  const selfieInput = useRef<HTMLInputElement>(null)
  const siaInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/event-book-on/${token}`)
      const d: BookOnState = await res.json()
      if (!res.ok || !d.ok) { setError(d.error || "This link is not valid."); setState(null) }
      else setState(d)
    } catch {
      setError("Could not load — check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }, [token])
  useEffect(() => { load() }, [load])

  async function pick(e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) {
    const file = e.target.files?.[0]
    if (!file) return
    try { setter(await downscale(file)) } catch { /* ignore */ }
    e.target.value = ""
  }

  function getGps(): Promise<{ lat: number; lng: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { timeout: 8000, maximumAge: 60000 }
      )
    })
  }

  async function submit() {
    if (!selfie || !siaPhoto) return
    setSubmitting(true)
    const gps = await getGps()
    try {
      const res = await fetch(`/api/event-book-on/${token}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selfie, sia_photo: siaPhoto, sia_number: siaNumber.trim() || null, signature_data: signature,
          read_duration_seconds: Math.round((Date.now() - openedAt.current) / 1000),
          gps_lat: gps?.lat ?? null, gps_lng: gps?.lng ?? null,
        }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) { setError(d.error || "Could not book on."); }
      else setDone(true)
    } catch {
      setError("Could not submit — check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          <span className="font-semibold">GuardTec — Event Book-On</span>
        </div>
        {children}
      </div>
    </div>
  )

  if (loading) return <Shell><div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div></Shell>

  if (error && !state) return (
    <Shell>
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center dark:border-red-900/50 dark:bg-red-950/30">
        <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-500" />
        <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
      </div>
    </Shell>
  )
  if (!state) return null

  if (done) return (
    <Shell>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="h-8 w-8 text-emerald-600" />
        </div>
        <h2 className="text-lg font-semibold">Booked on for today</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Thanks {state.staff_name.split(" ")[0]} — your attendance for {fmtDate(state.today)} is recorded.
        </p>
      </div>
    </Shell>
  )

  const instr = state.instruction

  // Header card shared by every state
  const Header = (
    <div className="mb-4 rounded-xl border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h1 className="text-base font-semibold">{instr.title}</h1>
      <p className="mt-1 text-xs text-neutral-500">Hi {state.staff_name}</p>
      {instr.event_date_from && instr.event_date_to && (
        <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
          <CalendarDays className="h-3 w-3" />{fmtDate(instr.event_date_from)} – {fmtDate(instr.event_date_to)}
        </p>
      )}
    </div>
  )

  if (state.event_ended) return (
    <Shell>{Header}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        This event has ended. Booking on is closed.
      </div>
    </Shell>
  )

  // Assigned-days overview with each day's status
  const DayList = (
    <div className="mb-4 rounded-xl border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="mb-2 text-xs font-medium text-neutral-500">Your days on this event</p>
      <div className="flex flex-wrap gap-1.5">
        {state.assigned_dates.map(d => {
          const bookedDay = state.booked_dates.includes(d)
          const isToday = d === state.today
          return (
            <span key={d} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
              bookedDay ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
              : isToday ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
              : "border-neutral-200 text-neutral-500 dark:border-neutral-800"
            }`}>
              {bookedDay && <Check className="h-3 w-3" />}{fmtDate(d)}{isToday ? " · today" : ""}
            </span>
          )
        })}
      </div>
    </div>
  )

  if (state.booked_today) return (
    <Shell>{Header}{DayList}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <Check className="mx-auto mb-2 h-7 w-7 text-emerald-600" />
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">You've already booked on for today ({fmtDate(state.today)}).</p>
      </div>
    </Shell>
  )

  if (!state.assigned_today) return (
    <Shell>{Header}{DayList}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        You're not rostered for today ({fmtDate(state.today)}). Come back on one of your assigned days to book on.
      </div>
    </Shell>
  )

  // can_book === true: full flow
  return (
    <Shell>{Header}{DayList}
      {/* Instruction to read */}
      <div className="mb-4 rounded-xl border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4" />Assignment instructions</p>
        {instr.instructions_html
          ? <div className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{instr.instructions_html}</div>
          : <p className="text-sm text-neutral-500">No written instructions.</p>}
        {instr.requirements.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {instr.requirements.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span><span className="font-medium">{r.title}</span>{r.description ? ` — ${r.description}` : ""}
                  {r.mandatory && <span className="ml-1 text-[10px] font-semibold uppercase text-red-500">required</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {instr.has_document && (
          <a href={`/api/event-book-on/${token}/document`} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800">
            <FileText className="h-3.5 w-3.5" />Open the full briefing document
          </a>
        )}
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={readConfirmed} onChange={e => setReadConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>I confirm I have read and understood the assignment instructions.</span>
        </label>
      </div>

      {/* E-signature confirming the briefing was read */}
      <div className="mb-4 rounded-xl border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="mb-1 text-sm font-semibold">Sign to confirm</p>
        <p className="mb-2 text-xs text-neutral-500">Draw your signature below — this confirms you have read the briefing.</p>
        <DigitalSignaturePad onChange={setSignature} emptyHint="Draw your signature above with your finger or stylus" />
      </div>

      {/* Photo capture */}
      <div className="mb-4 rounded-xl border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 space-y-3">
        <p className="text-sm font-semibold">Book on with your photos</p>

        {state.sia_required && (
          <div>
            <p className="mb-1.5 text-xs text-neutral-500">Your SIA licence number</p>
            <input value={siaNumber} onChange={e => setSiaNumber(e.target.value)}
              placeholder="Enter your SIA number"
              className="w-full rounded-lg border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              inputMode="numeric" autoComplete="off" />
            <p className="mt-1 text-[11px] text-neutral-400">Must match the number on file to confirm it's you.</p>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs text-neutral-500">Live selfie (taken now)</p>
          {selfie
            ? <img src={selfie} alt="selfie" className="h-32 w-32 rounded-lg border object-cover" />
            : <div className="flex h-32 w-32 items-center justify-center rounded-lg border border-dashed text-neutral-400"><Camera className="h-7 w-7" /></div>}
          <input ref={selfieInput} type="file" accept="image/*" capture="user" className="hidden" onChange={e => pick(e, setSelfie)} />
          <button onClick={() => selfieInput.current?.click()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800">
            <Camera className="h-3.5 w-3.5" />{selfie ? "Retake selfie" : "Take selfie"}
          </button>
        </div>

        <div>
          <p className="mb-1.5 text-xs text-neutral-500">Photo of your SIA badge</p>
          {siaPhoto
            ? <img src={siaPhoto} alt="SIA badge" className="h-32 w-auto rounded-lg border object-contain" />
            : <div className="flex h-32 w-32 items-center justify-center rounded-lg border border-dashed text-neutral-400"><ShieldCheck className="h-7 w-7" /></div>}
          <input ref={siaInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => pick(e, setSiaPhoto)} />
          <button onClick={() => siaInput.current?.click()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800">
            <ShieldCheck className="h-3.5 w-3.5" />{siaPhoto ? "Retake badge photo" : "Photograph SIA badge"}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}

      <button onClick={submit} disabled={!readConfirmed || !selfie || !siaPhoto || !signature || submitting || (state.sia_required && !siaNumber.trim())}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Book on for today
      </button>
      <p className="mt-2 text-center text-[11px] text-neutral-400">
        Read the instructions, add both photos, then book on.
      </p>
    </Shell>
  )
}
