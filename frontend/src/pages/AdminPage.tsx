import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Pencil, Link2, Trash2, Plus, Copy } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser, useGenerateSetupLink } from '@/hooks/useUsers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminOverviewTab } from '@/components/admin/AdminOverviewTab'
import { AiSettingsTab } from '@/components/admin/AiSettingsTab'
import { toast } from 'sonner'
import type { UserDetail, CreateUserData, UpdateUserData, SetupLink } from '@/types'
import { PAGE_HEADER_CLASS, PAGE_BODY_CLASS } from '@/lib/layout'

const ROLE_BADGE: Record<UserDetail['role'], string> = {
  instructor: 'bg-brand-100 text-brand-700',
  ta: 'bg-orchid-100 text-orchid-700',
  admin: 'bg-rose-100 text-rose-700',
}

// ---- Create User Dialog ----
function CreateUserDialog({
  onCreated,
  onClose,
}: {
  onCreated: (user: UserDetail, setup: SetupLink) => void
  onClose: () => void
}) {
  const createUser = useCreateUser()
  const [form, setForm] = useState<CreateUserData>({
    email: '',
    display_name: '',
    role: 'ta',
    github_token: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const result = await createUser.mutateAsync({
        ...form,
        github_token: form.github_token || undefined,
      })
      toast.success('User created')
      // Straight to the link rather than closing: the token is readable only
      // in this response, so this is the one chance to hand it over.
      onCreated(result.user, result.setup)
    } catch {
      toast.error('Failed to create user')
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Email *</label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              placeholder="user@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Display Name *</label>
            <Input
              value={form.display_name}
              onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              required
              placeholder="Full name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Role *</label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v as CreateUserData['role'] }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instructor">Instructor</SelectItem>
                <SelectItem value="ta">Teaching Assistant</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">GitHub Token (optional)</label>
            <Input
              type="password"
              value={form.github_token ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, github_token: e.target.value }))}
              placeholder="ghp_..."
              className="font-mono text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            No password needed — you will get a one-time link to send them so they can
            set their own.
          </p>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={createUser.isPending} disabled={createUser.isPending}>
              {createUser.isPending ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- Edit User Dialog ----
function EditUserDialog({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const updateUser = useUpdateUser()
  const [form, setForm] = useState<UpdateUserData>({
    display_name: user.display_name,
    role: user.role,
    github_token: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await updateUser.mutateAsync({
        id: user.id,
        data: { ...form, github_token: form.github_token || undefined },
      })
      toast.success('User updated')
      onClose()
    } catch {
      toast.error('Failed to update user')
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User — {user.display_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={form.display_name ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              placeholder="Display name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Role</label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v as UpdateUserData['role'] }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instructor">Instructor</SelectItem>
                <SelectItem value="ta">Teaching Assistant</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              GitHub Token
              {user.github_token_configured && (
                <span className="ml-2 text-xs font-normal text-emerald-600">(configured)</span>
              )}
            </label>
            <Input
              type="password"
              value={form.github_token ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, github_token: e.target.value }))}
              placeholder={user.github_token_configured ? 'Leave blank to keep existing' : 'ghp_...'}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={updateUser.isPending} disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- Setup Link Dialog ----
/**
 * Hands the admin a setup link to pass on. Shown after creating a user and
 * after generating a reset link. The token is only readable here — the server
 * stores a hash — so closing this dialog loses it and a new link is needed.
 */
function SetupLinkDialog({
  user,
  setup,
  onClose,
}: {
  user: UserDetail
  setup: SetupLink
  onClose: () => void
}) {
  const url = `${window.location.origin}${setup.setup_path}`
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setCopyFailed(false)
      toast.success('Link copied')
    } catch {
      // Clipboard access can be refused outright; the field is selectable, so
      // say so rather than pretending it worked.
      setCopyFailed(true)
      toast.error('Could not copy — select the link and copy it manually')
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Setup link — {user.display_name}</DialogTitle>
          <DialogDescription>
            Send this to {user.email}. It works once, and expires{' '}
            {new Date(setup.expires_at).toLocaleString()}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex items-center gap-2">
            <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-1.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {copyFailed && (
            <p className="text-xs text-destructive">
              Copying was blocked. Select the link above and copy it yourself.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            You will not be able to see this link again. Generate a new one if it is lost.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Delete Confirm Dialog ----
function DeleteConfirmDialog({
  user,
  onClose,
  onConfirm,
  isPending,
}: {
  user: UserDetail
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
        </DialogHeader>
        <p className="text-sm py-2">
          Are you sure you want to delete{' '}
          <span className="font-semibold">{user.display_name}</span>? This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={isPending} disabled={isPending}>
            {isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Users Tab ----
function UsersTab() {
  const { data: users = [], isLoading } = useUsers()
  const deleteUser = useDeleteUser()
  const generateSetupLink = useGenerateSetupLink()
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<UserDetail | null>(null)
  const [issuedLink, setIssuedLink] = useState<{ user: UserDetail; setup: SetupLink } | null>(null)
  const [deleteUser_, setDeleteUser_] = useState<UserDetail | null>(null)

  async function handleDelete(user: UserDetail) {
    try {
      await deleteUser.mutateAsync(user.id)
      toast.success('User deleted')
      setDeleteUser_(null)
    } catch {
      toast.error('Failed to delete user')
    }
  }

  async function handleGenerateLink(user: UserDetail) {
    try {
      const setup = await generateSetupLink.mutateAsync(user.id)
      setIssuedLink({ user, setup })
    } catch {
      toast.error('Failed to generate setup link')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{users.length} user{users.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New User
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center justify-between rounded-lg border border-border px-4 py-3 bg-white"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center">
                {user.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{user.display_name}</span>
                  <span
                    className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${ROLE_BADGE[user.role]}`}
                  >
                    {user.role}
                  </span>
                  {user.github_token_configured && (
                    <span className="text-[10px] text-emerald-600 font-medium">GitHub</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                onClick={() => setEditingUser(user)}
                title="Edit user"
                className="p-1.5 rounded text-muted-foreground hover:text-brand-600 hover:bg-brand-50 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleGenerateLink(user)}
                title="Generate setup link"
                disabled={generateSetupLink.isPending}
                className="p-1.5 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setDeleteUser_(user)}
                title="Delete user"
                className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <CreateUserDialog
          onCreated={(user, setup) => {
            setShowCreate(false)
            setIssuedLink({ user, setup })
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editingUser && <EditUserDialog user={editingUser} onClose={() => setEditingUser(null)} />}
      {issuedLink && (
        <SetupLinkDialog
          user={issuedLink.user}
          setup={issuedLink.setup}
          onClose={() => setIssuedLink(null)}
        />
      )}
      {deleteUser_ && (
        <DeleteConfirmDialog
          user={deleteUser_}
          onClose={() => setDeleteUser_(null)}
          onConfirm={() => handleDelete(deleteUser_)}
          isPending={deleteUser.isPending}
        />
      )}
    </div>
  )
}

// ---- Admin Page ----
type AdminTab = 'overview' | 'users' | 'ai'

export function AdminPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')

  if (user?.role !== 'admin') {
    return <Navigate to="/collections" replace />
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div data-testid="page-header" className={PAGE_HEADER_CLASS}>
        <h1 className="text-xl font-semibold">Admin Panel</h1>
      </div>

      {/* Overview takes the full width — it is a multi-column card layout
          that packs more columns as the screen grows — while the other tabs
          stay narrow so their label/value rows and tables do not stretch
          into unreadably long lines. */}
      <div
        className={`${PAGE_BODY_CLASS} ${
          activeTab === 'overview' ? 'max-w-none' : 'max-w-5xl'
        }`}
      >

      {/* Radix Tabs rather than hand-rolled buttons: keyboard navigation and
          correct tab/tabpanel ARIA come for free, and the component was
          already in the repo unused. */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AdminTab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          {/* One AI tab, not two. The old LLM Usage tab reported call counts
              and could only say token usage and cost were unrecorded; both
              are recorded now, so that reporting lives at the bottom of the
              tab that sets the rates it is priced at. Call volume over time
              is still on Overview's LLM Volume card. */}
          <TabsTrigger value="ai">AI Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {/* A fault chip on the dashboard opens the tab that can fix it. */}
          <AdminOverviewTab
            onNavigate={(tab) => setActiveTab(tab as AdminTab)}
          />
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">User Management</CardTitle>
            </CardHeader>
            <CardContent>
              <UsersTab />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai">
          <AiSettingsTab />
        </TabsContent>
      </Tabs>
      </div>
    </motion.div>
  )
}
