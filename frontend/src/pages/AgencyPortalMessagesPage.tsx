// Agency Portal — Messages.
//
// This is the agency-side self-service messaging view: an agency admin
// talking directly to GuardTec's admin team. It is deliberately the SAME
// messaging system as the existing staff <-> management chat (MyProfilePage's
// "Messages" tab / StaffDetailPage's "Messages" tab), just parameterized by
// agency_id instead of employee_id (server.js's messagesSelectQuery +
// canAccessMessageOwner, plan §"Agency Messages"/debug note #5) — so this
// page mirrors MyProfilePage.tsx's messages-tab rendering byte-for-byte
// (bubble left/right by sender, inline image preview, download row for
// non-images) rather than inventing a new visual design.
//
// Endpoints (server.js:5282-5330):
//   GET  /api/agencies/:agencyId/messages  -> { ok, messages, unread? }
//   POST /api/agencies/:agencyId/messages  { message } -> { ok, message: { id } }
// Attachment routes are shared, unchanged, with the employee-side chat:
//   POST /api/messages/:messageId/attachment
//   GET  /api/message-attachments/:filename
// There is no delete route exposed here — deleting a message is
// management-only (requirePermission('staff') in server.js), matching the
// employee side's self-service view, which also has no delete capability.

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/contexts/AuthContext"
import {
  MessageSquare, Paperclip, X, FileVideo, FileText, Image as ImageIcon,
  Send, Download, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface AgencyMessage {
  id: string
  message: string
  sender_name: string
  sender_role: string
  created_at: string
  is_read: boolean
  attachment_id?: string
  attachment_filename?: string
  attachment_original_name?: string
  attachment_mime_type?: string
  attachment_size?: number
}

function attachIcon(mime: string) {
  if (mime.startsWith("video/")) return <FileVideo className="h-3.5 w-3.5 text-primary shrink-0" />
  if (mime.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5 text-success shrink-0" />
  return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

const ALLOWED_ATTACH_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/quicktime", "video/webm",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

export default function AgencyPortalMessagesPage() {
  const { user } = useAuth()
  // The shared User type (contexts/AuthContext.tsx) doesn't declare agency_id
  // yet — the backend already returns it (server.js /api/login, /api/me:
  // `agency_id: user.agency_id || null`), it just hasn't been added to the
  // frontend type. Read it via a narrow local cast rather than editing that
  // shared file, which is out of scope for this page.
  const agencyId = (user as unknown as { agency_id?: string | null } | null)?.agency_id ?? null

  const [messages, setMessages] = useState<AgencyMessage[]>([])
  const [loading, setLoading]   = useState(true)
  const [msgDraft, setMsgDraft] = useState("")
  const [msgSending, setMsgSending] = useState(false)
  const [msgFile, setMsgFile]   = useState<File | null>(null)
  const msgFileInputRef         = useRef<HTMLInputElement>(null)
  const msgEndRef               = useRef<HTMLDivElement>(null)

  async function loadMessages() {
    if (!agencyId) { setLoading(false); return }
    setLoading(true)
    try {
      const d = await api.get<{ ok: boolean; messages: AgencyMessage[]; unread?: number }>(
        `/api/agencies/${agencyId}/messages`
      )
      setMessages(d.messages)
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 150)
    } catch {
    } finally {
      setLoading(false)
    }
  }

  function pickMsgFile(file: File | null) {
    if (!file) return
    if (!ALLOWED_ATTACH_TYPES.includes(file.type)) { toast.error("Only images, videos, PDFs, and Word docs are allowed."); return }
    if (file.size > 100 * 1024 * 1024) { toast.error("File too large (max 100 MB)."); return }
    setMsgFile(file)
  }

  async function sendMessage() {
    if (!agencyId || (!msgDraft.trim() && !msgFile)) return
    setMsgSending(true)
    try {
      const d = await api.post<{ ok: boolean; message: { id: string } }>(
        `/api/agencies/${agencyId}/messages`,
        { message: msgDraft.trim() || `📎 ${msgFile?.name}` }
      )
      if (msgFile) {
        const buf = await msgFile.arrayBuffer()
        const attRes = await fetch(`/api/messages/${d.message.id}/attachment`, {
          method: "POST",
          headers: { "Content-Type": msgFile.type || "application/octet-stream", "x-original-name": encodeURIComponent(msgFile.name) },
          credentials: "include",
          body: buf,
        })
        const attD = await attRes.json()
        if (!attD.ok) toast.error(attD.error ?? "Message sent, but the attachment failed to upload.")
      }
      setMsgDraft(""); setMsgFile(null)
      await loadMessages()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send.")
    } finally {
      setMsgSending(false)
    }
  }

  useEffect(() => { loadMessages() }, [agencyId])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <MessageSquare className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="text-sm text-muted-foreground">Direct line to GuardTec's admin team. Private to your agency.</p>
        </div>
      </div>

      {!agencyId ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No agency linked to this account.
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden flex flex-col" style={{ minHeight: "480px" }}>
          <div className="border-b px-4 py-3 bg-muted/20">
            <p className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Messages
            </p>
            <p className="text-xs text-muted-foreground">Message GuardTec's admin team directly. You'll be notified here when they reply.</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-muted/5" style={{ maxHeight: "380px" }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <MessageSquare className="h-8 w-8 opacity-20" />
                <p className="text-sm">No messages yet. Send the first one below.</p>
              </div>
            )}
            {messages.map(m => {
              const isMe = m.sender_role === "agency"
              const isImage = m.attachment_mime_type?.startsWith("image/")
              return (
                <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-sm rounded-2xl px-4 py-2.5 text-sm shadow-sm ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border text-foreground rounded-tl-sm"}`}>
                    <p className="text-[11px] font-semibold mb-1 opacity-60">{m.sender_name}</p>
                    <p className="leading-snug">{m.message}</p>
                    {m.attachment_filename && (
                      isImage ? (
                        <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" className="mt-1.5 block">
                          <img src={`/api/message-attachments/${m.attachment_filename}`} alt={m.attachment_original_name}
                            className="max-h-48 w-full rounded-lg object-cover" />
                        </a>
                      ) : (
                        <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" download={m.attachment_original_name}
                          className={`mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${isMe ? "bg-white/15" : "bg-muted"}`}>
                          {attachIcon(m.attachment_mime_type ?? "")}
                          <span className="flex-1 truncate">{m.attachment_original_name}</span>
                          <Download className="h-3 w-3 shrink-0" />
                        </a>
                      )
                    )}
                    <p className="text-[10px] mt-1.5 opacity-50 text-right">
                      {new Date(m.created_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                    </p>
                  </div>
                </div>
              )
            })}
            <div ref={msgEndRef} />
          </div>
          <div className="border-t p-4 bg-background space-y-2">
            {msgFile && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                {attachIcon(msgFile.type)}
                <span className="flex-1 truncate">{msgFile.name}</span>
                <span className="text-muted-foreground shrink-0">{(msgFile.size / 1024 / 1024).toFixed(1)} MB</span>
                <button onClick={() => setMsgFile(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input ref={msgFileInputRef} type="file" hidden
                accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx"
                onChange={e => { pickMsgFile(e.target.files?.[0] ?? null); e.target.value = "" }} />
              <button onClick={() => msgFileInputRef.current?.click()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground hover:bg-muted transition-colors" title="Attach file">
                <Paperclip className="h-4 w-4" />
              </button>
              <input value={msgDraft} onChange={e => setMsgDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Type a message…"
                className="flex-1 h-10 rounded-lg border border-input bg-muted/30 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <Button disabled={msgSending || (!msgDraft.trim() && !msgFile)} onClick={sendMessage} className="gap-1.5 h-10 px-5">
                {msgSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
