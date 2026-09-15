import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ChartTableView } from './ChartTableView'

/**
 * The container every chart mounts in.
 *
 * Owns the parts that are easy to get subtly wrong per-chart and so are
 * centralised: the loading / error / empty states (matching the shape the
 * admin tabs already use, so a chart failure looks like a tab failure), the
 * "as of" caption, and the table-view toggle.
 *
 * On height: the plot and its x-axis band are sized together. Fixing a
 * container to the plot height alone pushes the axis labels out and the card
 * grows a nested vertical scrollbar, which is the most common way a
 * dashboard card breaks.
 *
 * On refetch: `isPlaceholder` dims the existing render rather than tearing it
 * down. A skeleton on every range change is a full-page flash and a layout
 * jump on what the reader experiences as a filter.
 */
interface Props {
  title: string
  description?: string
  /** Rendered small and muted, e.g. "as of 14:02". */
  asOf?: string
  /** Right-aligned controls in the header (segmented toggles, links). */
  action?: ReactNode
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  /** True while a new window loads and the previous render is still shown. */
  isPlaceholder?: boolean
  /** When true, renders `emptyMessage` instead of children. */
  isEmpty?: boolean
  emptyMessage?: string
  /** Omit to hide the toggle — a stat strip with no plot needs no table. */
  table?: { caption: string; columns: string[]; rows: Array<Array<string | number>> }
  className?: string
  contentClassName?: string
  testId?: string
  children: ReactNode
}

export function ChartCard({
  title,
  description,
  asOf,
  action,
  isLoading = false,
  isError = false,
  onRetry,
  isPlaceholder = false,
  isEmpty = false,
  emptyMessage = 'No data yet.',
  table,
  className,
  contentClassName,
  testId,
  children,
}: Props) {
  const [showTable, setShowTable] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn('h-full', className)}
    >
      {/* h-full so cards in a grid row share one height. This is safe in a
          grid, where the percentage resolves against the row; it was not in
          the multi-column layout this replaced, where it resolved against the
          whole column and stretched every card to the tallest on the page. */}
      <Card className="flex h-full flex-col" data-testid={testId}>
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">{title}</CardTitle>
              {description && (
                <CardDescription className="mt-0.5">{description}</CardDescription>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {action}
              {table && !isLoading && !isError && !isEmpty && (
                <button
                  type="button"
                  onClick={() => setShowTable((open) => !open)}
                  aria-expanded={showTable}
                  className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  {showTable ? 'Chart' : 'Table'}
                </button>
              )}
            </div>
          </div>
          {asOf && (
            <p className="mt-1 text-xs text-muted-foreground">{asOf}</p>
          )}
        </CardHeader>

        <CardContent className={cn('flex-1', contentClassName)}>
          {isLoading ? (
            <div
              data-testid={testId ? `${testId}-loading` : undefined}
              className="h-40 animate-pulse rounded-lg bg-muted"
            />
          ) : isError ? (
            <div role="alert" className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                Could not load {title.toLowerCase()}.
              </span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  Retry
                </button>
              )}
            </div>
          ) : isEmpty ? (
            <p className="py-6 text-sm text-muted-foreground">{emptyMessage}</p>
          ) : showTable && table ? (
            <ChartTableView {...table} />
          ) : (
            <div
              className={cn(
                'transition-opacity',
                isPlaceholder && 'opacity-50',
              )}
            >
              {children}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
