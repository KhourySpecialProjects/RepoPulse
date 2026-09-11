import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Repo, Commit, Note, PaginatedResponse } from '@/types'

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
  contributor_count: 1,
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

const commitResponse: PaginatedResponse<Commit> = {
  items: [mockCommit],
  total: 1,
  limit: 20,
  offset: 0,
}

const noteWithCommitHash: Note = {
  id: 'note-with-hash',
  author_id: 'user-1',
  author_display_name: 'Test User',
  repo_id: 'repo-1',
  contributor_id: null,
  commit_hash: 'abc1234567890',
  content: 'Note linked to a commit',
  is_reminder: false,
  reminder_context: null,
  is_checked: false,
  is_archived: false,
  created_at: '2025-10-11T10:00:00Z',
  updated_at: '2025-10-11T10:00:00Z',
  comments: [],
}

const noteWithoutCommitHash: Note = {
  id: 'note-no-hash',
  author_id: 'user-1',
  author_display_name: 'Test User',
  repo_id: 'repo-1',
  contributor_id: null,
  commit_hash: null,
  content: 'Regular repo note',
  is_reminder: false,
  reminder_context: null,
  is_checked: false,
  is_archived: false,
  created_at: '2025-10-10T10:00:00Z',
  updated_at: '2025-10-10T10:00:00Z',
  comments: [],
}

function setupHandlers(notes: Note[] = []) {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json(commitResponse)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: notes, total: notes.length, limit: 50, offset: 0 })
    ),
    http.post('/api/v1/notes', async ({ request }) => {
      const body = (await request.json()) as Partial<Note>
      return HttpResponse.json(
        {
          id: 'new-note',
          author_id: 'user-1',
          repo_id: body.repo_id ?? null,
          contributor_id: null,
          commit_hash: body.commit_hash ?? null,
          content: body.content ?? '',
          is_reminder: false,
          reminder_context: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { status: 201 }
      )
    })
  )
}

async function openNotesDrawer() {
  await waitFor(() => expect(screen.getByTitle('Open notes')).toBeInTheDocument())
  fireEvent.click(screen.getByTitle('Open notes'))
}

describe('RepoDetailPage - commit linking from Notes panel', () => {
  it('does not render a commit link button for notes without a commit_hash', async () => {
    setupHandlers([noteWithoutCommitHash])
    renderPage()
    await openNotesDrawer()
    await waitFor(() => expect(screen.getByText('Regular repo note')).toBeInTheDocument())
    // Should not render any element with text that looks like a short commit hash link
    expect(screen.queryByTitle('Jump to commit')).not.toBeInTheDocument()
  })

  it('renders a commit link button next to the timestamp for notes with a commit_hash', async () => {
    setupHandlers([noteWithCommitHash])
    renderPage()
    await openNotesDrawer()
    await waitFor(() => expect(screen.getByText('Note linked to a commit')).toBeInTheDocument())
    const commitLinkBtn = screen.getByTitle('Jump to commit')
    expect(commitLinkBtn).toBeInTheDocument()
    // Displays first 7 chars of the hash
    expect(commitLinkBtn).toHaveTextContent('abc1234')
  })

  it('adds an id to commit rows matching the commit hash', async () => {
    setupHandlers([noteWithCommitHash])
    renderPage()
    await waitFor(() => expect(screen.getAllByText('abc1234').length).toBeGreaterThan(0))
    const commitRow = document.getElementById('commit-abc1234567890')
    expect(commitRow).not.toBeNull()
  })

  it('highlights the commit row when the commit link button is clicked', async () => {
    setupHandlers([noteWithCommitHash])
    renderPage()
    await openNotesDrawer()
    await waitFor(() => expect(screen.getByText('Note linked to a commit')).toBeInTheDocument())

    const commitRow = document.getElementById('commit-abc1234567890') as HTMLElement
    expect(commitRow.className).not.toMatch(/ring-indigo-400/)

    const commitLinkBtn = screen.getByTitle('Jump to commit')
    fireEvent.click(commitLinkBtn)

    await waitFor(() => {
      const updatedRow = document.getElementById('commit-abc1234567890') as HTMLElement
      expect(updatedRow.className).toMatch(/ring-indigo-400/)
    })
  })

  it('does not show a commit link for notes without a hash even when other notes have hashes', async () => {
    setupHandlers([noteWithCommitHash, noteWithoutCommitHash])
    renderPage()
    await openNotesDrawer()
    await waitFor(() => {
      expect(screen.getByText('Note linked to a commit')).toBeInTheDocument()
      expect(screen.getByText('Regular repo note')).toBeInTheDocument()
    })
    // Only one "Jump to commit" button — for the note with a hash
    const jumpButtons = screen.getAllByTitle('Jump to commit')
    expect(jumpButtons).toHaveLength(1)
  })
})
