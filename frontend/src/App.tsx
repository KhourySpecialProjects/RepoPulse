import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { LoginPage } from '@/pages/LoginPage'
import { CollectionsPage } from '@/pages/CollectionsPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { UserProfilePage } from '@/pages/UserProfilePage'
import { AdminPage } from '@/pages/AdminPage'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarContext, COLLAPSED_GUTTER } from '@/contexts/SidebarContext'

interface ProtectedRouteProps {
  children: React.ReactNode
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/collections"
          element={
            <ProtectedRoute>
              <CollectionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/collections/:id"
          element={
            <ProtectedRoute>
              <CollectionDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/repos/:id"
          element={
            <ProtectedRoute>
              <RepoDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <UserProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/collections" replace />} />
      </Routes>
    </AnimatePresence>
  )
}

const DEFAULT_WIDTH = 220

export function App() {
  const { isAuthenticated, isLoading } = useAuth()
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem('sidebar_collapsed') === 'true'
  )
  const [width, setWidth] = useState<number>(() => {
    const stored = parseInt(localStorage.getItem('sidebar_width') ?? '', 10)
    return isNaN(stored) ? DEFAULT_WIDTH : stored
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppRoutes />
      </div>
    )
  }

  // Collapsed hides the sidebar, but keep a gutter clear so the floating
  // expand arrow doesn't overlap page content (e.g. header back arrows)
  const marginLeft = collapsed ? COLLAPSED_GUTTER : width

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, width, setWidth }}>
      <div className="flex min-h-screen bg-gray-50">
        <AppSidebar />
        {/* No transition during drag — sidebar updates width synchronously */}
        <main className="flex-1 min-w-0" style={{ marginLeft }}>
          <AppRoutes />
        </main>
      </div>
    </SidebarContext.Provider>
  )
}
