/**
 * The Commit Activity card collapses, like every other panel on the repo page.
 *
 * What stays visible when collapsed is the design decision here. The card also
 * carries the Check In controls, the health pills and the last-checked line —
 * none of which are the graph. Hiding those along with the chart would take
 * away the one button an instructor visits this page to press, so collapsing
 * hides the graph and everything that only explains the graph: the chart, its
 * legend, the range selector and the caption about quiet periods.
 */
import { render, screen } from '@testing-library/react'
import { vi, it, expect, afterEach, describe } from 'vitest'
import type { ReactNode } from 'react'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'

vi.mock('@/hooks/useContextualActivity', () => ({
  useContextualActivity: () => ({
    data: {
      repositories: [
        {
          id: 'repo',
          name: 'Repo',
          available: true,
          activity: [{ date: '2026-09-01', count: 4 }],
          students: [],
        },
      ],
    },
    isLoading: false,
  }),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => null,
  ReferenceDot: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

afterEach(() => vi.useRealTimers())

function renderChart(props: Record<string, unknown> = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
  return render(
    <ContextualActivityChart
      collectionId="collection"
      repoId="repo"
      actions={<button type="button">Check In</button>}
      {...props}
    >
      <p>Last checked: 2 days ago</p>
    </ContextualActivityChart>
  )
}

const graph = () => screen.queryByLabelText('Commit activity graph')
const toggle = () => screen.queryByRole('button', { name: /commit activity/i })

describe('the toggle itself', () => {
  it('offers no toggle when the page does not wire one up', () => {
    // The component predates this feature and is rendered without the props
    // in other tests; it must stay usable as a plain, always-open card.
    renderChart()

    expect(toggle()).not.toBeInTheDocument()
    expect(graph()).toBeInTheDocument()
  })

  it('adds a chevron toggle once wired up', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    expect(toggle()).toBeInTheDocument()
  })

  it('leaves the title as plain text rather than a second toggle', () => {
    // One affordance, not two. Two buttons both named "Commit Activity" would
    // also make every name-based query in these tests ambiguous.
    renderChart({ expanded: true, onToggle: vi.fn() })

    expect(screen.getByText('Commit Activity').tagName).not.toBe('BUTTON')
    expect(screen.getAllByRole('button', { name: /commit activity/i })).toHaveLength(1)
  })

  it('puts the chevron last in the row, on the card’s right edge', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    const controls = toggle()!.parentElement!
    expect(controls.lastElementChild).toBe(toggle())
  })

  it('reports its state to assistive tech', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('reports the collapsed state too', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('points at the region it controls', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    const controls = toggle()?.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls!)).toBeInTheDocument()
  })

  it('calls back on click rather than holding its own state', () => {
    // State lives on the page, which persists it per repo — the same shape
    // every other panel on RepoDetailPage uses.
    const onToggle = vi.fn()
    renderChart({ expanded: true, onToggle })

    toggle()!.click()

    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('what collapsing hides', () => {
  it('hides the graph', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(graph()).not.toBeInTheDocument()
  })

  it('hides the marker legend with it', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(
      screen.queryByRole('list', { name: 'Marker legend' })
    ).not.toBeInTheDocument()
  })

  it('hides the range selector, which only steers the graph', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(screen.queryByLabelText('Activity range')).not.toBeInTheDocument()
  })

  it('hides the caption explaining the markers', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(screen.queryByText(/UTC daily counts/i)).not.toBeInTheDocument()
  })
})

describe('what collapsing keeps', () => {
  it('keeps the title, so the card can be found again', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(screen.getByText('Commit Activity')).toBeInTheDocument()
  })

  it('keeps the Check In action reachable', () => {
    // The reason not to hide the whole card: this button is why an instructor
    // opens the page, and it is not part of the graph.
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(screen.getByRole('button', { name: 'Check In' })).toBeInTheDocument()
  })

  it('keeps the health pills and last-checked line', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(screen.getByText(/Last checked/)).toBeInTheDocument()
  })
})

/**
 * The header is one row: title on the left, controls on the right.
 *
 * The actions used to sit on their own `justify-end` row beneath the title,
 * which left a band of blank white under "Commit Activity" — the controls were
 * pushed right, and nothing occupied the space they left behind.
 */
describe('header layout', () => {
  /** The flex row that holds the title. */
  function titleRow(): HTMLElement {
    const heading = screen.getByText('Commit Activity')
    return heading.closest('[data-testid="activity-header-row"]') as HTMLElement
  }

  it('puts the Check In action on the title’s own line', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    expect(titleRow()).toContainElement(
      screen.getByRole('button', { name: 'Check In' })
    )
  })

  it('keeps the controls on the right', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    // Title hard left, controls hard right, nothing stretched between them.
    expect(titleRow().className).toContain('justify-between')
  })

  it('keeps the range selector on that line too', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    expect(titleRow()).toContainElement(screen.getByLabelText('Activity range'))
  })

  it('leaves no row between the title and the content beneath it', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    // Whatever the page passes as children — the health pills, then this
    // last-checked line — follows the title row directly. An element in
    // between is the blank band this layout exists to remove.
    expect(
      screen.getByText(/Last checked/).previousElementSibling
    ).toBe(titleRow())
  })

  it('still groups title and actions on one row when collapsed', () => {
    renderChart({ expanded: false, onToggle: vi.fn() })

    expect(titleRow()).toContainElement(
      screen.getByRole('button', { name: 'Check In' })
    )
  })
})

describe('expanded stays as it was', () => {
  it('shows the graph, legend, range and caption', () => {
    renderChart({ expanded: true, onToggle: vi.fn() })

    expect(graph()).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Marker legend' })).toBeInTheDocument()
    expect(screen.getByLabelText('Activity range')).toBeInTheDocument()
    expect(screen.getByText(/UTC daily counts/i)).toBeInTheDocument()
  })

  it('defaults to open when only onToggle is given', () => {
    renderChart({ onToggle: vi.fn() })

    expect(graph()).toBeInTheDocument()
  })
})
