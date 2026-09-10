export type UserRole = 'instructor' | 'ta' | 'admin'
export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown'
export type SummaryType = 'repo_overview' | 'contributor_activity' | 'health_explanation'

export interface CommitActivityPoint {
  date: string // YYYY-MM-DD
  count: number
}

export interface CollectionCommitActivity {
  activity: CommitActivityPoint[]
}

export interface User {
  id: string
  email: string
  display_name: string
  role: UserRole
  created_at: string
}

export interface Collection {
  id: string
  name: string
  course_tag: string | null
  semester_tag: string | null
  local_folder_name: string
  owner_id: string
  created_at: string
  updated_at: string
  repo_count: number
  is_archived: boolean
  health_green: number
  health_yellow: number
  health_red: number
  health_unknown: number
}

export interface Repo {
  id: string
  collection_id: string
  github_url: string
  name: string
  local_path: string | null
  health_status: HealthStatus
  health_score: HealthScore | null
  last_synced_at: string | null
  last_commit_at: string | null
  created_at: string
  updated_at: string
  contributor_count: number
  active_reminder_count: number
  expected_contributor_count: number | null
}

export interface HealthScore {
  commit_frequency: number
  recency: number
  distribution: number
  branch_activity: number
  commit_message_quality: number
  participation?: number | null
  composite: number
  status: HealthStatus
}

export interface ContributorAlias {
  id: string
  git_email: string
  git_name: string
}

export interface UnmergeContributorsResponse {
  contributors: Contributor[]
}

export interface Contributor {
  can_unmerge?: boolean
  id: string
  display_name: string
  repo_id: string
  created_at: string
  aliases: ContributorAlias[]
  commit_count: number
  total_insertions: number
  total_deletions: number
  last_commit_at: string | null
}

export interface Commit {
  hash: string
  author_name: string
  author_email: string
  date: string
  message: string
  branches: string[]
  insertions: number
  deletions: number
  files_changed: number
}

export interface NoteComment {
  id: string
  note_id: string
  author_id: string
  author_display_name: string
  content: string
  created_at: string
  updated_at: string
}

export interface Note {
  id: string
  author_id: string
  author_display_name: string
  repo_id: string | null
  contributor_id: string | null
  commit_hash: string | null
  content: string
  is_reminder: boolean
  reminder_context: string | null
  is_checked: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
  comments: NoteComment[]
}

export interface Summary {
  id: string
  repo_id: string | null
  contributor_id: string | null
  summary_type: SummaryType
  content: string
  model_used: string
  generated_at: string
}

export interface AppSettings {
  id: string
  user_id: string
  repo_root_directory: string
  llm_provider: string
  llm_model: string
  anthropic_api_key_configured: boolean
  ollama_base_url: string | null
  health_thresholds: Record<string, unknown> | null
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user_id: string
  display_name: string
  role: UserRole
}

export interface CreateCollectionData {
  name: string
  course_tag?: string | null
  semester_tag?: string | null
  local_folder_name: string
}

export interface UpdateCollectionData {
  name?: string
  course_tag?: string | null
  semester_tag?: string | null
  is_archived?: boolean
}

export interface CreateNoteData {
  content: string
  is_reminder: boolean
  reminder_context?: string | null
  repo_id?: string | null
  contributor_id?: string | null
  commit_hash?: string | null
}

export interface UpdateNoteData {
  content?: string
  is_reminder?: boolean
  reminder_context?: string | null
  is_checked?: boolean
  is_archived?: boolean
}

export interface UserSummary {
  id: string
  display_name: string
  email: string
  role: string
}

export interface UserDetail {
  id: string
  email: string
  display_name: string
  role: 'instructor' | 'ta' | 'admin'
  github_token_configured: boolean
  created_at: string
  updated_at: string
}

export interface CreateUserData {
  email: string
  display_name: string
  role: 'instructor' | 'ta' | 'admin'
  password: string
  github_token?: string
}

export interface UpdateUserData {
  display_name?: string
  role?: 'instructor' | 'ta' | 'admin'
  github_token?: string
}

export interface PatchMeData {
  display_name?: string
  github_token?: string
}

export interface ChangePasswordData {
  current_password: string
  new_password: string
}

export interface CollectionAccessEntry {
  id: string
  collection_id: string
  user_id: string
  user_display_name: string
  user_email: string
  user_role: string
  access_role: 'co_instructor' | 'ta'
  created_at: string
}

export interface Notification {
  id: string
  type: 'mention' | 'note_comment'
  note_id: string | null
  comment_id: string | null
  is_read: boolean
  created_at: string
  note_content_preview: string | null
  repo_id: string | null
}

export interface NotificationListResponse {
  items: Notification[]
  total: number
  unread_count: number
}

export interface GenerateSummaryData {
  repo_id?: string | null
  contributor_id?: string | null
  summary_type: SummaryType
}

export interface UpdateSettingsData {
  repo_root_directory?: string
  llm_provider?: string
  llm_model?: string
  anthropic_api_key?: string
  ollama_base_url?: string | null
  health_thresholds?: Record<string, unknown> | null
}

export interface GetCommitsParams {
  limit?: number
  offset?: number
  branch?: string
  author_email?: string
}

export interface GetNotesParams {
  repo_id?: string
  contributor_id?: string
  commit_hash?: string
}

export interface ScoredCommit {
  hash: string
  full_hash: string
  message: string
  author: string
  date: string
  score: 'good' | 'ok' | 'bad'
  from_cache: boolean
}

export interface RepoCommitQuality {
  repo_id: string
  repo_name: string
  commits: ScoredCommit[]
  cache_hits: number
  newly_scored: number
}

export interface CommitQualityResponse {
  repos: RepoCommitQuality[]
  model_used: string
  repos_skipped: number
  total_cache_hits: number
  total_newly_scored: number
}

export interface PullRequest {
  id: string
  repo_id: string
  pr_number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  author_login: string
  created_at: string | null
  merged_at: string | null
  closed_at: string | null
  html_url: string
  reviews_requested: number
  draft: boolean
  fetched_at: string
}

export interface PRStats {
  open_count: number
  merged_last_30d: number
  avg_days_to_merge: number | null
  total_count: number
  fetched_at: string | null
}

export interface PRListResponse {
  items: PullRequest[]
  total: number
  limit: number
  offset: number
  fetched_at: string | null
}

export interface PRSyncResponse {
  synced: number
  repo_id: string
  fetched_at: string
}

export interface ContextActivityPoint extends CommitActivityPoint {
  ts: number
  context: string
}
export interface StudentActivity {
  id: string
  name: string
  activity: CommitActivityPoint[]
}
export interface RepositoryActivity {
  id: string
  name: string
  available: boolean
  activity: CommitActivityPoint[]
  students: StudentActivity[]
}
export interface ContextualActivity {
  repositories: RepositoryActivity[]
}
