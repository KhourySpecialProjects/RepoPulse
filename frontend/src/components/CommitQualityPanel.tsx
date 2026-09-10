import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronDown, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCommitQuality } from '@/services/api'
import type { RepoCommitQuality, ScoredCommit } from '@/types'

const SCORE_CONFIG = {
  good: { label: 'Good', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  ok:   { label: 'OK',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  bad:  { label: 'Bad',  className: 'bg-red-100 text-red-700 border-red-200' },
}

function ScorePill({ score }: { score: ScoredCommit['score'] }) {
  const cfg = SCORE_CONFIG[score] ?? SCORE_CONFIG.ok
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function RepoSection({ repo }: { repo: RepoCommitQuality }) {
  const [open, setOpen] = useState(true)
  const goodCount = repo.commits.filter((c) => c.score === 'good').length
  const badCount  = repo.commits.filter((c) => c.score === 'bad').length

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        aria-label={repo.repo_name}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {open
            ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
            : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
          }
          <span className="font-medium text-sm text-gray-900 truncate">{repo.repo_name}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">{repo.commits.length} commits</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {goodCount > 0 && <span className="text-xs text-emerald-600 font-medium">{goodCount} good</span>}
          {badCount  > 0 && <span className="text-xs text-red-500 font-medium">{badCount} bad</span>}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-white">
                  <th className="text-left px-4 py-2 text-gray-400 font-medium w-16">Hash</th>
                  <th className="text-left px-4 py-2 text-gray-400 font-medium">Message</th>
                  <th className="text-left px-4 py-2 text-gray-400 font-medium w-32 hidden sm:table-cell">Author</th>
                  <th className="text-left px-4 py-2 text-gray-400 font-medium w-24 hidden md:table-cell">Date</th>
                  <th className="text-left px-4 py-2 text-gray-400 font-medium w-16">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {repo.commits.map((commit) => (
                  <tr key={commit.hash} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2 font-mono text-gray-400">{commit.hash}</td>
                    <td className="px-4 py-2 text-gray-700 max-w-0">
                      <span className="block truncate" title={commit.message}>{commit.message}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 truncate hidden sm:table-cell">{commit.author}</td>
                    <td className="px-4 py-2 text-gray-400 hidden md:table-cell">
                      {new Date(commit.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <ScorePill score={commit.score} />
                        {commit.from_cache && (
                          <span className="text-[10px] text-gray-300" title="Score loaded from cache">●</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface CommitQualityPanelProps {
  collectionId: string
  perRepo?: number
}

export function CommitQualityPanel({ collectionId, perRepo = 15 }: CommitQualityPanelProps) {
  const { data: result, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['commit-quality', collectionId, perRepo],
    queryFn: () => getCommitQuality(collectionId, perRepo),
    staleTime: 5 * 60 * 1000,
  })

  const errorMessage = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? (error ? 'Failed to analyze commit quality' : null)

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-900">Commit Message Quality</h3>
          {result && (
            <span className="text-xs text-gray-400 ml-1">
              · {result.repos.length} repos · {result.total_cache_hits > 0 ? `${result.total_cache_hits} cached, ${result.total_newly_scored} new` : `${result.total_newly_scored} scored`} · {result.model_used}
              {result.repos_skipped > 0 && ` · ${result.repos_skipped} skipped`}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          loading={isFetching} disabled={isFetching}
          className="gap-1.5"
        >
          {isFetching ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Re-analyze
            </>
          )}
        </Button>
      </div>

      {/* Body */}
      <AnimatePresence mode="wait">
        {isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-5 py-8 text-center text-sm text-gray-400"
          >
            <div className="flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              Fetching commits and scoring with LLM…
            </div>
          </motion.div>
        )}

        {!isLoading && errorMessage && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-5 py-4 flex items-center gap-2 text-sm text-red-600"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {errorMessage}
          </motion.div>
        )}

        {!isLoading && result && result.repos.length === 0 && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="px-5 py-8 text-center text-sm text-gray-400"
          >
            No repos with commit history found in this collection.
          </motion.div>
        )}

        {!isLoading && result && result.repos.length > 0 && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="p-4 flex flex-col gap-3"
          >
            {result.repos.map((repo) => (
              <RepoSection key={repo.repo_id} repo={repo} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
