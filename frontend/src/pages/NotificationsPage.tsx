import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Bell,
  AtSign,
  Clock,
  MessageSquare,
  Trash2,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useRecentlyDeleted,
  useDismissNotification,
  useRestoreNotification,
  usePurgeNotification,
  useRestoreNote,
  usePurgeNote,
} from '@/hooks/useNotifications'
import { ActiveRemindersPanel } from '@/components/ActiveRemindersPanel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PAGE_HEADER_CLASS, PAGE_BODY_CLASS } from '@/lib/layout'
import type { Notification, RecentlyDeletedItem } from '@/types'

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
}

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

function NotificationIcon({ type }: { type: Notification['type'] }) {
  if (type === 'mention') return <AtSign className="h-5 w-5 text-violet-500" />
  if (type === 'reminder') return <Clock className="h-5 w-5 text-amber-500" />
  return <MessageSquare className="h-5 w-5 text-indigo-500" />
}

function notificationTitle(type: Notification['type']): string {
  if (type === 'mention') return 'You were mentioned'
  if (type === 'reminder') return 'Reminder due'
  return 'New comment on your note'
}

const SECTION_CLASS = 'mb-8 overflow-hidden rounded-xl border border-border bg-white'
const SECTION_HEADING_CLASS =
  'text-sm font-semibold uppercase tracking-wider text-muted-foreground'

/**
 * Restore-or-purge list for soft-deleted notifications and reminders. Hidden
 * entirely while nothing has been deleted, so it never adds noise.
 */
function RecentlyDeletedSection() {
  const { data } = useRecentlyDeleted()
  const restoreNotification = useRestoreNotification()
  const purgeNotification = usePurgeNotification()
  const restoreNote = useRestoreNote()
  const purgeNote = usePurgeNote()

  const items = data?.items ?? []
  if (items.length === 0) return null

  function restore(item: RecentlyDeletedItem) {
    if (item.kind === 'notification') restoreNotification.mutate(item.id)
    else restoreNote.mutate(item.id)
  }

  function purge(item: RecentlyDeletedItem) {
    if (item.kind === 'notification') purgeNotification.mutate(item.id)
    else purgeNote.mutate(item.id)
  }

  return (
    <section data-testid="recently-deleted" className={SECTION_CLASS}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className={SECTION_HEADING_CLASS}>
          Recently deleted
          <span className="ml-2 font-normal normal-case">({items.length})</span>
        </h2>
      </div>

      <ul>
        {items.map((item) => (
          <li
            key={`${item.kind}-${item.id}`}
            className="flex items-start gap-3 border-b border-border/40 px-5 py-4 transition-colors last:border-0 hover:bg-muted/40"
          >
            <Undo2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              {item.detail && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {item.detail}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Deleted {formatTimeAgo(item.deleted_at)}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => restore(item)}
                title={`Restore ${item.label}`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => purge(item)}
                title={`Delete ${item.label} forever`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const { data: notificationsData, isLoading } = useNotifications({ limit: 50 })
  const { data: unreadData } = useUnreadCount()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const dismiss = useDismissNotification()

  const notifications = notificationsData?.items ?? []
  const unreadCount = unreadData?.unread_count ?? 0

  async function handleNotificationClick(id: string, repoId: string | null) {
    await markRead.mutateAsync(id)
    if (repoId) navigate(`/repos/${repoId}`)
  }

  return (
    <motion.div
      data-testid="notifications-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="min-h-screen"
    >
      {/* Page header */}
      <div data-testid="page-header" className={cn(PAGE_HEADER_CLASS, 'justify-between')}>
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {unreadCount} unread
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            loading={markAllRead.isPending}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div data-testid="notifications-body" className={PAGE_BODY_CLASS}>
        {/* Reminders you can manage directly */}
        <section className={SECTION_CLASS}>
          <ActiveRemindersPanel />
        </section>

        {/* The notification feed */}
        <section className={SECTION_CLASS}>
          <div className="border-b border-border px-5 py-4">
            <h2 className={SECTION_HEADING_CLASS}>Recent activity</h2>
          </div>

          {isLoading ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              Loading notifications...
            </p>
          ) : notifications.length === 0 ? (
            <div
              data-testid="notifications-empty"
              className="px-5 py-16 text-center text-muted-foreground"
            >
              <Bell className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm font-medium">No notifications</p>
              <p className="mt-1 text-sm">
                Mentions, replies and due reminders will appear here.
              </p>
            </div>
          ) : (
            <motion.ul variants={containerVariants} initial="hidden" animate="visible">
              {notifications.map((notif) => (
                <motion.li
                  key={notif.id}
                  variants={itemVariants}
                  data-testid="notification-row"
                  className={cn(
                    'flex items-start gap-3 border-b border-border/40 px-5 py-4 transition-colors last:border-0 hover:bg-muted/40',
                    !notif.is_read && 'bg-indigo-50/50'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(notif.id, notif.repo_id)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span className="mt-0.5 flex-shrink-0">
                      <NotificationIcon type={notif.type} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {notificationTitle(notif.type)}
                      </span>
                      {notif.note_content_preview && (
                        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                          {notif.note_content_preview}
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {formatTimeAgo(notif.created_at)}
                      </span>
                    </span>
                  </button>

                  {!notif.is_read && (
                    <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />
                  )}
                  <button
                    type="button"
                    onClick={() => dismiss.mutate(notif.id)}
                    title="Remove notification"
                    className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </section>

        {/* Undo surface for anything deleted by mistake */}
        <RecentlyDeletedSection />
      </div>
    </motion.div>
  )
}
