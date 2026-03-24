import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import type { UserDetail, NoteComment, Notification, NotificationListResponse } from '@/types'

// Helper to render with providers
function renderWithProviders(ui: React.ReactElement, { route = '/' } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const mockUserDetail: UserDetail = {
  id: 'user-1',
  email: 'mark@example.com',
  display_name: 'Instructor Mark',
  role: 'instructor',
  github_token_configured: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const mockAdminUser: UserDetail = {
  id: 'user-admin-1',
  email: 'admin@example.com',
  display_name: 'Admin Alex',
  role: 'admin',
  github_token_configured: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const mockNoteComment: NoteComment = {
  id: 'comment-1',
  note_id: 'note-1',
  author_id: 'user-1',
  author_display_name: 'Instructor Mark',
  content: 'This is a test comment',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const mockNotification: Notification = {
  id: 'notif-1',
  type: 'note_comment',
  note_id: 'note-1',
  comment_id: 'comment-1',
  is_read: false,
  created_at: '2025-01-01T00:00:00Z',
  note_content_preview: 'Good progress...',
  repo_id: 'repo-1',
}

// Tests for API functions
describe('API: user management endpoints', () => {
  it('getCurrentUser returns UserDetail', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(mockUserDetail))
    )
    const { getCurrentUser } = await import('@/services/api')
    const result = await getCurrentUser()
    expect(result.email).toBe('mark@example.com')
    expect(result.role).toBe('instructor')
    expect(result.github_token_configured).toBe(false)
  })

  it('getUsers accepts optional collection_id param', async () => {
    server.use(
      http.get('/api/v1/users', ({ request }) => {
        const url = new URL(request.url)
        const collectionId = url.searchParams.get('collection_id')
        if (collectionId === 'col-1') {
          return HttpResponse.json([mockUserDetail])
        }
        return HttpResponse.json([mockUserDetail, mockAdminUser])
      })
    )
    const { getUsers } = await import('@/services/api')
    const allUsers = await getUsers()
    expect(allUsers).toHaveLength(2)
    const filteredUsers = await getUsers({ collection_id: 'col-1' })
    expect(filteredUsers).toHaveLength(1)
  })

  it('createUser posts to /users', async () => {
    server.use(
      http.post('/api/v1/users', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>
        return HttpResponse.json({ ...mockUserDetail, email: body.email as string }, { status: 201 })
      })
    )
    const { createUser } = await import('@/services/api')
    const result = await createUser({
      email: 'new@example.com',
      display_name: 'New User',
      role: 'ta',
      password: 'password123',
    })
    expect(result.email).toBe('new@example.com')
  })

  it('deleteUser sends DELETE to /users/:id', async () => {
    let deleted = false
    server.use(
      http.delete('/api/v1/users/:id', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      })
    )
    const { deleteUser } = await import('@/services/api')
    await deleteUser('user-1')
    expect(deleted).toBe(true)
  })

  it('getNoteComments fetches note comments', async () => {
    server.use(
      http.get('/api/v1/notes/:noteId/comments', () => HttpResponse.json([mockNoteComment]))
    )
    const { getNoteComments } = await import('@/services/api')
    const result = await getNoteComments('note-1')
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('This is a test comment')
  })

  it('createNoteComment posts to /notes/:noteId/comments', async () => {
    server.use(
      http.post('/api/v1/notes/:noteId/comments', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>
        return HttpResponse.json({ ...mockNoteComment, content: body.content as string }, { status: 201 })
      })
    )
    const { createNoteComment } = await import('@/services/api')
    const result = await createNoteComment('note-1', 'New comment')
    expect(result.content).toBe('New comment')
  })

  it('getNotifications fetches notifications with unread_count', async () => {
    const mockResponse: NotificationListResponse = {
      items: [mockNotification],
      total: 1,
      unread_count: 1,
    }
    server.use(
      http.get('/api/v1/notifications', () => HttpResponse.json(mockResponse))
    )
    const { getNotifications } = await import('@/services/api')
    const result = await getNotifications()
    expect(result.unread_count).toBe(1)
    expect(result.items).toHaveLength(1)
  })

  it('markAllNotificationsRead posts to /notifications/read-all', async () => {
    server.use(
      http.post('/api/v1/notifications/read-all', () => HttpResponse.json({ marked_read: 3 }))
    )
    const { markAllNotificationsRead } = await import('@/services/api')
    const result = await markAllNotificationsRead()
    expect(result.marked_read).toBe(3)
  })

  it('getCollectionAccess returns access entries', async () => {
    server.use(
      http.get('/api/v1/collections/:id/access', () => HttpResponse.json([]))
    )
    const { getCollectionAccess } = await import('@/services/api')
    const result = await getCollectionAccess('col-1')
    expect(Array.isArray(result)).toBe(true)
  })
})

