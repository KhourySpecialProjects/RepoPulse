export type UserRole = 'instructor' | 'ta' | 'admin'
export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown'
export type SummaryType = 'repo_overview' | 'contributor_activity' | 'health_explanation'

/** Does this commit advance the project, or keep it tidy? */
export type CommitType = 'substantive' | 'logistical'
/** LLM-rated quality of the commit *message*, independent of CommitType. */
export type CommitQualityScore = 'good' | 'ok' | 'bad'
/** `unclassified` is a filter value only — it never appears on a commit. */
export type CommitTypeFilter = CommitType | 'unclassified'

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
  /**
   * Sync state is shared, not per-session: a sync started by a TA reads as
   * `syncing` for everyone with access to the collection until it finishes.
   */
  sync_status: SyncStatus
  sync_started_at: string | null
  sync_started_by_name: string | null
  sync_error: string | null
}

export type SyncStatus = 'idle' | 'syncing' | 'failed'

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
  // Every branch containing the commit — drives the "merged to main" badge.
  branches: string[]
  // The single branch the work was done on; what the branch filter matches.
  origin_branch: string
  insertions: number
  deletions: number
  files_changed: number
  /** null until the repo is classified — render as a dash, never a default. */
  commit_type: CommitType | null
  /** Populated by classification, or by the collection-level quality pass. */
  quality_score: CommitQualityScore | null
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
  remind_at: string | null
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
  /** Instructor rubric added to the built-in criteria. '' means no addendum. */
  commit_evaluation_criteria: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

/**
 * Commits, plus whether they are live.
 *
 * `stale` means the local clone could not be read and these came from the
 * snapshot written at the last successful sync — worth saying out loud, since
 * anything committed since then is missing.
 */
export interface CommitsResponse extends PaginatedResponse<Commit> {
  stale: boolean
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
  remind_at?: string | null
  /** User ids to share a reminder with. Reminders only. */
  shared_with?: string[]
  repo_id?: string | null
  contributor_id?: string | null
  commit_hash?: string | null
}

