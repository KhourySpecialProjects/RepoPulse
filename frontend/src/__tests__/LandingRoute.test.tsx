import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '@/App'
import { LANDING_DOCUMENT } from '@/pages/LandingPage'
import { useAuth } from '@/hooks/useAuth'

// The landing page is a static document, not a route, so what is under test is
// the decision: who gets sent to it, who does not, and who is still unknown.
// The pages themselves are stubbed — this is about the routing table.
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/pages/DashboardPage', () => ({ DashboardPage: () => <p>the dashboard</p> }))
vi.mock('@/pages/LoginPage', () => ({ LoginPage: () => <p>the login form</p> }))
vi.mock('@/pages/SettingsPage', () => ({ SettingsPage: () => <p>settings</p> }))

const mockedAuth = vi.mocked(useAuth)

function signedIn() {
  mockedAuth.mockReturnValue({ isAuthenticated: true, isLoading: false } as ReturnType<typeof useAuth>)
}
function signedOut() {
  mockedAuth.mockReturnValue({ isAuthenticated: false, isLoading: false } as ReturnType<typeof useAuth>)
}
function stillAsking() {
  mockedAuth.mockReturnValue({ isAuthenticated: false, isLoading: true } as ReturnType<typeof useAuth>)
}

let replace: ReturnType<typeof vi.fn>
const realLocation = window.location

// location.replace is unforgeable — non-writable and non-configurable — so it
// cannot be spied on. window.location itself can be redefined, so swap the
// whole object and put it back afterwards.
function stubLocation(value: unknown) {
  Object.defineProperty(window, 'location', { value, configurable: true, writable: true })
}

beforeEach(() => {
  replace = vi.fn()
  stubLocation({ ...realLocation, href: realLocation.href, replace, assign: vi.fn() })
})
afterEach(() => {
  stubLocation(realLocation)
  vi.restoreAllMocks()
})

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  )
}

describe('the front door', () => {
  it('sends a visitor who is not signed in to the landing page', async () => {
    signedOut()
    at('/')
    await waitFor(() => expect(replace).toHaveBeenCalledWith(LANDING_DOCUMENT))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('the dashboard')).not.toBeInTheDocument()
    // Leaving for another document is not something to do in silence.
    expect(screen.getByRole('status')).toHaveTextContent(/landing page/i)
  })

  it('leaves a signed-in visitor on the dashboard', async () => {
    signedIn()
    at('/')
    expect(await screen.findByText('the dashboard')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('waits for the answer rather than flashing the landing page at a signed-in visitor', async () => {
    // A reload re-reads the stored session, so isAuthenticated is false before
    // it is true. Acting on that would bounce every returning user out of the
    // app and back in.
    stillAsking()
    at('/')
    await waitFor(() => expect(replace).not.toHaveBeenCalled())
    expect(screen.queryByText('the dashboard')).not.toBeInTheDocument()
  })

  it('still sends a deep link into the app to the login form, not to marketing', async () => {
    // Someone following a link to a real page wants that page, not a pitch.
    signedOut()
    at('/settings')
    expect(await screen.findByText('the login form')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('points at a document the app actually ships', async () => {
    // The redirect target is a path on this origin, which at build time means a
    // file copied verbatim out of public/. Rename one without the other and the
    // front door 404s, which nothing else here would notice.
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(existsSync(join(process.cwd(), 'public', LANDING_DOCUMENT))).toBe(true)
  })
})
