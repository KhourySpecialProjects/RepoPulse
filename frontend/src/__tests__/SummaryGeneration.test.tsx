import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Summary } from '@/types'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1', role: 'instructor' } }) }))
vi.mock('@/components/ContextualActivityChart', () => ({ ContextualActivityChart: () => null }))
vi.mock('@/components/SummaryLiquidBackground', () => ({ SummaryLiquidBackground: () => null }))
// The reveal animation has its own timer tests; here we verify which summary is visible.
vi.mock('@/components/TypedMarkdown', () => ({ TypedMarkdown: ({ content }: { content: string }) => <div>{content}</div> }))

const previous: Summary = {
  id: 'previous', repo_id: 'repo-1', contributor_id: null, summary_type: 'repo_overview',
  content: 'Previous saved analysis.', model_used: 'test', generated_at: '2026-09-10T12:00:00Z',
}
const next: Summary = { ...previous, id: 'next', content: 'Fresh repository analysis.', generated_at: '2026-09-11T12:00:00Z' }

function renderSummary() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter initialEntries={['/repos/repo-1']}><Routes><Route path="/repos/:id" element={<RepoDetailPage />} /></Routes></MemoryRouter>
  </QueryClientProvider>)
}

describe('Summary regeneration', () => {
  it('hides the previous text while pending, then displays the new summary', async () => {
    let summaries = [previous]
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    server.use(
      http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json(summaries)),
      http.post('/api/v1/summaries/generate', async () => {
        await pending
        summaries = [next, previous]
        return HttpResponse.json(next)
      }),
    )
    renderSummary()
    expect(await screen.findByText(previous.content)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Summary', exact: true }))
    expect(await screen.findByRole('button', { name: 'Generating summary', exact: true })).toBeDisabled()
    expect(screen.queryByText(previous.content)).not.toBeInTheDocument()
    finish()
    expect(await screen.findByText(next.content)).toBeInTheDocument()
    expect(screen.queryByText(previous.content)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Summary', exact: true })).toBeEnabled())
  })

  it('restores the previous text and enables retry when generation fails', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    server.use(
      http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([previous])),
      http.post('/api/v1/summaries/generate', async () => {
        await pending
        return HttpResponse.json({ detail: 'Generation failed' }, { status: 500 })
      }),
    )
    renderSummary()
    expect(await screen.findByText(previous.content)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Summary', exact: true }))
    await screen.findByRole('button', { name: 'Generating summary', exact: true })
    expect(screen.queryByText(previous.content)).not.toBeInTheDocument()
    finish()
    expect(await screen.findByText(previous.content)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate Summary', exact: true })).toBeEnabled()
  })
})
