import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useBackTarget, backLabelFor } from '@/hooks/useBackTarget'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: vi.fn() }
})

const navigate = vi.fn()
beforeEach(() => {
  navigate.mockClear()
  vi.mocked(useNavigate).mockReturnValue(navigate)
})

function at(entry: string | { pathname: string; state: unknown }) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  )
}

describe('backLabelFor', () => {
  it('names the destination so the arrow is not just "back"', () => {
    expect(backLabelFor('/')).toBe('Back to dashboard')
    expect(backLabelFor('/collections')).toBe('Back to collections')
    expect(backLabelFor('/collections/col-1')).toBe('Back to collection')
    expect(backLabelFor('/collections/col-1?tab=archived')).toBe('Back to collection')
    expect(backLabelFor('/repos/repo-1')).toBe('Back to repository')
    expect(backLabelFor('/notifications')).toBe('Back to notifications')
    expect(backLabelFor('/settings')).toBe('Back to settings')
  })

  it('falls back to a generic label for an unrecognised path', () => {
    expect(backLabelFor('/something-new')).toBe('Go back')
  })
})

describe('useBackTarget', () => {
  it('uses the page parent when nothing recorded where we came from', () => {
    const { result } = renderHook(() => useBackTarget('/collections/col-1'), {
      wrapper: at('/repos/repo-1'),
    })

    expect(result.current.to).toBe('/collections/col-1')
    expect(result.current.label).toBe('Back to collection')
  })

  it('returns to the recorded origin instead of the parent', () => {
    const { result } = renderHook(() => useBackTarget('/collections/col-1'), {
      wrapper: at({ pathname: '/repos/repo-1', state: { from: '/' } }),
    })

    expect(result.current.to).toBe('/')
    expect(result.current.label).toBe('Back to dashboard')
  })

  it('keeps the origin query string so filters survive the round trip', () => {
    const { result } = renderHook(() => useBackTarget('/collections/col-1'), {
      wrapper: at({
        pathname: '/repos/repo-1',
        state: { from: '/collections/col-1?view=list' },
      }),
    })

    expect(result.current.to).toBe('/collections/col-1?view=list')
  })

  it('navigates to the target when asked to go back', () => {
    const { result } = renderHook(() => useBackTarget('/collections/col-1'), {
      wrapper: at({ pathname: '/repos/repo-1', state: { from: '/notifications' } }),
    })

    result.current.goBack()

    expect(navigate).toHaveBeenCalledWith('/notifications')
  })

  it('ignores a state shape it does not recognise', () => {
    const { result } = renderHook(() => useBackTarget('/collections/col-1'), {
      wrapper: at({ pathname: '/repos/repo-1', state: { from: 42 } }),
    })

    expect(result.current.to).toBe('/collections/col-1')
  })

  // A protocol-relative URL starts with a slash but leaves the app, so
  // "starts with /" is not a sufficient check on its own.
  it('refuses an off-site origin', () => {
    const { result } = renderHook(() => useBackTarget('/collections/col-1'), {
      wrapper: at({ pathname: '/repos/repo-1', state: { from: '//evil.example.com' } }),
    })

    expect(result.current.to).toBe('/collections/col-1')
  })
})
