import { useEffect, useRef, useState } from "react"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"

// Live countdown from the link's expiry. Display-only, exactly per the plan
// ("the ?expires= query param... is DISPLAY ONLY — validation always re-reads
// link_expires_at from the DB, never trusts anything from the URL", §2.4) —
// this component just re-derives the same countdown from whichever expiry
// timestamp the parent currently trusts (URL param before the first API
// response, then acknowledgment_forms.link_expires_at after). The real
// enforcement happens server-side on every progress/sign request; if this
// clock and the server disagree, the next API call is what actually wins.
export function TimeTracker({ expiresAt, onExpire }: { expiresAt: string; onExpire?: () => void }) {
  const [msLeft, setMsLeft] = useState(() => Date.parse(expiresAt) - Date.now())
  const firedRef = useRef(false)

  useEffect(() => {
    firedRef.current = false
    const id = setInterval(() => {
      const remaining = Date.parse(expiresAt) - Date.now()
      setMsLeft(remaining)
      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true
        onExpire?.()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, onExpire])

  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000))
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0")
  const ss = String(totalSeconds % 60).padStart(2, "0")
  const urgent = totalSeconds <= 60

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        urgent ? "border-destructive/30 bg-destructive/15 text-destructive" : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      {totalSeconds > 0 ? <>Link expires in {mm}:{ss}</> : <>Link expired</>}
    </div>
  )
}
