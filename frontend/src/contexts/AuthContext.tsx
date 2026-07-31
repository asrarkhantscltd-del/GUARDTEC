import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react"

export type UserRole =
  | "director"
  | "ops_manager"
  | "hr_manager"
  | "office_manager"
  | "accounts"
  | "media"
  | "supervisor"
  | "fleet_manager"
  | "staff"

export interface User {
  id: number
  username: string
  full_name: string
  role: UserRole
  staff_id?: string | null
  departments: string[]
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  async function refreshUser() {
    try {
      const res = await fetch("/api/me", { credentials: "include" })
      const data = res.ok ? await res.json() : null
      setUser(data?.user ?? null)
    } catch {
      setUser(null)
    }
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))
  }, [])

  async function login(username: string, password: string) {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || "Login failed")
    }
    const data = await res.json()
    setUser(data.user)
  }

  async function logout() {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    })
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
