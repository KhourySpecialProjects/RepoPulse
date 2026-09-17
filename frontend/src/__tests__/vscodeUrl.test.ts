import { describe, expect, it } from 'vitest'

import { vscodeDevUrl } from '@/lib/vscodeUrl'

describe('vscodeDevUrl', () => {
  it('builds the vscode.dev URL for a plain GitHub repo URL', () => {
    expect(vscodeDevUrl('https://github.com/owner/repo')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
  })

  it('strips a trailing slash and a .git suffix', () => {
    expect(vscodeDevUrl('https://github.com/owner/repo/')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
    expect(vscodeDevUrl('https://github.com/owner/repo.git')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
    expect(vscodeDevUrl('https://github.com/owner/repo.git/')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
  })

  it('accepts http and a www host', () => {
    expect(vscodeDevUrl('http://github.com/owner/repo')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
    expect(vscodeDevUrl('https://www.github.com/owner/repo')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
  })

  it('accepts the SSH clone form', () => {
    expect(vscodeDevUrl('git@github.com:owner/repo.git')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
    expect(vscodeDevUrl('ssh://git@github.com/owner/repo.git')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
  })

  it('keeps only owner and repo when the URL points deeper into the repo', () => {
    expect(vscodeDevUrl('https://github.com/owner/repo/tree/main')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
    expect(vscodeDevUrl('https://github.com/owner/repo/pull/3')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
  })

  it('ignores a query string and fragment', () => {
    expect(vscodeDevUrl('https://github.com/owner/repo?tab=readme#install')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
  })

  it('tolerates surrounding whitespace', () => {
    expect(vscodeDevUrl('  https://github.com/owner/repo  ')).toBe(
      'https://vscode.dev/github/owner/repo'
    )
  })

  it('returns null for a non-GitHub host', () => {
    expect(vscodeDevUrl('https://gitlab.com/owner/repo')).toBeNull()
    expect(vscodeDevUrl('https://bitbucket.org/owner/repo')).toBeNull()
    // A host that merely ends with the string "github.com" is not GitHub.
    expect(vscodeDevUrl('https://notgithub.com/owner/repo')).toBeNull()
    expect(vscodeDevUrl('https://github.com.evil.example/owner/repo')).toBeNull()
  })

  it('returns null when owner or repo is missing', () => {
    expect(vscodeDevUrl('https://github.com/owner')).toBeNull()
    expect(vscodeDevUrl('https://github.com/')).toBeNull()
    expect(vscodeDevUrl('https://github.com')).toBeNull()
    expect(vscodeDevUrl('https://github.com/owner//')).toBeNull()
  })

  it('returns null for empty or malformed input', () => {
    expect(vscodeDevUrl('')).toBeNull()
    expect(vscodeDevUrl('   ')).toBeNull()
    expect(vscodeDevUrl('not a url')).toBeNull()
    expect(vscodeDevUrl('owner/repo')).toBeNull()
  })

  it('percent-encodes segments rather than interpolating them raw', () => {
    // Nothing should be able to smuggle extra path structure into the URL.
    expect(vscodeDevUrl('https://github.com/own er/re po')).toBe(
      'https://vscode.dev/github/own%20er/re%20po'
    )
  })
})
