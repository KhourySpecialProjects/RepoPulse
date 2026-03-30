import axios from 'axios'
import type {
  TokenResponse,
  Collection,
  CreateCollectionData,
  UpdateCollectionData,
  Repo,
  HealthScore,
  Contributor,
  Commit,
  Note,
  CreateNoteData,
  UpdateNoteData,
  Summary,
  GenerateSummaryData,
  AppSettings,
  UpdateSettingsData,
  PaginatedResponse,
  GetCommitsParams,
  GetNotesParams,
  UserDetail,
  CreateUserData,
  UpdateUserData,
  PatchMeData,
  ChangePasswordData,
  CollectionAccessEntry,
  NoteComment,
  Notification,
  NotificationListResponse,
  CommitQualityResponse,
  PRListResponse,
  PRStats,
  PRSyncResponse,
} from '@/types'

const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export function setAuthToken(token: string) {
  localStorage.setItem('auth_token', token)
}

export function clearAuthToken() {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_user')
}

// Auth
export async function devLogin(userId: string): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/dev-login', { user_id: userId })
  return response.data
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/login', { email, password })
  return response.data
}

// Collections
export async function getCollections(limit = 50, offset = 0, includeArchived = false): Promise<PaginatedResponse<Collection>> {
  const response = await apiClient.get<PaginatedResponse<Collection>>('/collections', {
    params: { limit, offset, include_archived: includeArchived },
  })
  return response.data
}

export async function createCollection(data: CreateCollectionData): Promise<Collection> {
  const response = await apiClient.post<Collection>('/collections', data)
  return response.data
}

export async function getCollection(id: string): Promise<Collection> {
  const response = await apiClient.get<Collection>(`/collections/${id}`)
  return response.data
}

export async function updateCollection(id: string, data: UpdateCollectionData): Promise<Collection> {
  const response = await apiClient.patch<Collection>(`/collections/${id}`, data)
  return response.data
}

export async function deleteCollection(id: string): Promise<void> {
  await apiClient.delete(`/collections/${id}`)
}

export async function syncCollection(id: string): Promise<void> {
  await apiClient.post(`/collections/${id}/sync`)
}

// Repos
export async function getRepos(collectionId: string, limit = 50, offset = 0): Promise<PaginatedResponse<Repo>> {
  const response = await apiClient.get<PaginatedResponse<Repo>>(`/collections/${collectionId}/repos`, {
    params: { limit, offset },
  })
  return response.data
}

export async function addRepos(collectionId: string, urls: string[]): Promise<Repo[]> {
  const response = await apiClient.post<Repo[]>(`/collections/${collectionId}/repos`, { urls })
  return response.data
}

export async function getRepo(id: string): Promise<Repo> {
  const response = await apiClient.get<Repo>(`/repos/${id}`)
  return response.data
}

export async function deleteRepo(id: string): Promise<void> {
  await apiClient.delete(`/repos/${id}`)
}

export async function syncRepo(id: string): Promise<void> {
  await apiClient.post(`/repos/${id}/sync`)
}

export async function patchRepo(id: string, data: { expected_contributor_count?: number | null }): Promise<Repo> {
  const response = await apiClient.patch<Repo>(`/repos/${id}`, data)
  return response.data
}

export async function getRepoHealth(id: string): Promise<HealthScore> {
  const response = await apiClient.get<HealthScore>(`/repos/${id}/health`)
  return response.data
}

export async function getRepoCommits(id: string, params?: GetCommitsParams): Promise<PaginatedResponse<Commit>> {
  const response = await apiClient.get<PaginatedResponse<Commit>>(`/repos/${id}/commits`, { params })
  return response.data
}

export async function getRepoContributors(id: string): Promise<Contributor[]> {
  const response = await apiClient.get<Contributor[]>(`/repos/${id}/contributors`)
  return response.data
}

// Contributors
export async function getContributor(id: string): Promise<Contributor> {
  const response = await apiClient.get<Contributor>(`/contributors/${id}`)
  return response.data
}

export async function updateContributor(id: string, displayName: string): Promise<Contributor> {
  const response = await apiClient.put<Contributor>(`/contributors/${id}`, { display_name: displayName })
  return response.data
}

export async function mergeContributors(ids: string[], displayName: string): Promise<Contributor> {
  const response = await apiClient.post<Contributor>('/contributors/merge', { contributor_ids: ids, display_name: displayName })
  return response.data
}

export async function getContributorAliases(id: string): Promise<Contributor> {
  const response = await apiClient.get<Contributor>(`/contributors/${id}/aliases`)
  return response.data
}

// Notes
export async function getNotes(params?: GetNotesParams): Promise<Note[]> {
  const response = await apiClient.get<PaginatedResponse<Note>>('/notes', { params })
  return response.data.items
}

export async function createNote(data: CreateNoteData): Promise<Note> {
  const response = await apiClient.post<Note>('/notes', data)
  return response.data
}

export async function updateNote(id: string, data: UpdateNoteData): Promise<Note> {
  const response = await apiClient.patch<Note>(`/notes/${id}`, data)
  return response.data
}

export async function deleteNote(id: string): Promise<void> {
  await apiClient.delete(`/notes/${id}`)
}

// Summaries
export async function generateSummary(data: GenerateSummaryData): Promise<Summary> {
  const response = await apiClient.post<Summary>('/summaries/generate', data)
  return response.data
}

