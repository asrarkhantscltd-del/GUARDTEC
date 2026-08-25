import { useEffect, useRef, useState } from "react"
import { Eraser } from "lucide-react"
import { Button } from "@/components/ui/button"

// Plain <canvas> signature capture — no external signature-pad library is
// installed in this project (see frontend/package.json), and pointer events
// cover mouse + touch + pen in every browser this app targets, so a small
// hand-rolled pad is simpler than adding a dependency for this one field.
// Output is a base64 PNG data URL, matching acknowledgment_forms.signature_data
// ("optional base64 signature image" — plan §2.2). The always-required proof
// of identity is the typed full legal name in SignatureSection, not this pad,
// so an empty pad is a valid submission.
export function DigitalSignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const hasInkRef = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  // Backing-store resolution matches CSS size * devicePixelRatio so strokes
  // stay crisp, then everything below draws in CSS pixel coordinates.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function resize() {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.scale(ratio, ratio)
        ctx.lineWidth = 2
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.strokeStyle = "#111318"
      }
    }
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    const ctx = canvas.getContext("2d")
    const { x, y } = pointFromEvent(e)
    if (ctx) {
      ctx.beginPath()
      ctx.moveTo(x, y)
    }
    drawingRef.current = true
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    const { x, y } = pointFromEvent(e)
    if (ctx) {
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    if (!hasInkRef.current) {
      hasInkRef.current = true
      setHasInk(true)
    }
  }

  function stopDrawing() {
    if (!drawingRef.current) return
    drawingRef.current = false
    emitChange()
  }

  function emitChange() {
    const canvas = canvasRef.current
    if (!canvas || !hasInkRef.current) {
      onChange(null)
      return
    }
    onChange(canvas.toDataURL("image/png"))
  }

  function handleClear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasInkRef.current = false
    setHasInk(false)
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-lg border border-input bg-white"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        onPointerCancel={stopDrawing}
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {hasInk ? "Signature captured" : "Optional — draw your signature above with a mouse, stylus, or finger"}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={handleClear} disabled={!hasInk}>
          <Eraser className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>
    </div>
  )
}
