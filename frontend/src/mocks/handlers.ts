import { http, HttpResponse } from 'msw'
import type {
  TokenResponse,
  Collection,
  Repo,
  Contributor,
  Commit,
  Note,
  Summary,
  AppSettings,
  PaginatedResponse,
  HealthScore,
  UserDetail,
  NoteComment,
  Notification,
  NotificationListResponse,
  CollectionAccessEntry,
  PRStats,
  PRListResponse,
  PRSyncResponse,
} from '@/types'

const BASE = '/api/v1'

// Seed data
const mockUser = {
  id: 'user-instructor-1',
  display_name: 'Instructor Mark',
  role: 'instructor' as const,
}

const mockTokenResponse: TokenResponse = {
  access_token: 'mock-jwt-token',
  token_type: 'bearer',
  user_id: mockUser.id,
  display_name: mockUser.display_name,
  role: mockUser.role,
}

const mockHealthScore: HealthScore = {
  commit_frequency: 0.75,
  recency: 0.82,
  distribution: 0.6,
  branch_activity: 0.9,
  commit_message_quality: 0.65,
  composite: 0.744,
  status: 'green',
}

const mockCollections: Collection[] = [
  {
    id: 'col-1',
    name: 'CS 101 Fall 2025',
    course_tag: 'CS 101',
    semester_tag: 'Fall 2025',
    local_folder_name: 'cs101-fall-2025',
    owner_id: mockUser.id,
    created_at: '2025-09-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
    repo_count: 3,
    is_archived: false,
    health_green: 1,
    health_yellow: 1,
    health_red: 1,
    health_unknown: 0,
  },
  {
    id: 'col-2',
    name: 'CS 201 Spring 2025',
    course_tag: 'CS 201',
    semester_tag: 'Spring 2025',
    local_folder_name: 'cs201-spring-2025',
    owner_id: mockUser.id,
    created_at: '2025-01-15T00:00:00Z',
    updated_at: '2025-01-15T00:00:00Z',
    repo_count: 1,
    is_archived: false,
    health_green: 0,
    health_yellow: 1,
    health_red: 0,
    health_unknown: 0,
  },
]

const mockRepos: Repo[] = [
  {
    id: 'repo-1',
    collection_id: 'col-1',
    github_url: 'https://github.com/student-alice/cs101-project',
    name: 'cs101-project',
    local_path: '/repos/cs101-fall-2025/cs101-project',
    health_status: 'green',
    health_score: mockHealthScore,
    last_synced_at: '2025-10-15T10:00:00Z',
    last_commit_at: '2025-10-15T09:45:00Z',
    created_at: '2025-09-01T00:00:00Z',
    updated_at: '2025-10-15T10:00:00Z',
    contributor_count: 3,
    active_reminder_count: 1,
    expected_contributor_count: null,
  },
  {
    id: 'repo-2',
    collection_id: 'col-1',
    github_url: 'https://github.com/student-bob/cs101-project',
    name: 'cs101-project-bob',
    local_path: '/repos/cs101-fall-2025/cs101-project-bob',
    health_status: 'yellow',
    health_score: {
      ...mockHealthScore,
      commit_frequency: 0.45,
      recency: 0.5,
      composite: 0.42,
      status: 'yellow',
    },
    last_synced_at: '2025-10-14T08:00:00Z',
    last_commit_at: '2025-10-12T14:20:00Z',
    created_at: '2025-09-01T00:00:00Z',
    updated_at: '2025-10-14T08:00:00Z',
    contributor_count: 2,
    active_reminder_count: 0,
    expected_contributor_count: null,
  },
  {
    id: 'repo-3',
    collection_id: 'col-1',
    github_url: 'https://github.com/student-carol/cs101-project',
    name: 'cs101-project-carol',
    local_path: null,
    health_status: 'red',
    health_score: {
      ...mockHealthScore,
      commit_frequency: 0.1,
      recency: 0.2,
      distribution: 0.05,
      composite: 0.15,
      status: 'red',
    },
    last_synced_at: null,
    last_commit_at: null,
    created_at: '2025-09-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
    contributor_count: 1,
    active_reminder_count: 0,
    expected_contributor_count: null,
  },
]

