import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Save, Eye, EyeOff, RefreshCw, CheckCircle2, XCircle, Shield, ExternalLink } from 'lucide-react'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { useCurrentUser, useUpdateCurrentUser, useChangePassword } from '@/hooks/useUsers'
import { getOllamaModels } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most capable)' },
]

export function SettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useSettings()
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

  // LLM settings
  const [provider, setProvider] = useState<'anthropic' | 'ollama'>('anthropic')
  const [llmModel, setLlmModel] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [ollamaModel, setOllamaModel] = useState('')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) {
      const p = (settings.llm_provider === 'ollama' ? 'ollama' : 'anthropic') as 'anthropic' | 'ollama'
      setProvider(p)
      setLlmModel(settings.llm_model)
      setOllamaUrl(settings.ollama_base_url || 'http://localhost:11434')
      if (p === 'ollama') {
        setOllamaModel(settings.llm_model)
      }
    }
  }, [settings])

  const isLoading = settingsLoading || profileLoading

  async function testOllamaConnection() {
    setOllamaStatus('loading')
    setOllamaModels([])
    try {
      const models = await getOllamaModels(ollamaUrl)
      setOllamaModels(models)
      setOllamaStatus(models.length > 0 ? 'ok' : 'error')
    } catch {
      setOllamaStatus('error')
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const model = provider === 'ollama' ? ollamaModel : llmModel
    const updateData: Record<string, unknown> = {
      llm_provider: provider,
      llm_model: model,
      ollama_base_url: provider === 'ollama' ? ollamaUrl : null,
    }
    if (anthropicKey.trim()) {
      updateData.anthropic_api_key = anthropicKey.trim()
    }
    await updateMutation.mutateAsync(updateData)
    setAnthropicKey('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (isLoading) {
    return (
      <div className="px-6 py-6 max-w-3xl">
        <div className="h-8 w-32 bg-muted rounded animate-pulse mb-6" />
        <div className="space-y-4">
          <div className="h-40 bg-muted rounded-lg animate-pulse" />
          <div className="h-40 bg-muted rounded-lg animate-pulse" />
          <div className="h-48 bg-muted rounded-lg animate-pulse" />
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
      className="px-6 py-6 max-w-3xl"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">Settings</h1>
        {currentUser?.role && (
          <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${roleBadgeClass}`}>
            {currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}
          </span>
        )}
      </div>
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
        {/* LLM Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LLM Configuration</CardTitle>
            <CardDescription>Choose the AI provider and model used for generating summaries</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">

            {/* Provider toggle */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Provider</label>
              <div className="flex rounded-md border border-border overflow-hidden w-fit">
                {(['anthropic', 'ollama'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProvider(p)}
                    className={cn(
                      'px-4 py-1.5 text-sm font-medium transition-colors',
                      provider === p
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {p === 'anthropic' ? 'Anthropic' : 'Ollama (local)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Anthropic settings */}
            {provider === 'anthropic' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">API Key</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={anthropicKey}
                        onChange={e => setAnthropicKey(e.target.value)}
                        placeholder={settings?.anthropic_api_key_configured ? '●●●●●●●● (leave blank to keep existing)' : 'sk-ant-...'}
                        className="pr-9 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {settings?.anthropic_api_key_configured && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 whitespace-nowrap">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Configured
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your key is stored locally and never sent anywhere except Anthropic's API.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Model</label>
                  <Select value={llmModel} onValueChange={setLlmModel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {ANTHROPIC_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Ollama settings */}
            {provider === 'ollama' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Ollama Base URL</label>
                  <div className="flex gap-2">
                    <Input
                      value={ollamaUrl}
                      onChange={e => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="font-mono text-sm flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={testOllamaConnection}
                      loading={ollamaStatus === 'loading'} disabled={ollamaStatus === 'loading'}
                      className="whitespace-nowrap"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', ollamaStatus === 'loading' && 'animate-spin')} />
                      Test
                    </Button>
                  </div>
                  {ollamaStatus === 'ok' && (
                    <p className="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Connected — {ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''} available
                    </p>
                  )}
                  {ollamaStatus === 'error' && (
                    <p className="flex items-center gap-1 text-xs text-red-600">
                      <XCircle className="h-3.5 w-3.5" />
                      Could not connect. Is Ollama running?
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Model</label>
                  {ollamaModels.length > 0 ? (
                    <Select value={ollamaModel} onValueChange={setOllamaModel}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {ollamaModels.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={ollamaModel}
                      onChange={e => setOllamaModel(e.target.value)}
                      placeholder="e.g. llama3.2, mistral, phi3"
                      className="font-mono text-sm"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Click Test above to auto-populate from your running Ollama instance, or type a model name manually.
                  </p>
                </div>

                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-700">
                  <strong>Tip:</strong> Models with 7B+ parameters (mistral, llama3.1, phi3) work best for summarization. Run{' '}
                  <code className="font-mono">ollama pull llama3.2</code> to get started.
                </div>
              </div>
            )}
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
          <Button type="submit" loading={updateMutation.isPending} disabled={updateMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </motion.div>
  )
}
