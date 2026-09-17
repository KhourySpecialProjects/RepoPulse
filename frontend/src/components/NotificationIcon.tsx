import {
  AtSign,
  Clock,
  FolderMinus,
  FolderPlus,
  GitMerge,
  GitPullRequest,
  HeartPulse,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NotificationEvent } from '@/types'

/** Icon and accent colour per event, shared by every surface that lists them. */
const ICONS: Record<NotificationEvent, { Icon: LucideIcon; color: string }> = {
  mention: { Icon: AtSign, color: 'text-orchid-500' },
  note_comment: { Icon: MessageSquare, color: 'text-brand-500' },
  reminder: { Icon: Clock, color: 'text-amber-500' },
  repo_added: { Icon: FolderPlus, color: 'text-emerald-500' },
  repo_removed: { Icon: FolderMinus, color: 'text-red-500' },
  repo_health_declined: { Icon: HeartPulse, color: 'text-red-500' },
  pr_opened: { Icon: GitPullRequest, color: 'text-sky-500' },
  pr_merged: { Icon: GitMerge, color: 'text-emerald-500' },
}

const FALLBACK = { Icon: MessageSquare, color: 'text-brand-500' }

export function NotificationIcon({
  type,
  className,
}: {
  type: NotificationEvent
  className?: string
}) {
  // A newer backend can raise a type this build has never heard of, so fall
  // back to the generic icon rather than rendering nothing.
  const { Icon, color } = ICONS[type] ?? FALLBACK
  return <Icon className={cn('h-5 w-5', color, className)} />
}
