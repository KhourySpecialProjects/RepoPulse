import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  GitBranch,
  ChevronLeft,
  ChevronRight,
  Bell,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight as ChevronRightSmall,
  Settings,
  Shield,
  LogOut,
  X,
  MessageSquare,
  AtSign,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCollections } from '@/hooks/useCollections'
import { useRepos, useRepo } from '@/hooks/useRepos'
import {
  useUnreadCount,
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/hooks/useNotifications'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { useSidebar, COLLAPSED_GUTTER } from '@/contexts/SidebarContext'
import type { HealthStatus } from '@/types'

// ── Health dot ──────────────────────────────────────────────────────────────
const HEALTH_DOT_CLASS: Record<HealthStatus | 'unknown', string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
  unknown: 'bg-slate-500',
}

// ── Nav item base class ──────────────────────────────────────────────────────
const NAV_BASE =
  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer select-none'
const NAV_DEFAULT = 'text-slate-300 hover:text-white hover:bg-slate-800'
const NAV_ACTIVE = 'bg-indigo-600/20 text-indigo-300'

// ── Notification dropdown ────────────────────────────────────────────────────
function NotificationDropdown({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { data: notificationsData } = useNotifications({ limit: 20 })
  const { data: unreadData } = useUnreadCount()
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
    onClose()
    if (repoId) navigate(`/repos/${repoId}`)
  }

  async function handleMarkAllRead() {
    await markAllRead.mutateAsync()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -8, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -8, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="absolute left-full top-0 ml-2 w-80 z-50 bg-white border border-border rounded-xl shadow-xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-foreground">
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
            onClick={onClose}
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
                  {notif.type === 'mention'
                    ? 'You were mentioned'
                    : 'New comment on your note'}
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
  )
}

