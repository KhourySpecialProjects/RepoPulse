import { useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, User, Shield, X, MessageSquare, AtSign } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useUnreadCount, useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/hooks/useNotifications'
import { LoginPage } from '@/pages/LoginPage'
import { CollectionsPage } from '@/pages/CollectionsPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { UserProfilePage } from '@/pages/UserProfilePage'
import { AdminPage } from '@/pages/AdminPage'

// ---- Notification Bell ----
function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data: unreadData } = useUnreadCount()
  const { data: notificationsData } = useNotifications({ limit: 20 })
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const unreadCount = unreadData?.unread_count ?? 0
  const notifications = notificationsData?.items ?? []

  function formatTimeAgo(isoStr: string): string {
    const ms = Date.now() - new Date(isoStr).getTime()
    const minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  async function handleNotificationClick(id: string, repoId: string | null) {
    await markRead.mutateAsync(id)
    setOpen(false)
    if (repoId) {
      navigate(`/repos/${repoId}`)
    }
  }

  async function handleMarkAllRead() {
    await markAllRead.mutateAsync()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-1 w-80 z-50 bg-white border border-border rounded-xl shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                <span className="text-sm font-semibold">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-amber-600">
                      {unreadCount} unread
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-xs text-indigo-600 hover:text-indigo-700 transition-colors px-1.5 py-0.5 rounded"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-muted-foreground hover:text-foreground p-0.5"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <Bell className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No notifications</p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => handleNotificationClick(notif.id, notif.repo_id)}
                      className={`w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0 ${
                        !notif.is_read ? 'bg-indigo-50/50' : ''
                      }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {notif.type === 'mention' ? (
                          <AtSign className="h-4 w-4 text-violet-500" />
                        ) : (
                          <MessageSquare className="h-4 w-4 text-indigo-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {notif.type === 'mention' ? 'You were mentioned' : 'New comment on your note'}
                        </p>
                        {notif.note_content_preview && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {notif.note_content_preview}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatTimeAgo(notif.created_at)}
                        </p>
                      </div>
                      {!notif.is_read && (
                        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 mt-1.5" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---- NavBar ----
function NavBar() {
  const { user, logout } = useAuth()
  const location = useLocation()

  function isActive(path: string) {
    return location.pathname.startsWith(path)
  }

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-border shadow-sm">
      <div className="container max-w-7xl flex h-14 items-center justify-between">
        <a href="/collections" className="flex items-center gap-2 font-bold text-lg text-foreground">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-sm font-bold shadow-sm">
            R
          </span>
          RepoPulse
        </a>
        <nav className="flex items-center gap-1">
          <a
            href="/collections"
            className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
              isActive('/collections')
                ? 'bg-indigo-50 text-indigo-700 font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            Collections
          </a>
          <a
            href="/settings"
            className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
              isActive('/settings')
                ? 'bg-indigo-50 text-indigo-700 font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            Settings
          </a>
          {user?.role === 'admin' && (
            <a
              href="/admin"
              className={`text-sm px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 ${
                isActive('/admin')
                  ? 'bg-rose-50 text-rose-700 font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              Admin
            </a>
          )}
          {user && (
            <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border">
              <NotificationBell />
              <a
                href="/profile"
                title="My Profile"
                className={`p-1.5 rounded-md transition-colors ${
                  isActive('/profile')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <User className="h-4 w-4" />
              </a>
              <span className="text-xs text-muted-foreground">{user.display_name}</span>
              <button
                onClick={logout}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}

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
          element={isAuthenticated ? <Navigate to="/collections" replace /> : <LoginPage />}
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Navigate to="/collections" replace />
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

export function App() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {isAuthenticated && <NavBar />}
      <main>
        <AppRoutes />
      </main>
    </div>
  )
}
