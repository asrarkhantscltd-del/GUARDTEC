import { useAuth, type Permissions } from "@/contexts/AuthContext"

export type Permission = keyof Permissions

// Mirrors the backend's requirePermission(): a Director always passes,
// everyone else needs the toggle switched on for their role in Manage Roles.
export function usePermissions() {
  const { user } = useAuth()
  const isDirector = user?.role === "director"
  const can = (permission: Permission) => isDirector || !!user?.permissions?.[permission]
  return { isDirector, can }
}
