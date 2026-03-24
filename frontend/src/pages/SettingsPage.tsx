import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Save, Settings, Eye, EyeOff, RefreshCw, CheckCircle2, XCircle, User } from 'lucide-react'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { getOllamaModels } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most capable)' },
]

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings()
  const updateMutation = useUpdateSettings()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

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
      <div className="container max-w-2xl py-8">
        <div className="h-8 w-32 bg-muted rounded animate-pulse mb-6" />
        <div className="h-48 bg-muted rounded-lg animate-pulse" />
      </div>
    )
  }

  return (
    <motion.div
      className="container max-w-2xl py-8"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center gap-2 mb-6">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-5">
        {/* Repository Root */}
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
                      disabled={ollamaStatus === 'loading'}
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

        {/* Quick links */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Manage your personal settings (display name, password, GitHub token)</span>
              </div>
              <a
                href="/profile"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium underline underline-offset-2 transition-colors whitespace-nowrap ml-3"
              >
                My Profile
              </a>
            </div>
            {!isAdmin && (
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  LLM configuration is managed by an administrator.
                </p>
                <a
                  href="/admin"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium underline underline-offset-2 transition-colors whitespace-nowrap ml-3"
                >
                  Admin panel
                </a>
              </div>
            )}
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
          <Button type="submit" disabled={updateMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </motion.div>
  )
}
