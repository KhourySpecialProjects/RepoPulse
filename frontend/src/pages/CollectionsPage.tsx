import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, FolderOpen, BookOpen, RefreshCw, Archive, ArchiveRestore, Pencil } from 'lucide-react'
import { useCollections, useCreateCollection, useUpdateCollection } from '@/hooks/useCollections'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Collection, CreateCollectionData } from '@/types'

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}

export function CollectionsPage() {
  const navigate = useNavigate()
  const [showArchived, setShowArchived] = useState(false)
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null)
  const [editForm, setEditForm] = useState({ name: '', course_tag: '', semester_tag: '' })
  const { data, isLoading, isError } = useCollections(50, 0, showArchived)
  const createMutation = useCreateCollection()
  const updateCollectionMutation = useUpdateCollection()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState<CreateCollectionData>({
    name: '',
    course_tag: '',
    semester_tag: '',
    local_folder_name: '',
  })

  function handleFormChange(field: keyof CreateCollectionData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      const payload: CreateCollectionData = {
        name: form.name.trim(),
        local_folder_name: form.local_folder_name.trim(),
        course_tag: form.course_tag?.trim() || null,
        semester_tag: form.semester_tag?.trim() || null,
      }
      await createMutation.mutateAsync(payload)
      setDialogOpen(false)
      setForm({ name: '', course_tag: '', semester_tag: '', local_folder_name: '' })
    } catch {
      setFormError('Failed to create collection. Please try again.')
    }
  }

  function handleEditOpen(col: Collection, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingCollection(col)
    setEditForm({
      name: col.name,
      course_tag: col.course_tag ?? '',
      semester_tag: col.semester_tag ?? '',
    })
  }

  async function handleEditSave() {
    if (!editingCollection || !editForm.name.trim()) return
    await updateCollectionMutation.mutateAsync({
      id: editingCollection.id,
      data: {
        name: editForm.name.trim(),
        course_tag: editForm.course_tag.trim() || null,
        semester_tag: editForm.semester_tag.trim() || null,
      },
    })
    setEditingCollection(null)
  }

  async function handleArchiveToggle(col: Collection, e: React.MouseEvent) {
    e.stopPropagation()
    await updateCollectionMutation.mutateAsync({
      id: col.id,
      data: { is_archived: !col.is_archived },
    })
  }

  const collections = data?.items ?? []

  return (
    <div>
      <div className="border-b border-border bg-white px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Collections</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowArchived(v => !v)}
            className={cn(showArchived && 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100')}
          >
            <Archive className="h-4 w-4 mr-1.5" />
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
            <Plus className="h-4 w-4 mr-2" />
            New Collection
          </Button>
        </div>
      </div>
    <div className="px-6 py-6">

      {isLoading && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          Failed to load collections.
        </div>
      )}

      {!isLoading && !isError && collections.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20 text-muted-foreground"
        >
          <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No collections yet</p>
          <p className="text-sm mt-1">Create a collection to start monitoring repositories</p>
        </motion.div>
      )}

      {!isLoading && collections.length > 0 && (
        <motion.div
          className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence>
            {collections.map((collection) => (
              <motion.div key={collection.id} variants={itemVariants} className={cn(collection.is_archived && 'opacity-70')}>
                <Card
                  className="cursor-pointer bg-white shadow-sm hover:shadow-md border border-border hover:border-indigo-200 transition-all duration-200 h-full"
                  onClick={() => navigate(`/collections/${collection.id}`)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <BookOpen className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{collection.name}</CardTitle>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {collection.is_archived && (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                <Archive className="h-3 w-3" />
                                Archived
                              </span>
                            )}
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
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleEditOpen(collection, e)}
                          title="Edit collection"
                          className="p-1.5 rounded text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleArchiveToggle(collection, e)}
                          title={collection.is_archived ? 'Unarchive collection' : 'Archive collection'}
                          className="p-1.5 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors"
                        >
                          {collection.is_archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm">
                      {collection.repo_count} repositor{collection.repo_count !== 1 ? 'ies' : 'y'}
                    </CardDescription>
                    {collection.repo_count > 0 && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {collection.health_green > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                            {collection.health_green}
                          </span>
                        )}
                        {collection.health_yellow > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
                            {collection.health_yellow}
                          </span>
                        )}
                        {collection.health_red > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
                            {collection.health_red}
                          </span>
                        )}
                        {collection.health_unknown > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-gray-50 text-gray-500 border border-gray-200 rounded-full px-2 py-0.5 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" />
                            {collection.health_unknown}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{collection.local_folder_name}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Collection</DialogTitle>
            <DialogDescription>
              Create a new collection to group and monitor repositories together.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4 mt-2">
            {formError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{formError}</p>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="col-name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="col-name"
                value={form.name}
                onChange={(e) => handleFormChange('name', e.target.value)}
                placeholder="CS 101 Fall 2025"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="col-folder" className="text-sm font-medium">
                Local Folder Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="col-folder"
                value={form.local_folder_name}
                onChange={(e) => handleFormChange('local_folder_name', e.target.value)}
                placeholder="cs101-fall-2025"
                required
              />
              <p className="text-xs text-muted-foreground">
                Folder name within your repo root directory
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="col-course" className="text-sm font-medium">
                  Course Tag
                </label>
                <Input
                  id="col-course"
                  value={form.course_tag ?? ''}
                  onChange={(e) => handleFormChange('course_tag', e.target.value)}
                  placeholder="CS 101"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="col-semester" className="text-sm font-medium">
                  Semester Tag
                </label>
                <Input
                  id="col-semester"
                  value={form.semester_tag ?? ''}
                  onChange={(e) => handleFormChange('semester_tag', e.target.value)}
                  placeholder="Fall 2025"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={createMutation.isPending} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <RefreshCw className={cn('h-4 w-4 mr-2 animate-spin')} />
                    Creating...
                  </>
                ) : (
                  'Create Collection'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Edit Collection Dialog */}
      <Dialog open={editingCollection !== null} onOpenChange={(open) => { if (!open) setEditingCollection(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
            <DialogDescription>
              Update the name and tags for this collection.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-col-name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="edit-col-name"
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Collection name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-col-course" className="text-sm font-medium">
                  Course Tag
                </label>
                <Input
                  id="edit-col-course"
                  value={editForm.course_tag}
                  onChange={e => setEditForm(f => ({ ...f, course_tag: e.target.value }))}
                  placeholder="e.g. CS 101"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-col-semester" className="text-sm font-medium">
                  Semester Tag
                </label>
                <Input
                  id="edit-col-semester"
                  value={editForm.semester_tag}
                  onChange={e => setEditForm(f => ({ ...f, semester_tag: e.target.value }))}
                  placeholder="e.g. Fall 2025"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingCollection(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              loading={updateCollectionMutation.isPending} disabled={!editForm.name.trim() || updateCollectionMutation.isPending}
            >
              {updateCollectionMutation.isPending ? (
                <>
                  <RefreshCw className={cn('h-4 w-4 mr-2 animate-spin')} />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  )
}
