import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react'

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import {
  useAdminTokenUsage,
  useAdminTokenUsageSummary,
  useLlmConfig,
  useSetUserTokenLimit,
  useUpdateLlmConfig,
} from '@/hooks/useAdminStats'
import { getOllamaModels } from '@/services/api'
import { cn } from '@/lib/utils'
import type { UpdateLlmConfigData, UserTokenUsage } from '@/types'

/**
 * The instance's one AI model, its one API key, and who may spend against it.
 *
 * This tab exists because RepoPulse stopped asking every user for their own
 * Anthropic key. One shared key means one payer, so the same screen that
 * chooses the model also rations it — a limit set anywhere else would be a
 * second place to look when someone reports that AI features stopped working.
 */

/**
 * Models offered in the picker.
 *
 * A free-text field as well, because this list goes stale: a model id that
 * has been retired returns 404 on every LLM call at once, and an admin has to
 * be able to move off it without waiting for a release. See
 * backend/tests/test_llm_model_default.py for the same problem server-side.
 */
const ANTHROPIC_MODELS = [
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 (recommended)' },
  { value: 'claude-opus-5', label: 'Claude Opus 5 (most capable)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
]

/** Mirrors the fallback in backend/app/services/llm/__init__.py. */
const OLLAMA_DEFAULT_URL = 'http://localhost:11434'

function formatTokens(value: number): string {
  return value.toLocaleString()
}

/**
 * A cost for display, or why there isn't one.
 *
 * Three outcomes, all distinct and all load-bearing:
 *   null   -> no rates set, so the cost is unknown. Never "$0.00", which
 *             would report a month of real spend as free.
 *   >0 <1c -> a real charge that 2dp would round away to $0.00.
 *   else   -> dollars and cents.
 */
function formatCost(amount: string | null): string {
  if (amount === null) return 'Enter rates below'
  const value = Number(amount)
  if (!Number.isFinite(value)) return 'Enter rates below'
  if (value === 0) return '$0.00'
  if (value < 0.01) return 'less than $0.01'
  return `$${value.toFixed(2)}`
}

/**
 * A rate field's value, as the server should receive it.
 *
 * Blank is `null` — "stop reporting a cost" — and never 0, which would claim
 * the tokens were free. Returns `undefined` for anything unparseable so the
 * caller can block the save rather than sending NaN.
 */
/**
 * `Numeric(12,4)` arrives as "3.0000"; show it as "3".
 *
 * Accepts undefined as well as null, and always returns a string. A response
 * that omits the field entirely would otherwise put `undefined` into the
 * input's state, and the next `parseRate` call would throw on `.trim()` and
 * take the whole tab down with it.
 */
function formatRateForInput(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const parsed = Number(value)
  return Number.isFinite(parsed) ? String(parsed) : value
}

function parseRate(draft: string): string | null | undefined {
  const trimmed = draft.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return undefined
  return trimmed
}

/** A row's limit cell: the effective number, and where it came from. */
function LimitLabel({ row }: { row: UserTokenUsage }) {
  if (row.unlimited) {
    return (
      <span className="text-xs text-muted-foreground">
        Unlimited (administrator)
      </span>
    )
  }
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {formatTokens(row.limit ?? 0)}
      {row.override === null && ' (default)'}
    </span>
  )
}

/**
 * One editable per-user limit.
 *
 * Its own component so each row keeps its own draft value: a single piece of
 * state in the parent would make every row's input change together, and a
 * keystroke in one row would discard an edit in progress in another.
 */
