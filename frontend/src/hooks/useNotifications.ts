import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  dismissNotification,
  getNotifications,
  getNotificationSettings,
  getRecentlyDeleted,
  getReminders,
  getUnreadCount,
  purgeNote,
  purgeNotification,
  restoreNote,
  restoreNotification,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
  markAllNotificationsUnread,
  sendTestEmail,
  updateNotificationSettings,
} from '@/services/api'
import type { UpdateNotificationSettingsData } from '@/types'

export function useNotifications(params?: {
  unread_only?: boolean
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ['notifications', params],
    queryFn: () => getNotifications(params),
    staleTime: 30_000,
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

/** The current user's outstanding reminders, for the notifications panel. */
export function useReminders() {
  return useQuery({
    queryKey: ['notifications', 'reminders'],
    queryFn: getReminders,
    staleTime: 15_000,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// ── Recently deleted (soft delete) ──────────────────────────────────────────

/** Notifications and reminders awaiting restore or permanent deletion. */
export function useRecentlyDeleted() {
  return useQuery({
    queryKey: ['notifications', 'recently-deleted'],
    queryFn: getRecentlyDeleted,
    staleTime: 15_000,
  })
}

/**
 * Every soft-delete action touches the feed, the reminders list, the recently
 * deleted list and the unread count, so they all invalidate together.
 */
function useSoftDeleteMutation(mutationFn: (id: string) => Promise<void>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notes'] })
      qc.invalidateQueries({ queryKey: ['repos'] })
    },
  })
}

export function useDismissNotification() {
  return useSoftDeleteMutation(dismissNotification)
}

export function useRestoreNotification() {
  return useSoftDeleteMutation(restoreNotification)
}

export function usePurgeNotification() {
  return useSoftDeleteMutation(purgeNotification)
}

export function useRestoreNote() {
  return useSoftDeleteMutation(restoreNote)
}

export function usePurgeNote() {
  return useSoftDeleteMutation(purgeNote)
}

export function useMarkNotificationUnread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markNotificationUnread(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllNotificationsUnread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markAllNotificationsUnread,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// ── Email relay ─────────────────────────────────────────────────────────────

export function useNotificationSettings() {
  return useQuery({
    queryKey: ['notifications', 'settings'],
    queryFn: getNotificationSettings,
    staleTime: 60_000,
  })
}

export function useUpdateNotificationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateNotificationSettingsData) =>
      updateNotificationSettings(data),
    onSuccess: (settings) => {
      // The response is the full new state, so seed the cache with it rather
      // than invalidating and refetching what we were just handed.
      qc.setQueryData(['notifications', 'settings'], settings)
    },
  })
}

export function useSendTestEmail() {
  return useMutation({ mutationFn: sendTestEmail })
}
