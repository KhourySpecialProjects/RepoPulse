import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Repo, Commit, Contributor, Note, PaginatedResponse } from '@/types'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: vi.fn() }
})

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-test-1', display_name: 'Test User', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage(repoId = 'repo-1') {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[`/repos/${repoId}`]}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_synced_at: '2025-10-15T10:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-15T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 0,
  expected_contributor_count: null,
}

const mockCommit: Commit = {
  hash: 'abc1234567890',
  author_name: 'Alice Johnson',
  author_email: 'alice@example.com',
  date: '2025-10-14T14:00:00Z',
  message: 'feat: implement auth',
  branches: ['main'],
  insertions: 142,
  deletions: 23,
  files_changed: 6,
}

const mockContributor: Contributor = {
  id: 'contrib-1',
  display_name: 'Alice Johnson',
  repo_id: 'repo-1',
  created_at: '2025-09-01T00:00:00Z',
  aliases: [{ id: 'alias-1', git_email: 'alice@example.com', git_name: 'alice' }],
  commit_count: 42,
  total_insertions: 1204,
  total_deletions: 389,
  last_commit_at: '2026-03-15T10:00:00Z',
}

const mockNote: Note = {
  id: 'note-1',
  author_id: 'user-1',
  author_display_name: 'Test User',
  repo_id: 'repo-1',
  contributor_id: null,
  commit_hash: null,
  content: 'Repo-level note',
  is_reminder: false,
  reminder_context: null,
  is_checked: false,
  is_archived: false,
  created_at: '2025-10-10T10:00:00Z',
  updated_at: '2025-10-10T10:00:00Z',
  comments: [],
}

const commitNoteForHash: Note = {
  id: 'note-commit-1',
  author_id: 'user-1',
  author_display_name: 'Test User',
  repo_id: 'repo-1',
  contributor_id: null,
  commit_hash: 'abc1234567890',
  content: 'This commit looks suspicious',
  is_reminder: false,
  reminder_context: null,
  is_checked: false,
  is_archived: false,
  created_at: '2025-10-11T10:00:00Z',
  updated_at: '2025-10-11T10:00:00Z',
  comments: [],
}

function setupHandlers(overrides?: {
  notes?: Note[]
  commitNotes?: Note[]
}) {
  const commitResponse: PaginatedResponse<Commit> = {
    items: [mockCommit],
    total: 1,
    limit: 20,
    offset: 0,
  }
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json(commitResponse)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([mockContributor])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', ({ request }) => {
      const url = new URL(request.url)
      const commitHash = url.searchParams.get('commit_hash')
      if (commitHash) {
        const notes = overrides?.commitNotes ?? []
        return HttpResponse.json({ items: notes, total: notes.length, limit: 50, offset: 0 })
      }
      const notes = overrides?.notes ?? [mockNote]
      return HttpResponse.json({ items: notes, total: notes.length, limit: 50, offset: 0 })
    }),
    http.post('/api/v1/notes', async ({ request }) => {
      const body = (await request.json()) as Partial<Note>
      const newNote: Note = {
        id: `note-${Date.now()}`,
        author_id: 'user-1',
        author_display_name: 'Test User',
        repo_id: body.repo_id ?? null,
        contributor_id: null,
        commit_hash: body.commit_hash ?? null,
        content: body.content ?? '',
        is_reminder: body.is_reminder ?? false,
        reminder_context: body.reminder_context ?? null,
        is_checked: false,
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        comments: [],
      }
      return HttpResponse.json(newNote, { status: 201 })
    })
  )
}

// ──────────────────────────────────────────────
// 1. Contributors in right column
// ──────────────────────────────────────────────
describe('RepoDetailPage - Contributors in right column', () => {
  it('renders contributors section in the right column', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    // Alice appears in both commits table (author_name) and contributors panel — both expected
    const aliceElements = screen.getAllByText('Alice Johnson')
    expect(aliceElements.length).toBeGreaterThan(0)
    expect(screen.getByText(/42 commits/)).toBeInTheDocument()
  })

  it('shows contributor aliases in right column panel', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText('Alice Johnson').length).toBeGreaterThan(0)
    })
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────
// 2. Commit hash links to GitHub
// ──────────────────────────────────────────────
describe('RepoDetailPage - Commit hash GitHub link', () => {
  it('renders commit hash as a link', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('abc1234')).toBeInTheDocument())
    const link = screen.getByRole('link', { name: 'abc1234' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://github.com/student/project/commit/abc1234567890')
    expect(link).toHaveAttribute('target', '_blank')
  })
})

// ──────────────────────────────────────────────
// 3. Chart range selector
// ──────────────────────────────────────────────
describe('RepoDetailPage - Chart date range selector', () => {
  it('renders range selector buttons', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '90d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
  })

  it('defaults to "All" range button as active', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    const btnAll = screen.getByRole('button', { name: 'All' })
    expect(btnAll.className).toMatch(/bg-indigo-600/)
  })

  it('switches active range when a button is clicked', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '7d' }).className).toMatch(/bg-indigo-600/)
    })
    expect(screen.getByRole('button', { name: '30d' }).className).not.toMatch(/bg-indigo-600/)
  })
})