function UserLimitRow({ row }: { row: UserTokenUsage }) {
  const setLimit = useSetUserTokenLimit()
  const [draft, setDraft] = useState(
    row.override === null ? '' : String(row.override),
  )

  // Resync when the server's answer arrives, so a saved row stops looking
  // edited. Guarded on the mutation being idle, or a refetch mid-typing would
  // yank the field back.
  useEffect(() => {
    if (!setLimit.isPending) {
      setDraft(row.override === null ? '' : String(row.override))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.override])

  const trimmed = draft.trim()
  // Empty means "follow the instance default" — a null, not a 0. Sending 0
  // would revoke the user's AI access, which is the opposite request.
  const parsed = trimmed === '' ? null : Number(trimmed)
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 0)
  const unchanged = parsed === row.override

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-3">
        <div className="font-medium">{row.display_name}</div>
        <div className="text-xs text-muted-foreground">{row.email}</div>
      </td>
      <td className="py-2 pr-3 text-xs capitalize text-muted-foreground">
        {row.role}
      </td>
      <td className="py-2 pr-3 text-right text-xs tabular-nums">
        {formatTokens(row.used)}
      </td>
      <td className="py-2 pr-3 text-right">
        <LimitLabel row={row} />
      </td>
      <td className="py-2 pr-3">
        {row.exceeded && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            Limit reached
          </span>
        )}
      </td>
      <td className="py-2">
        {/* An admin is never metered, so an input here would imply a limit
            that the server would ignore. */}
        {row.unlimited ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Input
              aria-label={`Token limit for ${row.display_name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="default"
              inputMode="numeric"
              className={cn(
                'h-8 w-28 text-right font-mono text-xs',
                invalid && 'border-destructive focus-visible:ring-destructive',
              )}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={setLimit.isPending}
              disabled={setLimit.isPending || invalid || unchanged}
              onClick={() =>
                setLimit.mutate({
                  userId: row.user_id,
                  monthlyTokenLimit: parsed,
                })
              }
            >
              Save
            </Button>
          </div>
        )}
      </td>
    </tr>
  )
}

export function AiSettingsTab() {
  const { data: config, isLoading, isError, refetch } = useLlmConfig()
  const updateConfig = useUpdateLlmConfig()
  const { data: usage } = useAdminTokenUsage({ limit: 200, offset: 0 })
  const { data: summary } = useAdminTokenUsageSummary()

  const [provider, setProvider] = useState<'anthropic' | 'ollama'>('anthropic')
  const [model, setModel] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [defaultLimit, setDefaultLimit] = useState('')
  const [inputRate, setInputRate] = useState('')
  const [outputRate, setOutputRate] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<
    'idle' | 'loading' | 'ok' | 'error'
  >('idle')

  async function testOllama() {
    setOllamaStatus('loading')
    setOllamaModels([])
    try {
      // Matches the placeholder and the adapter's own fallback, so an
      // untouched field tests the URL the instance would actually use
      // rather than probing an empty string.
      const models = await getOllamaModels(
        ollamaUrl.trim() || OLLAMA_DEFAULT_URL,
      )
      setOllamaModels(models)
      // An empty list is a failure to report, not a success: the endpoint
      // swallows connection errors and returns [], so "reachable with no
      // models" and "unreachable" arrive identically.
      setOllamaStatus(models.length > 0 ? 'ok' : 'error')
    } catch {
      setOllamaStatus('error')
    }
  }

  useEffect(() => {
    if (!config) return
    setProvider(config.llm_provider)
    setModel(config.llm_model)
    setOllamaUrl(config.ollama_base_url ?? '')
    setDefaultLimit(String(config.default_monthly_token_limit))
    // Trimmed of trailing zeros so "3.0000" from Numeric(12,4) shows as the
    // "3" an admin typed, and re-saving does not look like an edit.
    setInputRate(formatRateForInput(config.input_price_per_mtok))
    setOutputRate(formatRateForInput(config.output_price_per_mtok))
    // Deliberately not seeded from the server: it never sends the key back.
    setApiKey('')
  }, [config])

  if (isLoading) {
    return (
      <div
        data-testid="ai-settings-loading"
        className="h-64 animate-pulse rounded-lg bg-muted"
      />
    )
  }

  if (isError || !config) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Could not load AI settings.
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const parsedDefault = Number(defaultLimit.trim())
  const defaultInvalid =
    defaultLimit.trim() === '' ||
    !Number.isInteger(parsedDefault) ||
    parsedDefault < 0

  const parsedInputRate = parseRate(inputRate)
  const parsedOutputRate = parseRate(outputRate)
  const inputRateInvalid = parsedInputRate === undefined
  const outputRateInvalid = parsedOutputRate === undefined
  const ratesInvalid = inputRateInvalid || outputRateInvalid

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    // Re-checked here, not only in the disabled button: a form also submits
    // on Enter.
    if (defaultInvalid || ratesInvalid) return

    const payload: UpdateLlmConfigData = {
      llm_provider: provider,
      llm_model: model.trim(),
      default_monthly_token_limit: parsedDefault,
      ollama_base_url: provider === 'ollama' ? ollamaUrl.trim() || null : null,
      // Sent as strings so the decimal reaches Postgres Numeric exactly —
      // a JSON number would round-trip through a float on the way.
      input_price_per_mtok: parsedInputRate,
      output_price_per_mtok: parsedOutputRate,
    }
    // Only sent when something was typed. A blank field means "leave the key
    // alone"; including it as "" or null would silently revoke a working key
    // every time an admin saved an unrelated change.
    if (apiKey.trim()) {
      payload.anthropic_api_key = apiKey.trim()
    }

    await updateConfig.mutateAsync(payload)
    setApiKey('')
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSave} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shared AI Model</CardTitle>
            <CardDescription>
              One model and one API key for the whole instance. Users cannot see
              or change these — they spend against the allowance below.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Provider</span>
              <div className="flex w-fit overflow-hidden rounded-md border border-border">
                {(['anthropic', 'ollama'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setProvider(option)}
                    aria-pressed={provider === option}
                    className={cn(
                      'px-4 py-1.5 text-sm font-medium transition-colors',
                      provider === option
                        ? 'bg-brand-600 text-white'
                        : 'bg-white text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {option === 'anthropic' ? 'Anthropic' : 'Ollama (local)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Model in use</span>
              <code className="font-mono text-sm text-muted-foreground">
                {config.llm_model}
              </code>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-model" className="text-sm font-medium">
                Model
              </label>
              {provider === 'anthropic' ? (
                <>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger id="ai-model">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {ANTHROPIC_MODELS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label="Model id"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="or type a model id"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    The list goes stale as models are retired. A retired id
                    makes every AI feature fail at once — type the replacement
                    here rather than waiting for an update.
                  </p>
                </>
              ) : (
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. llama3.2, mistral, phi3"
                  className="font-mono text-sm"
                />
              )}
            </div>

            {provider === 'ollama' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ollama-url" className="text-sm font-medium">
                  Ollama base URL
                </label>
                <div className="flex gap-2">
                  <Input
                    id="ollama-url"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder={OLLAMA_DEFAULT_URL}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={ollamaStatus === 'loading'}
                    disabled={ollamaStatus === 'loading'}
                    onClick={testOllama}
                    className="whitespace-nowrap"
                  >
                    <RefreshCw
                      className={cn(
                        'mr-1.5 h-3.5 w-3.5',
                        ollamaStatus === 'loading' && 'animate-spin',
                      )}
                    />
                    Test
                  </Button>
                </div>
                {/* Worth keeping from the old per-user page: a wrong base URL
                    otherwise surfaces as every AI feature failing later, with
                    nothing on screen to connect it to this field. */}
                {ollamaStatus === 'ok' && (
                  <p className="flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Connected — {ollamaModels.length} model
                    {ollamaModels.length === 1 ? '' : 's'} available
                  </p>
                )}
                {ollamaStatus === 'error' && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <XCircle className="h-3.5 w-3.5" />
                    Could not reach Ollama at that URL.
                  </p>
                )}
                {ollamaModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {ollamaModels.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setModel(name)}
                        className={cn(
                          'rounded border px-2 py-0.5 font-mono text-xs transition-colors',
                          model === name
                            ? 'border-brand-200 bg-brand-50 text-brand-700'
                            : 'border-border text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-api-key" className="text-sm font-medium">
                API key
              </label>
              <div className="relative">
                <Input
                  id="ai-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    config.anthropic_api_key_configured
                      ? '●●●●●●●● (leave blank to keep the current key)'
                      : 'sk-ant-...'
                  }
                  className="pr-9 font-mono text-sm"
                />
                {/* The aria-label deliberately avoids the words "API key":
                    repeating the field's own label there would make
                    getByLabelText(/api key/i) match two elements. */}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {/* Three distinct states, because "Configured" alone leaves an
                  admin unable to tell a working default install from one
                  somebody has since pasted a key into. */}
              {config.anthropic_api_key_from_env ? (
                <p className="text-xs text-muted-foreground">
                  Currently using the key from the ANTHROPIC_API_KEY environment
                  variable. Entering one here overrides it.
                </p>
              ) : config.anthropic_api_key_configured ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-emerald-600">
                    A key is stored for this instance.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={updateConfig.isPending}
                    onClick={() =>
                      updateConfig.mutate({ anthropic_api_key: null })
                    }
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove stored key
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-amber-600">
                  No key configured — AI features will fail until one is set
                  here or in ANTHROPIC_API_KEY.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default Token Allowance</CardTitle>
            <CardDescription>
              Tokens each non-administrator may spend per calendar month, unless
              given their own limit below. Resets on the 1st. Administrators are
              never metered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="default-token-limit" className="text-sm font-medium">
                Default monthly token limit
              </label>
              <Input
                id="default-token-limit"
                value={defaultLimit}
                onChange={(e) => setDefaultLimit(e.target.value)}
                inputMode="numeric"
                className={cn(
                  'w-48 font-mono text-sm',
                  defaultInvalid &&
                    'border-destructive focus-visible:ring-destructive',
                )}
              />
              <p className="text-xs text-muted-foreground">
                Set to 0 to switch AI features off for everyone without an
                explicit limit of their own.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Moved here from the old LLM Usage tab, which could only report
            that token counts were unrecorded. They are recorded now, so the
            reporting sits beside the rates it is priced at — an admin who
            distrusts the number can fix it in the same card. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Token usage and cost</CardTitle>
            <CardDescription>
              Tokens are measured — every figure below comes from what the API
              reported per call. The rates are yours to enter, which is the
              only reason cost is an estimate.
            </CardDescription>
          </CardHeader>
          <CardContent
            data-testid="token-usage-cost"
            className="flex flex-col gap-5"
          >
            {!summary ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    ['Input', summary.input_tokens],
                    ['Output', summary.output_tokens],
                    ['Total', summary.total_tokens],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {label as string}
                      </span>
                      <span className="tabular-nums">
                        {formatTokens(value as number)}
                      </span>
                    </div>
                  ))}
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">
                      Estimated cost
                    </span>
                    <span
                      className={cn(
                        'tabular-nums',
                        summary.estimated_cost_usd === null &&
                          'text-muted-foreground',
                      )}
                    >
                      {formatCost(summary.estimated_cost_usd)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {summary.period} · {formatTokens(summary.calls)} billed call
                  {summary.calls === 1 ? '' : 's'}. Failed calls are not
                  counted — they record no usage.
                </p>

                {summary.mixed_models && (
                  <p
                    role="status"
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    This period spans more than one model (
                    {summary.models.join(', ')}). One rate pair cannot price
                    them all, so the cost above is approximate.
                  </p>
                )}
              </>
            )}

            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="input-rate" className="text-sm font-medium">
                  Input tokens, $ per million
                </label>
                <Input
                  id="input-rate"
                  value={inputRate}
                  onChange={(e) => setInputRate(e.target.value)}
                  inputMode="decimal"
                  placeholder="unset"
                  className={cn(
                    'w-40 font-mono text-sm',
                    inputRateInvalid &&
                      'border-destructive focus-visible:ring-destructive',
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="output-rate" className="text-sm font-medium">
                  Output tokens, $ per million
                </label>
                <Input
                  id="output-rate"
                  value={outputRate}
                  onChange={(e) => setOutputRate(e.target.value)}
                  inputMode="decimal"
                  placeholder="unset"
                  className={cn(
                    'w-40 font-mono text-sm',
                    outputRateInvalid &&
                      'border-destructive focus-visible:ring-destructive',
                  )}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave both blank to report no cost at all. Check them against
              current Anthropic pricing — nothing here updates them for you.
            </p>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {defaultInvalid && (
            <p className="text-sm text-destructive">
              Enter a whole number of tokens, 0 or more.
            </p>
          )}
          {ratesInvalid && (
            <p className="text-sm text-destructive">
              Enter a rate in dollars per million tokens, or leave it blank.
            </p>
          )}
          <Button
            type="submit"
            loading={updateConfig.isPending}
            disabled={updateConfig.isPending || defaultInvalid || ratesInvalid}
          >
            <Save className="mr-2 h-4 w-4" />
            {updateConfig.isPending ? 'Saving...' : 'Save AI settings'}
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Per-user usage and limits
            {usage?.period && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {usage.period}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Heaviest spenders first. Leave a limit blank to follow the instance
            default, or set 0 to revoke that user&apos;s AI access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!usage ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : usage.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-3 text-left font-medium">User</th>
                    <th className="pb-2 pr-3 text-left font-medium">Role</th>
                    <th className="pb-2 pr-3 text-right font-medium">Used</th>
                    <th className="pb-2 pr-3 text-right font-medium">Limit</th>
                    <th className="pb-2 pr-3" />
                    <th className="pb-2 text-right font-medium">Override</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.items.map((row) => (
                    <UserLimitRow key={row.user_id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