export interface UpdateNoteData {
  content?: string
  is_reminder?: boolean
  reminder_context?: string | null
  remind_at?: string | null
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

/**
 * Every notification the backend can raise.
 *
 * The first three are note-scoped and read their text from the linked note.
 * The rest are repo-scoped course activity and carry their own subject/body.
 */
export type NotificationEvent =
  | 'mention'
  | 'note_comment'
  | 'reminder'
  | 'repo_added'
  | 'repo_removed'
  | 'repo_health_declined'
  | 'pr_opened'
  | 'pr_merged'

export interface Notification {
  id: string
  type: NotificationEvent
  note_id: string | null
  comment_id: string | null
  is_read: boolean
  created_at: string
  note_content_preview: string | null
  repo_id: string | null
  /**
   * The commit the underlying note was written against, when there is one.
   * Lets a click deep-link to that commit rather than just the repo.
   */
  commit_hash: string | null
  /** Set on repo-scoped events only. */
  subject: string | null
  body: string | null
}

export interface NotificationListResponse {
  items: Notification[]
  total: number
  unread_count: number
}

/**
 * Which events this account wants to be notified about.
 *
 * Per user, not per instance: a TA and a professor on the same collection each
 * have their own map. Always complete — the server merges defaults in — so the
 * UI can render the full list without guessing.
 */
export interface NotificationPreferences {
  subscribed_events: Record<NotificationEvent, boolean>
}

/** A partial update: send only the events being changed. */
export interface UpdateNotificationPreferencesData {
  subscribed_events: Partial<Record<NotificationEvent, boolean>>
}

/** An outstanding reminder, as shown in the notifications panel. */
export interface Reminder {
  id: string
  content: string
  /** Optional: a reminder with no due date never fires, but is still a to-do. */
  remind_at: string | null
  reminder_context: string | null
  repo_id: string | null
  commit_hash: string | null
  created_at: string
  owner_display_name: string
  /** Display names of the other people this reminder is shared with. */
  shared_with: string[]
  is_owner: boolean
}

export interface ReminderListResponse {
  items: Reminder[]
  total: number
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
  commit_evaluation_criteria?: string
}

export interface GetCommitsParams {
  limit?: number
  offset?: number
  branch?: string
  author_email?: string
  commit_type?: CommitTypeFilter
}

/** Response from POST /repos/{id}/commits/classify.
 *
 * `status: 'preview'` means nothing was written and the caller should confirm.
 * `skipped` is retryable failure; `remaining` is deferred work — keeping them
 * apart is what lets the UI say whether clicking again will help.
 */
export interface ClassifyCommitsResponse {
  status: 'preview' | 'completed'
  total_commits: number
  already_classified: number
  pending: number
  resolvable_by_rules: number
  needs_llm: number
  classified_by_rules: number
  classified_by_llm: number
  classified: number
  skipped: number
  remaining: number
  threshold: number
  model_used: string
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
  /** null when the LLM call failed or its answer could not be read. */
  score: CommitQualityScore | null
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

/** Why a day is marked on the activity graph. Drives the marker colour and the
 *  graph's legend, so the reason is readable without opening a tooltip. */
export type ActivityContextKind = 'burst-unusual' | 'burst-deadline' | 'quiet'

export interface ContextActivityPoint extends CommitActivityPoint {
  ts: number
  context: string
  /** null on an unremarkable day — no marker, no legend entry. */
  kind: ActivityContextKind | null
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
  /** True when the history came from the last sync's snapshot, not the clone. */
  stale?: boolean
  activity: CommitActivityPoint[]
  students: StudentActivity[]
}
export interface ContextualActivity {
  repositories: RepositoryActivity[]
}

/** A soft-deleted notification or reminder, restorable until purged. */
export interface RecentlyDeletedItem {
  id: string
  kind: 'notification' | 'reminder'
  label: string
  detail: string | null
  deleted_at: string
}

export interface RecentlyDeletedListResponse {
  items: RecentlyDeletedItem[]
  total: number
}

// ---------------------------------------------------------------------------
// Admin dashboard
//
// Byte counts are always integers; formatting happens once in lib/formatBytes.
// ---------------------------------------------------------------------------

export interface AdminDiskUsage {
  root: string
  /** false when REPO_ROOT_DIR is not mounted — distinct from an empty disk. */
  exists: boolean
  total_bytes: number
  used_bytes: number
  free_bytes: number
  percent_used: number
}

export interface AdminCloneStorage {
  measured_repos: number
  /** NULL size_bytes: never measured, as distinct from measured-and-empty. */
  unmeasured_repos: number
  total_bytes: number
  git_bytes: number
  oldest_measurement: string | null
  newest_measurement: string | null
}

export interface AdminTableStat {
  table_name: string
  total_bytes: number
  table_bytes: number
  index_bytes: number
  /** Exact count(*) — the one to display. */
  row_count: number
  /** Planner estimate; reads 0 until autovacuum runs. */
  row_estimate: number
}

export interface AdminDriftItem {
  path: string | null
  repo_id: string | null
  repo_name: string | null
  collection_name: string | null
}

export interface AdminStorageDrift {
  orphan_directories: AdminDriftItem[]
  missing_clones: AdminDriftItem[]
  /** null unless include_orphan_size was requested. */
  orphan_bytes: number | null
}

export interface AdminStorageSummary {
  disk: AdminDiskUsage
  clones: AdminCloneStorage
  database_bytes: number
  tables: AdminTableStat[]
  drift: AdminStorageDrift
  repo_root_dir: string
  generated_at: string
}

export type AdminRepoSizeSort = 'size_desc' | 'size_asc' | 'name_asc' | 'measured_asc'

export interface AdminRepoStorageItem {
  id: string
  name: string
  collection_id: string
  collection_name: string
  local_path: string | null
  size_bytes: number | null
  git_size_bytes: number | null
  worktree_bytes: number | null
  size_computed_at: string | null
}

export interface AdminRecalculateResult {
  requested: number
  measured: number
  skipped_missing: number
  failed: number
  total_bytes: number
  duration_ms: number
  computed_at: string
}

export interface AdminEntityCounts {
  users: number
  admins: number
  instructors: number
  tas: number
  collections: number
  archived_collections: number
  repos: number
  contributors: number
  notes: number
  note_comments: number
  summaries: number
  commit_classifications: number
  pull_requests: number
  notifications: number
  collection_access: number
}

/** Always all four statuses, zero-filled — never a missing key. */
export interface AdminHealthDistribution {
  green: number
  yellow: number
  red: number
  unknown: number
}

export interface AdminSyncFreshness {
  total: number
  never_synced: number
  stale: number
  fresh: number
  stale_after_days: number
  most_recent_sync: string | null
  oldest_sync: string | null
}

export interface AdminOverview {
  counts: AdminEntityCounts
  health: AdminHealthDistribution
  sync: AdminSyncFreshness
  generated_at: string
}

export interface AdminSystemStatus {
  status: 'ok' | 'degraded'
  server_time: string
  database: 'ok' | 'unreachable'
  schema_revision: string | null
  schema_head: string | null
  /** null when the revision cannot be read — unknown, not up-to-date. */
  schema_up_to_date: boolean | null
  auth_mode: string
  dev_login_enabled: boolean
  admin_count: number
  repo_root_dir: string
  repo_root_exists: boolean
  repo_root_writable: boolean
  /** Booleans only — the API never returns key material. */
  anthropic_api_key_configured: boolean
  github_token_configured: boolean
  default_llm_provider: string
  default_llm_model: string
  git_version: string | null
}

export interface AdminLlmModelUsage {
  kind: 'summary' | 'commit_classification'
  model: string
  calls: number
  first_at: string | null
  last_at: string | null
}

export interface AdminLlmDailyUsage {
  day: string
  kind: string
  calls: number
}

export interface AdminLlmOwnerUsage {
  user_id: string
  display_name: string
  calls: number
}

/**
 * Deliberately carries no cost and no failure count — neither is derivable
 * from what the backend persists. See the LlmUsage schema docstring.
 */
export interface AdminLlmUsage {
  window_days: number
  total_calls: number
  by_model: AdminLlmModelUsage[]
  daily: AdminLlmDailyUsage[]
  by_collection_owner: AdminLlmOwnerUsage[]
  unattributed_summaries: number
  models_in_use: string[]
  retired_models_in_use: string[]
  current_default_model: string
  generated_at: string
}

// ---------------------------------------------------------------------------
// Admin pipeline health
//
// This block answers "is the application working", not "how are the students
// doing". Health data appears only as coverage — unknown status and a null
// health_score both mean the scoring pipeline did not run. The
// green/yellow/red spread is an instructor concern and is not served here.
// ---------------------------------------------------------------------------

/** All three states always present, zero-filled. */
export interface AdminSyncStateCounts {
  idle: number
  syncing: number
  failed: number
}

/**
 * Repos grouped by identical sync_error.
 *
 * Grouped because the shape of the failure is the diagnosis: twelve repos
 * failing on one credential is one problem, not twelve.
 */
export interface AdminSyncErrorGroup {
  error: string
  repos: number
  example_repo_name: string
  last_seen: string | null
}

export type AdminAgeBucketKey =
  | 'lt1d'
  | '1to3d'
  | '3to7d'
  | '7to30d'
  | 'gt30d'
  | 'never'

/** `never` is its own bucket, not an infinite age — it sits off the ramp. */
export interface AdminAgeBucket {
  key: AdminAgeBucketKey
  label: string
  repos: number
}

export type AdminCoverageGapKey =
  | 'no_health_score'
  | 'unknown_health'
  | 'unmeasured_clone'
  | 'missing_clone'
  | 'orphan_directory'
  | 'unattributed_summary'

/** Always carries its own `total`: the denominators genuinely differ per gap. */
export interface AdminCoverageGap {
  key: AdminCoverageGapKey
  label: string
  affected: number
  total: number
}

export interface AdminPipeline {
  sync_state: AdminSyncStateCounts
  sync_errors: AdminSyncErrorGroup[]
  /** Over last_synced_at (when we pulled), never last_commit_at. */
  sync_age: AdminAgeBucket[]
  coverage: AdminCoverageGap[]
  generated_at: string
}

// ---------------------------------------------------------------------------
// Admin attention
// ---------------------------------------------------------------------------

/**
 * Operational codes only. There is deliberately no `health_red`: a failing
 * student project is an instructor's problem, and listing it here would bury
 * the faults only an admin can fix.
 */
export type AdminAttentionCode =
  | 'sync_failed'
  | 'never_synced'
  | 'stale_sync'
  | 'clone_missing'
  | 'unmeasured'
  | 'no_health_data'

export interface AdminAttentionReason {
  code: AdminAttentionCode
  label: string
}

export interface AdminAttentionRepo {
  id: string
  name: string
  collection_id: string
  collection_name: string
  sync_status: string
  sync_error: string | null
  last_synced_at: string | null
  local_path: string | null
  reasons: AdminAttentionReason[]
  severity: number
}

export interface AdminAttention {
  items: AdminAttentionRepo[]
  total: number
  limit: number
  offset: number
  generated_at: string
}
