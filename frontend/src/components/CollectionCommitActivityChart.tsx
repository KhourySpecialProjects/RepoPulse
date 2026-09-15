import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CrosshairTooltip } from '@/components/charts'
import { CHROME, MARKS, SERIES, TICK } from '@/lib/chartTheme'
import { useCollectionCommitActivity } from '@/hooks/useCollections'
import { cn } from '@/lib/utils'

type ChartRange = '7d' | '30d' | '90d' | 'all'

interface Props {
  collectionId: string
}

export function CollectionCommitActivityChart({ collectionId }: Props) {
  const [range, setRange] = useState<ChartRange>('30d')
  const { data, isLoading } = useCollectionCommitActivity(collectionId)

  const chartData = useMemo(() => {
    if (!data) return []
    const now = Date.now()
    const cutoff =
      range === '7d' ? now - 7 * 86400000
      : range === '30d' ? now - 30 * 86400000
      : range === '90d' ? now - 90 * 86400000
      : null

    const notNull = cutoff
    const points = data.activity
      .filter((p) => {
        if (notNull === null) return true
        return new Date(p.date).getTime() >= notNull
      })
      .map((p) => ({
        ...p,
        ts: new Date(p.date + 'T12:00:00Z').getTime(),
        pointLabel: '',
      }))

    if (points.length > 0) {
      const peak = points.reduce((best, p) => (p.count > best.count ? p : best))
      const last = points[points.length - 1]
      // The peak is the point worth naming; the endpoint is where the eye
      // lands. If they coincide, one label rather than two on one mark.
      if (peak.count > 0) peak.pointLabel = String(peak.count)
      if (last.count > 0) last.pointLabel = String(last.count)
    }
    return points
  }, [data, range])

  const hasData = chartData.some((p) => p.count > 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Collection Commit Activity</CardTitle>
            <div className="flex items-center gap-1">
              {(['7d', '30d', '90d', 'all'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    'text-xs px-2 py-1 rounded border transition-colors',
                    range === r
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'text-muted-foreground border-border hover:border-indigo-300'
                  )}
                >
                  {r === 'all' ? 'All' : r}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div
              data-testid="commit-activity-skeleton"
              className="h-48 bg-muted rounded animate-pulse"
            />
          ) : !hasData ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No commit data available.
            </p>
          ) : (
            <div data-testid="commit-activity-chart" className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="collectionActivityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SERIES[0]} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={SERIES[0]} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={CHROME.grid} strokeDasharray="0" />
                  <XAxis
                    type="number"
                    dataKey="ts"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickCount={6}
                    tick={TICK}
                    axisLine={{ stroke: CHROME.axis }}
                    tickLine={false}
                    tickFormatter={(ts: number) =>
                      new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    }
                  />
                  <YAxis tick={TICK} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
                    content={
                      <CrosshairTooltip
                        labelFormatter={(ts) =>
                          new Date(Number(ts)).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Commits"
                    stroke={SERIES[0]}
                    fill="url(#collectionActivityGradient)"
                    strokeWidth={MARKS.strokeWidth}
                    activeDot={{
                      r: MARKS.dotRadius,
                      stroke: CHROME.surface,
                      strokeWidth: MARKS.surfaceRing,
                    }}
                  >
                    {/* Peak and endpoint only, and in a text token rather
                        than the series colour — a light hue is illegible as
                        type against the surface. */}
                    <LabelList
                      dataKey="pointLabel"
                      position="top"
                      style={{ fontSize: 11, fill: CHROME.label }}
                    />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
