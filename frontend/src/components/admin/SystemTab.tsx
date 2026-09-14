import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { useAdminSystem } from '@/hooks/useAdminStats'

/**
 * System configuration and environment.
 *
 * Replaces a panel that rendered AppSettings.repo_root_directory — a
 * per-user, display-only column that is never consulted when building clone
 * paths. An admin editing it changed nothing, and the tab could show a path
 * clones were not in. This reads the real REPO_ROOT_DIR from the server.
 *
 * Secrets are booleans from the API; no key material reaches the client.
 */

function Row({
  label,
  value,
  tone = 'default',
  testId,
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'warn' | 'bad'
  testId?: string
}) {
  const toneClass =
    tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : ''
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span data-testid={testId} className={`text-sm font-medium ${toneClass}`}>
        {value}
      </span>
    </div>
  )
}

function YesNo({ value }: { value: boolean }) {
  return <>{value ? 'Yes' : 'No'}</>
}

export function SystemTab() {
  const { data, isLoading, isError, refetch } = useAdminSystem()

  if (isLoading) {
    return (
      <div data-testid="system-loading" className="h-64 animate-pulse rounded-lg bg-muted" />
    )
  }

  if (isError || !data) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Could not load system status.
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* AUTH_MODE=dev serves POST /auth/dev-login, which mints a full token
          from a bare user id with no password. Loud, because an instance
          left in dev mode is an open door. */}
      {data.dev_login_enabled && (
        <div
          role="alert"
          data-testid="dev-mode-banner"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <strong>Dev authentication is enabled.</strong>{' '}
          <code className="font-mono">POST /auth/dev-login</code> issues a full
          session from a user id with no password. Never run an instance
          reachable by students with <code className="font-mono">AUTH_MODE=dev</code>.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage location</CardTitle>
          <CardDescription>
            The real clone root, read from the server's{' '}
            <code className="font-mono">REPO_ROOT_DIR</code>. This is not the
            per-user value in Settings, which is display-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Row
            label="Repo root"
            testId="repo-root"
            value={<code className="font-mono text-xs">{data.repo_root_dir}</code>}
          />
          <Row
            label="Exists"
            testId="repo-root-exists"
            tone={data.repo_root_exists ? 'default' : 'bad'}
            value={<YesNo value={data.repo_root_exists} />}
          />
          <Row
            label="Writable"
            testId="repo-root-writable"
            tone={data.repo_root_writable ? 'default' : 'bad'}
            value={<YesNo value={data.repo_root_writable} />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Database &amp; schema</CardTitle>
        </CardHeader>
        <CardContent>
          <Row
            label="Database"
            testId="database-state"
            tone={data.database === 'ok' ? 'default' : 'bad'}
            value={data.database}
          />
          <Row
            label="Applied revision"
            testId="schema-revision"
            value={data.schema_revision ?? 'unknown'}
          />
          <Row label="Latest migration" value={data.schema_head ?? 'unknown'} />
          <Row
            label="Up to date"
            testId="schema-up-to-date"
            tone={data.schema_up_to_date === false ? 'warn' : 'default'}
            value={
              data.schema_up_to_date === null
                ? 'unknown'
                : data.schema_up_to_date
                  ? 'Yes'
                  : 'No — run alembic upgrade head'
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <Row
            label="Auth mode"
            testId="auth-mode"
            tone={data.dev_login_enabled ? 'bad' : 'default'}
            value={data.auth_mode}
          />
          <Row
            label="Administrators"
            testId="admin-count"
            tone={data.admin_count <= 1 ? 'warn' : 'default'}
            value={data.admin_count}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integrations</CardTitle>
          <CardDescription>
            Whether a credential is configured. Values are never sent to the
            browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Row
            label="Anthropic API key"
            testId="anthropic-configured"
            tone={data.anthropic_api_key_configured ? 'default' : 'warn'}
            value={
              data.anthropic_api_key_configured ? 'Configured' : 'Not configured'
            }
          />
          <Row
            label="GitHub token"
            testId="github-configured"
            tone={data.github_token_configured ? 'default' : 'warn'}
            value={data.github_token_configured ? 'Configured' : 'Not configured'}
          />
          <Row label="Default LLM provider" value={data.default_llm_provider} />
          <Row label="Default LLM model" value={data.default_llm_model} />
          <Row label="git" value={data.git_version ?? 'unavailable'} />
        </CardContent>
      </Card>
    </div>
  )
}
