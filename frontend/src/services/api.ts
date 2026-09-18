import axios from 'axios'
import type {
  AdminAttention,
  AdminLlmUsage,
  AdminOverview,
  AdminPipeline,
  AdminRecalculateResult,
  AdminRepoSizeSort,
  AdminRepoStorageItem,
  AdminStorageSummary,
  AdminSystemStatus,
  AppSettings,
  ChangePasswordData,
  ClassifyCommitsResponse,
  Collection,
  CollectionAccessEntry,
  CollectionCommitActivity,
  CommitQualityResponse,
  CommitsResponse,
  Contributor,
  CreateCollectionData,
  CreateNoteData,
  CreateUserData,
  CreateUserResponse,
  GenerateSummaryData,
  GetCommitsParams,
  GetNotesParams,
  HealthScore,
  LlmConfig,
  Note,
  NoteComment,
  Notification,
  NotificationListResponse,
  NotificationPreferences,
  PRListResponse,
  PRStats,
  PRSyncResponse,
  PaginatedResponse,
  PatchMeData,
  RecentlyDeletedListResponse,
  ReminderListResponse,
  Repo,
  Summary,
  SetupLink,
  SetupTokenInfo,
  TokenQuota,
  TokenResponse,
  TokenUsageSummary,
  UnmergeContributorsResponse,
  UpdateCollectionData,
  UpdateLlmConfigData,
  UpdateNoteData,
  UpdateNotificationPreferencesData,
  UpdateSettingsData,
  UpdateUserData,
  UserDetail,
  UserTokenUsage,
  UserTokenUsageListResponse,
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

/**
 * Endpoints where a 401 is the answer to credentials the user just typed, not
 * a session that expired. Signing out and reloading the page on one of those
 * would throw away the caller's own error message before it could be read —
 * the login form would blank itself the instant you got the password wrong.
 */
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/dev-login', '/auth/account-setup']

function answersSubmittedCredentials(url: string | undefined): boolean {
  if (!url) return false
  return CREDENTIAL_ENDPOINTS.some((endpoint) => url.startsWith(endpoint))
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !answersSubmittedCredentials(error.config?.url)) {
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
const AUTH_TIMEOUT_MS = 10_000

export async function devLogin(userId: string): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/dev-login', { user_id: userId }, {
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  })
  return response.data
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/login', { email, password }, {
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  })
  return response.data
}

/**
 * Check an account setup link and find out who it belongs to. Rejects with a
 * 400 (never a 401) when the link is unusable, so the response interceptor
 * above does not redirect the recipient away from the setup page.
 */
export async function verifySetupToken(token: string): Promise<SetupTokenInfo> {
  const response = await apiClient.post<SetupTokenInfo>('/auth/account-setup/verify', { token }, {
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  })
  return response.data
}

/**
 * Redeem a setup link, setting the password and signing the user in.
 *
 * `githubToken` is omitted from the body when blank rather than sent as an
 * empty string: the backend reads a present-but-empty value the same way, but
 * a reset link redeemed with an untouched field should not even look like a
 * request to clear the token already on the account.
 */
export async function completeAccountSetup(
  token: string,
  newPassword: string,
  githubToken?: string
): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/account-setup/complete', {
    token,
    new_password: newPassword,
    ...(githubToken ? { github_token: githubToken } : {}),
  }, {
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  })
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

