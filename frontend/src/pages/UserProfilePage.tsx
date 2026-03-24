import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { User, Shield, CheckCircle2, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { useCurrentUser, useUpdateCurrentUser, useChangePassword } from '@/hooks/useUsers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'

export function UserProfilePage() {
  const { data: currentUser, isLoading } = useCurrentUser()
  const updateCurrentUser = useUpdateCurrentUser()
  const changePassword = useChangePassword()

  // Display name
  const [displayName, setDisplayName] = useState('')
  const [displayNameSaved, setDisplayNameSaved] = useState(false)

  // GitHub token
  const [githubToken, setGithubToken] = useState('')
  const [showToken, setShowToken] = useState(false)

  // Change password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.display_name)
    }
  }, [currentUser])

  async function handleSaveDisplayName(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    try {
      await updateCurrentUser.mutateAsync({ display_name: displayName.trim() })
      setDisplayNameSaved(true)
      toast.success('Display name updated')
      setTimeout(() => setDisplayNameSaved(false), 2500)
    } catch {
      toast.error('Failed to update display name')
    }
  }

  async function handleSaveGithubToken(e: React.FormEvent) {
    e.preventDefault()
    try {
      await updateCurrentUser.mutateAsync({ github_token: githubToken || undefined })
      setGithubToken('')
      toast.success(githubToken ? 'GitHub token updated' : 'GitHub token cleared')
    } catch {
      toast.error('Failed to update GitHub token')
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    try {
      await changePassword.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed successfully')
    } catch {
      toast.error('Failed to change password. Check your current password.')
    }
  }

  if (isLoading) {
    return (
      <div className="container max-w-2xl py-8">
        <div className="h-8 w-32 bg-muted rounded animate-pulse mb-6" />
        <div className="space-y-4">
          <div className="h-40 bg-muted rounded-lg animate-pulse" />
          <div className="h-40 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
    )
  }

  const roleBadgeClass =
    currentUser?.role === 'admin'
      ? 'bg-rose-100 text-rose-700'
      : currentUser?.role === 'ta'
        ? 'bg-violet-100 text-violet-700'
        : 'bg-indigo-100 text-indigo-700'

  return (
    <motion.div
      className="container max-w-2xl py-8"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center gap-2 mb-6">
        <User className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-bold">My Profile</h1>
        {currentUser?.role && (
          <span className={`ml-2 text-xs font-medium rounded-full px-2 py-0.5 ${roleBadgeClass}`}>
            {currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}
          </span>
        )}
      </div>

      {currentUser && (
        <div className="mb-4 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{currentUser.email}</span>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {/* Display Name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Display Name</CardTitle>
            <CardDescription>Your name as it appears to other users</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveDisplayName} className="flex gap-2">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                className="flex-1"
                required
              />
              <Button
                type="submit"
                disabled={updateCurrentUser.isPending || !displayName.trim()}
              >
                {displayNameSaved ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1 text-emerald-500" />
                    Saved
                  </>
                ) : updateCurrentUser.isPending ? (
                  'Saving...'
                ) : (
                  'Save'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* GitHub Token */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">GitHub Token</CardTitle>
            <CardDescription>
              Personal access token for GitHub API integration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-center gap-2">
              {currentUser?.github_token_configured ? (
                <span className="flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Token configured
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not configured</span>
              )}
            </div>
            <form onSubmit={handleSaveGithubToken} className="flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder={
                      currentUser?.github_token_configured
                        ? 'Enter new token to update'
                        : 'ghp_...'
                    }
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showToken ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={updateCurrentUser.isPending}
                >
                  {githubToken ? 'Update Token' : 'Clear Token'}
                </Button>
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-center"
                >
                  <ExternalLink className="h-3 w-3" />
                  Get a token
                </a>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Change Password
            </CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
              {passwordError && (
                <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
                  {passwordError}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="current-password" className="text-sm font-medium">
                  Current Password
                </label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showPasswords ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswords ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-password" className="text-sm font-medium">
                  New Password
                </label>
                <Input
                  id="new-password"
                  type={showPasswords ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-sm font-medium">
                  Confirm New Password
                </label>
                <Input
                  id="confirm-password"
                  type={showPasswords ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    changePassword.isPending ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword
                  }
                >
                  {changePassword.isPending ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="text-center">
          <a
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Go to Settings
          </a>
        </div>
      </div>
    </motion.div>
  )
}