const mockContributors: Contributor[] = [
  {
    id: 'contrib-1',
    display_name: 'Alice Johnson',
    repo_id: 'repo-1',
    created_at: '2025-09-01T00:00:00Z',
    aliases: [{ id: 'alias-1', git_email: 'alice@example.com', git_name: 'alice' }],
    commit_count: 28,
    total_insertions: 842,
    total_deletions: 156,
    last_commit_at: '2025-10-15T10:00:00Z',
  },
  {
    id: 'contrib-2',
    display_name: 'Bob Smith',
    repo_id: 'repo-1',
    created_at: '2025-09-01T00:00:00Z',
    aliases: [
      { id: 'alias-2', git_email: 'bob@example.com', git_name: 'Bob Smith' },
      { id: 'alias-3', git_email: 'bsmith@students.edu', git_name: 'bsmith' },
    ],
    commit_count: 12,
    total_insertions: 318,
    total_deletions: 74,
    last_commit_at: '2025-10-13T09:30:00Z',
  },
]

const mockCommits: Commit[] = [
  {
    hash: 'abc1234567890',
    author_name: 'Alice Johnson',
    author_email: 'alice@example.com',
    date: '2025-10-14T14:00:00Z',
    message: 'feat: implement user authentication flow',
    branches: ['main'],
    insertions: 142,
    deletions: 23,
    files_changed: 6,
  },
  {
    hash: 'def0987654321',
    author_name: 'Bob Smith',
    author_email: 'bob@example.com',
    date: '2025-10-13T09:30:00Z',
    message: 'fix: resolve merge conflict in database module',
    branches: ['main'],
    insertions: 18,
    deletions: 5,
    files_changed: 2,
  },
  {
    hash: 'ghi1122334455',
    author_name: 'Alice Johnson',
    author_email: 'alice@example.com',
    date: '2025-10-12T16:45:00Z',
    message: 'docs: update README with setup instructions',
    branches: ['feature/docs'],
    insertions: 54,
    deletions: 0,
    files_changed: 1,
  },
]

const mockNotes: Note[] = [
  {
    id: 'note-1',
    author_id: mockUser.id,
    author_display_name: mockUser.display_name,
    repo_id: 'repo-1',
    contributor_id: null,
    commit_hash: null,
    content: 'Good progress so far. Alice is carrying most of the load — check in with Bob.',
    is_reminder: true,
    reminder_context: 'Check in at next office hours',
    is_checked: false,
    is_archived: false,
    created_at: '2025-10-10T10:00:00Z',
    updated_at: '2025-10-10T10:00:00Z',
    comments: [],
  },
]

