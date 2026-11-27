import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface InboxConversation {
  staffId: string
  name: string
  jobRole: string | null
  lastMessage: string
  lastAt: string
  lastFromStaff: boolean
  unread: number
}

interface InboxResponse {
  ok: boolean
  conversations: InboxConversation[]
  totalUnread: number
}

export const INBOX_KEY = ["inbox"] as const

export function useInboxUnread(enabled = true) {
  const { data } = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () =>
      api.get<InboxResponse>("/api/messages/inbox").then(d => d ?? { ok: true, conversations: [], totalUnread: 0 }),
    refetchInterval: 30_000,
    staleTime: 20_000,
    enabled,
  })

  return data?.totalUnread ?? 0
}

export function useInbox(enabled = true) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () =>
      api.get<InboxResponse>("/api/messages/inbox").then(d => d ?? { ok: true, conversations: [], totalUnread: 0 }),
    refetchInterval: 30_000,
    staleTime: 20_000,
    enabled,
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: INBOX_KEY })
  }

  return {
    conversations: data?.conversations ?? null,
    totalUnread: data?.totalUnread ?? 0,
    isLoading: isLoading && !data,
    invalidate,
  }
}
