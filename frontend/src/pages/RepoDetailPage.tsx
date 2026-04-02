import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ExternalLink, Code2, RefreshCw, Sparkles, Trash2, GitCommit, GitMerge, User, BarChart2, MessageSquare, Calendar, Pencil, Check, X, ClipboardCheck, CalendarPlus, ChevronDown, ChevronUp, History, GitPullRequest, GitPullRequestClosed } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { useQueryClient } from '@tanstack/react-query'
import { useRepo, useRepoHealth, useSyncRepo, useDeleteRepo, useRepoCommits, useRepoContributors, useUpdateContributor, useMergeContributors, usePatchRepo, repoKeys, usePRStats, usePullRequests, useSyncPullRequests } from '@/hooks/useRepos'
import { useRepoSummaries, useContributorSummaries, useGenerateSummary } from '@/hooks/useSummaries'
import { useNotes, useCreateNote, useUpdateNote, useDeleteNote } from '@/hooks/useNotes'
import { useUsers, useCurrentUser } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import { HealthBadge } from '@/components/HealthBadge'
import { CommitNotesPanel } from '@/components/CommitNotesPanel'
import { MarkdownContent } from '@/components/MarkdownContent'
import { NotesDrawer } from '@/components/NotesDrawer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { CreateNoteData, Summary, Contributor, Note, PullRequest } from '@/types'

const PERIOD_COLORS = ['#94a3b8', '#a78bfa', '#60a5fa', '#34d399', '#f97316', '#6366f1']

function formatRelativeDays(isoStr: string): string {
  const days = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}


function ContributorGenerateButton({ contributorId, repoId }: { contributorId: string; repoId: string }) {
  const generateMutation = useGenerateSummary()
  return (
    <button
      onClick={() => generateMutation.mutateAsync({
        summary_type: 'contributor_activity',
        repo_id: repoId,
        contributor_id: contributorId,
      })}
      disabled={generateMutation.isPending}
      className="ml-auto flex items-center gap-0.5 text-muted-foreground hover:text-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
      title="Generate activity summary"
    >
      <Sparkles className={cn('h-3 w-3', generateMutation.isPending && 'animate-pulse')} />
    </button>
  )
}

function ContributorSummaryDisplay({ contributorId }: { contributorId: string }) {
  const { data: summaries } = useContributorSummaries(contributorId)
  const [expanded, setExpanded] = useState(false)
  const latest = summaries?.[0]
  if (!latest) return null
  return (
    <div className="mt-1.5 rounded-md bg-violet-50 border border-violet-100 px-2.5 py-2">
      <button
        className="flex items-center gap-1 w-full text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <p className="text-[10px] text-muted-foreground flex-1">
          {formatDateTime(latest.generated_at)} · {latest.model_used}
        </p>
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
      </button>
      {expanded && (
        <MarkdownContent content={latest.content} className="mt-1.5" />
      )}
    </div>
  )
}

const SUMMARY_TYPE_LABELS: Record<string, string> = {
  repo_overview: 'Repo Overview',
  health_explanation: 'Health Explanation',
  contributor_activity: 'Activity',
}

const SUMMARY_TYPE_COLORS: Record<string, string> = {
  repo_overview: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  health_explanation: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  contributor_activity: 'bg-violet-100 text-violet-700 border-violet-200',
}

function SummaryEntry({ summary }: { summary: Summary }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <span className={cn('text-xs font-medium border rounded-full px-2 py-0.5 flex-shrink-0', SUMMARY_TYPE_COLORS[summary.summary_type] ?? 'bg-gray-100 text-gray-700 border-gray-200')}>
          {SUMMARY_TYPE_LABELS[summary.summary_type] ?? summary.summary_type}
        </span>
        <span className="text-xs text-muted-foreground flex-1 truncate">{formatDateTime(summary.generated_at)} · {summary.model_used}</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2.5">
          <MarkdownContent content={summary.content} />
        </div>
      )}
    </div>
  )
}

