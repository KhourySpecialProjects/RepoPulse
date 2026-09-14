import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailRelayPanel } from '@/components/EmailRelayPanel'
import type { NotificationSettings } from '@/types'

const getNotificationSettings = vi.fn()
const updateNotificationSettings = vi.fn()
const sendTestEmail = vi.fn()

vi.mock('@/services/api', () => ({
  getNotificationSettings: (...args: unknown[]) => getNotificationSettings(...args),
  updateNotificationSettings: (...args: unknown[]) => updateNotificationSettings(...args),
  sendTestEmail: (...args: unknown[]) => sendTestEmail(...args),
  // The panel prefills the test recipient from the signed-in account.
  getCurrentUser: () =>
    Promise.resolve({
      id: 'user-1',
      email: 'me@example.edu',
      display_name: 'Prof Owner',
      role: 'instructor',
    }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}))

const UNCONFIGURED: NotificationSettings = {
  email_enabled: false,
  transport: 'smtp',
  from_email: null,
  from_name: null,
  smtp_host: null,
  smtp_port: null,
  smtp_username: null,
  smtp_encryption: 'starttls',
  smtp_password_set: false,
  resend_api_key_set: false,
  subscribed_events: {
    mention: true,
    note_comment: true,
    reminder: true,
    repo_added: true,
    repo_removed: true,
    repo_health_declined: true,
    pr_opened: true,
    pr_merged: true,
  },
  deliverable: false,
}

function settings(over: Partial<NotificationSettings> = {}): NotificationSettings {
  return { ...UNCONFIGURED, ...over }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmailRelayPanel />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getNotificationSettings.mockResolvedValue(settings())
  updateNotificationSettings.mockImplementation((data) =>
    Promise.resolve(settings(data as Partial<NotificationSettings>))
  )
  sendTestEmail.mockResolvedValue({ detail: 'Test email sent.', sent_to: 'me@example.edu' })
})

