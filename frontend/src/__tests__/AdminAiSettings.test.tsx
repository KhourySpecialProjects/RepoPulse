/**
 * The AI model, the API key and the token limits are the administrator's.
 *
 * The server is the real gate (backend/tests/api/test_admin_auth.py); these
 * tests cover the panel an admin actually uses, and the one client-side
 * guarantee worth pinning: the key they type is never rendered back to them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { AiSettingsTab } from '@/components/admin/AiSettingsTab'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AiSettingsTab />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => vi.clearAllMocks())

// ── The shared model ─────────────────────────────────────────────────────────

describe('AiSettingsTab model configuration', () => {
  it('shows the model the whole instance is using', async () => {
    renderTab()

    expect(await screen.findByText('claude-sonnet-5')).toBeInTheDocument()
  })

  it('says when the key is coming from the environment', async () => {
    renderTab()

    // "Configured" alone would leave an admin unsure whether anyone had set
    // anything, on an instance that works purely from ANTHROPIC_API_KEY.
    expect(
      await screen.findByText(/from the ANTHROPIC_API_KEY environment variable/i)
    ).toBeInTheDocument()
  })

  it('saves a new default token limit', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/llm-config', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'llm-config-1',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: true,
          anthropic_api_key_from_env: true,
          ollama_base_url: null,
          default_monthly_token_limit: 250000,
          updated_at: null,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    const limit = await screen.findByLabelText(/default monthly token limit/i)
    await user.clear(limit)
    await user.type(limit, '250000')
    await user.click(screen.getByRole('button', { name: /save ai settings/i }))

    await waitFor(() =>
      expect(patched?.default_monthly_token_limit).toBe(250000)
    )
  })

  it('never renders a submitted API key back into the form', async () => {
    const user = userEvent.setup()
    renderTab()

    const keyField = await screen.findByLabelText(/api key/i)
    await user.type(keyField, 'sk-ant-super-secret')
    await user.click(screen.getByRole('button', { name: /save ai settings/i }))

    // Cleared on success: the value only ever travels to the server, and a
    // key left sitting in a form field is one screenshot from a leak.
    await waitFor(() => expect(keyField).toHaveValue(''))
    expect(screen.queryByText(/sk-ant-super-secret/)).not.toBeInTheDocument()
  })

  it('omits the API key from the request when the field is left blank', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/llm-config', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'llm-config-1',
          llm_provider: 'anthropic',
          llm_model: 'claude-opus-5',
          anthropic_api_key_configured: true,
          anthropic_api_key_from_env: true,
          ollama_base_url: null,
          default_monthly_token_limit: 500000,
          updated_at: null,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    await screen.findByLabelText(/api key/i)
    await user.click(screen.getByRole('button', { name: /save ai settings/i }))

    // An empty field means "leave it alone", not "clear it" — sending "" or
    // null here would silently revoke a working key on an unrelated save.
    await waitFor(() => expect(patched).not.toBeNull())
    expect('anthropic_api_key' in (patched ?? {})).toBe(false)
  })

  it('offers an explicit control for clearing a stored key', async () => {
    server.use(
      http.get('/api/v1/admin/llm-config', () =>
        HttpResponse.json({
          id: 'llm-config-1',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: true,
          // Stored in the panel, not inherited from the environment.
          anthropic_api_key_from_env: false,
          ollama_base_url: null,
          default_monthly_token_limit: 500000,
          updated_at: null,
        })
      )
    )

    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/llm-config', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'llm-config-1',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: false,
          anthropic_api_key_from_env: false,
          ollama_base_url: null,
          default_monthly_token_limit: 500000,
          updated_at: null,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    await user.click(await screen.findByRole('button', { name: /remove stored key/i }))

    // A wrong key must be removable, or it is permanent.
    await waitFor(() => expect(patched?.anthropic_api_key).toBeNull())
  })
})

// ── Per-user limits ──────────────────────────────────────────────────────────

describe('AiSettingsTab per-user token limits', () => {
  it('lists each user with their spend and effective limit', async () => {
    renderTab()

    const row = (await screen.findByText('TA Sarah')).closest('tr')!
    // Used and limit are both 250,000 for this fixture, so there are two.
    expect(within(row).getAllByText(/250,000/).length).toBeGreaterThan(0)
  })

  it('distinguishes a user on the default from one with an override', async () => {
    renderTab()

    const onDefault = (await screen.findByText('Instructor Mark')).closest('tr')!
    expect(within(onDefault).getByText(/default/i)).toBeInTheDocument()

    const overridden = (await screen.findByText('TA Sarah')).closest('tr')!
    expect(within(overridden).queryByText(/default/i)).not.toBeInTheDocument()
  })

  it('marks an admin as not metered rather than showing a limit', async () => {
    renderTab()

    const row = (await screen.findByText('Admin Alex')).closest('tr')!
    expect(within(row).getByText(/unlimited/i)).toBeInTheDocument()
  })

  it('flags a user who has spent their allowance', async () => {
    renderTab()

    const row = (await screen.findByText('TA Sarah')).closest('tr')!
    expect(within(row).getByText(/limit reached/i)).toBeInTheDocument()
  })

  it('saves a per-user override', async () => {
    let patchedPath = ''
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/users/:userId/token-limit', async ({ params, request }) => {
        patchedPath = String(params.userId)
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          user_id: String(params.userId),
          display_name: 'TA Sarah',
          email: 'sarah@example.com',
          role: 'ta',
          used: 250000,
          limit: 900000,
          remaining: 650000,
          unlimited: false,
          exceeded: false,
          override: 900000,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    const row = (await screen.findByText('TA Sarah')).closest('tr')!
    const input = within(row).getByLabelText(/token limit for TA Sarah/i)
    await user.clear(input)
    await user.type(input, '900000')
    await user.click(within(row).getByRole('button', { name: /save/i }))

    await waitFor(() => expect(patched?.monthly_token_limit).toBe(900000))
    expect(patchedPath).toBe('user-ta-1')
  })

  it('sends null when the override field is cleared', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/users/:userId/token-limit', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          user_id: 'user-ta-1',
          display_name: 'TA Sarah',
          email: 'sarah@example.com',
          role: 'ta',
          used: 250000,
          limit: 500000,
          remaining: 250000,
          unlimited: false,
          exceeded: false,
          override: null,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    const row = (await screen.findByText('TA Sarah')).closest('tr')!
    await user.clear(within(row).getByLabelText(/token limit for TA Sarah/i))
    await user.click(within(row).getByRole('button', { name: /save/i }))

    // Empty means "follow the instance default", which is a null — not a 0,
    // which would revoke their access instead.
    await waitFor(() => expect(patched).toEqual({ monthly_token_limit: null }))
  })

  it('keeps a typed zero as zero rather than reading it as cleared', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/users/:userId/token-limit', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          user_id: 'user-ta-1',
          display_name: 'TA Sarah',
          email: 'sarah@example.com',
          role: 'ta',
          used: 250000,
          limit: 0,
          remaining: 0,
          unlimited: true,
          exceeded: true,
          override: 0,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    const row = (await screen.findByText('TA Sarah')).closest('tr')!
    const input = within(row).getByLabelText(/token limit for TA Sarah/i)
    await user.clear(input)
    await user.type(input, '0')
    await user.click(within(row).getByRole('button', { name: /save/i }))

    // 0 revokes AI access — a falsy-check would send null and grant the
    // default instead, which is the opposite of what was asked for.
    await waitFor(() => expect(patched?.monthly_token_limit).toBe(0))
  })

  it('does not offer a limit field for an unmetered admin', async () => {
    renderTab()

    const row = (await screen.findByText('Admin Alex')).closest('tr')!
    expect(
      within(row).queryByLabelText(/token limit for Admin Alex/i)
    ).not.toBeInTheDocument()
  })
})

// ── Token usage and cost ─────────────────────────────────────────────────────
//
// This card replaces the old LLM Usage tab's version, which could only report
// that token counts were not recorded. They are now, so the only estimated
// input is the rates — which is what the wording has to convey.

describe('AiSettingsTab token usage and cost', () => {
  function summary(overrides: Record<string, unknown>) {
    return {
      period: '2026-09',
      input_tokens: 8_420_000,
      output_tokens: 1_190_000,
      total_tokens: 9_610_000,
      calls: 412,
      models: ['claude-sonnet-5'],
      input_price_per_mtok: '3.0000',
      output_price_per_mtok: '15.0000',
      estimated_cost_usd: '43.1100',
      mixed_models: false,
      ...overrides,
    }
  }

  it('reports the measured token totals for the month', async () => {
    renderTab()

    const card = (await screen.findByTestId('token-usage-cost'))
    expect(within(card).getByText(/8,420,000/)).toBeInTheDocument()
    expect(within(card).getByText(/1,190,000/)).toBeInTheDocument()
    expect(within(card).getByText(/9,610,000/)).toBeInTheDocument()
  })

  it('shows the cost once rates are configured', async () => {
    renderTab()

    const card = await screen.findByTestId('token-usage-cost')
    expect(within(card).getByText(/\$43\.11/)).toBeInTheDocument()
  })

  it('says cost is unavailable rather than showing zero when no rates are set', async () => {
    server.use(
      http.get('/api/v1/admin/token-usage/summary', () =>
        HttpResponse.json(
          summary({
            input_price_per_mtok: null,
            output_price_per_mtok: null,
            estimated_cost_usd: null,
          })
        )
      )
    )

    renderTab()

    const card = await screen.findByTestId('token-usage-cost')
    // $0.00 would report a month of real spend as free.
    expect(within(card).queryByText(/\$0\.00/)).not.toBeInTheDocument()
    expect(within(card).getByText(/enter rates/i)).toBeInTheDocument()
  })

  it('renders a real but sub-cent charge without rounding it to nothing', async () => {
    server.use(
      http.get('/api/v1/admin/token-usage/summary', () =>
        HttpResponse.json(
          summary({
            input_tokens: 1_000,
            output_tokens: 200,
            total_tokens: 1_200,
            estimated_cost_usd: '0.0060',
          })
        )
      )
    )

    renderTab()

    const card = await screen.findByTestId('token-usage-cost')
    expect(within(card).getByText(/less than \$0\.01/i)).toBeInTheDocument()
  })

  it('warns that one rate pair cannot price a period spanning two models', async () => {
    server.use(
      http.get('/api/v1/admin/token-usage/summary', () =>
        HttpResponse.json(
          summary({
            models: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
            mixed_models: true,
          })
        )
      )
    )

    renderTab()

    const card = await screen.findByTestId('token-usage-cost')
    expect(within(card).getByText(/more than one model/i)).toBeInTheDocument()
  })

  it('saves the rates an admin enters', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/llm-config', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'llm-config-1',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: true,
          anthropic_api_key_from_env: true,
          ollama_base_url: null,
          default_monthly_token_limit: 500000,
          input_price_per_mtok: '0.8000',
          output_price_per_mtok: '4.0000',
          updated_at: null,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    const input = await screen.findByLabelText(/input tokens, \$ per million/i)
    const output = screen.getByLabelText(/output tokens, \$ per million/i)
    await user.clear(input)
    await user.type(input, '0.80')
    await user.clear(output)
    await user.type(output, '4.00')
    await user.click(screen.getByRole('button', { name: /save ai settings/i }))

    await waitFor(() => {
      expect(patched?.input_price_per_mtok).toBe('0.80')
      expect(patched?.output_price_per_mtok).toBe('4.00')
    })
  })

  it('sends null when a rate is cleared', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/admin/llm-config', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'llm-config-1',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: true,
          anthropic_api_key_from_env: true,
          ollama_base_url: null,
          default_monthly_token_limit: 500000,
          input_price_per_mtok: null,
          output_price_per_mtok: null,
          updated_at: null,
        })
      })
    )

    const user = userEvent.setup()
    renderTab()

    await user.clear(await screen.findByLabelText(/input tokens, \$ per million/i))
    await user.clear(screen.getByLabelText(/output tokens, \$ per million/i))
    await user.click(screen.getByRole('button', { name: /save ai settings/i }))

    // Clearing a rate is how an admin stops reporting a cost they distrust,
    // so it must be a null rather than a 0 that claims the tokens were free.
    await waitFor(() => {
      expect(patched).not.toBeNull()
      expect(patched?.input_price_per_mtok).toBeNull()
      expect(patched?.output_price_per_mtok).toBeNull()
    })
  })

  it('rejects a non-numeric rate before sending it', async () => {
    let patched = false
    server.use(
      http.patch('/api/v1/admin/llm-config', () => {
        patched = true
        return HttpResponse.json({})
      })
    )

    const user = userEvent.setup()
    renderTab()

    const input = await screen.findByLabelText(/input tokens, \$ per million/i)
    await user.clear(input)
    await user.type(input, 'free')

    expect(screen.getByRole('button', { name: /save ai settings/i })).toBeDisabled()
    expect(patched).toBe(false)
  })
})