export async function getRepoSummaries(repoId: string): Promise<Summary[]> {
  const response = await apiClient.get<Summary[]>(`/repos/${repoId}/summaries`)
  return response.data
}

export async function getContributorSummaries(contributorId: string): Promise<Summary[]> {
  const response = await apiClient.get<Summary[]>(`/contributors/${contributorId}/summaries`)
  return response.data
}

// Settings
export async function getSettings(): Promise<AppSettings> {
  const response = await apiClient.get<AppSettings>('/settings')
  return response.data
}

export async function getOllamaModels(baseUrl: string): Promise<string[]> {
  const response = await apiClient.get<string[]>('/settings/ollama-models', {
    params: { base_url: baseUrl },
  })
  return response.data
}

export async function updateSettings(data: UpdateSettingsData): Promise<AppSettings> {
  const response = await apiClient.patch<AppSettings>('/settings', data)
  return response.data
}

// Users
export async function getUsers(params?: { collection_id?: string }): Promise<UserDetail[]> {
  const res = await apiClient.get<{ items: UserDetail[]; total: number }>('/users', { params })
  return res.data.items
}

export async function getCurrentUser(): Promise<UserDetail> {
  const res = await apiClient.get<UserDetail>('/users/me')
  return res.data
}

export async function updateCurrentUser(data: PatchMeData): Promise<UserDetail> {
  const res = await apiClient.patch<UserDetail>('/users/me', data)
  return res.data
}

export async function changePassword(data: ChangePasswordData): Promise<UserDetail> {
  const res = await apiClient.post<UserDetail>('/users/me/change-password', data)
  return res.data
}

export async function createUser(data: CreateUserData): Promise<UserDetail> {
  const res = await apiClient.post<UserDetail>('/users', data)
  return res.data
}

export async function updateUser(id: string, data: UpdateUserData): Promise<UserDetail> {
  const res = await apiClient.patch<UserDetail>(`/users/${id}`, data)
  return res.data
}

export async function deleteUser(id: string): Promise<void> {
  await apiClient.delete(`/users/${id}`)
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  await apiClient.post(`/users/${id}/reset-password`, { new_password: newPassword })
}

// Collection access
export async function getCollectionAccess(collectionId: string): Promise<CollectionAccessEntry[]> {
  const res = await apiClient.get<{ items: CollectionAccessEntry[]; total: number }>(`/collections/${collectionId}/access`)
  return res.data.items
}

export async function addCollectionAccess(
  collectionId: string,
  userId: string,
  accessRole: 'co_instructor' | 'ta'
): Promise<CollectionAccessEntry> {
  const res = await apiClient.post<CollectionAccessEntry>(`/collections/${collectionId}/access`, {
    user_id: userId,
    access_role: accessRole,
  })
  return res.data
}

export async function removeCollectionAccess(collectionId: string, userId: string): Promise<void> {
  await apiClient.delete(`/collections/${collectionId}/access/${userId}`)
}

// Note comments
export async function getNoteComments(noteId: string): Promise<NoteComment[]> {
  const res = await apiClient.get<NoteComment[]>(`/notes/${noteId}/comments`)
  return res.data
}

export async function createNoteComment(noteId: string, content: string): Promise<NoteComment> {
  const res = await apiClient.post<NoteComment>(`/notes/${noteId}/comments`, { content })
  return res.data
}

export async function deleteNoteComment(noteId: string, commentId: string): Promise<void> {
  await apiClient.delete(`/notes/${noteId}/comments/${commentId}`)
}

// Notifications
export async function getNotifications(params?: {
  unread_only?: boolean
  limit?: number
  offset?: number
}): Promise<NotificationListResponse> {
  const res = await apiClient.get<NotificationListResponse>('/notifications', { params })
  return res.data
}

export async function getUnreadCount(): Promise<{ unread_count: number }> {
  const res = await apiClient.get<{ unread_count: number }>('/notifications/unread-count')
  return res.data
}

export async function markNotificationRead(id: string): Promise<Notification> {
  const res = await apiClient.post<Notification>(`/notifications/${id}/read`)
  return res.data
}

export async function markAllNotificationsRead(): Promise<{ marked_read: number }> {
  const res = await apiClient.post<{ marked_read: number }>('/notifications/read-all')
  return res.data
}

// Commit Quality
export async function getCommitQuality(
  collectionId: string,
  perRepo = 15
): Promise<CommitQualityResponse> {
  const res = await apiClient.get<CommitQualityResponse>(
    `/collections/${collectionId}/commit-quality`,
    { params: { per_repo: perRepo } }
  )
  return res.data
}

// Pull Requests
export async function getPullRequests(repoId: string, state?: string, limit = 10, offset = 0): Promise<PRListResponse> {
  const response = await apiClient.get<PRListResponse>(`/repos/${repoId}/pull-requests`, {
    params: { ...(state ? { state } : {}), limit, offset },
  })
  return response.data
}

export async function getPRStats(repoId: string): Promise<PRStats> {
  const response = await apiClient.get<PRStats>(`/repos/${repoId}/pull-requests/stats`)
  return response.data
}

export async function syncPullRequests(repoId: string): Promise<PRSyncResponse> {
  const response = await apiClient.post<PRSyncResponse>(`/repos/${repoId}/pull-requests/sync`)
  return response.data
}

export default apiClient
