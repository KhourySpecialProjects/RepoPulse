import { useState } from 'react'
import { X, UserPlus, Users } from 'lucide-react'
import { useCollectionAccess, useAddCollectionAccess, useRemoveCollectionAccess } from '@/hooks/useCollectionAccess'
import { useUsers } from '@/hooks/useUsers'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import type { CollectionAccessEntry } from '@/types'

interface CollectionAccessPanelProps {
  collectionId: string
  canManage?: boolean
}

const ACCESS_ROLE_LABELS: Record<CollectionAccessEntry['access_role'], string> = {
  co_instructor: 'Co-Instructor',
  ta: 'Teaching Assistant',
}

const ACCESS_ROLE_COLORS: Record<CollectionAccessEntry['access_role'], string> = {
  co_instructor: 'bg-blue-100 text-blue-700',
  ta: 'bg-violet-100 text-violet-700',
}

interface AddAccessDialogProps {
  collectionId: string
  accessRole: 'co_instructor' | 'ta'
  existingUserIds: Set<string>
  onClose: () => void
}

function AddAccessDialog({ collectionId, accessRole, existingUserIds, onClose }: AddAccessDialogProps) {
  const { data: users = [] } = useUsers()
  const addAccess = useAddCollectionAccess()
  const [selectedUserId, setSelectedUserId] = useState('')

  const eligibleUsers = users.filter((u) => !existingUserIds.has(u.id))

  async function handleAdd() {
    if (!selectedUserId) return
    try {
      await addAccess.mutateAsync({ collectionId, userId: selectedUserId, accessRole })
      toast.success(`${ACCESS_ROLE_LABELS[accessRole]} added`)
      onClose()
    } catch {
      toast.error('Failed to add access')
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {ACCESS_ROLE_LABELS[accessRole]}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {eligibleUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No eligible users available.</p>
          ) : (
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger style={{ backgroundColor: 'white' }}>
                <SelectValue placeholder="Select a user" />
              </SelectTrigger>
              <SelectContent>
                {eligibleUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.display_name} ({u.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            loading={addAccess.isPending} disabled={!selectedUserId || addAccess.isPending}
          >
            {addAccess.isPending ? 'Adding...' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CollectionAccessPanel({ collectionId, canManage = false }: CollectionAccessPanelProps) {
  const { data: accessEntries = [], isLoading } = useCollectionAccess(collectionId)
  const removeAccess = useRemoveCollectionAccess()
  const [addingRole, setAddingRole] = useState<'co_instructor' | 'ta' | null>(null)

  const coInstructors = accessEntries.filter((e) => e.access_role === 'co_instructor')
  const tas = accessEntries.filter((e) => e.access_role === 'ta')
  const existingUserIds = new Set(accessEntries.map((e) => e.user_id))

  async function handleRemove(userId: string) {
    try {
      await removeAccess.mutateAsync({ collectionId, userId })
      toast.success('Access removed')
    } catch {
      toast.error('Failed to remove access')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        <div className="h-4 w-48 bg-muted rounded animate-pulse" />
      </div>
    )
  }

  function renderSection(
    title: string,
    entries: CollectionAccessEntry[],
    role: 'co_instructor' | 'ta'
  ) {
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {title}
          </h4>
          {canManage && (
            <button
              type="button"
              onClick={() => setAddingRole(role)}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              <UserPlus className="h-3 w-3" />
              Add
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">None</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold flex items-center justify-center">
                    {entry.user_display_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{entry.user_display_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{entry.user_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${ACCESS_ROLE_COLORS[entry.access_role]}`}>
                    {ACCESS_ROLE_LABELS[entry.access_role]}
                  </span>
                  {canManage && (
                    <Button variant="ghost"
                      type="button"
                      onClick={() => handleRemove(entry.user_id)}
                      loading={removeAccess.isPending} disabled={removeAccess.isPending}
                      className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40"
                      title="Remove access"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Collection Access</h3>
      </div>
      {renderSection('Co-Instructors', coInstructors, 'co_instructor')}
      {renderSection('Teaching Assistants', tas, 'ta')}

      {addingRole && (
        <AddAccessDialog
          collectionId={collectionId}
          accessRole={addingRole}
          existingUserIds={existingUserIds}
          onClose={() => setAddingRole(null)}
        />
      )}
    </div>
  )
}
