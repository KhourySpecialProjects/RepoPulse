/**
 * The browser-storage panel is REPORTING ONLY.
 *
 * There is deliberately no clear/reclaim/delete affordance — see
 * test_has_no_mutation_affordance below, which pins that scope decision so a
 * later change cannot quietly reintroduce one.
 *
 * src/test/setup.ts does not clear localStorage, so this file does it itself.
 */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserStorageCard } from '@/components/admin/BrowserStorageCard'
import { LOCAL_STORAGE_QUOTA_BYTES } from '@/lib/storageUsage'

/** Fill localStorage to roughly the given fraction of quota. */
function fillToFraction(fraction: number) {
  const targetBytes = LOCAL_STORAGE_QUOTA_BYTES * fraction
  localStorage.setItem('bulk', 'x'.repeat(Math.floor(targetBytes / 2)))
}

beforeEach(() => {
  localStorage.clear()
})

describe('BrowserStorageCard', () => {
  it('labels the panel as this browser only, never instance-wide', () => {
    render(<BrowserStorageCard />)

    const note = screen.getByTestId('storage-scope-note')
    expect(note).toHaveTextContent(/this browser only/i)
    expect(note).toHaveTextContent(/cannot be read from the server/i)
  })

  it('reports the total in human units', () => {
    localStorage.setItem('auth_token', 'abcdef')

    render(<BrowserStorageCard />)

    // 'auth_token' (10) + 'abcdef' (6) = 16 code units = 32 bytes
    expect(screen.getByTestId('storage-total')).toHaveTextContent('32 B')
  })

  it('renders a row per stored key with its size', () => {
    localStorage.setItem('auth_token', 'abc')
    localStorage.setItem('sidebar_width', '240')

    render(<BrowserStorageCard />)

    const table = screen.getByRole('table')
    expect(within(table).getByText('auth_token')).toBeInTheDocument()
    expect(within(table).getByText('sidebar_width')).toBeInTheDocument()
  })

  it('exposes the quota bar to assistive tech', () => {
    render(<BrowserStorageCard />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('stays at the ok level well under quota', () => {
    localStorage.setItem('auth_token', 'abc')

    render(<BrowserStorageCard />)

    expect(screen.getByTestId('quota-bar')).toHaveAttribute('data-level', 'ok')
  })

  it('warns past 60% of quota', () => {
    fillToFraction(0.65)

    render(<BrowserStorageCard />)

    expect(screen.getByTestId('quota-bar')).toHaveAttribute('data-level', 'warn')
  })

  it('escalates past 80% of quota', () => {
    fillToFraction(0.85)

    render(<BrowserStorageCard />)

    expect(screen.getByTestId('quota-bar')).toHaveAttribute(
      'data-level',
      'critical',
    )
  })

  it('summarises the per-repo keys that accumulate forever', () => {
    localStorage.setItem('repo-checkins-r1', '[1,2,3]')
    localStorage.setItem('notes-drawer-pinned-r2', 'true')

    render(<BrowserStorageCard />)

    expect(screen.getByTestId('per-repo-summary')).toHaveTextContent('2')
  })

  it('reports orphaned keys when it knows which repos still exist', () => {
    localStorage.setItem('repo-checkins-alive', '[1]')
    localStorage.setItem('repo-checkins-deleted', '[1,2,3]')

    render(<BrowserStorageCard knownRepoIds={['alive']} />)

    expect(screen.getByTestId('orphan-summary')).toHaveTextContent('1')
  })

  it('omits the orphan summary when it cannot know which repos exist', () => {
    localStorage.setItem('repo-checkins-r1', '[1]')

    render(<BrowserStorageCard />)

    expect(screen.queryByTestId('orphan-summary')).not.toBeInTheDocument()
  })

  it('does not throw when navigator.storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
    Object.defineProperty(navigator, 'storage', {
      value: undefined,
      configurable: true,
    })

    expect(() => render(<BrowserStorageCard />)).not.toThrow()
    expect(screen.queryByTestId('origin-estimate')).not.toBeInTheDocument()

    if (original) Object.defineProperty(navigator, 'storage', original)
  })

  it('shows the whole-origin estimate separately, labelled so it is not mistaken for the sum', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: vi.fn().mockResolvedValue({ usage: 4096 }) },
      configurable: true,
    })

    render(<BrowserStorageCard />)

    const estimate = await screen.findByTestId('origin-estimate')
    expect(estimate).toHaveTextContent('4 KB')
    expect(estimate).toHaveTextContent(/whole origin/i)

    if (original) Object.defineProperty(navigator, 'storage', original)
  })

  it('renders an empty state rather than a bare zero table', () => {
    render(<BrowserStorageCard />)

    expect(screen.getByText(/nothing stored/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('has no mutation affordance — the panel reports, it does not remediate', () => {
    localStorage.setItem('repo-checkins-r1', '[1,2,3]')

    render(<BrowserStorageCard knownRepoIds={[]} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/\bclear\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bdelete\b/i)).not.toBeInTheDocument()
  })
})
