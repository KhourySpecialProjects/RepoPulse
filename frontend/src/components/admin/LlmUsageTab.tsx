import { useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { useAdminLlmUsage } from '@/hooks/useAdminStats'

/**
 * LLM call volume. Deliberately not cost.
 *
 * No token counts are persisted on `summaries` or `commit_classifications`,
 * so a spend figure would be rows x assumed-tokens x assumed-price — a number
 * that reads as measured, is wrong by a multiple rather than a percentage,
 * and goes stale invisibly as prices change. Arize Phoenix is already running
 * in the stack and records real per-span token usage, so the honest answer is
 * call counts plus a link to it.
 *
 * Failures are absent for the same kind of reason: a failed call writes no
 * row, so these tables hold only successes and "0 failures" would be a lie.
 */

/** Phoenix runs in docker-compose on 6006, exposed to the host. */
const PHOENIX_URL = 'http://localhost:6006'

const WINDOWS = [7, 30, 90] as const

export function LlmUsageTab() {
  const [days, setDays] = useState<number>(30)
  const { data, isLoading, isError, refetch } = useAdminLlmUsage(days)

  if (isLoading) {
    return <div data-testid="llm-loading" className="h-48 animate-pulse rounded-lg bg-muted" />
  }

  if (isError || !data) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Could not load LLM usage.</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Window</span>
        {WINDOWS.map((window) => (
          <button
            key={window}
            type="button"
            onClick={() => setDays(window)}
            aria-pressed={days === window}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              days === window
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {window}d
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calls</CardTitle>
          <CardDescription>
            Successful generations recorded in the last {data.window_days} days.
            Counts only — token usage and cost are not recorded here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div data-testid="llm-total" className="text-2xl font-semibold tabular-nums">
            {data.total_calls.toLocaleString()}
          </div>

          {data.by_model.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No LLM calls in this window.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-4 font-medium">Model</th>
                  <th scope="col" className="py-1.5 pr-4 font-medium">Used for</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {data.by_model.map((row) => (
                  <tr
                    key={`${row.kind}-${row.model}`}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-1.5 pr-4 font-mono text-xs">{row.model}</td>
                    <td className="py-1.5 pr-4 text-xs text-muted-foreground">
                      {row.kind === 'summary' ? 'Summaries' : 'Commit classification'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.calls.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {data.retired_models_in_use.length > 0 && (
        <div
          role="status"
          data-testid="retired-models"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <strong>Models other than the current default are in use:</strong>{' '}
          {data.retired_models_in_use.join(', ')}. The default is{' '}
          <code className="font-mono">{data.current_default_model}</code>. A
          retired model id starts returning 404s rather than failing loudly.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By collection owner</CardTitle>
          <CardDescription>
            Attributed through repo → collection → owner. Neither table records
            who triggered a call, so this credits the collection owner, not
            whoever clicked the button.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.by_collection_owner.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to attribute yet.</p>
          ) : (
            <ul data-testid="llm-by-owner" className="flex flex-col gap-1">
              {data.by_collection_owner.map((owner) => (
                <li
                  key={owner.user_id}
                  className="flex items-baseline justify-between border-b border-border/50 py-1.5 text-sm last:border-0"
                >
                  <span>{owner.display_name}</span>
                  <span className="tabular-nums">{owner.calls.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}

          {data.unattributed_summaries > 0 && (
            <p data-testid="unattributed" className="mt-3 text-xs text-muted-foreground">
              {data.unattributed_summaries} summary
              {data.unattributed_summaries === 1 ? '' : ' summaries'} not
              attributable — contributor-scoped summaries carry no repo.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Token usage and cost</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p data-testid="cost-explainer" className="text-sm text-muted-foreground">
            Not shown here, because it is not recorded. RepoPulse stores the
            model and timestamp of each call but no token counts, so any figure
            on this page would be an assumption dressed as a measurement.
            Arize Phoenix traces every call with real token usage.
          </p>
          <a
            data-testid="phoenix-link"
            href={PHOENIX_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-800"
          >
            Open Phoenix for token usage and traces
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
