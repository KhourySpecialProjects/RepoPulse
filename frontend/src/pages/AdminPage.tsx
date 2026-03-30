import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Pencil, Key, Trash2, Plus, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser, useResetUserPassword } from '@/hooks/useUsers'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import type { UserDetail, CreateUserData, UpdateUserData } from '@/types'

const ROLE_BADGE: Record<UserDetail['role'], string> = {
  instructor: 'bg-indigo-100 text-indigo-700',
  ta: 'bg-violet-100 text-violet-700',
  admin: 'bg-rose-100 text-rose-700',
}

// ---- Create User Dialog ----
function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const createUser = useCreateUser()
  const [form, setForm] = useState<CreateUserData>({
    email: '',
    display_name: '',
    role: 'ta',
    password: '',
    github_token: '',
  })
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createUser.mutateAsync({
        ...form,
        github_token: form.github_token || undefined,
      })
      toast.success('User created')
      onClose()
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
              <SelectTrigger style={{ backgroundColor: 'white' }}>
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
            <label className="text-sm font-medium">Password *</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
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
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createUser.isPending}>
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
              <SelectTrigger style={{ backgroundColor: 'white' }}>
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
            <Button type="submit" disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- Reset Password Dialog ----
function ResetPasswordDialog({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const resetPassword = useResetUserPassword()
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await resetPassword.mutateAsync({ id: user.id, password: newPassword })
      toast.success('Password reset')
      onClose()
    } catch {
      toast.error('Failed to reset password')
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password — {user.display_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">New Password *</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={resetPassword.isPending || newPassword.length < 8}>
              {resetPassword.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </form>
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
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
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
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<UserDetail | null>(null)
  const [resetPasswordUser, setResetPasswordUser] = useState<UserDetail | null>(null)
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
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center justify-center">
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
                className="p-1.5 rounded text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setResetPasswordUser(user)}
                title="Reset password"
                className="p-1.5 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors"
              >
                <Key className="h-3.5 w-3.5" />
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

      {showCreate && <CreateUserDialog onClose={() => setShowCreate(false)} />}
      {editingUser && <EditUserDialog user={editingUser} onClose={() => setEditingUser(null)} />}
      {resetPasswordUser && (
        <ResetPasswordDialog
          user={resetPasswordUser}
          onClose={() => setResetPasswordUser(null)}
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
export function AdminPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'users' | 'llm' | 'system'>('users')
  const { data: settings } = useSettings()

  if (user?.role !== 'admin') {
    return <Navigate to="/collections" replace />
  }

  return (
    <motion.div
      className="px-6 py-6 max-w-3xl"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <h1 className="text-xl font-semibold mb-6">Admin Panel</h1>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-border mb-6">
        {(['users', 'llm', 'system'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'users' ? 'Users' : tab === 'llm' ? 'LLM Settings' : 'System'}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User Management</CardTitle>
          </CardHeader>
          <CardContent>
            <UsersTab />
          </CardContent>
        </Card>
      )}

      {activeTab === 'llm' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LLM Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              LLM provider and model are configured per-user in Settings.
            </p>
          </CardContent>
        </Card>
      )}

      {activeTab === 'system' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Repository Root</CardTitle>
            <CardDescription>The directory where repository clones are stored</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              value={settings?.repo_root_directory ?? ''}
              readOnly
              className="bg-muted cursor-not-allowed font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Configured via the <code className="font-mono">REPO_ROOT_DIR</code> environment variable
            </p>
          </CardContent>
        </Card>
      )}
    </motion.div>
  )
}