function SummaryHistoryModal({
  open,
  onClose,
  summaries,
  contributors,
}: {
  open: boolean
  onClose: () => void
  summaries: Summary[]
  contributors: Contributor[]
}) {
  const repoSummaries = summaries.filter(s => s.contributor_id === null)
  const contributorSummaries = summaries.filter(s => s.contributor_id !== null)

  // Group contributor summaries by contributor_id
  const byContributor = contributorSummaries.reduce<Record<string, Summary[]>>((acc, s) => {
    const key = s.contributor_id!
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  const contributorNameMap = Object.fromEntries(contributors.map(c => [c.id, c.display_name]))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Summary History
            <span className="text-sm font-normal text-muted-foreground ml-1">({summaries.length} total)</span>
          </DialogTitle>
        </DialogHeader>

        {summaries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No summaries generated yet.</p>
        ) : (
          <div className="flex flex-col gap-6 mt-2">

            {/* Repo-level summaries */}
            {repoSummaries.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Repo Summaries
                  <span className="text-xs font-normal text-muted-foreground">({repoSummaries.length})</span>
                </h3>
                <div className="flex flex-col gap-2">
                  {repoSummaries.map(s => <SummaryEntry key={s.id} summary={s} />)}
                </div>
              </div>
            )}

            {/* Contributor summaries grouped by contributor */}
            {Object.keys(byContributor).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  Contributor Summaries
                  <span className="text-xs font-normal text-muted-foreground">({contributorSummaries.length})</span>
                </h3>
                <div className="flex flex-col gap-4">
                  {Object.entries(byContributor).map(([contributorId, cSummaries]) => (
                    <div key={contributorId}>
                      <p className="text-xs font-semibold text-foreground mb-1.5 px-0.5">
                        {contributorNameMap[contributorId] ?? 'Unknown Contributor'}
                      </p>
                      <div className="flex flex-col gap-2">
                        {cSummaries.map(s => <SummaryEntry key={s.id} summary={s} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PRStatePill({ state }: { state: string }) {
  if (state === 'merged') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200">
      <GitMerge className="h-2.5 w-2.5" /> Merged
    </span>
  )
  if (state === 'open') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
      <GitPullRequest className="h-2.5 w-2.5" /> Open
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
      <GitPullRequestClosed className="h-2.5 w-2.5" /> Closed
    </span>
  )
}

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22 } },
}

export function RepoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [commitPage, setCommitPage] = useState(0)
  const [chartRange, setChartRange] = useState<'7d' | '30d' | '90d' | 'all'>('7d')
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null)
  const [highlightedCommitHash, setHighlightedCommitHash] = useState<string | null>(null)
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set())
  const [selectedAuthors, setSelectedAuthors] = useState<Set<string>>(new Set())
  const [showAllBranches, setShowAllBranches] = useState(false)
  const [showAllAuthors, setShowAllAuthors] = useState(false)
  const [selectedContributorIds, setSelectedContributorIds] = useState<Set<string>>(new Set())
  const [editingContributorId, setEditingContributorId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [mergeDisplayName, setMergeDisplayName] = useState('')
  const [expectedCount, setExpectedCount] = useState<string>('')
  const COMMITS_PER_PAGE = 20
  const MAX_FILTER_CHIPS = 8

  const [summaryExpanded, setSummaryExpanded] = useState(true)
  const [summaryHistoryOpen, setSummaryHistoryOpen] = useState(false)
  const [showArchivedNotes, setShowArchivedNotes] = useState(false)
  const [notesPinned, setNotesPinned] = useState(false)

  const [checkIns, setCheckIns] = useState<string[]>(() => {
    if (!id) return []
    try { return JSON.parse(localStorage.getItem(`repo-checkins-${id}`) ?? '[]') } catch { return [] }
  })
  const [showPastCheckIn, setShowPastCheckIn] = useState(false)
  const [pastCheckInDate, setPastCheckInDate] = useState('')

  function saveCheckIns(updated: string[]) {
    if (!id) return
    setCheckIns(updated)
    localStorage.setItem(`repo-checkins-${id}`, JSON.stringify(updated))
  }

  function handleCheckIn() {
    saveCheckIns([...checkIns, new Date().toISOString()].sort())
  }

  function handleAddPastCheckIn() {
    if (!pastCheckInDate) return
    saveCheckIns([...checkIns, new Date(pastCheckInDate).toISOString()].sort())
    setPastCheckInDate('')
    setShowPastCheckIn(false)
  }

  const queryClient = useQueryClient()
  const { data: repo, isLoading: repoLoading } = useRepo(id ?? '')
  const { data: healthScore, isLoading: healthLoading } = useRepoHealth(id ?? '')
  const syncMutation = useSyncRepo()
  const deleteRepoMutation = useDeleteRepo()
  const { data: me } = useCurrentUser()
  const hasToken = Boolean(me?.github_token_configured)
  const { data: summaries } = useRepoSummaries(id ?? '')
  const generateSummaryMutation = useGenerateSummary()
  const { data: commitsData, isLoading: commitsLoading } = useRepoCommits(id ?? '', {
    limit: COMMITS_PER_PAGE,
    offset: commitPage * COMMITS_PER_PAGE,
  })
  const { data: allCommitsData, isLoading: allCommitsLoading } = useRepoCommits(id ?? '', { limit: 500, offset: 0 })
  const { data: contributors, isLoading: contributorsLoading } = useRepoContributors(id ?? '')
  const updateContributorMutation = useUpdateContributor(id ?? '')
  const mergeContributorsMutation = useMergeContributors(id ?? '')
  const patchRepoMutation = usePatchRepo()
  const { data: prStats } = usePRStats(id ?? '')
  const PR_PAGE_SIZE = 10
  const [prStateFilter, setPrStateFilter] = useState<string | undefined>(undefined)
  const [prPage, setPrPage] = useState(0)
  const { data: prList } = usePullRequests(id ?? '', prStateFilter, PR_PAGE_SIZE, prPage * PR_PAGE_SIZE)
  const syncPRsMutation = useSyncPullRequests(id ?? '')
  const { data: notes } = useNotes({ repo_id: id })
  const createNoteMutation = useCreateNote()
  const updateNoteMutation = useUpdateNote()
  const deleteNoteMutation = useDeleteNote()
  const { user: currentUser } = useAuth()
  const { data: users } = useUsers(repo?.collection_id ? { collection_id: repo.collection_id } : undefined)

  // Progress bar: track how many of the slow parallel queries have resolved
  const loadingFlags = [repoLoading, healthLoading, commitsLoading, allCommitsLoading, contributorsLoading]
  const completedCount = loadingFlags.filter((v) => !v).length
  const loadProgress = Math.round((completedCount / loadingFlags.length) * 100)
  const isPageLoading = loadingFlags.some(Boolean)

  // Map git email → merged contributor display name
  const emailToDisplayName = useMemo(() => {
    const map: Record<string, string> = {}
    contributors?.forEach(contributor => {
      contributor.aliases.forEach(alias => {
        map[alias.git_email] = contributor.display_name
      })
    })
    return map
  }, [contributors])

  // Map git email → contributor id (for computing stats from commit data)
  const emailToContributorId = useMemo(() => {
    const map: Record<string, string> = {}
    contributors?.forEach(contributor => {
      contributor.aliases.forEach(alias => {
        map[alias.git_email] = contributor.id
      })
    })
    return map
  }, [contributors])

  // Compute contributor stats from allCommitsData so they're always accurate
  // even after merges (stored counts can lag until next sync)
  const contributorStats = useMemo(() => {
    const stats: Record<string, { commits: number; insertions: number; deletions: number; lastCommitAt: string | null }> = {}
    allCommitsData?.items.forEach(c => {
      const cid = emailToContributorId[c.author_email.toLowerCase()]
      if (!cid) return
      const s = stats[cid] ?? { commits: 0, insertions: 0, deletions: 0, lastCommitAt: null }
      s.commits += 1
      s.insertions += c.insertions
      s.deletions += c.deletions
      if (!s.lastCommitAt || c.date > s.lastCommitAt) s.lastCommitAt = c.date
      stats[cid] = s
    })
    return stats
  }, [allCommitsData, emailToContributorId])

  const sortedContributors = useMemo(() => {
    if (!contributors) return []
    return [...contributors].sort((a, b) => {
      const aDate = contributorStats[a.id]?.lastCommitAt ?? a.last_commit_at ?? ''
      const bDate = contributorStats[b.id]?.lastCommitAt ?? b.last_commit_at ?? ''
      return bDate < aDate ? -1 : bDate > aDate ? 1 : 0
    })
  }, [contributors, contributorStats])

  const resolvedAuthor = (commit: { author_name: string; author_email: string }) =>
    emailToDisplayName[commit.author_email.toLowerCase()] ?? commit.author_name

  const allBranches = useMemo(() => {
    const names = new Set<string>()
    allCommitsData?.items.forEach(c => c.branches.forEach(b => names.add(b)))
    return Array.from(names).sort()
  }, [allCommitsData])

  const allAuthors = useMemo(() => {
    const names = new Set<string>()
    allCommitsData?.items.forEach(c => names.add(resolvedAuthor(c)))
    return Array.from(names).sort()
  }, [allCommitsData, emailToDisplayName])

  function toggleBranch(branch: string) {
    setSelectedBranches(prev => {
      const next = new Set(prev)
      if (next.has(branch)) next.delete(branch)
      else next.add(branch)
      return next
    })
  }

  function toggleAuthor(author: string) {
    setSelectedAuthors(prev => {
      const next = new Set(prev)
      if (next.has(author)) next.delete(author)
      else next.add(author)
      return next
    })
  }

  const filteredCommits = useMemo(() => {
    return (allCommitsData?.items ?? []).filter(c => {
      const branchMatch = selectedBranches.size === 0 || c.branches.some(b => selectedBranches.has(b))
      const authorMatch = selectedAuthors.size === 0 || selectedAuthors.has(resolvedAuthor(c))
      return branchMatch && authorMatch
    })
  }, [allCommitsData, selectedBranches, selectedAuthors, emailToDisplayName])

  const displayedCommits = filteredCommits.slice(
    commitPage * COMMITS_PER_PAGE,
    (commitPage + 1) * COMMITS_PER_PAGE
  )

  function toggleContributorSelect(contributorId: string) {
    setSelectedContributorIds(prev => {
      const next = new Set(prev)
      if (next.has(contributorId)) next.delete(contributorId)
      else next.add(contributorId)
      return next
    })
  }

  function startEditing(contributor: { id: string; display_name: string }) {
    setEditingContributorId(contributor.id)
    setEditingName(contributor.display_name)
  }

  function cancelEditing() {
    setEditingContributorId(null)
    setEditingName('')
  }

  async function saveDisplayName() {
    if (!editingContributorId) return
    await updateContributorMutation.mutateAsync({ id: editingContributorId, displayName: editingName })
    setEditingContributorId(null)
    setEditingName('')
  }

  async function handleMerge() {
    const ids = Array.from(selectedContributorIds)
    if (ids.length < 2 || !mergeDisplayName.trim()) return
    await mergeContributorsMutation.mutateAsync({ ids, displayName: mergeDisplayName.trim() })
    setSelectedContributorIds(new Set())
    setMergeDisplayName('')
  }

  function initMerge() {
    const selected = (contributors ?? []).filter(c => selectedContributorIds.has(c.id))
    setMergeDisplayName(selected[0]?.display_name ?? '')
  }

  async function handleCreateNote(values: { content: string; is_reminder: boolean; reminder_context: string }) {
    const noteData: CreateNoteData = {
      content: values.content,
      is_reminder: values.is_reminder,
      reminder_context: values.reminder_context || null,
      repo_id: id ?? null,
    }
    await createNoteMutation.mutateAsync(noteData)
  }

  async function handleGenerateSummary() {
    await generateSummaryMutation.mutateAsync({
      repo_id: id ?? null,
      summary_type: 'repo_overview',
    })
  }

  function handleRemove() {
    if (window.confirm('Remove this repository? This cannot be undone.')) {
      deleteRepoMutation.mutate(id ?? '', {
        onSuccess: () => navigate(-1),
      })
    }
  }

  async function handleSaveExpectedCount() {
    const val = expectedCount.trim()
    const parsed = val === '' ? null : parseInt(val, 10)
    const minCount = contributors?.length ?? 1
    if (val !== '' && (isNaN(parsed!) || parsed! < minCount)) return
    await patchRepoMutation.mutateAsync({
      id: id ?? '',
      data: { expected_contributor_count: parsed },
    })
  }

  function handleScrollToCommit(hash: string) {
    const allItems = allCommitsData?.items ?? []
    const idx = allItems.findIndex(c => c.hash === hash)
    if (idx !== -1) {
      const targetPage = Math.floor(idx / COMMITS_PER_PAGE)
      setCommitPage(targetPage)
    }
    setHighlightedCommitHash(hash)
  }

  useEffect(() => {
    if (!highlightedCommitHash) return
    const el = document.getElementById(`commit-${highlightedCommitHash}`)
    if (el) {
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      const timer = setTimeout(() => setHighlightedCommitHash(null), 2500)
      return () => clearTimeout(timer)
    }
  }, [highlightedCommitHash, displayedCommits])

  // Reset to page 0 when filters change
  useEffect(() => {
    setCommitPage(0)
  }, [selectedBranches, selectedAuthors])

  useEffect(() => {
    if (repo?.expected_contributor_count != null) {
      setExpectedCount(String(repo.expected_contributor_count))
    } else {
      setExpectedCount('')
    }
  }, [repo?.expected_contributor_count])

  const commitChartData = useMemo(() => {
    const allCommits = allCommitsData?.items ?? []
    const now = new Date()
    const todayTs = now.getTime()
    const cutoff = chartRange === '7d' ? new Date(todayTs - 7 * 86400000)
      : chartRange === '30d' ? new Date(todayTs - 30 * 86400000)
      : chartRange === '90d' ? new Date(todayTs - 90 * 86400000)
      : null

    const rangeStart = cutoff ?? (allCommits.length > 0
      ? new Date(Math.min(...allCommits.map(c => new Date(c.date).getTime())))
      : new Date(todayTs - 7 * 86400000))
    const rangeStartTs = rangeStart.getTime()

    const filtered = cutoff ? allCommits.filter(c => new Date(c.date) >= cutoff) : allCommits
    const groupByWeek = chartRange === '90d' || chartRange === 'all'

    const byBucket: Record<string, { ts: number; commits: number; latestDate: string }> = {}
    filtered.forEach((c) => {
      const d = new Date(c.date)
      let key: string
      let ts: number
      if (groupByWeek) {
        const day = d.getDay()
        const monday = new Date(d)
        monday.setDate(d.getDate() - ((day + 6) % 7))
        key = monday.toISOString().slice(0, 10)
        ts = monday.getTime()
      } else {
        key = c.date.slice(0, 10)
        ts = new Date(key + 'T12:00:00Z').getTime()
      }
      const prev = byBucket[key] ?? { ts, commits: 0, latestDate: '' }
      byBucket[key] = {
        ts,
        commits: prev.commits + 1,
        latestDate: c.date > prev.latestDate ? c.date : prev.latestDate,
      }
    })

    const points: { ts: number; date: string; commits: number }[] = Object.values(byBucket)
      .sort((a, b) => a.ts - b.ts)
      .map(({ ts, commits, latestDate }) => ({
        ts,
        date: latestDate.slice(0, 10),
        commits,
      }))

    // Anchor the left edge at rangeStart so gradient percentages align with the axis domain
    if (points.length === 0 || points[0].ts > rangeStartTs + 86400000) {
      points.unshift({ ts: rangeStartTs, date: rangeStart.toISOString().slice(0, 10), commits: 0 })
    }

    return { points, rangeStartTs, todayTs }
  }, [allCommitsData, chartRange])

  const gradientStops = useMemo(() => {
    const { rangeStartTs, todayTs } = commitChartData
    const duration = todayTs - rangeStartTs
    const inRange = checkIns
      .map(ci => new Date(ci).getTime())
      .filter(ts => ts > rangeStartTs && ts < todayTs)
      .sort((a, b) => a - b)

    const boundaries = [rangeStartTs, ...inRange, todayTs]
    const numPeriods = boundaries.length - 1

    // Most recent period gets the last (indigo) color; older periods get earlier colors
    const periodColors = Array.from({ length: numPeriods }, (_, i) => {
      const colorIdx = PERIOD_COLORS.length - numPeriods + i
      return PERIOD_COLORS[Math.max(0, colorIdx)]
    })

    if (numPeriods === 1 || duration <= 0) {
      return [
        { offset: '0%', color: periodColors[0] },
        { offset: '100%', color: periodColors[0] },
      ]
    }

    const stops: { offset: string; color: string }[] = []
    stops.push({ offset: '0%', color: periodColors[0] })
    for (let i = 1; i < boundaries.length - 1; i++) {
      const pct = ((boundaries[i] - rangeStartTs) / duration * 100).toFixed(2) + '%'
      stops.push({ offset: pct, color: periodColors[i - 1] })
      stops.push({ offset: pct, color: periodColors[i] })
    }
    stops.push({ offset: '100%', color: periodColors[numPeriods - 1] })
    return stops
  }, [commitChartData, checkIns])

  const commitNoteStats = (notes ?? []).reduce<Record<string, { total: number; reminders: number }>>(
    (acc, note) => {
      if (!note.commit_hash) return acc
      const existing = acc[note.commit_hash] ?? { total: 0, reminders: 0 }
      acc[note.commit_hash] = {
        total: existing.total + 1,
        reminders: existing.reminders + (note.is_reminder ? 1 : 0),
      }
      return acc
    },
    {}
  )

  const latestSummary = summaries?.[0]
  const noteCount = notes?.length ?? 0

  const totalCommitPages = Math.ceil(filteredCommits.length / COMMITS_PER_PAGE)

  function renderCommitPagination() {
    if (totalCommitPages <= 1) return null
    const pages: (number | '…')[] = []
    for (let i = 0; i < totalCommitPages; i++) {
      if (i === 0 || i === totalCommitPages - 1 || Math.abs(i - commitPage) <= 1) {
        pages.push(i)
      } else if (pages[pages.length - 1] !== '…') {
        pages.push('…')
      }
    }
    return (
      <div className="flex items-center gap-1">
        <button
          disabled={commitPage === 0}
          onClick={() => setCommitPage(p => p - 1)}
          className="text-xs px-2 h-7 rounded border transition-colors text-muted-foreground border-border hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setCommitPage(p)}
              className={cn(
                'text-xs w-7 h-7 rounded border transition-colors',
                p === commitPage
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'text-muted-foreground border-border hover:border-indigo-300'
              )}
            >
              {p + 1}
            </button>
          )
        )}
        <button
          disabled={commitPage >= totalCommitPages - 1}
          onClick={() => setCommitPage(p => p + 1)}
          className="text-xs px-2 h-7 rounded border transition-colors text-muted-foreground border-border hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    )
  }

  if (repoLoading) {
    return (
      <div className="px-6 py-8">
        <div className="h-8 w-64 bg-muted rounded animate-pulse mb-4" />
        <div className="h-4 w-40 bg-muted rounded animate-pulse mb-8" />
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="px-6 py-8">
        <p className="text-muted-foreground">Repository not found.</p>
      </div>
    )
  }

  return (
    <div>
      {/* NProgress-style loading bar */}
      {isPageLoading && (
        <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-transparent pointer-events-none">
          <div
            className="h-full bg-indigo-500 transition-[width] duration-300 ease-out"
            style={{ width: `${loadProgress}%` }}
          />
        </div>
      )}
      {/* Clean white page header */}
      <div className="bg-white border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className="text-muted-foreground hover:text-indigo-600 transition-colors mt-0.5 flex-shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-semibold truncate text-foreground">{repo.name}</h1>
                <HealthBadge status={healthScore?.status ?? repo.health_status} />
                {healthScore && (
                  <div className={cn(
                    'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border',
                    healthScore.composite >= 0.75
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : healthScore.composite >= 0.375
                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                      : 'bg-red-100 text-red-700 border-red-200'
                  )}>
                    <span>Score: {Math.round(healthScore.composite * 100)}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <p className="text-sm text-muted-foreground truncate">{repo.github_url}</p>
                <span className="text-xs text-muted-foreground flex-shrink-0 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  {repo.last_synced_at ? `Synced ${formatDateTime(repo.last_synced_at)}` : 'Never synced'}
                </span>
              </div>

              {healthScore && (() => {
                const signals = [
                  {
                    label: 'Frequency',
                    value: healthScore.commit_frequency,
                    tip: 'Avg commits/week over the last 4 weeks. Green ≥10/wk, yellow 4–9/wk, red ≤3/wk.',
                  },
                  {
                    label: 'Recency',
                    value: healthScore.recency,
                    tip: 'Days since the most recent commit. Green <3 days, yellow 3–7 days, red >7 days.',
                  },
                  {
                    label: 'Distribution',
                    value: healthScore.distribution,
                    tip: 'How evenly commits are spread across contributors (Gini coefficient). Green = well distributed, red = one person dominates.',
                  },
                  {
                    label: 'Branches',
                    value: healthScore.branch_activity,
                    tip: 'Active branch count. Green ≥2 branches, yellow = 1 branch with recent activity, red = stale or no branches.',
                  },
                  {
                    label: 'Msg Quality',
                    value: healthScore.commit_message_quality,
                    tip: 'Percentage of commits with descriptive messages (≥10 chars, multi-word). Green <10% low-quality, red >30%.',
                  },
                  {
                    label: 'Participation',
                    value: healthScore.participation ?? 0,
                    tip: 'Actual vs expected unique contributors. Green = at or above expected, yellow ≥60%, red <60%.',
                  },
                ]
                return (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {signals.map((signal) => {
                      const norm = signal.value / 2
                      const dotClass = norm >= 0.7
                        ? 'bg-emerald-500'
                        : norm >= 0.4
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                      return (
                        <div
                          key={signal.label}
                          title={signal.tip}
                          className={cn(
                            'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border cursor-default',
                            norm >= 0.7
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                              : norm >= 0.4
                              ? 'bg-amber-100 text-amber-700 border-amber-200'
                              : 'bg-red-100 text-red-700 border-red-200'
                          )}
                        >
                          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotClass)} />
                          <span>{signal.label}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {/* Row 1: navigation + history */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={repo.github_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  GitHub
                </a>
              </Button>
              {repo.local_path && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`vscode://file/${repo.local_path}`}>
                    <Code2 className="h-4 w-4 mr-1.5" />
                    VS Code
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSummaryHistoryOpen(true)}
                className="relative"
              >
                <History className="h-4 w-4 mr-1.5" />
                AI History
                {(summaries?.length ?? 0) > 0 && (
                  <span className="ml-1.5 bg-violet-100 text-violet-700 text-xs font-semibold rounded-full px-1.5 py-0.5 leading-none">
                    {summaries!.length}
                  </span>
                )}
              </Button>
            </div>
            {/* Row 2: actions */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  const repoId = repo.id
                  const toastId = toast.loading('Syncing repository…')
                  try {
                    await syncMutation.mutateAsync(repoId)
                    toast.success('Sync started — data will refresh shortly.', { id: toastId })
                    setTimeout(() => {
                      queryClient.invalidateQueries({ queryKey: repoKeys.detail(repoId) })
                      queryClient.invalidateQueries({ queryKey: repoKeys.health(repoId) })
                      queryClient.invalidateQueries({ queryKey: repoKeys.commits(repoId) })
                      queryClient.invalidateQueries({ queryKey: repoKeys.contributors(repoId) })
                    }, 5000)
                  } catch {
                    toast.error('Sync failed — check backend logs for details.', { id: toastId })
                  }
                }}
                disabled={syncMutation.isPending || !hasToken}
                title={!hasToken ? 'Add a GitHub token in your profile to enable syncing' : undefined}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <RefreshCw className={cn('h-4 w-4 mr-1.5', syncMutation.isPending && 'animate-spin')} />
                Sync
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRemove}
                disabled={deleteRepoMutation.isPending}
                className="text-red-500 hover:text-red-600 border-red-200 hover:border-red-300"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Body — flex-row when notes are pinned, flex-col otherwise */}
      <div className={cn('px-6 py-6 flex gap-6', notesPinned ? 'flex-row items-start' : 'flex-col')}>

        {/* Main sections column */}
        <div className={cn('flex flex-col gap-6', notesPinned ? 'flex-1 min-w-0' : 'w-full')}>
        <div className="flex gap-8 items-start">

          {/* Left column — main content */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">

            {/* Overview section */}
            <motion.div variants={sectionVariants} initial="hidden" animate="visible">
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-muted-foreground" />
                Overview
              </h2>
              <div className="flex flex-col gap-5">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <button
                        className="flex items-center gap-1.5 text-base font-semibold hover:text-indigo-600 transition-colors"
                        onClick={() => latestSummary && setSummaryExpanded(v => !v)}
                      >
                        AI Summary
                        {latestSummary && (summaryExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleGenerateSummary}
                        disabled={generateSummaryMutation.isPending}
                      >
                        <Sparkles className={cn('h-4 w-4 mr-1.5', generateSummaryMutation.isPending && 'animate-pulse')} />
                        {generateSummaryMutation.isPending ? 'Generating...' : 'Generate Summary'}
                      </Button>
                    </div>
                  </CardHeader>
                  {summaryExpanded && (
                  <CardContent>
                    {latestSummary ? (
                      <div>
                        <MarkdownContent content={latestSummary.content} />
                        <p className="text-xs text-muted-foreground mt-3">
                          Generated {formatDateTime(latestSummary.generated_at)} · {latestSummary.model_used}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No summary generated yet. Click "Generate Summary" to create one.
                      </p>
                    )}
                  </CardContent>
                  )}
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">Commit Activity</CardTitle>
                        {checkIns.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            Last checked: {formatRelativeDays(checkIns[checkIns.length - 1])}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleCheckIn}
                          title="Record a check-in now"
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded border text-indigo-600 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          <span>Check In</span>
                        </button>
                        <button
                          onClick={() => { setShowPastCheckIn(v => !v); setPastCheckInDate('') }}
                          title="Add a past check-in"
                          className={cn(
                            'flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors mr-1',
                            showPastCheckIn
                              ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                              : 'text-muted-foreground border-border hover:border-indigo-300'
                          )}
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                        </button>
                        {(['7d', '30d', '90d', 'all'] as const).map((r) => (
                          <button
                            key={r}
                            onClick={() => setChartRange(r)}
                            className={cn(
                              'text-xs px-2 py-1 rounded border transition-colors',
                              chartRange === r
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'text-muted-foreground border-border hover:border-indigo-300'
                            )}
                          >
                            {r === 'all' ? 'All' : r}
                          </button>
                        ))}
                      </div>
                    </div>
                    {showPastCheckIn && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                        <input
                          type="datetime-local"
                          value={pastCheckInDate}
                          onChange={(e) => setPastCheckInDate(e.target.value)}
                          max={new Date().toISOString().slice(0, 16)}
                          className="text-xs border border-border rounded px-2 py-1 flex-1 focus:outline-none focus:border-indigo-400"
                        />
                        <button
                          onClick={handleAddPastCheckIn}
                          disabled={!pastCheckInDate}
                          className="text-xs px-2 py-1 rounded border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => setShowPastCheckIn(false)}
                          className="text-xs px-2 py-1 rounded border text-muted-foreground border-border hover:border-indigo-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    {commitChartData.points.filter(p => p.commits > 0).length > 0 ? (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={commitChartData.points}>
                            <defs>
                              <linearGradient id="periodGradient" x1="0" y1="0" x2="1" y2="0">
                                {gradientStops.map((stop, i) => (
                                  <stop key={i} offset={stop.offset} stopColor={stop.color} stopOpacity={1} />
                                ))}
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis
                              type="number"
                              dataKey="ts"
                              scale="time"
                              domain={[commitChartData.rangeStartTs, commitChartData.todayTs]}
                              tickCount={6}
                              tick={{ fontSize: 11 }}
                              tickFormatter={(ts: number) =>
                                new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              }
                            />
                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                            <Tooltip
                              labelFormatter={(ts: number) =>
                                new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              }
                              formatter={(v: number) => [v, 'Commits']}
                            />
                            {checkIns
                              .map(ci => new Date(ci).getTime())
                              .filter(ts => ts > commitChartData.rangeStartTs && ts < commitChartData.todayTs)
                              .map((ts, i) => (
                                <ReferenceLine
                                  key={i}
                                  x={ts}
                                  stroke="#6366f1"
                                  strokeDasharray="4 2"
                                  strokeWidth={1.5}
                                  label={{ value: '✓', position: 'insideTopRight', fontSize: 10, fill: '#6366f1' }}
                                />
                              ))}
                            <Area
                              type="monotone"
                              dataKey="commits"
                              stroke="url(#periodGradient)"
                              fill="url(#periodGradient)"
                              fillOpacity={0.2}
                              strokeWidth={2}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-8 text-center">
                        No commits in the selected range.
                      </p>
                    )}
                  </CardContent>
                </Card>

              </div>
            </motion.div>

            {/* Commits section */}
            <motion.div variants={sectionVariants} initial="hidden" animate="visible" transition={{ delay: 0.1 }}>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <GitCommit className="h-4 w-4 text-muted-foreground" />
                Commits
              </h2>
              {!allCommitsData?.items.length ? (
                <p className="text-muted-foreground text-sm">No commits found.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2">
                    {allBranches.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground mr-1">Branch:</span>
                        <button
                          onClick={() => setSelectedBranches(new Set())}
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded border transition-colors',
                            selectedBranches.size === 0
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          )}
                        >
                          All
                        </button>
                        {(showAllBranches ? allBranches : allBranches.slice(0, MAX_FILTER_CHIPS)).map(b => (
                          <button
                            key={b}
                            onClick={() => toggleBranch(b)}
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded border font-mono transition-colors',
                              selectedBranches.has(b)
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                            )}
                          >
                            {b}
                          </button>
                        ))}
                        {allBranches.length > MAX_FILTER_CHIPS && (
                          <button
                            onClick={() => setShowAllBranches(v => !v)}
                            className="text-xs px-1.5 py-0.5 rounded border transition-colors bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"
                          >
                            {showAllBranches ? 'Show less' : `+${allBranches.length - MAX_FILTER_CHIPS} more`}
                          </button>
                        )}
                      </div>
                    )}
                    {allAuthors.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground mr-1">Author:</span>
                        <button
                          onClick={() => setSelectedAuthors(new Set())}
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded border transition-colors',
                            selectedAuthors.size === 0
                              ? 'bg-violet-600 text-white border-violet-600'
                              : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                          )}
                        >
                          All
                        </button>
                        {(showAllAuthors ? allAuthors : allAuthors.slice(0, MAX_FILTER_CHIPS)).map(a => (
                          <button
                            key={a}
                            onClick={() => toggleAuthor(a)}
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded border transition-colors',
                              selectedAuthors.has(a)
                                ? 'bg-violet-600 text-white border-violet-600'
                                : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                            )}
                          >
                            {a}
                          </button>
                        ))}
                        {allAuthors.length > MAX_FILTER_CHIPS && (
                          <button
                            onClick={() => setShowAllAuthors(v => !v)}
                            className="text-xs px-1.5 py-0.5 rounded border transition-colors bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"
                          >
                            {showAllAuthors ? 'Show less' : `+${allAuthors.length - MAX_FILTER_CHIPS} more`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {totalCommitPages > 1 && (
                    <div className="flex items-center justify-between py-1">
                      <p className="text-xs text-muted-foreground">
                        {filteredCommits.length} commit{filteredCommits.length !== 1 ? 's' : ''}
                        {filteredCommits.length !== (allCommitsData?.items.length ?? 0) && (
                          <span> (of {allCommitsData?.items.length ?? 0})</span>
                        )}
                      </p>
                      {renderCommitPagination()}
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left pb-2 font-medium">Commit</th>
                          <th className="text-left pb-2 font-medium">Author</th>
                          <th className="text-left pb-2 font-medium">Branch</th>
                          <th className="text-right pb-2 font-medium">+/-</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedCommits.map((commit) => (
                          <>
                          <tr id={`commit-${commit.hash}`} key={commit.hash} className={cn(
                            'border-b hover:bg-accent/20 transition-colors',
                            highlightedCommitHash === commit.hash && 'ring-2 ring-inset ring-indigo-400 bg-indigo-50'
                          )}>
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-2">
                                <a
                                  href={`${repo.github_url}/commit/${commit.hash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 font-mono text-xs text-indigo-600 hover:underline whitespace-nowrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <GitCommit className="h-3 w-3 flex-shrink-0" />
                                  {commit.hash.slice(0, 7)}
                                </a>
                                <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                  <Calendar className="h-3 w-3 flex-shrink-0" />
                                  {formatDate(commit.date)}
                                </span>
                              </div>
                              <p className="text-xs mt-0.5 break-words">{commit.message}</p>
                              {(() => {
                                const stats = commitNoteStats[commit.hash]
                                return (
                                  <button
                                    onClick={() => setActiveCommitHash(activeCommitHash === commit.hash ? null : commit.hash)}
                                    className="text-xs text-muted-foreground hover:text-indigo-600 mt-0.5 flex items-center gap-1"
                                  >
                                    <MessageSquare className="h-3 w-3" />
                                    {stats ? (
                                      <>
                                        <span className="bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none">
                                          {stats.total}
                                        </span>
                                        {stats.reminders > 0 && (
                                          <span className="bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none">
                                            {stats.reminders} reminder{stats.reminders !== 1 ? 's' : ''}
                                          </span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="text-xs">Add note</span>
                                    )}
                                  </button>
                                )
                              })()}
                            </td>
                            <td className="py-2.5 pr-4 text-xs whitespace-nowrap">{resolvedAuthor(commit)}</td>
                            <td className="py-2.5 pr-4 text-xs max-w-[10rem]">
                              {(() => {
                                const mainNames = ['main', 'master']
                                const onMain = commit.branches.some(b => mainNames.includes(b))
                                const originBranch = commit.branches.find(b => !mainNames.includes(b)) ?? commit.branches[0]
                                const displayBranch = originBranch && originBranch.length > 22
                                  ? originBranch.slice(0, 20) + '…'
                                  : originBranch
                                return (
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {originBranch && (
                                      <button
                                        title={originBranch.length > 22 ? originBranch : undefined}
                                        onClick={(e) => { e.stopPropagation(); toggleBranch(originBranch) }}
                                        className={cn(
                                          'rounded px-1.5 py-0.5 font-mono border transition-colors truncate max-w-full',
                                          selectedBranches.has(originBranch)
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                                        )}
                                      >
                                        {displayBranch}
                                      </button>
                                    )}
                                    {onMain && (
                                      <span title="Merged to main" className="text-emerald-500 flex-shrink-0">
                                        <GitMerge className="h-3.5 w-3.5" />
                                      </span>
                                    )}
                                  </div>
                                )
                              })()}
                            </td>
                            <td className="py-2.5 text-right text-xs whitespace-nowrap">
                              <span className="text-health-green">+{commit.insertions}</span>
                              {' / '}
                              <span className="text-health-red">-{commit.deletions}</span>
                            </td>
                          </tr>
                          {activeCommitHash === commit.hash && (
                            <tr>
                              <td colSpan={5} className="pb-3 pt-1">
                                <CommitNotesPanel repoId={id ?? ''} commitHash={commit.hash} />
                              </td>
                            </tr>
                          )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-muted-foreground">
                      {filteredCommits.length} commit{filteredCommits.length !== 1 ? 's' : ''}
                      {filteredCommits.length !== (allCommitsData?.items.length ?? 0) && (
                        <span> (of {allCommitsData?.items.length ?? 0})</span>
                      )}
                      {totalCommitPages > 1 && (
                        <span> — page {commitPage + 1} of {totalCommitPages}</span>
                      )}
                    </p>
                    {renderCommitPagination()}
                  </div>
                </div>
              )}
            </motion.div>


          </div>

          {/* Right column — Contributors + Notes */}
          <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col gap-6">

            {/* Contributors panel */}
            <div className="bg-gray-50 rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Contributors</h2>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Expected:</span>
                  <input
                    type="number"
                    min={contributors?.length ?? 1}
                    value={expectedCount}
                    onChange={e => setExpectedCount(e.target.value)}
                    onBlur={handleSaveExpectedCount}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveExpectedCount() }}
                    placeholder="—"
                    className="w-10 text-xs text-center border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  />
                </div>
                {selectedContributorIds.size >= 2 && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 font-medium">
                    {selectedContributorIds.size} selected
                  </span>
                )}
              </div>

              {/* Merge bar — shown when 2+ selected */}
              {selectedContributorIds.size >= 2 && (
                <div className="mb-3 p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg flex flex-col gap-2">
                  <p className="text-xs text-indigo-700 font-medium">Merge display name:</p>
                  <input
                    className="w-full text-xs border border-indigo-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    value={mergeDisplayName}
                    onChange={e => setMergeDisplayName(e.target.value)}
                    placeholder="Merged contributor name"
                    onFocus={() => { if (!mergeDisplayName) initMerge() }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleMerge}
                      disabled={!mergeDisplayName.trim() || mergeContributorsMutation.isPending}
                      className="flex-1 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded px-2 py-1.5 font-medium transition-colors"
                    >
                      {mergeContributorsMutation.isPending ? 'Merging…' : 'Confirm Merge'}
                    </button>
                    <button
                      onClick={() => { setSelectedContributorIds(new Set()); setMergeDisplayName('') }}
                      className="text-xs border border-border rounded px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!sortedContributors.length ? (
                <p className="text-xs text-muted-foreground text-center py-4">No contributors found.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {sortedContributors.map((contributor) => (
                    <div key={contributor.id} className={cn(
                      'flex items-start gap-2 rounded-lg p-1.5 -mx-1.5 transition-colors',
                      selectedContributorIds.has(contributor.id) && 'bg-indigo-50'
                    )}>
                      <input
                        type="checkbox"
                        checked={selectedContributorIds.has(contributor.id)}
                        onChange={() => toggleContributorSelect(contributor.id)}
                        className="mt-1 h-3.5 w-3.5 flex-shrink-0 accent-indigo-600 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        {editingContributorId === contributor.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              className="flex-1 min-w-0 text-sm border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              value={editingName}
                              onChange={e => setEditingName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') cancelEditing() }}
                            />
                            <button onClick={saveDisplayName} disabled={updateContributorMutation.isPending} className="text-emerald-600 hover:text-emerald-700">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={cancelEditing} className="text-muted-foreground hover:text-foreground">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <p className="font-medium text-sm truncate">{contributor.display_name}</p>
                            <button
                              onClick={() => startEditing(contributor)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-indigo-600 transition-opacity flex-shrink-0"
                              title="Edit display name"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <ContributorGenerateButton contributorId={contributor.id} repoId={id ?? ''} />
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {contributor.aliases.length} alias{contributor.aliases.length !== 1 ? 'es' : ''}
                          {contributor.aliases.length > 0 && (
                            <span> — {contributor.aliases.map((a) => a.git_email).join(', ')}</span>
                          )}
                        </p>
                        {(() => {
                          const s = contributorStats[contributor.id]
                          const commits = s?.commits ?? contributor.commit_count
                          const ins = s?.insertions ?? contributor.total_insertions
                          const del = s?.deletions ?? contributor.total_deletions
                          const last = s?.lastCommitAt ?? contributor.last_commit_at
                          return (
                            <p className="text-xs text-muted-foreground mt-1">
                              {commits} commits
                              {' · '}
                              <span className="text-green-600">+{ins.toLocaleString()}</span>
                              {' / '}
                              <span className="text-red-600">-{del.toLocaleString()}</span>
                              {' · '}
                              Last: {last ? formatDate(last) : 'Never'}
                            </p>
                          )
                        })()}
                        <ContributorSummaryDisplay contributorId={contributor.id} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pull Requests panel */}
            <div className="bg-gray-50 rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <GitPullRequest className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Pull Requests</h2>
                <button
                  onClick={() => syncPRsMutation.mutate()}
                  disabled={syncPRsMutation.isPending || !hasToken}
                  className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={!hasToken ? 'Add a GitHub token to fetch PRs' : prStats && prStats.total_count > 0 ? 'Refresh PRs' : 'Fetch PRs from GitHub'}
                >
                  {syncPRsMutation.isPending
                    ? <div className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    : <RefreshCw className="h-3 w-3" />}
                  {syncPRsMutation.isPending ? 'Syncing…' : prStats && prStats.total_count > 0 ? 'Refresh' : 'Fetch PRs'}
                </button>
                {prStats && prStats.total_count > 0 && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 font-medium">
                    {prStats.total_count}
                  </span>
                )}
              </div>

              {/* State filter */}
              {prStats && prStats.total_count > 0 && (
                <div className="flex gap-1 mb-3">
                  {(['all', 'open', 'merged', 'closed'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => { setPrStateFilter(s === 'all' ? undefined : s); setPrPage(0) }}
                      className={cn(
                        'flex-1 py-0.5 rounded text-xs font-medium transition-colors capitalize',
                        (s === 'all' ? !prStateFilter : prStateFilter === s)
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* PR list */}
              {!prStats || prStats.total_count === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {prStats?.fetched_at
                    ? 'No pull requests found.'
                    : 'Click Fetch PRs above to load pull requests from GitHub.'}
                </p>
              ) : (
                <div>
                  {prList?.items.map((pr: PullRequest, index: number, arr: PullRequest[]) => (
                    <div
                      key={pr.id}
                      className={cn('flex items-start gap-2 py-2', index < arr.length - 1 && 'border-b border-border')}
                    >
                      <span className="text-xs text-gray-400 font-mono flex-shrink-0 mt-0.5">#{pr.pr_number}</span>
                      <div className="flex-1 min-w-0">
                        <a
                          href={pr.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-700 hover:text-indigo-600 transition-colors leading-relaxed line-clamp-2"
                          title={pr.title}
                        >
                          {pr.draft && <span className="text-gray-400">[Draft] </span>}
                          {pr.title}
                        </a>
                        <div className="flex items-center gap-2 mt-1">
                          <PRStatePill state={pr.state} />
                          <span className="text-[10px] text-gray-400 truncate">{pr.author_login}</span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0 ml-auto">
                            {pr.state === 'merged' && pr.merged_at
                              ? formatRelativeDays(pr.merged_at)
                              : pr.state === 'closed' && pr.closed_at
                              ? formatRelativeDays(pr.closed_at)
                              : pr.created_at
                              ? formatRelativeDays(pr.created_at)
                              : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {prList && prList.total > PR_PAGE_SIZE && (
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-border">
                      <span className="text-[10px] text-muted-foreground">
                        {prPage * PR_PAGE_SIZE + 1}–{Math.min((prPage + 1) * PR_PAGE_SIZE, prList.total)} of {prList.total}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          disabled={prPage === 0}
                          onClick={() => setPrPage(p => p - 1)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Prev
                        </button>
                        <button
                          disabled={(prPage + 1) * PR_PAGE_SIZE >= prList.total}
                          onClick={() => setPrPage(p => p + 1)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>{/* end right column */}

        </div>{/* end inner two-column flex */}
        </div>{/* end main sections column */}

        <NotesDrawer
          repoId={id ?? ''}
          notes={notes}
          noteCount={noteCount}
          showArchivedNotes={showArchivedNotes}
          onToggleArchivedNotes={() => setShowArchivedNotes(v => !v)}
          createNoteMutation={{ isPending: createNoteMutation.isPending, mutate: (data) => handleCreateNote(data) }}
          updateNoteMutation={{ mutate: ({ id: noteId, data }) => updateNoteMutation.mutate({ id: noteId, data: data as Partial<Note> }) }}
          deleteNoteMutation={{ mutate: (noteId) => { if (window.confirm('Delete this note?')) deleteNoteMutation.mutate(noteId) } }}
          users={users}
          currentUser={currentUser}
          onScrollToCommit={handleScrollToCommit}
          onPinnedChange={setNotesPinned}
        />

      </div>{/* end body flex wrapper */}

      <SummaryHistoryModal
        open={summaryHistoryOpen}
        onClose={() => setSummaryHistoryOpen(false)}
        summaries={summaries ?? []}
        contributors={contributors ?? []}
      />
    </div>
  )
}
