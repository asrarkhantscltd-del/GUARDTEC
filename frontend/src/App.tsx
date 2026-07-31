import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"
import DashboardLayout from "@/layouts/DashboardLayout"
import LoginPage from "@/pages/LoginPage"
import DashboardPage from "@/pages/DashboardPage"
import StaffPage from "@/pages/StaffPage"
import StaffDetailPage from "@/pages/StaffDetailPage"
import FleetPage from "@/pages/FleetPage"
import CompliancePage from "@/pages/CompliancePage"
import SitesPage from "@/pages/SitesPage"
import type { ReactNode } from "react"

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />
          <Route
            element={
              <RequireAuth>
                <DashboardLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="staff" element={<StaffPage />} />
            <Route path="staff/:id" element={<StaffDetailPage />} />
            <Route path="fleet" element={<FleetPage />} />
            <Route path="sites" element={<SitesPage />} />
            <Route path="compliance" element={<CompliancePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
