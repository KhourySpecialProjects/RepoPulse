import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderX,
  KeyRound,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react'

import { STATUS } from '@/lib/chartTheme'
import type { AdminLlmUsage, AdminOverview, AdminSystemStatus } from '@/types'

/**
 * Is this instance configured and running?
 *
 * The page's lead, and the only place several of these faults surface at all.
 * Each one is a condition an administrator can act on, and each is rendered
 * only when it is actually true — a row of green ticks trains people to stop
 * reading, so a healthy instance gets one calm line instead.
 *
 * Every chip pairs an icon with a text label. Two of the four status steps
 * sit below 3:1 against a white surface, so colour is never the only channel
 * carrying "this is the bad one".
 *
 * Absorbs the standalone administrator-count warning that used to live in the
 * overview tab, keeping its testid and its distinction between "one admin" —
 * a risk worth a heads-up — and "no admins", which is unrecoverable through
 * the UI and so is an assertive alert.
 *
 * One line, chips and all. Each chip carries its label; the longer
 * explanation moves to the title attribute rather than a second row, because
 * this strip sits above every other card and any height it takes is height
 * the dashboard's actual content does not get.
 */
type Severity = 'critical' | 'warning'

interface Fault {
  key: string
  severity: Severity
  icon: typeof AlertTriangle
  label: string
  detail: string
  /**
   * Tab to open when the chip is clicked. Omitted for the environment faults
   * — a wrong REPO_ROOT_DIR, a behind schema, dev login, a missing API key —
   * which are fixed in the server's environment and migrations, not anywhere
   * in this UI. Those chips report and explain rather than pretending to be
   * a way in; a chip that navigates nowhere is worse than plain text.
   */
  tab?: string
}

interface Props {
  system?: AdminSystemStatus
  overview?: AdminOverview
  llm?: AdminLlmUsage
  onNavigate?: (tab: string) => void
}

function buildFaults(
  system: AdminSystemStatus | undefined,
  overview: AdminOverview | undefined,
  llm: AdminLlmUsage | undefined,
): Fault[] {
  const faults: Fault[] = []
  if (!system) return faults

  if (system.database === 'unreachable') {
    faults.push({
      key: 'database',
      severity: 'critical',
      icon: Database,
      label: 'Database unreachable',
      detail: 'Aggregates on this page cannot be trusted.',
    })
  }

  // Explicitly false, never merely falsy: null means the revision could not
  // be read, which is unknown rather than behind.
  if (system.schema_up_to_date === false) {
    faults.push({
      key: 'schema',
      severity: 'critical',
      icon: Database,
      label: 'Schema behind head',
      detail: `At ${system.schema_revision ?? 'unknown'}, head is ${
        system.schema_head ?? 'unknown'
      }. Run alembic upgrade head.`,
    })
  }

  if (!system.repo_root_exists) {
    faults.push({
      key: 'repo-root-missing',
      severity: 'critical',
      icon: FolderX,
      label: 'Repo root not mounted',
      detail: `${system.repo_root_dir} is not present. Clones and sizes will fail.`,
    })
  } else if (!system.repo_root_writable) {
    faults.push({
      key: 'repo-root-readonly',
      severity: 'critical',
      icon: FolderX,
      label: 'Repo root not writable',
      detail: `${system.repo_root_dir} cannot be written. Syncs will fail.`,
    })
  }

  if (system.dev_login_enabled) {
    faults.push({
      key: 'dev-login',
      severity: 'warning',
      icon: ShieldAlert,
      label: 'Dev login enabled',
      detail: 'Anyone can mint a token from a user id with no password.',
    })
  }

  if (!system.anthropic_api_key_configured) {
    faults.push({
      key: 'anthropic',
      severity: 'warning',
      icon: KeyRound,
      label: 'No Anthropic API key',
      detail: 'Summaries and commit classification cannot run.',
    })
  }

  // Migration 0002 exists because a retired model id started returning 404s.
  // This is the chip that would have caught it.
  if (llm && llm.retired_models_in_use.length > 0) {
    faults.push({
      key: 'retired-models',
      severity: 'warning',
      icon: AlertTriangle,
      label: `${llm.retired_models_in_use.length} retired model${
        llm.retired_models_in_use.length === 1 ? '' : 's'
      } in use`,
      detail: llm.retired_models_in_use.join(', '),
      tab: 'llm',
    })
  }

  const admins = overview?.counts.admins
  if (admins === 0) {
    faults.push({
      key: 'no-admins',
      severity: 'critical',
      icon: Users,
      label: 'No administrators',
      detail: 'Recovering requires changing a role directly in the database.',
      tab: 'users',
    })
  } else if (admins === 1) {
    faults.push({
      key: 'one-admin',
      severity: 'warning',
      icon: Users,
      label: 'Only one administrator',
      detail: 'If that account is lost, admin access is lost with it.',
      tab: 'users',
    })
  }

  return faults
}

