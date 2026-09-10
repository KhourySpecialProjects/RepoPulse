import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bell, AtSign, Clock, MessageSquare } from 'lucide-react'
import {
  useNotifications,
  useUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/hooks/useNotifications'
import { ActiveRemindersPanel } from '@/components/ActiveRemindersPanel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Notification } from '@/types'

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
  if (type === 'mention') return <AtSign className="h-4 w-4 text-violet-500" />
  if (type === 'reminder') return <Clock className="h-4 w-4 text-amber-500" />
  return <MessageSquare className="h-4 w-4 text-indigo-500" />
}

function notificationTitle(type: Notification['type']): string {
  if (type === 'mention') return 'You were mentioned'
  if (type === 'reminder') return 'Reminder due'
  return 'New comment on your note'
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const { data: notificationsData, isLoading } = useNotifications({ limit: 50 })
  const { data: unreadData } = useUnreadCount()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

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
      <div className="border-b border-border bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
          {unreadCount > 0 && (
            <span className="text-xs font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
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

      <div className="px-6 py-6 max-w-3xl">
        {/* Reminders you can manage directly */}
        <section className="mb-6 rounded-xl border border-border bg-white overflow-hidden">
          <ActiveRemindersPanel />
        </section>

        {/* The notification feed */}
        <section className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent activity
            </h2>
          </div>

          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading notifications...
            </p>
          ) : notifications.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Bell className="h-7 w-7 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No notifications</p>
              <p className="text-xs mt-1">
                Mentions, replies and due reminders will appear here.
              </p>
            </div>
          ) : (
            <motion.ul variants={containerVariants} initial="hidden" animate="visible">
              {notifications.map((notif) => (
                <motion.li key={notif.id} variants={itemVariants}>
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(notif.id, notif.repo_id)}
                    className={cn(
                      'w-full text-left flex items-start gap-3 px-4 py-3 transition-colors border-b border-border/50 last:border-0 hover:bg-muted/50',
                      !notif.is_read && 'bg-indigo-50/50'
                    )}
                  >
                    <span className="flex-shrink-0 mt-0.5">
                      <NotificationIcon type={notif.type} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {notificationTitle(notif.type)}
                      </span>
                      {notif.note_content_preview && (
                        <span className="block text-xs text-muted-foreground truncate mt-0.5">
                          {notif.note_content_preview}
                        </span>
                      )}
                      <span className="block text-[11px] text-muted-foreground mt-1">
                        {formatTimeAgo(notif.created_at)}
                      </span>
                    </span>
                    {!notif.is_read && (
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 mt-1.5" />
                    )}
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </section>
      </div>
    </motion.div>
  )
}
