import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface AppNotification {
  id: string
  type: string
  message: string
  actor_name: string
  summary: string
  created_at: string
  link_staff_id?: string
  link_tab?: string
  link_incident_id?: string
  link_agency_id?: string
}

export const NOTIFS_KEY = ["notifications"] as const

export function useNotifications() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: NOTIFS_KEY,
    queryFn: () =>
      api.get<{ ok: boolean; notifications: AppNotification[] }>("/api/notifications")
        .then(d => d?.notifications ?? []),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  function dismiss(id: string) {
    qc.setQueryData<AppNotification[]>(NOTIFS_KEY, prev => (prev ?? []).filter(n => n.id !== id))
    api.post(`/api/notifications/${id}/seen`).catch(() => {})
  }

  function dismissAll() {
    qc.setQueryData<AppNotification[]>(NOTIFS_KEY, [])
    api.post("/api/notifications/seen-all").catch(() => {})
  }

  return {
    notifications: data ?? [],
    isLoading,
    dismiss,
    dismissAll,
  }
}
