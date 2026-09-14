import { useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { formatBytes } from '@/lib/formatBytes'
import { measureLocalStorage, type StorageCategory } from '@/lib/storageUsage'

/**
 * Reporting-only panel for this browser's localStorage usage.
 *
 * Deliberately has no clear/reclaim action. The dashboard reports; it does
 * not remediate. BrowserStorageCard.test.tsx pins that so a mutation
 * affordance cannot be reintroduced without the decision being revisited.
 *
 * Scope caveat that must stay visible in the UI: localStorage is per-browser
 * and per-origin and cannot be read from the server, so this reports the
 * administrator's own browser, not a fleet. Showing what every user's browser
 * stores would need a reporting beacon — out of scope, and a privacy decision
 * nobody has made.
 */

const CATEGORY_LABELS: Record<StorageCategory, string> = {
  auth: 'Session',
  'ui-pref': 'UI preference',
  'per-repo': 'Per repo',
  other: 'Other',
}

type QuotaLevel = 'ok' | 'warn' | 'critical'

function quotaLevel(percent: number): QuotaLevel {
  if (percent >= 80) return 'critical'
  if (percent >= 60) return 'warn'
  return 'ok'
}

const BAR_COLOURS: Record<QuotaLevel, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
}

interface BrowserStorageCardProps {
  /**
   * Ids of repos that still exist. Supplying it turns on orphan reporting;
   * without it, orphan status is unknown and the summary is hidden rather
   * than shown as zero.
   */
  knownRepoIds?: string[]
}

export function BrowserStorageCard({ knownRepoIds }: BrowserStorageCardProps) {
  const measurement = useMemo(
    () => measureLocalStorage(knownRepoIds),
    [knownRepoIds],
  )
  const [originBytes, setOriginBytes] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    // navigator.storage is absent in jsdom and in older browsers.
    const estimate = navigator.storage?.estimate?.bind(navigator.storage)
    if (!estimate) return

    estimate()
      .then((result) => {
        if (!cancelled && typeof result.usage === 'number') {
          setOriginBytes(result.usage)
        }
      })
      .catch(() => {
        /* An unavailable estimate is not worth surfacing as an error. */
      })

    return () => {
      cancelled = true
    }
  }, [])

  const level = quotaLevel(measurement.percentOfQuota)
  const percentLabel = Math.min(100, Math.round(measurement.percentOfQuota))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Browser storage</CardTitle>
        <CardDescription data-testid="storage-scope-note">
          This browser only. <code className="font-mono">localStorage</code> is
          per-browser and per-origin, so it cannot be read from the server —
          these numbers are not instance-wide.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-2">
          <span data-testid="storage-total" className="text-2xl font-semibold">
            {formatBytes(measurement.totalBytes)}
          </span>
          <span className="text-xs text-muted-foreground">
            of ~{formatBytes(measurement.quotaBytes)} quota ({percentLabel}%)
          </span>
        </div>

        <div
          role="progressbar"
          data-testid="quota-bar"
          data-level={level}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentLabel}
          aria-label="Share of browser storage quota used"
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={`h-full rounded-full transition-all ${BAR_COLOURS[level]}`}
            style={{ width: `${Math.max(percentLabel, measurement.totalBytes > 0 ? 1 : 0)}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="per-repo-summary">
            Per-repo keys: {measurement.perRepo.keyCount} (
            {formatBytes(measurement.perRepo.bytes)})
          </span>
          {measurement.orphaned !== null && (
            <span data-testid="orphan-summary">
              Orphaned: {measurement.orphaned.keyCount} (
              {formatBytes(measurement.orphaned.bytes)}) — written for repos
              that no longer exist
            </span>
          )}
          {originBytes !== null && (
            <span data-testid="origin-estimate">
              Whole origin: {formatBytes(originBytes)} — includes IndexedDB and
              Cache Storage, so it will not match the sum above
            </span>
          )}
        </div>

        {measurement.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing stored in this browser yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-4 font-medium">
                    Key
                  </th>
                  <th scope="col" className="py-1.5 pr-4 font-medium">
                    Type
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {measurement.entries.map((entry) => (
                  <tr key={entry.key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-4 font-mono text-xs break-all">
                      {entry.key}
                    </td>
                    <td className="py-1.5 pr-4 text-xs text-muted-foreground">
                      {CATEGORY_LABELS[entry.category]}
                      {entry.orphaned === true && ' · orphaned'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBytes(entry.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
