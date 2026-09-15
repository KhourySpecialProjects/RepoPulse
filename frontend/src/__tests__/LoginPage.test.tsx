import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from '@/pages/LoginPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockLogin = vi.fn()
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    user: null,
    isAuthenticated: false,
    isLoading: false,
    logout: vi.fn(),
  }),
}))

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    mockLogin.mockReset()
  })

  it('renders the RepoPulse title', () => {
    renderLogin()
    expect(screen.getByText('RepoPulse')).toBeInTheDocument()
  })

  it('does not show one-click dev login user cards', () => {
    renderLogin()
    expect(screen.queryByText('Instructor Mark')).not.toBeInTheDocument()
    expect(screen.queryByText('TA Sarah')).not.toBeInTheDocument()
    expect(screen.queryByText('Admin Alex')).not.toBeInTheDocument()
    expect(screen.queryByText(/or sign in with email/i)).not.toBeInTheDocument()
  })

  it('shows the email/password form without any toggle on initial render', () => {
    renderLogin()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('calls login() with email and password on form submit', async () => {
    mockLogin.mockResolvedValueOnce(undefined)
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'teacher@school.edu')
    await userEvent.type(screen.getByLabelText('Password'), 'secret123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('teacher@school.edu', 'secret123')
    })
  })

  it('navigates to / after successful email login', async () => {
    mockLogin.mockResolvedValueOnce(undefined)
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'teacher@school.edu')
    await userEvent.type(screen.getByLabelText('Password'), 'secret123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/')
    })
  })

  it('shows error message when email login fails', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Unauthorized'))
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'bad@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument()
    })
  })

  it('disables Sign In button and shows loading text while submitting', async () => {
    let resolveLogin!: () => void
    mockLogin.mockReturnValueOnce(new Promise<void>((res) => { resolveLogin = res }))
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com')
    await userEvent.type(screen.getByLabelText('Password'), 'pass')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    })
    resolveLogin()
  })
})
