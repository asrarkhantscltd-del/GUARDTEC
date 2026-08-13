import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"
import { ThemeProvider } from "@/contexts/ThemeContext"
import DashboardLayout from "@/layouts/DashboardLayout"
import StaffLayout from "@/layouts/StaffLayout"
import LoginPage from "@/pages/LoginPage"
import RegisterPage from "@/pages/RegisterPage"
import DashboardPage from "@/pages/DashboardPage"
import StaffPage from "@/pages/StaffPage"
import StaffDetailPage from "@/pages/StaffDetailPage"
import FleetPage from "@/pages/FleetPage"
import CompliancePage from "@/pages/CompliancePage"
import SitesPage from "@/pages/SitesPage"
import UsersPage from "@/pages/UsersPage"
import ManageRolesPage from "@/pages/ManageRolesPage"
import PendingReviewPage from "@/pages/PendingReviewPage"
import IncidentReportsPage from "@/pages/IncidentReportsPage"
import MyProfilePage from "@/pages/MyProfilePage"
import { ErrorBoundary } from "@/components/ErrorBoundary"
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

// Staff members get a stripped-down self-service shell — just their own
// profile — everyone else gets the full management dashboard.
function AuthenticatedApp() {
  const { user } = useAuth()

  if (user?.role === "staff") {
    return (
      <Routes>
        <Route element={<StaffLayout />}>
          <Route index element={<MyProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="staff/:id" element={<StaffDetailPage />} />
        <Route path="fleet" element={<FleetPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="roles" element={<ManageRolesPage />} />
        <Route path="pending-review" element={<PendingReviewPage />} />
        <Route path="incident-reports" element={<IncidentReportsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

// One QueryClient for the app's lifetime — created outside the component so
// it survives re-renders. Internal LAN tool, modest traffic: don't refetch
// on every window focus, but do retry once on a transient network blip.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
        <Toaster richColors position="bottom-right" />
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
            path="/register"
            element={
              <GuestOnly>
                <RegisterPage />
              </GuestOnly>
            }
          />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <ErrorBoundary>
                  <AuthenticatedApp />
                </ErrorBoundary>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
    </QueryClientProvider>
  )
}