const mockUserDetails: UserDetail[] = [
  {
    id: 'user-instructor-1',
    display_name: 'Instructor Mark',
    email: 'mark@example.com',
    role: 'instructor',
    github_token_configured: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'user-ta-1',
    display_name: 'Teaching Assistant',
    email: 'ta@example.com',
    role: 'ta',
    github_token_configured: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'user-admin-1',
    display_name: 'Admin Alex',
    email: 'admin@example.com',
    role: 'admin',
    github_token_configured: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
]

const mockNoteComments: NoteComment[] = []

const mockNotifications: Notification[] = []

const mockCollectionAccess: CollectionAccessEntry[] = []

const mockSummaries: Summary[] = [
  {
    id: 'summary-1',
    repo_id: 'repo-1',
    contributor_id: null,
    summary_type: 'repo_overview',
    content:
      'This repository shows consistent activity from Alice Johnson, who accounts for approximately 70% of all commits. Bob Smith has been less active over the past two weeks. The commit history shows strong progress on the authentication feature. Commit messages are descriptive and follow conventional commit format. Branch usage is healthy with feature branches being created and merged regularly.',
    model_used: 'claude-3-5-sonnet-20241022',
    generated_at: '2025-10-15T09:00:00Z',
  },
]

const mockSettings: AppSettings = {
  id: 'settings-1',
  user_id: mockUser.id,
  repo_root_directory: '/Users/instructor/repos',
  llm_provider: 'anthropic',
  llm_model: 'claude-3-5-sonnet-20241022',
  anthropic_api_key_configured: false,
  ollama_base_url: null,
  health_thresholds: null,
}

export const handlers = [
  http.get('/api/v1/collections/:id/contextual-activity', () => HttpResponse.json({ repositories: [] })),
  // Auth
  http.post(`${BASE}/auth/dev-login`, () => {
    return HttpResponse.json(mockTokenResponse)
  }),
  http.post(`${BASE}/auth/login`, () => {
    return HttpResponse.json(mockTokenResponse)
  }),

  // Collections
  http.get(`${BASE}/collections`, () => {
    const response: PaginatedResponse<Collection> = {
      items: mockCollections,
      total: mockCollections.length,
      limit: 50,
      offset: 0,
    }
    return HttpResponse.json(response)
  }),
  http.post(`${BASE}/collections`, async ({ request }) => {
    const body = (await request.json()) as Partial<Collection>
    const newCollection: Collection = {
      id: `col-${Date.now()}`,
      name: body.name ?? 'New Collection',
      course_tag: body.course_tag ?? null,
      semester_tag: body.semester_tag ?? null,
      local_folder_name: body.local_folder_name ?? 'new-collection',
      owner_id: mockUser.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      repo_count: 0,
      is_archived: false,
      health_green: 0,
      health_yellow: 0,
      health_red: 0,
      health_unknown: 0,
    }
    return HttpResponse.json(newCollection, { status: 201 })
  }),
  http.get(`${BASE}/collections/:id`, ({ params }) => {
    const collection = mockCollections.find((c) => c.id === params.id)
    if (!collection) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    return HttpResponse.json(collection)
  }),
  http.patch(`${BASE}/collections/:id`, async ({ params, request }) => {
    const collection = mockCollections.find((c) => c.id === params.id)
    if (!collection) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const body = (await request.json()) as Partial<Collection>
    return HttpResponse.json({ ...collection, ...body })
  }),
  http.delete(`${BASE}/collections/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.post(`${BASE}/collections/:id/sync`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Repos
  http.get(`${BASE}/collections/:collectionId/repos`, ({ params }) => {
    const repos = mockRepos.filter((r) => r.collection_id === params.collectionId)
    const response: PaginatedResponse<Repo> = {
      items: repos,
      total: repos.length,
      limit: 50,
      offset: 0,
    }
    return HttpResponse.json(response)
  }),
  http.post(`${BASE}/collections/:collectionId/repos`, async ({ params, request }) => {
    const body = (await request.json()) as { urls: string[] }
    const newRepos: Repo[] = body.urls.map((url, i) => ({
      id: `repo-new-${Date.now()}-${i}`,
      collection_id: params.collectionId as string,
      github_url: url,
      name: url.split('/').pop() ?? 'new-repo',
      local_path: null,
      health_status: 'unknown',
      health_score: null,
      last_synced_at: null,
      last_commit_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      contributor_count: 0,
      active_reminder_count: 0,
      expected_contributor_count: null,
    }))
    return HttpResponse.json(newRepos, { status: 201 })
  }),
  http.get(`${BASE}/repos/:id`, ({ params }) => {
    const repo = mockRepos.find((r) => r.id === params.id)
    if (!repo) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    return HttpResponse.json(repo)
  }),
  http.patch(`${BASE}/repos/:id`, async ({ params, request }) => {
    const repo = mockRepos.find((r) => r.id === params.id)
    if (!repo) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const body = (await request.json()) as Partial<Repo>
    return HttpResponse.json({ ...repo, ...body })
  }),
  http.delete(`${BASE}/repos/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.post(`${BASE}/repos/:id/sync`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(`${BASE}/repos/:id/health`, () => {
    return HttpResponse.json(mockHealthScore)
  }),
  http.get(`${BASE}/repos/:id/commits`, () => {
    const response: PaginatedResponse<Commit> = {
      items: mockCommits,
      total: mockCommits.length,
      limit: 20,
      offset: 0,
    }
    return HttpResponse.json(response)
  }),
  http.get(`${BASE}/repos/:id/contributors`, () => {
    return HttpResponse.json(mockContributors)
  }),
  http.get(`${BASE}/repos/:id/summaries`, () => {
    return HttpResponse.json(mockSummaries)
  }),

  // Contributors
  http.get(`${BASE}/contributors/:id`, ({ params }) => {
    const contributor = mockContributors.find((c) => c.id === params.id)
    if (!contributor) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    return HttpResponse.json(contributor)
  }),
  http.patch(`${BASE}/contributors/:id`, async ({ params, request }) => {
    const contributor = mockContributors.find((c) => c.id === params.id)
    if (!contributor) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const body = (await request.json()) as { display_name: string }
    return HttpResponse.json({ ...contributor, display_name: body.display_name })
  }),
  http.post(`${BASE}/contributors/merge`, async ({ request }) => {
    const body = (await request.json()) as { ids: string[]; display_name: string }
    const merged: Contributor = {
      id: `contrib-merged-${Date.now()}`,
      display_name: body.display_name,
      repo_id: mockContributors[0]?.repo_id ?? 'repo-1',
      created_at: new Date().toISOString(),
      aliases: [],
      commit_count: 0,
      total_insertions: 0,
      total_deletions: 0,
      last_commit_at: null,
    }
    return HttpResponse.json(merged)
  }),
  http.get(`${BASE}/contributors/:id/aliases`, ({ params }) => {
    const contributor = mockContributors.find((c) => c.id === params.id)
    if (!contributor) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    return HttpResponse.json(contributor)
  }),
  http.get(`${BASE}/contributors/:id/summaries`, () => {
    return HttpResponse.json([])
  }),

  // Notes
  http.get(`${BASE}/notes`, () => {
    return HttpResponse.json(mockNotes)
  }),
  http.post(`${BASE}/notes`, async ({ request }) => {
    const body = (await request.json()) as Partial<Note>
    const newNote: Note = {
      id: `note-${Date.now()}`,
      author_id: mockUser.id,
      author_display_name: mockUser.display_name,
      repo_id: body.repo_id ?? null,
      contributor_id: body.contributor_id ?? null,
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
  }),
  http.patch(`${BASE}/notes/:id`, async ({ params, request }) => {
    const note = mockNotes.find((n) => n.id === params.id)
    if (!note) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const body = (await request.json()) as Partial<Note>
    return HttpResponse.json({ ...note, ...body })
  }),
  http.delete(`${BASE}/notes/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Summaries
  http.post(`${BASE}/summaries/generate`, async ({ request }) => {
    const body = (await request.json()) as { repo_id?: string; summary_type: string }
    const newSummary: Summary = {
      id: `summary-${Date.now()}`,
      repo_id: body.repo_id ?? null,
      contributor_id: null,
      summary_type: body.summary_type as Summary['summary_type'],
      content: 'AI-generated summary: This repository shows healthy activity with regular commits from multiple contributors.',
      model_used: 'claude-3-5-sonnet-20241022',
      generated_at: new Date().toISOString(),
    }
    return HttpResponse.json(newSummary, { status: 201 })
  }),

  // Settings
  http.get(`${BASE}/settings`, () => {
    return HttpResponse.json(mockSettings)
  }),
  http.patch(`${BASE}/settings`, async ({ request }) => {
    const body = (await request.json()) as Partial<AppSettings>
    return HttpResponse.json({ ...mockSettings, ...body })
  }),

  // Users
  http.get(`${BASE}/users`, () => {
    return HttpResponse.json(mockUserDetails)
  }),
  http.get(`${BASE}/users/me`, () => {
    return HttpResponse.json(mockUserDetails[0])
  }),
  http.patch(`${BASE}/users/me`, async ({ request }) => {
    const body = (await request.json()) as Partial<UserDetail>
    return HttpResponse.json({ ...mockUserDetails[0], ...body })
  }),
  http.post(`${BASE}/users/me/change-password`, () => {
    return HttpResponse.json(mockUserDetails[0])
  }),
  http.post(`${BASE}/users`, async ({ request }) => {
    const body = (await request.json()) as Partial<UserDetail>
    const newUser: UserDetail = {
      id: `user-${Date.now()}`,
      email: (body.email as string) ?? 'new@example.com',
      display_name: (body.display_name as string) ?? 'New User',
      role: (body.role as UserDetail['role']) ?? 'ta',
      github_token_configured: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    return HttpResponse.json(newUser, { status: 201 })
  }),
  http.patch(`${BASE}/users/:id`, async ({ params, request }) => {
    const user = mockUserDetails.find((u) => u.id === params.id)
    if (!user) return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
    const body = (await request.json()) as Partial<UserDetail>
    return HttpResponse.json({ ...user, ...body })
  }),
  http.delete(`${BASE}/users/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
  http.post(`${BASE}/users/:id/reset-password`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Collection access
  http.get(`${BASE}/collections/:id/access`, () => {
    return HttpResponse.json(mockCollectionAccess)
  }),
  http.post(`${BASE}/collections/:id/access`, async ({ params, request }) => {
    const body = (await request.json()) as { user_id: string; access_role: 'co_instructor' | 'ta' }
    const user = mockUserDetails.find((u) => u.id === body.user_id)
    const entry: CollectionAccessEntry = {
      id: `access-${Date.now()}`,
      collection_id: params.id as string,
      user_id: body.user_id,
      user_display_name: user?.display_name ?? 'Unknown',
      user_email: user?.email ?? '',
      user_role: user?.role ?? 'ta',
      access_role: body.access_role,
      created_at: new Date().toISOString(),
    }
    return HttpResponse.json(entry, { status: 201 })
  }),
  http.delete(`${BASE}/collections/:id/access/:userId`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Note comments
  http.get(`${BASE}/notes/:noteId/comments`, () => {
    return HttpResponse.json(mockNoteComments)
  }),
  http.post(`${BASE}/notes/:noteId/comments`, async ({ params, request }) => {
    const body = (await request.json()) as { content: string }
    const comment: NoteComment = {
      id: `comment-${Date.now()}`,
      note_id: params.noteId as string,
      author_id: mockUser.id,
      author_display_name: mockUser.display_name,
      content: body.content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    return HttpResponse.json(comment, { status: 201 })
  }),
  http.delete(`${BASE}/notes/:noteId/comments/:commentId`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Notifications
  http.get(`${BASE}/notifications`, () => {
    const response: NotificationListResponse = {
      items: mockNotifications,
      total: 0,
      unread_count: 0,
    }
    return HttpResponse.json(response)
  }),
  http.get(`${BASE}/notifications/unread-count`, () => {
    return HttpResponse.json({ unread_count: 0 })
  }),
  http.post(`${BASE}/notifications/:id/read`, ({ params }) => {
    const notif: Notification = {
      id: params.id as string,
      type: 'note_comment',
      note_id: null,
      comment_id: null,
      is_read: true,
      created_at: new Date().toISOString(),
      note_content_preview: null,
      repo_id: null,
    }
    return HttpResponse.json(notif)
  }),
  http.post(`${BASE}/notifications/read-all`, () => {
    return HttpResponse.json({ marked_read: 0 })
  }),

  // Pull Requests
  http.get(`${BASE}/repos/:id/pull-requests/stats`, () => {
    const stats: PRStats = {
      open_count: 0,
      merged_last_30d: 0,
      avg_days_to_merge: null,
      total_count: 0,
      fetched_at: null,
    }
    return HttpResponse.json(stats)
  }),
  http.get(`${BASE}/repos/:id/pull-requests`, () => {
    const response: PRListResponse = {
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      fetched_at: null,
    }
    return HttpResponse.json(response)
  }),
  http.post(`${BASE}/repos/:id/pull-requests/sync`, ({ params }) => {
    const result: PRSyncResponse = {
      synced: 0,
      repo_id: params.id as string,
      fetched_at: new Date().toISOString(),
    }
    return HttpResponse.json(result)
  }),
]