// ── Collection tree item ──────────────────────────────────────────────────────
function CollectionTreeItem({
  collection,
  expanded,
  onToggle,
  activeRepoId,
  collapsed: sidebarCollapsed,
}: {
  collection: { id: string; name: string }
  expanded: boolean
  onToggle: () => void
  activeRepoId: string | null
  collapsed: boolean
}) {
  const navigate = useNavigate()
  const { data: reposData } = useRepos(collection.id, 50, 0)
  const repos = reposData?.items ?? []

  if (sidebarCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            className={`w-full flex items-center justify-center py-2 rounded-md transition-colors ${NAV_DEFAULT}`}
          >
            {expanded ? (
              <FolderOpen className="h-4 w-4 flex-shrink-0" />
            ) : (
              <Folder className="h-4 w-4 flex-shrink-0" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{collection.name}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div>
      <div className={`w-full ${NAV_BASE} ${NAV_DEFAULT} justify-between pr-1`}>
        <button
          type="button"
          onClick={() => navigate(`/collections/${collection.id}`)}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
        >
          {expanded ? (
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-slate-400" />
          ) : (
            <Folder className="h-4 w-4 flex-shrink-0 text-slate-400" />
          )}
          <span className="truncate">{collection.name}</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex-shrink-0 p-0.5 rounded hover:bg-slate-700 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          ) : (
            <ChevronRightSmall className="h-3.5 w-3.5 text-slate-500" />
          )}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden pl-3 border-l border-slate-700 ml-4 mt-0.5"
          >
            {repos.length === 0 ? (
              <p className="text-xs text-slate-500 py-1.5 pl-1">No repos</p>
            ) : (
              repos.map((repo) => {
                const isActive = repo.id === activeRepoId
                return (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => navigate(`/repos/${repo.id}`)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm transition-colors rounded-md ${
                      isActive
                        ? 'bg-indigo-600/20 text-indigo-300 border-l-2 border-indigo-400 rounded-l-none pl-1.5'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        HEALTH_DOT_CLASS[repo.health_status ?? 'unknown']
                      }`}
                    />
                    <span className="truncate text-xs">{repo.name}</span>
                  </button>
                )
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Sidebar nav item (bottom section) ────────────────────────────────────────
function SidebarNavItem({
  icon: Icon,
  label,
  onClick,
  isActive,
  collapsed,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  isActive?: boolean
  collapsed: boolean
  danger?: boolean
}) {
  const baseClass = `${NAV_BASE} ${
    danger
      ? 'text-slate-400 hover:text-red-400 hover:bg-red-950/30'
      : isActive
        ? NAV_ACTIVE
        : NAV_DEFAULT
  }`

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center justify-center py-2 rounded-md transition-colors ${
              danger
                ? 'text-slate-400 hover:text-red-400 hover:bg-red-950/30'
                : isActive
                  ? NAV_ACTIVE
                  : NAV_DEFAULT
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <button type="button" onClick={onClick} className={`w-full ${baseClass}`}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

const MIN_WIDTH = 160
const MAX_WIDTH = 480
const COLLAPSE_THRESHOLD = 120

// ── Main sidebar ─────────────────────────────────────────────────────────────
export function AppSidebar() {
  const { collapsed, setCollapsed, width, setWidth } = useSidebar()
  const isDragging = useRef(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ id: string }>()

  // Determine active repo id from URL
  const isOnRepoPage = location.pathname.startsWith('/repos/')
  const activeRepoId = isOnRepoPage ? params.id ?? null : null

  // Fetch the active repo to find its collection_id for auto-expand
  const { data: activeRepo } = useRepo(activeRepoId ?? '')

  // Collections
  const { data: collectionsData } = useCollections(50, 0, false)
  const collections = collectionsData?.items ?? []

  // Expanded collections state (persisted to localStorage)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('sidebar_expanded_collections')
      if (stored) {
        return new Set(JSON.parse(stored) as string[])
      }
    } catch {
      // ignore
    }
    return new Set<string>()
  })

  // Notification bell state
  const [notifOpen, setNotifOpen] = useState(false)
  const { data: unreadData } = useUnreadCount()
  const unreadCount = unreadData?.unread_count ?? 0

  // Auto-expand collection containing the active repo
  useEffect(() => {
    if (activeRepo?.collection_id) {
      setExpandedIds((prev) => {
        if (prev.has(activeRepo.collection_id)) return prev
        const next = new Set(prev)
        next.add(activeRepo.collection_id)
        return next
      })
    }
  }, [activeRepo?.collection_id])

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem(
      'sidebar_expanded_collections',
      JSON.stringify(Array.from(expandedIds))
    )
  }, [expandedIds])

  const toggleCollection = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar_collapsed', String(next))
  }

  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(ev: MouseEvent) {
      if (!isDragging.current) return
      const newWidth = ev.clientX
      if (newWidth < COLLAPSE_THRESHOLD) {
        // snap to collapsed
        setCollapsed(true)
        localStorage.setItem('sidebar_collapsed', 'true')
      } else {
        const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth))
        setCollapsed(false)
        localStorage.setItem('sidebar_collapsed', 'false')
        setWidth(clamped)
        localStorage.setItem('sidebar_width', String(clamped))
      }
    }

    function onMouseUp() {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function isActive(path: string) {
    return location.pathname.startsWith(path)
  }

  // Collapsed leaves only a slim rail holding the expand arrow. The rail is
  // exactly COLLAPSED_GUTTER wide — the same space App reserves — so page
  // headers butt against its right border and read as closed off rather than
  // stopping short with a raw edge. The arrow keeps the same horizontal line as
  // the collapse arrow it replaces (h-14 header = 56px, so top-3 + h-8 centres
  // both at 28px).
  if (collapsed) {
    return (
      <div
        className="fixed left-0 top-0 bottom-0 z-40 bg-gray-50 border-r border-border"
        style={{ width: COLLAPSED_GUTTER }}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="fixed left-3 top-3 z-50 flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="fixed left-0 top-0 bottom-0 z-40 bg-slate-900 flex flex-col overflow-hidden"
        style={{ width }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={handleDragStart}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-50 hover:bg-indigo-500/50 transition-colors group"
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 -left-0.5 -right-0.5 group-hover:bg-indigo-500/20" />
        </div>
        {/* ── Header ── */}
        <div className="h-14 flex items-center justify-between flex-shrink-0 border-b border-slate-700/50 px-3">
          {!collapsed && (
            <Link to="/" aria-label="RepoPulse home dashboard" className="flex items-center gap-2 min-w-0 rounded-md hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
              <GitBranch className="h-5 w-5 text-indigo-400 flex-shrink-0" />
              <span className="font-semibold text-white text-sm truncate">RepoPulse</span>
            </Link>
          )}
          {collapsed && (
            <Link to="/" aria-label="RepoPulse home dashboard" className="flex items-center justify-center w-full rounded-md hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
              <GitBranch className="h-5 w-5 text-indigo-400" />
            </Link>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ── Notification bell ── */}
        <div className="px-2 pt-2 flex-shrink-0 relative">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  className={`relative w-full flex items-center justify-center py-2 rounded-md transition-colors ${NAV_DEFAULT}`}
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-2 min-w-[14px] h-3.5 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Notifications</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => setNotifOpen((v) => !v)}
              className={`relative w-full ${NAV_BASE} ${NAV_DEFAULT}`}
            >
              <Bell className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Notifications</span>
              {unreadCount > 0 && (
                <span className="ml-auto min-w-[18px] h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          )}

          <AnimatePresence>
            {notifOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setNotifOpen(false)}
                />
                <div className="relative z-50">
                  <NotificationDropdown onClose={() => setNotifOpen(false)} />
                </div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* ── Collection tree ── */}
        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
          {!collapsed && (
            <button
              type="button"
              onClick={() => navigate('/collections')}
              title="View all collections"
              className={`text-xs font-semibold uppercase tracking-wider px-3 py-1 mt-2 mb-1 rounded transition-colors ${
                location.pathname === '/collections'
                  ? 'text-indigo-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Collections
            </button>
          )}
          <div className="flex flex-col gap-0.5">
            {collections.map((col) => (
              <CollectionTreeItem
                key={col.id}
                collection={col}
                expanded={expandedIds.has(col.id)}
                onToggle={() => toggleCollection(col.id)}
                activeRepoId={activeRepoId}
                collapsed={collapsed}
              />
            ))}
          </div>
        </div>

        {/* ── Bottom nav ── */}
        <div className="flex-shrink-0 border-t border-slate-700/50 px-2 py-2 flex flex-col gap-0.5">
          <SidebarNavItem
            icon={Settings}
            label="Settings"
            onClick={() => navigate('/settings')}
            isActive={isActive('/settings')}
            collapsed={collapsed}
          />
          {user?.role === 'admin' && (
            <SidebarNavItem
              icon={Shield}
              label="Admin"
              onClick={() => navigate('/admin')}
              isActive={isActive('/admin')}
              collapsed={collapsed}
            />
          )}
          <SidebarNavItem
            icon={LogOut}
            label="Log out"
            onClick={logout}
            collapsed={collapsed}
            danger
          />
        </div>
      </div>
    </TooltipProvider>
  )
}