describe('EmailRelayPanel', () => {
  it('renders the relay and every subscribable event', async () => {
    renderPanel()

    expect(await screen.findByText('Email relay')).toBeInTheDocument()
    expect(screen.getByText('Email me about')).toBeInTheDocument()
    // All eight notification types must be individually controllable.
    expect(screen.getAllByRole('checkbox')).toHaveLength(8)
    expect(screen.getByLabelText('Mentions')).toBeInTheDocument()
    expect(screen.getByLabelText('Health drops to red')).toBeInTheDocument()
    expect(screen.getByLabelText('Pull request merged')).toBeInTheDocument()
  })

  it('toggles email delivery through the master switch', async () => {
    renderPanel()
    const toggle = await screen.findByRole('switch', {
      name: 'Enable email notifications',
    })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(toggle)

    await waitFor(() =>
      expect(updateNotificationSettings).toHaveBeenCalledWith({ email_enabled: true })
    )
  })

  it('saves a subscription change immediately, without a save button', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, deliverable: true })
    )
    renderPanel()

    await userEvent.click(await screen.findByLabelText('Mentions'))

    await waitFor(() =>
      expect(updateNotificationSettings).toHaveBeenCalledWith({
        subscribed_events: { mention: false },
      })
    )
  })

  it('locks every relay control until email is switched on', async () => {
    renderPanel()
    await screen.findByText('Email relay')

    // The fieldset disables its whole subtree, so each control reports itself
    // as disabled to the accessibility tree and to user-event.
    expect(screen.getByPlaceholderText('repopulse@university.edu')).toBeDisabled()
    expect(screen.getByPlaceholderText('smtp.gmail.com')).toBeDisabled()
    expect(screen.getByLabelText('Encryption')).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'SMTP' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save relay' })).toBeDisabled()
    expect(screen.getByLabelText('Send a test email to')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled()
    expect(screen.getByLabelText('Mentions')).toBeDisabled()

    // ...and the master switch itself stays usable, or there would be no way out.
    expect(
      screen.getByRole('switch', { name: 'Enable email notifications' })
    ).toBeEnabled()
  })

  it('ignores typing into a locked relay field', async () => {
    renderPanel()
    await screen.findByText('Email relay')
    const from = screen.getByPlaceholderText(
      'repopulse@university.edu'
    ) as HTMLInputElement

    await userEvent.type(from, 'nope@example.edu')

    expect(from.value).toBe('')
    expect(updateNotificationSettings).not.toHaveBeenCalled()
  })

  it('unlocks the relay controls once email is on', async () => {
    getNotificationSettings.mockResolvedValue(settings({ email_enabled: true }))
    renderPanel()
    await screen.findByText('Email relay')

    expect(screen.getByPlaceholderText('repopulse@university.edu')).toBeEnabled()
    expect(screen.getByLabelText('Send a test email to')).toBeEnabled()
    expect(screen.getByLabelText('Mentions')).toBeEnabled()
  })

  it('saves SMTP relay fields only when Save is pressed', async () => {
    getNotificationSettings.mockResolvedValue(settings({ email_enabled: true }))
    renderPanel()
    await screen.findByText('Email relay')

    await userEvent.type(
      screen.getByPlaceholderText('repopulse@university.edu'),
      'relay@example.edu'
    )
    await userEvent.type(screen.getByPlaceholderText('smtp.gmail.com'), 'smtp.example.edu')

    // Nothing is persisted while typing.
    expect(updateNotificationSettings).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Save relay' }))

    await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalledTimes(1))
    expect(updateNotificationSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'smtp',
        from_email: 'relay@example.edu',
        smtp_host: 'smtp.example.edu',
        smtp_encryption: 'starttls',
      })
    )
  })

  it('does not send an untouched password, so the stored one survives', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({
        email_enabled: true,
        from_email: 'relay@example.edu',
        smtp_host: 'smtp.example.edu',
        smtp_port: 587,
        smtp_password_set: true,
        deliverable: true,
      })
    )
    renderPanel()
    await screen.findByText('Email relay')

    await userEvent.type(screen.getByPlaceholderText('RepoPulse'), 'CS 3200')
    await userEvent.click(screen.getByRole('button', { name: 'Save relay' }))

    await waitFor(() => expect(updateNotificationSettings).toHaveBeenCalled())
    const payload = updateNotificationSettings.mock.calls[0][0]
    expect(payload).not.toHaveProperty('smtp_password')
  })

  it('swaps to the Resend API key field when Resend is chosen', async () => {
    getNotificationSettings.mockResolvedValue(settings({ email_enabled: true }))
    renderPanel()
    await screen.findByText('Email relay')

    await userEvent.click(screen.getByRole('radio', { name: 'Resend' }))

    expect(screen.getByPlaceholderText('re_...')).toBeInTheDocument()
    // SMTP-only fields go away, so there is no ambiguity about what is used.
    expect(screen.queryByPlaceholderText('smtp.gmail.com')).not.toBeInTheDocument()
  })

  it('warns when email is on but the relay cannot actually send', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, deliverable: false })
    )
    renderPanel()

    expect(await screen.findByTestId('relay-incomplete-warning')).toBeInTheDocument()
  })

  it('does not warn when the relay is deliverable', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, deliverable: true })
    )
    renderPanel()
    await screen.findByText('Email relay')

    expect(screen.queryByTestId('relay-incomplete-warning')).not.toBeInTheDocument()
  })

  it('prefills the test recipient with the account address', async () => {
    getNotificationSettings.mockResolvedValue(settings({ email_enabled: true }))
    renderPanel()
    await screen.findByText('Email relay')

    await waitFor(() =>
      expect(screen.getByLabelText('Send a test email to')).toHaveValue(
        'me@example.edu'
      )
    )
  })

  it('reports where a test email was sent', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, deliverable: true })
    )
    renderPanel()
    await screen.findByText('Email relay')

    await userEvent.click(screen.getByRole('button', { name: /Send/ }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Test email sent to me@example.edu')
    )
  })

  it('sends the test to an overridden recipient', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, deliverable: true })
    )
    sendTestEmail.mockResolvedValue({
      detail: 'Test email sent.',
      sent_to: 'real@northeastern.edu',
    })
    renderPanel()
    await screen.findByText('Email relay')

    const to = screen.getByLabelText('Send a test email to')
    await userEvent.clear(to)
    await userEvent.type(to, 'real@northeastern.edu')
    await userEvent.click(screen.getByRole('button', { name: /Send/ }))

    await waitFor(() =>
      expect(sendTestEmail).toHaveBeenCalledWith('real@northeastern.edu')
    )
  })

  it('warns about Resend recipient and domain rules', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, transport: 'resend' })
    )
    renderPanel()
    await screen.findByText('Email relay')

    expect(screen.getByText(/delivered@resend.dev/)).toBeInTheDocument()
  })

  it('surfaces the backend reason when a test email fails', async () => {
    sendTestEmail.mockRejectedValue({
      response: { data: { detail: 'SMTP delivery failed: auth failed' } },
    })
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, deliverable: true })
    )
    renderPanel()
    await screen.findByText('Email relay')

    await userEvent.click(screen.getByRole('button', { name: /Send/ }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('SMTP delivery failed: auth failed')
    )
  })

  it('never renders a stored secret, only that one exists', async () => {
    getNotificationSettings.mockResolvedValue(
      settings({ email_enabled: true, smtp_password_set: true })
    )
    renderPanel()
    await screen.findByText('Email relay')

    const password = screen.getByPlaceholderText('••••••••') as HTMLInputElement
    expect(password.value).toBe('')
    expect(screen.getByText('· saved')).toBeInTheDocument()
  })
})
