import { RefreshCw, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Repo } from '@/types'

/**
 * Shows a repo's sync state as reported by the server.
 *
 * Deliberately driven by `repo.sync_status` rather than local state: the point
 * is that a sync started by one person is visible to everyone else looking at
 * the same collection. Whoever clicked the button gets no special treatment.
 */
export function SyncIndicator({ repo, className }: { repo: Repo; className?: string }) {
  if (repo.sync_status === 'syncing') {
    return (
      <span
        data-testid="sync-indicator"
        className={cn(
          'inline-flex items-center gap-1.5 text-xs text-brand-600',
          className
        )}
      >
        <RefreshCw className="h-3 w-3 animate-spin motion-reduce:animate-none" />
        {repo.sync_started_by_name
          ? `Syncing — started by ${repo.sync_started_by_name}`
          : 'Syncing'}
      </span>
    )
  }

  if (repo.sync_status === 'failed') {
    return (
      <span
        data-testid="sync-indicator"
        className={cn('inline-flex items-center gap-1.5 text-xs text-red-600', className)}
        title={repo.sync_error ?? undefined}
      >
        <AlertTriangle className="h-3 w-3" />
        Sync failed
      </span>
    )
  }

  return null
}
