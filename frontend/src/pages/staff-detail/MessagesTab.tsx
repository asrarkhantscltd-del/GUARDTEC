import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Loader2, FileText, Trash2, X as XIcon, MessageSquare, Send, Paperclip, FileVideo,
  Image as ImageIcon, Download, Ban,
} from "lucide-react"

export default function MessagesTab({ staffId, staffName, canDelete }: {
  staffId: string; staffName: string; canDelete: boolean
}) {
  const id = staffId
  const [messages, setMessages]       = useState<{
    id: string; message: string; sender_name: string; sender_role: string; created_at: string
    deleted_at?: string | null
    attachment_id?: string; attachment_filename?: string; attachment_original_name?: string
    attachment_mime_type?: string; attachment_size?: number
  }[]>([])
  const [msgLoading, setMsgLoading]   = useState(false)
  const [msgDraft, setMsgDraft]       = useState("")
  const [msgSending, setMsgSending]   = useState(false)
  const [msgFile, setMsgFile]         = useState<File | null>(null)
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null)
  const [deletingMsg, setDeletingMsg] = useState(false)
  const msgFileInputRef               = useRef<HTMLInputElement>(null)
  const msgEndRef                     = useRef<HTMLDivElement>(null)

  useEffect(() => { loadMessages() }, [staffId])

  async function loadMessages() {
    if (!id) return
    setMsgLoading(true)
    try {
      const d = await api.get<{ ok: boolean; messages: typeof messages }>(`/api/staff/${id}/messages`)
      if (d.ok) {
        setMessages(d.messages)
        setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
      }
    } finally {
      setMsgLoading(false)
    }
  }

  async function sendMessage() {
    if (!msgDraft.trim() && !msgFile) return
    setMsgSending(true)
    try {
      const d = await api.post<{ ok: boolean; message: { id: string } }>(`/api/staff/${id}/messages`, { message: msgDraft.trim() || `📎 ${msgFile?.name}` })
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
    } finally {
      setMsgSending(false)
    }
  }

  function pickMsgFile(file: File | null) {
    if (!file) return
    const allowed = ["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
    if (!allowed.includes(file.type)) { toast.error("Only images, videos, PDFs, and Word docs are allowed."); return }
    if (file.size > 100 * 1024 * 1024) { toast.error("File too large (max 100 MB)."); return }
    setMsgFile(file)
  }

  async function deleteMessage(messageId: string) {
    setDeletingMsg(true)
    try {
      await api.delete(`/api/messages/${messageId}`)
      setMessages(prev => prev.filter(m => m.id !== messageId))
      toast.success("Message removed")
    } finally {
      setDeletingMsg(false)
      setConfirmDeleteMsgId(null)
    }
  }

  function msgAttachIcon(mime?: string) {
    if (!mime) return <FileText className="h-3.5 w-3.5 shrink-0" />
    if (mime.startsWith("video/")) return <FileVideo className="h-3.5 w-3.5 shrink-0" />
    if (mime.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5 shrink-0" />
    return <FileText className="h-3.5 w-3.5 shrink-0" />
  }

  return (
    <motion.div key="messages" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <Card className="flex flex-col" style={{ minHeight: "480px" }}>
        <CardHeader className="pb-2 border-b">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Messages with {staffName}
          </CardTitle>
          <p className="text-xs text-muted-foreground">Messages are private between management and this staff member.</p>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 p-0">
          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ maxHeight: "360px" }}>
            {msgLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
            {!msgLoading && messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Send the first one below.</p>
            )}
            {messages.map(m => {
              const isStaff = m.sender_role === "staff"
              const isImage = m.attachment_mime_type?.startsWith("image/")
              // Deleted by the staff member — original text is in the Audit Trail (Director).
              if (m.deleted_at) return (
                <div key={m.id} className={`flex ${isStaff ? "justify-start" : "justify-end"}`}>
                  <p className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed px-3.5 py-2 text-xs italic text-muted-foreground">
                    <Ban className="h-3.5 w-3.5" /> {m.sender_name} deleted this message
                  </p>
                </div>
              )
              return (
                <div key={m.id} className={`group flex items-end gap-1.5 ${isStaff ? "justify-start" : "justify-end"}`}>
                  {!isStaff && canDelete && (
                    <button onClick={() => setConfirmDeleteMsgId(m.id)}
                      className="mb-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive hover:bg-destructive/10 group-hover:opacity-100">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                  <div className={`max-w-xs rounded-2xl px-3.5 py-2 text-sm shadow-sm ${isStaff ? "bg-muted text-foreground rounded-tl-sm" : "bg-primary text-primary-foreground rounded-tr-sm"}`}>
                    <p className="text-[11px] font-medium mb-0.5 opacity-70">{m.sender_name}</p>
                    <p>{m.message}</p>
                    {m.attachment_filename && (
                      isImage ? (
                        <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" className="mt-1.5 block">
                          <img src={`/api/message-attachments/${m.attachment_filename}`} alt={m.attachment_original_name}
                            className="max-h-48 w-full rounded-lg object-cover" />
                        </a>
                      ) : (
                        <a href={`/api/message-attachments/${m.attachment_filename}`} target="_blank" rel="noopener noreferrer" download={m.attachment_original_name}
                          className={`mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${isStaff ? "bg-background/60" : "bg-white/15"}`}>
                          {msgAttachIcon(m.attachment_mime_type)}
                          <span className="flex-1 truncate">{m.attachment_original_name}</span>
                          <Download className="h-3 w-3 shrink-0" />
                        </a>
                      )
                    )}
                    <p className={`text-[10px] mt-0.5 opacity-60 text-right`}>
                      {new Date(m.created_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                    </p>
                  </div>
                  {isStaff && canDelete && (
                    <button onClick={() => setConfirmDeleteMsgId(m.id)}
                      className="mb-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive hover:bg-destructive/10 group-hover:opacity-100">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
            <div ref={msgEndRef} />
          </div>
          {confirmDeleteMsgId && (
            <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">Remove this message for both sides?</p>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => setConfirmDeleteMsgId(null)} className="rounded px-2.5 py-1 text-xs border hover:bg-muted transition-colors">Cancel</button>
                <button onClick={() => deleteMessage(confirmDeleteMsgId)} disabled={deletingMsg}
                  className="rounded bg-destructive px-2.5 py-1 text-xs text-white hover:bg-destructive/90 transition-colors disabled:opacity-50">
                  {deletingMsg ? "Removing…" : "Yes, remove"}
                </button>
              </div>
            </div>
          )}
          {/* Compose */}
          <div className="border-t px-4 py-3 space-y-2">
            {msgFile && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                {msgAttachIcon(msgFile.type)}
                <span className="flex-1 truncate">{msgFile.name}</span>
                <span className="text-muted-foreground shrink-0">{(msgFile.size / 1024 / 1024).toFixed(1)} MB</span>
                <button onClick={() => setMsgFile(null)} className="text-muted-foreground hover:text-destructive">
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input ref={msgFileInputRef} type="file" hidden
                accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx"
                onChange={e => { pickMsgFile(e.target.files?.[0] ?? null); e.target.value = "" }} />
              <button onClick={() => msgFileInputRef.current?.click()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted transition-colors" title="Attach file">
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                value={msgDraft}
                onChange={e => setMsgDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder={`Message ${staffName}…`}
                className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button size="sm" disabled={msgSending || (!msgDraft.trim() && !msgFile)} onClick={sendMessage} className="gap-1.5">
                {msgSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