// Tests for hooks
describe('useCurrentUser hook', () => {
  it('fetches current user', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(mockUserDetail))
    )
    const { renderHook } = await import('@testing-library/react')
    const { useCurrentUser } = await import('@/hooks/useUsers')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useCurrentUser(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.role).toBe('instructor')
  })
})

describe('useNotifications hook', () => {
  it('returns notifications with unread_count', async () => {
    const mockResponse: NotificationListResponse = {
      items: [mockNotification],
      total: 1,
      unread_count: 1,
    }
    server.use(
      http.get('/api/v1/notifications', () => HttpResponse.json(mockResponse)),
      http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ unread_count: 1 }))
    )
    const { renderHook } = await import('@testing-library/react')
    const { useNotifications } = await import('@/hooks/useNotifications')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result: notifResult } = renderHook(() => useNotifications(), { wrapper })
    await waitFor(() => expect(notifResult.current.isSuccess).toBe(true))
    expect(notifResult.current.data?.unread_count).toBe(1)
  })
})

describe('useNoteComments hook', () => {
  it('fetches note comments', async () => {
    server.use(
      http.get('/api/v1/notes/:noteId/comments', () => HttpResponse.json([mockNoteComment]))
    )
    const { renderHook } = await import('@testing-library/react')
    const { useNoteComments } = await import('@/hooks/useNoteComments')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useNoteComments('note-1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].content).toBe('This is a test comment')
  })
})

describe('NoteComments component', () => {
  it('renders with show comments toggle when comments exist', async () => {
    server.use(
      http.get('/api/v1/notes/:noteId/comments', () => HttpResponse.json([mockNoteComment]))
    )
    const { NoteComments } = await import('@/components/NoteComments')
    renderWithProviders(
      <NoteComments note={{ id: 'note-1', author_id: 'user-1', author_display_name: 'Mark', repo_id: 'repo-1', contributor_id: null, commit_hash: null, content: 'Test note', is_reminder: false, reminder_context: null, is_checked: false, is_archived: false, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', comments: [] }} currentUserId="user-1" />
    )
    await waitFor(() => {
      expect(screen.getByText(/comment/i)).toBeInTheDocument()
    })
  })

  it('shows reply button and opens textarea on click', async () => {
    server.use(
      http.get('/api/v1/notes/:noteId/comments', () => HttpResponse.json([]))
    )
    const { NoteComments } = await import('@/components/NoteComments')
    renderWithProviders(
      <NoteComments note={{ id: 'note-1', author_id: 'user-1', author_display_name: 'Mark', repo_id: 'repo-1', contributor_id: null, commit_hash: null, content: 'Test note', is_reminder: false, reminder_context: null, is_checked: false, is_archived: false, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', comments: [] }} currentUserId="user-1" />
    )
    // Initially shows Reply button
    await waitFor(() => {
      expect(screen.getByText('Reply')).toBeInTheDocument()
    })
    // Click Reply to show textarea
    fireEvent.click(screen.getByText('Reply'))
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })
})

describe('UserProfilePage', () => {
  it('renders profile page with display name section', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(mockUserDetail))
    )
    const { UserProfilePage } = await import('@/pages/UserProfilePage')
    renderWithProviders(<UserProfilePage />, { route: '/profile' })
    await waitFor(() => {
      expect(screen.getByText(/display name/i)).toBeInTheDocument()
    })
  })

  it('renders change password section', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(mockUserDetail))
    )
    const { UserProfilePage } = await import('@/pages/UserProfilePage')
    renderWithProviders(<UserProfilePage />, { route: '/profile' })
    await waitFor(() => {
      const matches = screen.getAllByText(/change password/i)
      expect(matches.length).toBeGreaterThan(0)
    })
  })
})

describe('AdminPage', () => {
  it('renders admin page with users tab for admin users', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(mockAdminUser)),
      http.get('/api/v1/users', () => HttpResponse.json([mockUserDetail, mockAdminUser]))
    )

    // Mock auth context
    vi.mock('@/hooks/useAuth', () => ({
      useAuth: () => ({
        user: { id: 'user-admin-1', display_name: 'Admin Alex', role: 'admin', email: 'admin@example.com' },
        isAuthenticated: true,
        isLoading: false,
        login: vi.fn(),
        devLogin: vi.fn(),
        logout: vi.fn(),
      }),
      AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    }))

    const { AdminPage } = await import('@/pages/AdminPage')
    renderWithProviders(<AdminPage />, { route: '/admin' })
    await waitFor(() => {
      expect(screen.getByText(/users/i)).toBeInTheDocument()
    })
  })
})

describe('CollectionAccessPanel', () => {
  it('renders access panel with co-instructors section', async () => {
    server.use(
      http.get('/api/v1/collections/:id/access', () => HttpResponse.json([]))
    )
    const { CollectionAccessPanel } = await import('@/components/CollectionAccessPanel')
    renderWithProviders(<CollectionAccessPanel collectionId="col-1" />)
    await waitFor(() => {
      expect(screen.getByText(/co-instructor/i)).toBeInTheDocument()
    })
  })
})
