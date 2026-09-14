import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Send, ShieldCheck, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  useNotificationSettings,
  useSendTestEmail,
  useUpdateNotificationSettings,
} from '@/hooks/useNotifications'
import { useCurrentUser } from '@/hooks/useUsers'
import { NOTIFICATION_EVENTS } from '@/lib/notificationEvents'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type {
  EmailTransport,
  NotificationEvent,
  SmtpEncryption,
  UpdateNotificationSettingsData,
} from '@/types'

const FIELD_LABEL_CLASS = 'mb-1 block text-xs font-medium text-muted-foreground'
const NATIVE_SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** The relay fields, as edited locally before being saved. */
interface RelayDraft {
  transport: EmailTransport
  from_email: string
  from_name: string
  smtp_host: string
  smtp_port: string
  smtp_username: string
  smtp_password: string
  smtp_encryption: SmtpEncryption
  resend_api_key: string
}

const EMPTY_DRAFT: RelayDraft = {
  transport: 'smtp',
  from_email: '',
  from_name: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_username: '',
  smtp_password: '',
  smtp_encryption: 'starttls',
  resend_api_key: '',
}

function errorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response
    ?.data?.detail
  return detail ?? fallback
}

/**
 * Email relay configuration and per-event subscriptions.
 *
 * Two different save behaviours, on purpose. The relay credentials are a form
 * with an explicit Save, because a half-typed SMTP host should not be
 * persisted on every keystroke. The master switch and the event checkboxes
 * save on change, because each is a single complete decision and a Save button
 * for a checkbox is friction.
 */