// ──────────────────────────────────────────────
// 4. Commit-level notes
// ──────────────────────────────────────────────
describe('RepoDetailPage - Commit notes panel', () => {
  it('renders a Notes toggle button in each commit row', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('abc1234')).toBeInTheDocument())
    // Button shows "Add note" when no notes exist for the commit
    const addNoteButtons = screen.getAllByText('Add note')
    expect(addNoteButtons.length).toBeGreaterThan(0)
  })

  it('shows CommitNotesPanel when Notes button is clicked', async () => {
    setupHandlers({ commitNotes: [commitNoteForHash] })
    renderPage()
    await waitFor(() => expect(screen.getByText('abc1234')).toBeInTheDocument())
    // No commit-hash notes in the repo-level notes list, so button says "Add note"
    const notesBtn = screen.getAllByText('Add note')[0].closest('button') as HTMLElement
    fireEvent.click(notesBtn)
    await waitFor(() => {
      expect(screen.getByText('This commit looks suspicious')).toBeInTheDocument()
    })
  })

  it('hides CommitNotesPanel when Notes button is clicked again (toggle)', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('abc1234')).toBeInTheDocument())
    const notesBtn = screen.getAllByText('Add note')[0].closest('button') as HTMLElement

    // Before opening: only 1 textarea (the repo Notes panel)
    const countBefore = screen.getAllByPlaceholderText('Write a note...').length

    fireEvent.click(notesBtn)
    // After opening: 2 textareas (repo Notes + commit Notes panel)
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Write a note...').length).toBe(countBefore + 1)
    })

    fireEvent.click(notesBtn)
    // After closing: back to original count
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Write a note...').length).toBe(countBefore)
    })
  })
})

// ──────────────────────────────────────────────
// 5. Commit row note count indicators
// ──────────────────────────────────────────────
describe('RepoDetailPage - Commit row note count indicators', () => {
  it('shows "Add note" text when no notes exist for a commit', async () => {
    setupHandlers({ notes: [] })
    renderPage()
    await waitFor(() => expect(screen.getByText('abc1234')).toBeInTheDocument())
    expect(screen.getByText('Add note')).toBeInTheDocument()
  })

  it('shows note count badge when repo notes reference the commit hash', async () => {
    const noteWithHash: Note = {
      ...commitNoteForHash,
      is_reminder: false,
    }
    setupHandlers({ notes: [noteWithHash] })
    renderPage()
    await waitFor(() => expect(screen.getAllByText('abc1234').length).toBeGreaterThan(0))
    // The indigo badge on the commit button shows the total count
    const indigo = document.querySelector(
      '.bg-indigo-100.text-indigo-700.rounded-full.px-1\\.5'
    ) as HTMLElement
    expect(indigo).not.toBeNull()
    expect(indigo.textContent).toBe('1')
  })

  it('shows reminder badge when a commit note is a reminder', async () => {
    const reminderNote: Note = {
      ...commitNoteForHash,
      id: 'note-reminder-1',
      is_reminder: true,
    }
    setupHandlers({ notes: [reminderNote] })
    renderPage()
    await waitFor(() => expect(screen.getAllByText('abc1234').length).toBeGreaterThan(0))
    const indigo = document.querySelector(
      '.bg-indigo-100.text-indigo-700.rounded-full.px-1\\.5'
    ) as HTMLElement
    expect(indigo).not.toBeNull()
    expect(indigo.textContent).toBe('1')
    expect(screen.getByText('1 reminder')).toBeInTheDocument()
  })

  it('shows plural "reminders" when multiple reminder notes exist for a commit', async () => {
    const reminder1: Note = { ...commitNoteForHash, id: 'r1', is_reminder: true }
    const reminder2: Note = { ...commitNoteForHash, id: 'r2', is_reminder: true }
    setupHandlers({ notes: [reminder1, reminder2] })
    renderPage()
    await waitFor(() => expect(screen.getAllByText('abc1234').length).toBeGreaterThan(0))
    const indigo = document.querySelector(
      '.bg-indigo-100.text-indigo-700.rounded-full.px-1\\.5'
    ) as HTMLElement
    expect(indigo).not.toBeNull()
    expect(indigo.textContent).toBe('2')
    expect(screen.getByText('2 reminders')).toBeInTheDocument()
  })

  it('does not show "Add note" when there are notes for the commit', async () => {
    const noteWithHash: Note = { ...commitNoteForHash, is_reminder: false }
    setupHandlers({ notes: [noteWithHash] })
    renderPage()
    await waitFor(() => expect(screen.getAllByText('abc1234').length).toBeGreaterThan(0))
    expect(screen.queryByText('Add note')).not.toBeInTheDocument()
  })
})
