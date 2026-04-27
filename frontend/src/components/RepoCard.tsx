import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Code2, RefreshCw, Trash2, Users, Clock, Bell, GitCommit } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { HealthBadge } from '@/components/HealthBadge'
import { useSyncRepo, useDeleteRepo } from '@/hooks/useRepos'
import { useCurrentUser } from '@/hooks/useUsers'
import type { Repo, HealthStatus } from '@/types'

const healthBorderClass: Record<HealthStatus, string> = {
  green: 'border-l-4 border-l-emerald-400',
  yellow: 'border-l-4 border-l-amber-400',
  red: 'border-l-4 border-l-red-400',
  unknown: 'border-l-4 border-l-gray-300',
}

interface RepoCardProps {
  repo: Repo
  weeklyCommits?: number[]
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function RepoCard({ repo, weeklyCommits = [] }: RepoCardProps) {
  const navigate = useNavigate()
  const syncMutation = useSyncRepo()
  const deleteRepoMutation = useDeleteRepo()
  const { data: currentUser } = useCurrentUser()
  const hasToken = Boolean(currentUser?.github_token_configured)

  const sparklineData = weeklyCommits.map((count, index) => ({ week: index, commits: count }))

  function handleGitHub() {
    window.open(repo.github_url, '_blank', 'noopener,noreferrer')
  }

  function handleVSCode() {
    if (repo.local_path) {
      window.open(`vscode://file/${repo.local_path}`)
    }
  }

  function handleSync(e: React.MouseEvent) {
    e.stopPropagation()
    syncMutation.mutate(repo.id)
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    if (window.confirm('Remove this repository?')) {
      deleteRepoMutation.mutate(repo.id)
    }
  }

  function handleDetails() {
    navigate(`/repos/${repo.id}`)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <Card className={cn('flex flex-col h-full bg-white shadow-sm hover:shadow-md border border-gray-100 transition-all duration-200 cursor-pointer overflow-hidden', healthBorderClass[repo.health_status])} onClick={handleDetails}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-base leading-tight truncate flex-1" title={repo.name}>
              {repo.name}
            </h3>
            <HealthBadge status={repo.health_status} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 flex-1">
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {repo.contributor_count} contributor{repo.contributor_count !== 1 ? 's' : ''}
              </span>
              {repo.active_reminder_count > 0 && (
                <span className="flex items-center gap-1 text-amber-600 font-medium">
                  <Bell className="h-3.5 w-3.5" />
                  {repo.active_reminder_count} reminder{repo.active_reminder_count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1" title="Last synced">
                <Clock className="h-3.5 w-3.5" />
                {formatDate(repo.last_synced_at)}
              </span>
              <span className="flex items-center gap-1" title="Last commit">
                <GitCommit className="h-3.5 w-3.5" />
                {formatDateTime(repo.last_commit_at)}
              </span>
            </div>
          </div>

          {sparklineData.length > 0 && (
            <div className="h-12">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparklineData}>
                  <Line
                    type="monotone"
                    dataKey="commits"
                    stroke="hsl(var(--primary))"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: '11px', padding: '4px 8px' }}
                    formatter={(value: number) => [`${value} commits`, 'Week']}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="flex items-center gap-1 mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleGitHub}
              title="Open on GitHub"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              GitHub
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleVSCode}
              disabled={!repo.local_path}
              title="Open in VS Code"
            >
              <Code2 className="h-3.5 w-3.5 mr-1" />
              VS Code
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleSync}
              disabled={syncMutation.isPending || !hasToken}
              title={hasToken ? "Sync repository" : "Add a GitHub token in your profile to enable syncing"}
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1', syncMutation.isPending && 'animate-spin')} />
              Sync
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
              onClick={handleRemove}
              disabled={deleteRepoMutation.isPending}
              title="Remove repository"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Remove
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// inline cn since it's a local usage to avoid circular issues
function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ')
}
