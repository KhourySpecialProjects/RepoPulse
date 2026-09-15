import { cn } from '@/lib/utils'
import { stalenessBuckets } from '@/lib/dashboardInsights'
import type { Repo } from '@/types'

/**
 * How long since each repository last saw a commit.
 *
 * Compact SVG bars scale to their container without inline CSS. Counts stay
 * visible beside the bars, so color is never the only way to read the data.
 */
export function StalenessChart({ repos, className, loading, failed }: { repos: Repo[]; className?: string; loading?: boolean; failed?: boolean }) {
  const buckets = stalenessBuckets(repos)
  const total = repos.length
  const busiest = Math.max(...buckets.map(bucket => bucket.count), 1)

  return (
    <section
      aria-label="Commit recency spread"
      className={cn(
        'flex min-h-56 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm xl:min-h-0',
        className
      )}
    >
      <h2 className="text-sm font-semibold">Last commit</h2>

      {loading || failed || total === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{loading ? 'Loading commit recency…' : failed ? 'Commit recency is unavailable.' : 'No repositories yet.'}</p>
      ) : (
        <ul className="mt-2 flex min-h-0 flex-1 flex-col justify-center gap-2">
          {buckets.map((bucket, index) => (
            <li key={bucket.label} className="flex items-center gap-3 text-xs">
              <span className="w-20 flex-shrink-0 text-muted-foreground">{bucket.label}</span>
              <svg className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                <rect width={(bucket.count / busiest) * 100} height="10" rx="4" className={['fill-emerald-500', 'fill-lime-500', 'fill-amber-500', 'fill-rose-500', 'fill-slate-400'][index]} />
              </svg>
              <span className="w-6 flex-shrink-0 text-right font-medium tabular-nums">
                {bucket.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