export function EmailRelayPanel() {
  const { data: settings, isLoading } = useNotificationSettings()
  const { data: currentUser } = useCurrentUser()
  const update = useUpdateNotificationSettings()
  const testEmail = useSendTestEmail()

  const [draft, setDraft] = useState<RelayDraft>(EMPTY_DRAFT)
  const [dirty, setDirty] = useState(false)
  // Where the test probe goes. Prefilled with the account address, but
  // editable: dev accounts are seeded with @example.com, and Resend and most
  // other providers reject that domain outright as a recipient.
  const [testTo, setTestTo] = useState('')

  useEffect(() => {
    if (currentUser?.email) setTestTo((current) => current || currentUser.email)
  }, [currentUser?.email])

  // Seed the form from the server once, and on later refetches only while the
  // user has no unsaved edits — otherwise a background refetch would discard
  // what they were typing.
  useEffect(() => {
    if (!settings || dirty) return
    setDraft({
      transport: settings.transport,
      from_email: settings.from_email ?? '',
      from_name: settings.from_name ?? '',
      smtp_host: settings.smtp_host ?? '',
      smtp_port: settings.smtp_port ? String(settings.smtp_port) : '587',
      smtp_username: settings.smtp_username ?? '',
      // Never populated from the server: the stored secret is not sent to the
      // client. Left blank, and blank means "keep whatever is stored".
      smtp_password: '',
      smtp_encryption: settings.smtp_encryption,
      resend_api_key: '',
    })
  }, [settings, dirty])

  function edit<K extends keyof RelayDraft>(key: K, value: RelayDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  async function saveRelay() {
    const payload: UpdateNotificationSettingsData = {
      transport: draft.transport,
      from_email: draft.from_email.trim(),
      from_name: draft.from_name.trim(),
    }

    if (draft.transport === 'smtp') {
      payload.smtp_host = draft.smtp_host.trim()
      payload.smtp_encryption = draft.smtp_encryption
      payload.smtp_username = draft.smtp_username.trim()
      const port = Number(draft.smtp_port)
      if (draft.smtp_port.trim() !== '' && Number.isFinite(port)) {
        payload.smtp_port = port
      }
      // An untouched password field must not clear the stored one, so it is
      // only sent when the user actually typed something.
      if (draft.smtp_password !== '') payload.smtp_password = draft.smtp_password
    } else if (draft.resend_api_key !== '') {
      payload.resend_api_key = draft.resend_api_key
    }

    try {
      await update.mutateAsync(payload)
      setDirty(false)
      setDraft((prev) => ({ ...prev, smtp_password: '', resend_api_key: '' }))
      toast.success('Email relay saved')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the email relay'))
    }
  }

  async function toggleEnabled(enabled: boolean) {
    try {
      await update.mutateAsync({ email_enabled: enabled })
    } catch (error) {
      toast.error(errorMessage(error, 'Could not change email delivery'))
    }
  }

  async function toggleEvent(key: NotificationEvent, subscribed: boolean) {
    try {
      await update.mutateAsync({ subscribed_events: { [key]: subscribed } })
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update that subscription'))
    }
  }

  async function handleTestEmail() {
    try {
      const result = await testEmail.mutateAsync(testTo.trim() || undefined)
      toast.success(`Test email sent to ${result.sent_to}`)
    } catch (error) {
      toast.error(errorMessage(error, 'The test email could not be sent'))
    }
  }

  if (isLoading || !settings) {
    return (
      <section
        data-testid="email-relay-panel"
        className="overflow-hidden rounded-xl border border-border bg-white"
      >
        <p className="px-5 py-12 text-center text-sm text-muted-foreground">
          Loading email settings...
        </p>
      </section>
    )
  }

  const enabled = settings.email_enabled

  return (
    <motion.section
      data-testid="email-relay-panel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden rounded-xl border border-border bg-white"
    >
      {/* Header + master switch */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <Mail className="h-4 w-4" />
            Email relay
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Get notifications by email as well as in the app.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={toggleEnabled}
          disabled={update.isPending}
          aria-label="Enable email notifications"
        />
      </div>

      {/* Deliverability warning: switched on but not actually sendable. */}
      {enabled && !settings.deliverable && (
        <div
          data-testid="relay-incomplete-warning"
          className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Email is on, but the relay is not fully configured yet — nothing will
            be sent until it is.
          </span>
        </div>
      )}

      {/* Nothing here is configurable until the relay is switched on. A
          `fieldset` rather than a `disabled` prop on each control: it disables
          every input, select and button inside it natively, so a control added
          later cannot be left reachable by accident. */}
      <fieldset
        disabled={!enabled}
        data-testid="relay-config"
        className={cn(
          'min-w-0 border-0 px-5 py-4',
          !enabled && 'opacity-60'
        )}
      >
        {!enabled && (
          <p className="mb-4 text-xs text-muted-foreground">
            Turn on email notifications above to configure the relay.
          </p>
        )}

        {/* Transport picker */}
        <div className="mb-4">
          <span className={FIELD_LABEL_CLASS}>Transport</span>
          <div
            role="radiogroup"
            aria-label="Email transport"
            className="inline-flex rounded-md border border-input p-0.5"
          >
            {(['smtp', 'resend'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={draft.transport === option}
                onClick={() => edit('transport', option)}
                className={cn(
                  'rounded px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed',
                  draft.transport === option
                    ? 'bg-indigo-600 text-white'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option === 'smtp' ? 'SMTP' : 'Resend'}
              </button>
            ))}
          </div>
        </div>

        {/* Sender, shared by both transports */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>From address</span>
            <Input
              value={draft.from_email}
              onChange={(e) => edit('from_email', e.target.value)}
              placeholder="repopulse@university.edu"
              className="h-9"
            />
          </label>
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>From name</span>
            <Input
              value={draft.from_name}
              onChange={(e) => edit('from_name', e.target.value)}
              placeholder="RepoPulse"
              className="h-9"
            />
          </label>
        </div>

        {draft.transport === 'smtp' ? (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="col-span-2 block">
              <span className={FIELD_LABEL_CLASS}>SMTP host</span>
              <Input
                value={draft.smtp_host}
                onChange={(e) => edit('smtp_host', e.target.value)}
                placeholder="smtp.gmail.com"
                className="h-9"
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>Port</span>
              <Input
                type="number"
                value={draft.smtp_port}
                onChange={(e) => edit('smtp_port', e.target.value)}
                placeholder="587"
                className="h-9"
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>Encryption</span>
              <select
                aria-label="Encryption"
                value={draft.smtp_encryption}
                onChange={(e) =>
                  edit('smtp_encryption', e.target.value as SmtpEncryption)
                }
                className={NATIVE_SELECT_CLASS}
              >
                <option value="starttls">STARTTLS (587)</option>
                <option value="tls">TLS (465)</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>Username</span>
              <Input
                value={draft.smtp_username}
                onChange={(e) => edit('smtp_username', e.target.value)}
                autoComplete="off"
                className="h-9"
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>
                Password
                {settings.smtp_password_set && (
                  <span className="ml-1 font-normal normal-case text-emerald-600">
                    · saved
                  </span>
                )}
              </span>
              <Input
                type="password"
                value={draft.smtp_password}
                onChange={(e) => edit('smtp_password', e.target.value)}
                placeholder={settings.smtp_password_set ? '••••••••' : ''}
                autoComplete="new-password"
                className="h-9"
              />
            </label>
          </div>
        ) : (
          <label className="mb-4 block">
            <span className={FIELD_LABEL_CLASS}>
              Resend API key
              {settings.resend_api_key_set && (
                <span className="ml-1 font-normal normal-case text-emerald-600">
                  · saved
                </span>
              )}
            </span>
            <Input
              type="password"
              value={draft.resend_api_key}
              onChange={(e) => edit('resend_api_key', e.target.value)}
              placeholder={settings.resend_api_key_set ? '••••••••' : 're_...'}
              autoComplete="new-password"
              className="h-9"
            />
          </label>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={saveRelay}
            loading={update.isPending}
            disabled={update.isPending || !dirty}
            className="bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Save relay
          </Button>
          {dirty && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
        </div>

        {/* Test send. The recipient is explicit rather than implied, because a
            failure here is almost always about the recipient domain and a
            hidden address makes that impossible to work out. */}
        <div className="mt-4 border-t border-border pt-4">
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Send a test email to</span>
            <div className="flex items-center gap-2">
              <Input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@university.edu"
                className="h-9"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestEmail}
                loading={testEmail.isPending}
                disabled={testEmail.isPending || !testTo.trim()}
                className="flex-shrink-0"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Send
              </Button>
            </div>
          </label>
          {draft.transport === 'resend' && (
            <p className="mt-2 text-xs text-muted-foreground">
              Resend will only deliver from a domain you have verified, and
              rejects placeholder recipients like <code>@example.com</code>.
              Use a real address, or Resend's{' '}
              <code>delivered@resend.dev</code> test inbox.
            </p>
          )}
        </div>

        {/* Secrets are write-only, so say so rather than showing a blank box. */}
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Credentials are stored for your account only and are never sent back
            to the browser. Leave a password blank to keep the saved one.
          </span>
        </p>
      </fieldset>

      {/* Per-event subscriptions */}
      <div className="border-t border-border px-5 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Email me about
        </h3>
        <ul className="mt-3 flex flex-col">
          {NOTIFICATION_EVENTS.map((event) => {
            const subscribed = settings.subscribed_events[event.key] ?? true
            return (
              <li key={event.key}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50',
                    !enabled && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <span className="mt-0.5">
                    <Checkbox
                      checked={subscribed}
                      onCheckedChange={(next) => toggleEvent(event.key, next)}
                      disabled={!enabled || update.isPending}
                      aria-label={event.label}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {event.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {event.description}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>
    </motion.section>
  )
}
