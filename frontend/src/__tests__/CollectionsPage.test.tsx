import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CollectionsPage } from '@/pages/CollectionsPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('CollectionsPage', () => {
  it('renders page title', async () => {
    renderPage()
    expect(screen.getByText('Collections')).toBeInTheDocument()
  })

  it('renders New Collection button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /new collection/i })).toBeInTheDocument()
  })

  it('shows collections from API', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument()
      expect(screen.getByText('CS 201 Spring 2025')).toBeInTheDocument()
    })
  })

  it('shows course and semester tags', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('CS 101')).toBeInTheDocument()
      expect(screen.getByText('Fall 2025')).toBeInTheDocument()
    })
  })
})
