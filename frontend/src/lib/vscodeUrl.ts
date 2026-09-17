/** The scp-like SSH remote form, which is not a parseable URL: `git@github.com:owner/repo.git`. */
const SSH_SHORTHAND = /^[^@/\s]+@([^:/\s]+):(.+)$/

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * Map a repo's GitHub URL to the vscode.dev URL that opens it in the browser.
 *
 * The single place the vscode.dev URL is spelled. It used to be an inline
 * `vscode://file/${repo.local_path}` template in both RepoCard and
 * RepoDetailPage, which pointed at the *container* side of the repos bind
 * mount (`/repos/...`) — a path that exists on no user's machine, and on a
 * public deployment lives in a Docker volume no browser can reach. Reading
 * GitHub's copy instead means the button needs no clone, no install and no
 * host-path config, so it behaves the same locally and when deployed.
 *
 * Returns `null` for anything that is not a GitHub repo URL — an unknown host,
 * a URL with no `owner/repo`, or junk. Callers disable the button on `null`
 * rather than opening a URL that cannot resolve.
 *
 * Only the first two path segments are used, so a URL that points deeper into
 * the repo (`/tree/main`, `/pull/3`) still opens the repo. Segments are
 * percent-encoded rather than interpolated, so nothing in stored data can
 * smuggle extra path structure into the result.
 */
export function vscodeDevUrl(githubUrl: string): string | null {
  if (!githubUrl) return null

  const trimmed = githubUrl.trim()
  if (!trimmed) return null

  // Normalise `git@github.com:owner/repo.git` into something `URL` accepts.
  const ssh = SSH_SHORTHAND.exec(trimmed)
  const candidate = ssh ? `https://${ssh[1]}/${ssh[2]}` : trimmed

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null

  // `filter(Boolean)` drops the leading empty segment and collapses `//`.
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const owner = decodeSegment(segments[0])
  const repo = stripGitSuffix(decodeSegment(segments[1]))
  if (!owner || !repo) return null

  return `https://vscode.dev/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

/** `URL` percent-encodes the path, so decode before re-encoding to avoid `%2520`. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    // Malformed escape — use it as-is rather than discarding the whole URL.
    return segment
  }
}

/** Matches the backend's `_derive_repo_name`, so both agree on the repo's name. */
function stripGitSuffix(name: string): string {
  return name.endsWith('.git') ? name.slice(0, -4) : name
}
