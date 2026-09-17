import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Save, Eye, EyeOff, CheckCircle2, Shield, ExternalLink } from 'lucide-react'
import { useSettings, useUpdateSettings, useMyTokenUsage } from '@/hooks/useSettings'
import { useCurrentUser, useUpdateCurrentUser, useChangePassword } from '@/hooks/useUsers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { PAGE_HEADER_CLASS, PAGE_BODY_CLASS } from '@/lib/layout'

// Mirrors MAX_CRITERIA_CHARS in backend/app/services/llm/criteria.py, where the
// same cap is enforced with a 422 — the rubric is re-sent with every batch of
// commits, so its length is a per-request cost multiplier.
const MAX_CRITERIA_CHARS = 8000

// A prose budget on top of the character cap. The character cap is there to
// stop a runaway paste; this one is the number an instructor can actually aim
// at while writing, which is why it is the one shown as a running count.
const MAX_CRITERIA_WORDS = 500

/** Whitespace-separated runs, so trailing spaces and blank lines don't count. */
function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

export function SettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const { data: tokenQuota } = useMyTokenUsage()
  const updateMutation = useUpdateSettings()

  // Profile
  const { data: currentUser, isLoading: profileLoading } = useCurrentUser()
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

  // AI settings the user still owns. The provider, the model and the API key
  // are one instance-wide setting an administrator holds — see the Admin
  // panel's AI Settings tab — so all that is left here is the rubric.
  const [commitEvaluationCriteria, setCommitEvaluationCriteria] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) {
      setCommitEvaluationCriteria(settings.commit_evaluation_criteria || '')
    }
  }, [settings])

  const isLoading = settingsLoading || profileLoading

  const criteriaWordCount = countWords(commitEvaluationCriteria)
  const criteriaOverLimit = criteriaWordCount > MAX_CRITERIA_WORDS

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    // The Save button is disabled in this state, but a form can also be
    // submitted with Enter, so the limit is enforced here rather than only
    // in the button.
    if (countWords(commitEvaluationCriteria) > MAX_CRITERIA_WORDS) return
    await updateMutation.mutateAsync({
      commit_evaluation_criteria: commitEvaluationCriteria,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (isLoading) {
    return (
      <div>
        <div data-testid="page-header" className={PAGE_HEADER_CLASS}>
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>
        <div className={cn(PAGE_BODY_CLASS, 'max-w-3xl')}>
        <div className="space-y-4">
          <div className="h-40 bg-muted rounded-lg animate-pulse" />
          <div className="h-40 bg-muted rounded-lg animate-pulse" />
          <div className="h-48 bg-muted rounded-lg animate-pulse" />
        </div>
        </div>
      </div>
    )
  }

  const roleBadgeClass =
    currentUser?.role === 'admin'
      ? 'bg-rose-100 text-rose-700'
      : currentUser?.role === 'ta'
        ? 'bg-orchid-100 text-orchid-700'
        : 'bg-brand-100 text-brand-700'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div data-testid="page-header" className={PAGE_HEADER_CLASS}>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Settings</h1>
          {currentUser?.role && (
            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${roleBadgeClass}`}>
              {currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}
            </span>
          )}
        </div>
      </div>

      <div className={cn(PAGE_BODY_CLASS, 'max-w-3xl')}>
      {currentUser && (
        <div className="mb-6 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{currentUser.email}</span>
        </div>
      )}

      {/* Profile section */}
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Profile</h2>
      <div className="flex flex-col gap-5 mb-8">
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
                loading={updateCurrentUser.isPending} disabled={updateCurrentUser.isPending || !displayName.trim()}
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
            <CardDescription>Personal access token for GitHub API integration</CardDescription>
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
                  loading={updateCurrentUser.isPending} disabled={updateCurrentUser.isPending}
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
                  loading={changePassword.isPending} disabled={
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
      </div>

      {/* App Settings section */}
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">App Settings</h2>
      <form onSubmit={handleSave} className="flex flex-col gap-5">
        {/* Shared AI model — read-only */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Model</CardTitle>
            <CardDescription>
              Every user on this instance shares one model and one API key,
              configured by an administrator. You no longer need a key of your own.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Model in use</span>
              <code className="font-mono text-sm text-muted-foreground">
                {settings?.llm_model || 'Not configured'}
              </code>
            </div>

            {/* The meter is here rather than in the Admin panel because the
                person who needs it is the one who just got refused. */}
            {tokenQuota && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    AI tokens used this month
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {tokenQuota.unlimited
                      ? `${tokenQuota.used.toLocaleString()} — not metered`
                      : `${tokenQuota.used.toLocaleString()} / ${(tokenQuota.limit ?? 0).toLocaleString()}`}
                  </span>
                </div>
                {!tokenQuota.unlimited && (
                  <>
                    {/* A bar rather than a bare fraction: "420,000 of 500,000"
                        takes a moment to read as "nearly out". */}
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        role="progressbar"
                        aria-valuenow={tokenQuota.used}
                        aria-valuemin={0}
                        aria-valuemax={tokenQuota.limit ?? 0}
                        aria-label="AI tokens used this month"
                        className={cn(
                          'h-full rounded-full transition-all',
                          tokenQuota.exceeded
                            ? 'bg-destructive'
                            : 'bg-brand-500'
                        )}
                        style={{
                          width: `${Math.min(
                            100,
                            tokenQuota.limit
                              ? (tokenQuota.used / tokenQuota.limit) * 100
                              : 100
                          )}%`,
                        }}
                      />
                    </div>
                    <p
                      className={cn(
                        'text-xs',
                        tokenQuota.exceeded
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      )}
                    >
                      {tokenQuota.exceeded
                        ? 'Monthly limit reached — AI summaries and commit scoring are paused until it resets. Ask an administrator to raise your limit.'
                        : `${(tokenQuota.remaining ?? 0).toLocaleString()} remaining. Resets at the start of next month.`}
                    </p>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI commit evaluation criteria */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Summary &amp; Commit Evaluation Instructions</CardTitle>
            <CardDescription>
              Optional. Anything you write here is added to RepoPulse&apos;s built-in grading
              criteria when scoring commit messages and writing repository summaries — it
              refines how good, ok and bad are chosen, rather than replacing the built-in
              rules. Leave it empty to use the built-in criteria alone. Describe evaluation
              guidance, not an output format.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="commit-evaluation-criteria" className="text-sm font-medium">
                  Criteria
                </label>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    criteriaOverLimit ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {criteriaWordCount}/{MAX_CRITERIA_WORDS} words
                </span>
              </div>
              <Textarea
                id="commit-evaluation-criteria"
                value={commitEvaluationCriteria}
                onChange={(e) => setCommitEvaluationCriteria(e.target.value)}
                placeholder="e.g. Commits should describe why the change was made, not just what changed. Treat a message that only names a file as bad."
                rows={12}
                maxLength={MAX_CRITERIA_CHARS}
                aria-invalid={criteriaOverLimit}
                className={cn(
                  'min-h-[240px] resize-y font-mono text-sm',
                  criteriaOverLimit && 'border-destructive focus-visible:ring-destructive'
                )}
              />
              {criteriaOverLimit ? (
                <p className="text-xs text-destructive">
                  {criteriaWordCount - MAX_CRITERIA_WORDS} word
                  {criteriaWordCount - MAX_CRITERIA_WORDS === 1 ? '' : 's'} over the
                  500-word limit. Shorten the criteria to save.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Editing this re-grades commits that were already scored.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Health Thresholds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Health Thresholds</CardTitle>
            <CardDescription>Thresholds for health status signals (read-only in v1)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Health scoring thresholds are not configurable in this version.
              Default thresholds: green ≥ 0.75, yellow ≥ 0.375, red &lt; 0.375
            </p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 justify-end">
          {saved && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1 text-sm text-emerald-600"
            >
              <CheckCircle2 className="h-4 w-4" />
              Settings saved
            </motion.p>
          )}
          {updateMutation.isError && (
            <p className="text-sm text-destructive">Failed to save settings.</p>
          )}
          {criteriaOverLimit && (
            <p className="text-sm text-destructive">Trim the AI criteria before saving.</p>
          )}
          <Button
            type="submit"
            loading={updateMutation.isPending}
            disabled={updateMutation.isPending || criteriaOverLimit}
            title={
              criteriaOverLimit
                ? `Criteria is ${criteriaWordCount - MAX_CRITERIA_WORDS} word${
                    criteriaWordCount - MAX_CRITERIA_WORDS === 1 ? '' : 's'
                  } over the 500-word limit`
                : undefined
            }
            // A 50% fade on a solid primary button still reads as clickable.
            // pointer-events has to come back on for the cursor to show at all.
            className={cn(
              criteriaOverLimit &&
                'disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none'
            )}
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
      </div>
    </motion.div>
  )
}
