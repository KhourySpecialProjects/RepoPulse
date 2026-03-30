import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, RefreshCw, GitBranch, LayoutGrid, Pencil, Archive, ArchiveRestore, Users } from 'lucide-react'
import { useCollection, useSyncCollection, useUpdateCollection } from '@/hooks/useCollections'
import { useRepos, useAddRepos } from '@/hooks/useRepos'
import { useAuth } from '@/hooks/useAuth'
import { useCurrentUser } from '@/hooks/useUsers'
import { RepoCard } from '@/components/RepoCard'
import { CollectionAccessPanel } from '@/components/CollectionAccessPanel'
import { CommitQualityPanel } from '@/components/CommitQualityPanel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { HealthStatus } from '@/types'

type SortBy = 'name' | 'health' | 'last_synced'
type FilterHealth = 'all' | HealthStatus

const healthOrder: Record<HealthStatus, number> = { red: 0, yellow: 1, unknown: 2, green: 3 }

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: collection, isLoading: collectionLoading } = useCollection(id ?? '')
  const { data: reposData, isLoading: reposLoading } = useRepos(id ?? '')
  const syncMutation = useSyncCollection()
  const addReposMutation = useAddRepos()

  const updateCollectionMutation = useUpdateCollection()

  const { user } = useAuth()
  const { data: currentUser } = useCurrentUser()
  const hasToken = Boolean(currentUser?.github_token_configured)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [filterHealth, setFilterHealth] = useState<FilterHealth>('all')
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', course_tag: '', semester_tag: '' })
  const [accessPanelOpen, setAccessPanelOpen] = useState(false)

  function handleEditOpen() {
    if (!collection) return
    setEditForm({
      name: collection.name,
      course_tag: collection.course_tag ?? '',
      semester_tag: collection.semester_tag ?? '',
    })
    setEditOpen(true)
  }

  async function handleEditSave() {
    if (!collection || !editForm.name.trim()) return
    await updateCollectionMutation.mutateAsync({
      id: collection.id,
      data: {
        name: editForm.name.trim(),
        course_tag: editForm.course_tag.trim() || null,
        semester_tag: editForm.semester_tag.trim() || null,
      },
    })
    setEditOpen(false)
  }

  async function handleArchiveToggle() {
    if (!collection) return
    await updateCollectionMutation.mutateAsync({
      id: collection.id,
      data: { is_archived: !collection.is_archived },
    })
  }

  const repos = reposData?.items ?? []

  const filteredRepos = repos
    .filter((r) => filterHealth === 'all' || r.health_status === filterHealth)
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'health') return healthOrder[a.health_status] - healthOrder[b.health_status]
      if (sortBy === 'last_synced') {
        const aTime = a.last_synced_at ? new Date(a.last_synced_at).getTime() : 0
        const bTime = b.last_synced_at ? new Date(b.last_synced_at).getTime() : 0
        return bTime - aTime
      }
      return 0
    })

  async function handleAddRepos(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    const urls = urlInput
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean)
    if (!urls.length) {
      setAddError('Please enter at least one URL.')
      return
    }
    try {
      await addReposMutation.mutateAsync({ collectionId: id ?? '', urls })
      setDialogOpen(false)
      setUrlInput('')
    } catch {
      setAddError('Failed to add repositories. Check URLs and try again.')
    }
  }

  if (collectionLoading) {
    return (
      <div className="px-6 py-8">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-6" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!collection) {
    return (
      <div className="px-6 py-8">
        <p className="text-muted-foreground">Collection not found.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="border-b border-border bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/collections')}
              className="text-muted-foreground hover:text-indigo-600 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="text-xl font-semibold text-foreground truncate">{collection.name}</h1>
            <div className="flex gap-1.5 flex-shrink-0">
              {collection.course_tag && (
                <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">
                  {collection.course_tag}
                </span>
              )}
              {collection.semester_tag && (
                <span className="text-xs bg-violet-100 text-violet-700 rounded-full px-2 py-0.5 font-medium">
                  {collection.semester_tag}
                </span>
              )}
              {collection.is_archived && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 font-medium">
                  <Archive className="h-3 w-3" />
                  Archived
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleEditOpen}
              title="Edit collection"
              className="p-1.5 rounded text-muted-foreground hover:text-indigo-600 hover:bg-indigo-100 transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={handleArchiveToggle}
              title={collection.is_archived ? 'Unarchive collection' : 'Archive collection'}
              className="p-1.5 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-100 transition-colors"
            >
              {collection.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setAccessPanelOpen((v) => !v)}
              title="Manage access"
              className={`p-1.5 rounded transition-colors ${accessPanelOpen ? 'text-indigo-600 bg-indigo-100' : 'text-muted-foreground hover:text-indigo-600 hover:bg-indigo-100'}`}
            >
              <Users className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="text-muted-foreground text-sm mt-1 ml-7">
          {collection.repo_count} repositor{collection.repo_count !== 1 ? 'ies' : 'y'}
        </p>

        {/* Access Panel */}
        <AnimatePresence>
          {accessPanelOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-4 rounded-lg border border-border bg-gray-50 p-4">
                <CollectionAccessPanel
                  collectionId={collection.id}
                  canManage={
                    user?.role === 'admin' ||
                    collection.owner_id === user?.id
                  }
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    <div className="px-6 py-6">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={filterHealth} onValueChange={(v) => setFilterHealth(v as FilterHealth)}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <SelectValue placeholder="Filter by health" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All health</SelectItem>
              <SelectItem value="green">Healthy</SelectItem>
              <SelectItem value="yellow">At Risk</SelectItem>
              <SelectItem value="red">Critical</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-36 h-9 text-sm">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort by name</SelectItem>
              <SelectItem value="health">Sort by health</SelectItem>
              <SelectItem value="last_synced">Sort by sync date</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate(id ?? '')}
            disabled={syncMutation.isPending || !hasToken}
            title={!hasToken ? 'Add a GitHub token in your profile to enable syncing' : undefined}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', syncMutation.isPending && 'animate-spin')} />
            Sync All
          </Button>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={!hasToken}
            title={!hasToken ? 'Add a GitHub token in your profile to add repositories' : undefined}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Repos
          </Button>
        </div>
      </div>

      {reposLoading && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!reposLoading && filteredRepos.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20 text-muted-foreground"
        >
          <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-40" />
          {repos.length === 0 ? (
            <>
              <p className="font-medium">No repositories yet</p>
              <p className="text-sm mt-1">Add repositories to start monitoring them</p>
            </>
          ) : (
            <>
              <p className="font-medium">No repositories match the current filter</p>
              <p className="text-sm mt-1">Try changing the health filter</p>
            </>
          )}
        </motion.div>
      )}

      {!reposLoading && filteredRepos.length > 0 && (
        <motion.div
          className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05 } },
          }}
        >
          <AnimatePresence>
            {filteredRepos.map((repo) => (
              <RepoCard key={repo.id} repo={repo} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Repositories</DialogTitle>
            <DialogDescription>
              Paste one GitHub repository URL per line to add them to this collection.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddRepos} className="flex flex-col gap-4 mt-2">
            {addError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{addError}</p>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="repo-urls" className="text-sm font-medium">
                Repository URLs
              </label>
              <Textarea
                id="repo-urls"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder={`https://github.com/student/project-1\nhttps://github.com/student/project-2`}
                className="min-h-[120px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">One URL per line</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addReposMutation.isPending}>
                {addReposMutation.isPending ? (
                  <>
                    <GitBranch className="h-4 w-4 mr-2 animate-pulse" />
                    Adding...
                  </>
                ) : (
                  'Add Repositories'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Commit Quality Analysis */}
      {!collection.is_archived && (
        <div className="mt-8">
          <CommitQualityPanel collectionId={id ?? ''} perRepo={15} />
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div>
              <label className="text-sm font-medium">Name *</label>
              <input
                type="text"
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                placeholder="Collection name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Course Tag</label>
              <input
                type="text"
                value={editForm.course_tag}
                onChange={e => setEditForm(f => ({ ...f, course_tag: e.target.value }))}
                className="mt-1 w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                placeholder="e.g. CS 101"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Semester Tag</label>
              <input
                type="text"
                value={editForm.semester_tag}
                onChange={e => setEditForm(f => ({ ...f, semester_tag: e.target.value }))}
                className="mt-1 w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                placeholder="e.g. Fall 2025"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={handleEditSave}
              disabled={!editForm.name.trim() || updateCollectionMutation.isPending}
            >
              {updateCollectionMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  )
}
