import { useState } from 'react'

import {
  useAdminLlmUsage,
  useAdminOverview,
  useAdminPipeline,
  useAdminStorage,
  useAdminSystem,
} from '@/hooks/useAdminStats'
import { AttentionPanel } from './overview/AttentionPanel'
import { CoverageCard } from './overview/CoverageCard'
import { LlmVolumeCard } from './overview/LlmVolumeCard'
import { RangeFilter } from './overview/RangeFilter'
import { ServiceStatusBanner } from './overview/ServiceStatusBanner'
import { StorageCard } from './overview/StorageCard'
import { SyncHealthCard } from './overview/SyncHealthCard'

/**
 * The administrator's landing page.
 *
 * Scoped to running the application, not to how the students are doing. Every
 * card answers one of: is the service configured, is ingestion working, are we
 * going to run out of disk, are the integrations working. The instructor's
 * view of the same repos lives on CollectionDetailPage.
 *
 * One block of cards, grouped by function: everything about syncing in one
 * card, everything about disk in another. Capacity and largest-clones were
 * split across the grid reading as unrelated while answering halves of one
 * question, and each paid for its own header and padding to do it.
 *
 * Four cards in one row, then data coverage spanning the full width beneath
 * them. The row is a grid, so its cards share a height — sync health and
 * repos-needing-attention line up rather than ending at ragged points. That
 * height is set by the tallest card in the row, which is why the clone list
 * is capped at five: rows past that cost height every card beside it has to
 * match.
 *
 * Coverage sits below and reads across. It is the one card with six small
 * equal-weight figures, which stack into a narrow ribbon in a column and fit
 * naturally in a full-width strip.
 *
 * Full width rather than a centred max-width: on a wide monitor the capped
 * container left a third of the screen empty while the cards below the fold
 * were the ones that needed the room.
 *
 * Aggregates are computed server-side in SQL. DashboardPage builds its totals
 * by fanning out a request per collection and then per repo, which is
 * O(collections x pages) round trips and only ever sees the caller's
 * accessible collections. An admin view is instance-wide by definition, so it
 * is one request per concern.
 */
interface Props {
  /** Lets a fault chip open the tab that can fix it. */
  onNavigate?: (tab: string) => void
}

export function AdminOverviewTab({ onNavigate }: Props) {
  const [days, setDays] = useState(30)

  const overviewQuery = useAdminOverview()
  const systemQuery = useAdminSystem()
  const storageQuery = useAdminStorage()
  const pipelineQuery = useAdminPipeline()
  const llmQuery = useAdminLlmUsage(days)

  // The overview query gates the page: it carries the entity counts every
  // section is framed around. The other queries fail into their own cards, so
  // one broken endpoint costs one card rather than the whole dashboard.
  if (overviewQuery.isLoading) {
    return (
      <div data-testid="overview-loading" className="flex flex-col gap-4">
        {/* Mirrors the real shape — a row of four, then a full-width strip —
            so the page does not reflow when the data lands. */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-80 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Could not load the instance overview.
        </span>
        <button
          type="button"
          onClick={() => overviewQuery.refetch()}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Retry
        </button>
      </div>
    )
  }

  const overview = overviewQuery.data

  return (
    <div className="flex flex-col gap-4">
      <ServiceStatusBanner
        system={systemQuery.data}
        overview={overview}
        llm={llmQuery.data}
        onNavigate={onNavigate}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SyncHealthCard
          pipeline={pipelineQuery.data}
          sync={overview.sync}
          isLoading={pipelineQuery.isLoading}
          isError={pipelineQuery.isError}
          onRetry={() => pipelineQuery.refetch()}
        />

        <StorageCard
          storage={storageQuery.data}
          isLoading={storageQuery.isLoading}
          isError={storageQuery.isError}
          onRetry={() => storageQuery.refetch()}
        />

        <AttentionPanel />

        <LlmVolumeCard
          action={<RangeFilter days={days} onChange={setDays} />}
          llm={llmQuery.data}
          isLoading={llmQuery.isLoading}
          isError={llmQuery.isError}
          isPlaceholder={llmQuery.isFetching && !llmQuery.isLoading}
          onRetry={() => llmQuery.refetch()}
          onNavigate={onNavigate}
        />
      </div>

      <CoverageCard
        pipeline={pipelineQuery.data}
        isLoading={pipelineQuery.isLoading}
        isError={pipelineQuery.isError}
        onRetry={() => pipelineQuery.refetch()}
      />
    </div>
  )
}
