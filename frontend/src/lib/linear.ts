import type { LinearStatusCounts } from '@/types'

/**
 * Issues not yet done or canceled: triage, backlog, todo and in progress.
 * One definition, so the dashboard's Linear box and its tile cannot disagree.
 */
export function openIssueCount(counts: LinearStatusCounts): number {
  return counts.triage + counts.backlog + counts.unstarted + counts.started
}
