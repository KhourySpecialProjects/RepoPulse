import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ListChecks, TriangleAlert } from 'lucide-react'
import { useCurrentUser } from '@/hooks/useUsers'
import { linearErrorCode, useLinearProjects } from '@/hooks/useLinear'
import { cn } from '@/lib/utils'
import type { LinearProject } from '@/types'

const card = 'rounded-2xl border border-border bg-white shadow-sm'
const listBody = 'min-h-0 flex-1 divide-y divide-border overflow-y-auto'

// Text always names the status; the tint is a second cue, never the only one.
const STATUS_PILL: Record<string, string> = {
  started: 'bg-brand-100 text-brand-700',
  planned: 'bg-slate-100 text-slate-600',
  paused: 'bg-amber-100 text-amber-700',
  backlog: 'bg-slate-100 text-slate-500',
  completed: 'bg-emerald-100 text-emerald-700',
  canceled: 'bg-slate-100 text-slate-400 line-through',
}

/** A YYYY-MM-DD as "Nov 1", read as a local date so it cannot shift a day. */
function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ProjectRow({ project }: { project: LinearProject }) {
  const percent = Math.round(Math.min(Math.max(project.progress, 0), 1) * 100)
  const meta = [
    project.target_date && `Due ${formatDay(project.target_date)}`,
    project.lead_name,
    project.team_keys.length > 0 && project.team_keys.join(', '),
  ].filter(Boolean)

  return (
    <div data-testid="linear-project" className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex min-w-0 items-center gap-1 text-xs font-medium hover:text-brand-700"
        >
          <span className="truncate">{project.name}</span>
          <ExternalLink aria-hidden className="h-3 w-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </a>
        <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_PILL[project.status_type] ?? STATUS_PILL.backlog)}>
          {project.status_name}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div
          role="progressbar"
          aria-label={`${project.name} progress`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        >
          {/* Inline width, as in the chart primitives: it is data, not style. */}
          <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      {meta.length > 0 && <p className="mt-1 truncate text-[10px] text-muted-foreground">{meta.join(' · ')}</p>}
    </div>
  )
}

/**
 * Projects across the viewer's whole Linear workspace, in the slot the Needs
 * attention list held. Read with the viewer's own key, like the Linear panel on
 * Repo Detail, and not scoped by the collection picker: Linear projects belong
 * to the workspace, not to a collection.
 */
export function LinearProjectsPanel({ className }: { className?: string }) {
  const { data: me, isPending: mePending } = useCurrentUser()
  const configured = Boolean(me?.linear_api_key_configured)
  const { data, isPending, error, refetch, isFetching } = useLinearProjects(configured)
  const projects = data?.items ?? []

  let body: ReactNode
  if (mePending || (configured && isPending)) {
    body = <p className="px-4 py-3 text-xs text-muted-foreground">Loading Linear projects…</p>
  } else if (!configured) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
        <ListChecks className="h-7 w-7 text-brand-300" />
        <p className="text-xs text-muted-foreground">
          Connect Linear to see your workspace&apos;s projects.{' '}
          <Link to="/settings" className="font-medium text-brand-600 hover:underline">Add your Linear API key in Settings</Link>
        </p>
      </div>
    )
  } else if (error) {
    body = linearErrorCode(error) === 'linear_key_invalid' ? (
      <p className="m-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          Linear rejected your API key.{' '}
          <Link to="/settings" className="font-medium underline">Update it in Settings</Link>
        </span>
      </p>
    ) : (
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground">
        <span>Couldn&apos;t load Linear projects.</span>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch()}
          className="rounded-md border border-border px-2 py-1 font-medium hover:bg-brand-50 disabled:opacity-50"
        >
          Retry
        </button>
      </div>
    )
  } else if (projects.length === 0) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
        <ListChecks className="h-7 w-7 text-brand-300" />
        <p className="text-xs text-muted-foreground">No projects in your Linear workspace yet.</p>
      </div>
    )
  } else {
    body = projects.map(project => <ProjectRow key={project.id} project={project} />)
  }

  return (
    <section aria-label="Linear projects" className={cn(card, 'flex h-64 min-h-0 flex-col xl:h-auto', className)}>
      <div className="flex flex-shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold">Linear projects</h2>
        {data && (
          <span data-testid="linear-project-count" className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 tabular-nums">
            {data.total}
          </span>
        )}
      </div>
      <div data-testid="linear-projects-list" className={listBody}>
        {body}
      </div>
    </section>
  )
}