export async function getCollectionCommitActivity(collectionId: string): Promise<CollectionCommitActivity> {
  const response = await apiClient.get<CollectionCommitActivity>(`/collections/${collectionId}/commit-activity`)
  return response.data
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

export async function getRepoCommits(id: string, params?: GetCommitsParams): Promise<CommitsResponse> {
  const response = await apiClient.get<CommitsResponse>(`/repos/${id}/commits`, { params })
  return response.data
}

export async function getRepoContributors(id: string): Promise<Contributor[]> {
  const response = await apiClient.get<Contributor[]>(`/repos/${id}/contributors`)
  return response.data
}

// Contributors
export async function updateContributor(id: string, displayName: string): Promise<Contributor> {
  const response = await apiClient.put<Contributor>(`/contributors/${id}`, { display_name: displayName })
  return response.data
}

export async function mergeContributors(ids: string[], displayName: string): Promise<Contributor> {
  const response = await apiClient.post<Contributor>('/contributors/merge', { contributor_ids: ids, display_name: displayName })
  return response.data
}

export async function unmergeContributor(id: string): Promise<UnmergeContributorsResponse> {
  const response = await apiClient.post<UnmergeContributorsResponse>(`/contributors/${id}/unmerge`)
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

/** The signed-in user's own AI token usage. Any role may read this. */
export async function getMyTokenUsage(): Promise<TokenQuota> {
  const response = await apiClient.get<TokenQuota>('/settings/token-usage')
  return response.data
}

// Shared LLM configuration and token limits (admin only)
export async function getLlmConfig(): Promise<LlmConfig> {
  const response = await apiClient.get<LlmConfig>('/admin/llm-config')
  return response.data
}

export async function updateLlmConfig(data: UpdateLlmConfigData): Promise<LlmConfig> {
  const response = await apiClient.patch<LlmConfig>('/admin/llm-config', data)
  return response.data
}

export async function getTokenUsageSummary(): Promise<TokenUsageSummary> {
  const response = await apiClient.get<TokenUsageSummary>(
    '/admin/token-usage/summary'
  )
  return response.data
}

export async function getTokenUsage(params?: {
  limit?: number
  offset?: number
}): Promise<UserTokenUsageListResponse> {
  const response = await apiClient.get<UserTokenUsageListResponse>(
    '/admin/token-usage',
    { params }
  )
  return response.data
}

/**
 * Set or clear one user's monthly allowance.
 *
 * `null` clears the override so the user follows the instance default; `0`
 * revokes their AI access. The parameter is required so those two cannot be
 * confused with an accidental omission.
 */
export async function setUserTokenLimit(
  userId: string,
  monthlyTokenLimit: number | null
): Promise<UserTokenUsage> {
  const response = await apiClient.patch<UserTokenUsage>(
    `/admin/users/${userId}/token-limit`,
    { monthly_token_limit: monthlyTokenLimit }
  )
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

export async function createUser(data: CreateUserData): Promise<CreateUserResponse> {
  const res = await apiClient.post<CreateUserResponse>('/users', data)
  return res.data
}

export async function updateUser(id: string, data: UpdateUserData): Promise<UserDetail> {
  const res = await apiClient.patch<UserDetail>(`/users/${id}`, data)
  return res.data
}

export async function deleteUser(id: string): Promise<void> {
  await apiClient.delete(`/users/${id}`)
}

/**
 * Mint a fresh setup link for an existing user — this is how a password gets
 * reset. The admin hands the link over instead of choosing a password.
 */
export async function generateSetupLink(id: string): Promise<SetupLink> {
  const res = await apiClient.post<SetupLink>(`/users/${id}/setup-link`)
  return res.data
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
  const res = await apiClient.patch<Notification>(`/notifications/${id}/read`)
  return res.data
}

export async function getReminders(): Promise<ReminderListResponse> {
  const res = await apiClient.get<ReminderListResponse>('/notifications/reminders')
  return res.data
}

export async function markNotificationUnread(id: string): Promise<Notification> {
  const res = await apiClient.patch<Notification>(`/notifications/${id}/unread`)
  return res.data
}

export async function markAllNotificationsUnread(): Promise<{ marked_unread: number }> {
  const res = await apiClient.post<{ marked_unread: number }>(
    '/notifications/mark-all-unread'
  )
  return res.data
}

export async function markAllNotificationsRead(): Promise<{ marked_read: number }> {
  const res = await apiClient.post<{ marked_read: number }>('/notifications/mark-all-read')
  return res.data
}

// Which events this account wants to be notified about
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await apiClient.get<NotificationPreferences>('/notifications/preferences')
  return res.data
}

export async function updateNotificationPreferences(
  data: UpdateNotificationPreferencesData
): Promise<NotificationPreferences> {
  // A partial map: the server merges it over what is stored, so sending one
  // toggled event cannot reset the others.
  const res = await apiClient.put<NotificationPreferences>(
    '/notifications/preferences',
    data
  )
  return res.data
}

// Commit Quality
// Commit Classification
export async function classifyRepoCommits(
  repoId: string,
  confirm = false
): Promise<ClassifyCommitsResponse> {
  // No per-request timeout: a confirmed run on a large repo legitimately takes
  // minutes. The backend's preview threshold and per-request cap are what keep
  // that bounded, not a client-side clock.
  const res = await apiClient.post<ClassifyCommitsResponse>(
    `/repos/${repoId}/commits/classify`,
    { confirm }
  )
  return res.data
}

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

export async function getContextualActivity(collectionId: string): Promise<import('@/types').ContextualActivity> {
  const response = await apiClient.get<import('@/types').ContextualActivity>(`/collections/${collectionId}/contextual-activity`)
  return response.data
}

// ── Recently deleted (soft delete) ──────────────────────────────────────────

export async function getRecentlyDeleted(): Promise<RecentlyDeletedListResponse> {
  const res = await apiClient.get<RecentlyDeletedListResponse>('/notifications/recently-deleted')
  return res.data
}

/** Moves a notification to Recently deleted rather than destroying it. */
export async function dismissNotification(id: string): Promise<void> {
  await apiClient.delete(`/notifications/${id}`)
}

export async function restoreNotification(id: string): Promise<void> {
  await apiClient.post(`/notifications/${id}/restore`)
}

export async function purgeNotification(id: string): Promise<void> {
  await apiClient.delete(`/notifications/${id}/permanent`)
}

export async function restoreNote(id: string): Promise<void> {
  await apiClient.post(`/notes/${id}/restore`)
}

export async function purgeNote(id: string): Promise<void> {
  await apiClient.delete(`/notes/${id}/permanent`)
}

// ---------------------------------------------------------------------------
// Admin
//
// Instance-wide, admin-gated. Every one of these 403s for a non-admin
// server-side; the client-side role check is presentation only.
// These return the response envelope as-is rather than unwrapping to a bare
// array — unwrapping is what made getUsers and its MSW handler disagree.
// ---------------------------------------------------------------------------

export async function getAdminStorage(
  includeOrphanSize = false,
): Promise<AdminStorageSummary> {
  const res = await apiClient.get<AdminStorageSummary>('/admin/storage', {
    params: { include_orphan_size: includeOrphanSize },
  })
  return res.data
}

export async function getAdminRepoStorage(params?: {
  limit?: number
  offset?: number
  sort?: AdminRepoSizeSort
  collection_id?: string
}): Promise<PaginatedResponse<AdminRepoStorageItem>> {
  const res = await apiClient.get<PaginatedResponse<AdminRepoStorageItem>>(
    '/admin/storage/repos',
    { params },
  )
  return res.data
}

export async function recalculateAdminStorage(body?: {
  repo_ids?: string[]
  collection_id?: string
}): Promise<AdminRecalculateResult> {
  const res = await apiClient.post<AdminRecalculateResult>(
    '/admin/storage/recalculate',
    body ?? {},
  )
  return res.data
}

export async function getAdminOverview(
  staleAfterDays = 7,
): Promise<AdminOverview> {
  const res = await apiClient.get<AdminOverview>('/admin/overview', {
    params: { stale_after_days: staleAfterDays },
  })
  return res.data
}

export async function getAdminSystem(): Promise<AdminSystemStatus> {
  const res = await apiClient.get<AdminSystemStatus>('/admin/system')
  return res.data
}

export async function getAdminLlmUsage(days = 30): Promise<AdminLlmUsage> {
  const res = await apiClient.get<AdminLlmUsage>('/admin/llm-usage', {
    params: { days },
  })
  return res.data
}

export async function getAdminPipeline(): Promise<AdminPipeline> {
  const res = await apiClient.get<AdminPipeline>('/admin/pipeline')
  return res.data
}

export async function getAdminAttention(params?: {
  limit?: number
  offset?: number
  stale_after_days?: number
}): Promise<AdminAttention> {
  const res = await apiClient.get<AdminAttention>('/admin/attention', {
    params,
  })
  return res.data
}
