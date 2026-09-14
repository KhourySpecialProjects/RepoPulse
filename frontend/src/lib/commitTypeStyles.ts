import type { CommitType, CommitTypeFilter } from '@/types'

/** Styling for one commit-type value, in every place it appears.
 *
 * Kept in one module so a row tint can never drift from the filter chip that
 * claims to represent it — the chips are the only legend the table has now
 * that the Type column is gone.
 */
interface CommitTypeStyle {
  label: string
  /** Row background. Deliberately a -50 tint: it has to stay readable behind
   *  body text and lose to the indigo highlight when a commit is linked to. */
  rowClass: string
  chipIdle: string
  chipActive: string
}

export const COMMIT_TYPE_STYLES: Record<CommitType, CommitTypeStyle> = {
  substantive: {
    label: 'Substantive',
    rowClass: 'bg-emerald-50/70 hover:bg-emerald-100/80',
    chipIdle: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
    chipActive: 'bg-emerald-600 text-white border-emerald-600',
  },
  logistical: {
    label: 'Logistical',
    rowClass: 'bg-orange-50/70 hover:bg-orange-100/80',
    chipIdle: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100',
    chipActive: 'bg-orange-600 text-white border-orange-600',
  },
}

/** Unclassified is a filter bucket, not a verdict, so it gets no row tint —
 *  an untinted row is exactly what "we haven't judged this yet" looks like. */
const UNCLASSIFIED_STYLE: CommitTypeStyle = {
  label: 'Unclassified',
  rowClass: '',
  chipIdle: 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200',
  chipActive: 'bg-gray-500 text-white border-gray-500',
}

export const COMMIT_TYPE_FILTERS: CommitTypeFilter[] = [
  'substantive',
  'logistical',
  'unclassified',
]

export function commitTypeStyle(type: CommitTypeFilter | null): CommitTypeStyle {
  if (type === null || type === 'unclassified') return UNCLASSIFIED_STYLE
  return COMMIT_TYPE_STYLES[type]
}

/** Row background for a commit, or '' when it has no classification. */
export function commitRowClass(type: CommitType | null): string {
  return type ? COMMIT_TYPE_STYLES[type].rowClass : ''
}

/** Text fallback for the colour encoding, exposed as a row `title`. */
export function commitRowTitle(type: CommitType | null): string {
  return type ? `${COMMIT_TYPE_STYLES[type].label} commit` : 'Not classified yet'
}