export function ServiceStatusBanner({
  system,
  overview,
  llm,
  onNavigate,
}: Props) {
  const faults = buildFaults(system, overview, llm)
  const critical = faults.filter((fault) => fault.severity === 'critical')

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div
        data-testid="service-status"
        role={critical.length > 0 ? 'alert' : 'status'}
        className="flex shrink-0 items-center gap-2 text-sm"
      >
        {faults.length === 0 ? (
          <>
            <CheckCircle2
              aria-hidden="true"
              className="h-4 w-4"
              style={{ color: STATUS.good }}
            />
            <span className="font-medium">All systems normal</span>
            <span className="text-muted-foreground">
              No configuration faults detected.
            </span>
          </>
        ) : (
          <>
            {critical.length > 0 ? (
              <XCircle
                aria-hidden="true"
                className="h-4 w-4"
                style={{ color: STATUS.critical }}
              />
            ) : (
              <AlertTriangle
                aria-hidden="true"
                className="h-4 w-4"
                style={{ color: STATUS.warning }}
              />
            )}
            <span className="font-medium">
              {critical.length > 0 ? 'Needs attention' : 'Running with warnings'}
            </span>
            <span className="text-muted-foreground">
              {faults.length} configuration{' '}
              {faults.length === 1 ? 'issue' : 'issues'}
            </span>
          </>
        )}
      </div>

      {faults.length > 0 && (
        <div className="flex flex-1 flex-wrap gap-2">
          {faults.map((fault) => {
            const Icon = fault.icon
            const color =
              fault.severity === 'critical' ? STATUS.critical : STATUS.warning
            // Shared by both chip shapes so a navigable and a reported fault
            // are visually identical apart from the hover affordance.
            const shared = {
              title: fault.detail,
              // The admin-count warning kept its original testid so the
              // existing assertions keep pointing at the same thing.
              'data-testid':
                fault.key === 'no-admins' || fault.key === 'one-admin'
                  ? 'admin-count-warning'
                  : `fault-${fault.key}`,
              role:
                fault.key === 'no-admins'
                  ? 'alert'
                  : fault.key === 'one-admin'
                    ? 'status'
                    : undefined,
            }
            const body = (
              <>
                <Icon
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color }}
                />
                <span className="font-medium">{fault.label}</span>
              </>
            )
            const chipClass =
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-left text-xs'

            // A chip is a button only when it has somewhere to go. The
            // environment faults are reported, not navigable, so they render
            // as plain text rather than as a control that swallows a click.
            return fault.tab ? (
              <button
                key={fault.key}
                type="button"
                onClick={() => onNavigate?.(fault.tab!)}
                className={`${chipClass} transition-colors hover:bg-muted`}
                {...shared}
              >
                {body}
              </button>
            ) : (
              <span key={fault.key} className={chipClass} {...shared}>
                {body}
              </span>
            )
          })}
        </div>
      )}

    </div>
  )
}
