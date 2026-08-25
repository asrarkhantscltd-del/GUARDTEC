import { useState, useRef, useEffect } from "react"
import { motion, useMotionValue } from "framer-motion"
import { X, Send, Sparkles, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

const SUGGESTIONS = [
  "Which staff have SIA licences expiring in 30 days?",
  "Who needs their CSCS card renewed?",
  "Which staff have Right to Work expiring soon?",
  "Which vehicles need an MOT check?",
  "Show me all non-compliant staff",
  "Who is currently onsite?",
]

function AiOrb({ open }: { open: boolean }) {
  return (
    <div className="relative h-14 w-14 flex items-center justify-center">
      {/* Outer rotating ring */}
      <svg className="absolute inset-0 h-full w-full animate-[spin_8s_linear_infinite]" viewBox="0 0 56 56">
        <defs>
          <linearGradient id="orb-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E40613" />
            <stop offset="50%" stopColor="#00A99D" />
            <stop offset="100%" stopColor="#E40613" />
          </linearGradient>
        </defs>
        <circle cx="28" cy="28" r="26" fill="none" stroke="url(#orb-ring)" strokeWidth="1.5"
          strokeDasharray="12 6 4 6" opacity="0.7" />
      </svg>

      {/* Counter-rotating inner ring */}
      <svg className="absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)] animate-[spin_5s_linear_infinite_reverse]" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="22" fill="none" stroke="#E40613" strokeWidth="1"
          strokeDasharray="4 8" opacity="0.4" />
      </svg>

      {/* Core glow */}
      <div className="absolute inset-2 rounded-full bg-[#E40613]/20 blur-md animate-[pulse_2s_ease-in-out_infinite]" />

      {/* Inner solid circle */}
      <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#1a1a2e] to-[#0a0a15] border border-white/10 shadow-[0_0_20px_rgba(228,6,19,0.3)]">
        {open ? (
          <X className="h-5 w-5 text-white" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
            {/* Neural network / brain icon */}
            <circle cx="12" cy="6" r="1.5" fill="#E40613">
              <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="6" cy="11" r="1.5" fill="#00A99D">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="18" cy="11" r="1.5" fill="#E40613">
              <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="8" cy="18" r="1.5" fill="#00A99D">
              <animate attributeName="opacity" values="1;0.5;1" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="16" cy="18" r="1.5" fill="#E40613">
              <animate attributeName="opacity" values="0.5;1;0.5" dur="2.2s" repeatCount="indefinite" />
            </circle>
            {/* Connections */}
            <line x1="12" y1="6" x2="6" y2="11" stroke="#E40613" strokeWidth="0.7" opacity="0.5">
              <animate attributeName="opacity" values="0.2;0.7;0.2" dur="1.5s" repeatCount="indefinite" />
            </line>
            <line x1="12" y1="6" x2="18" y2="11" stroke="#E40613" strokeWidth="0.7" opacity="0.5">
              <animate attributeName="opacity" values="0.5;0.2;0.5" dur="1.8s" repeatCount="indefinite" />
            </line>
            <line x1="6" y1="11" x2="8" y2="18" stroke="#00A99D" strokeWidth="0.7" opacity="0.5">
              <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" repeatCount="indefinite" />
            </line>
            <line x1="18" y1="11" x2="16" y2="18" stroke="#E40613" strokeWidth="0.7" opacity="0.5">
              <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.6s" repeatCount="indefinite" />
            </line>
            <line x1="6" y1="11" x2="18" y2="11" stroke="white" strokeWidth="0.5" opacity="0.2">
              <animate attributeName="opacity" values="0.1;0.4;0.1" dur="2.5s" repeatCount="indefinite" />
            </line>
            <line x1="8" y1="18" x2="16" y2="18" stroke="white" strokeWidth="0.5" opacity="0.2">
              <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite" />
            </line>
            <line x1="12" y1="6" x2="8" y2="18" stroke="white" strokeWidth="0.3" opacity="0.15">
              <animate attributeName="opacity" values="0.05;0.25;0.05" dur="3s" repeatCount="indefinite" />
            </line>
            <line x1="12" y1="6" x2="16" y2="18" stroke="white" strokeWidth="0.3" opacity="0.15">
              <animate attributeName="opacity" values="0.15;0.05;0.15" dur="2.8s" repeatCount="indefinite" />
            </line>
          </svg>
        )}
      </div>

      {/* Orbiting dot 1 */}
      {!open && (
        <div className="absolute inset-0 animate-[spin_3s_linear_infinite]">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-[#E40613] shadow-[0_0_6px_#E40613]" />
        </div>
      )}
      {/* Orbiting dot 2 */}
      {!open && (
        <div className="absolute inset-0 animate-[spin_4s_linear_infinite_reverse]">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[#00A99D] shadow-[0_0_6px_#00A99D]" />
        </div>
      )}
    </div>
  )
}

export default function AiChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const constraintsRef = useRef<HTMLDivElement>(null)

  const x = useMotionValue(0)
  const y = useMotionValue(0)

  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  async function send(text?: string) {
    const msg = (text ?? input).trim()
    if (!msg || loading) return
    setInput("")
    setMessages(prev => [...prev, { id: Date.now().toString(), role: "user", content: msg }])
    setLoading(true)
    try {
      const data = await api.post<{ answer?: string }>("/api/ai-chat", { message: msg })
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.answer ?? "Sorry, I couldn't get a response. Please try again.",
      }])
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Connection error — please check your network and try again.",
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Full-screen drag boundary */}
      <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-40" />

      {/* Draggable floating orb */}
      <motion.button
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.1}
        dragMomentum={false}
        onDragStart={() => {
          setIsDragging(true)
        }}
        onDragEnd={() => {
          setTimeout(() => setIsDragging(false), 50)
        }}
        onClick={() => {
          if (!isDragging) setOpen(prev => !prev)
        }}
        style={{ x, y }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        aria-label="AI Compliance Assistant"
        className="fixed bottom-6 right-6 z-50 cursor-grab active:cursor-grabbing focus:outline-none"
      >
        <AiOrb open={open} />

        {/* Pulse ring when closed */}
        {!open && (
          <span className="absolute inset-0 rounded-full border-2 border-[#E40613]/40 animate-ping" />
        )}
      </motion.button>

      {/* Chat panel */}
      {open && (
        <motion.div
          className="fixed bottom-24 right-6 z-50 flex h-[520px] w-[370px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#E40613]/20 to-[#00A99D]/10 border border-[#E40613]/20">
              <Sparkles className="h-4 w-4 text-[#E40613]" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold font-display tracking-wide leading-tight">AI Assistant</p>
              <p className="text-[10px] text-muted-foreground">GuardTec Compliance Intelligence</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                title="Clear chat"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-center text-xs text-muted-foreground pb-1">
                  Ask me anything about compliance
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted hover:border-primary/30"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-primary text-white rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3 py-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border p-3">
            <form
              onSubmit={(e) => { e.preventDefault(); send() }}
              className="flex items-center gap-2"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about licences, vehicles…"
                disabled={loading}
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 placeholder:text-muted-foreground/60"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || loading}
                className="h-9 w-9 shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </motion.div>
      )}
    </>
  )
}
