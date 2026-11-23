import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export const MY_MESSAGES_UNREAD_KEY = ["my-messages-unread"] as const

export function useMyMessagesUnread() {
  const { data } = useQuery({
    queryKey: MY_MESSAGES_UNREAD_KEY,
    queryFn: () =>
      api.get<{ ok: boolean; unread: number }>("/api/my-messages?peek=1")
        .then(d => d?.unread ?? 0),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  return data ?? 0
}
