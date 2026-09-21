/**
 * Clicking a notification should land on the thing it is about.
 *
 * It used to navigate to `/repos/{id}` and stop there, leaving you to find the
 * note or commit yourself — on a repo with hundreds of commits and a drawer of
 * notes, that is close to useless. The payload already carries what is needed:
 * `commit_hash` when the note was written against a commit, `note_id`
 * otherwise.
 */
import { describe, it, expect } from 'vitest'
import { notificationTarget } from '@/lib/notificationTarget'
import type { Notification } from '@/types'

const base: Notification = {
  id: 'n-1',
  type: 'mention',
  note_id: 'note-1',
  comment_id: null,
  is_read: false,
  created_at: '2026-09-14T11:00:00Z',
  note_content_preview: 'Hey @Mark',
  repo_id: 'repo-1',
  commit_hash: null,
  subject: null,
  body: null,
}

describe('notificationTarget', () => {
  it('deep-links to the commit when the note was written on one', () => {
    expect(notificationTarget({ ...base, commit_hash: 'abc1234' })).toBe(
      '/repos/repo-1?commit=abc1234'
    )
  })

  it('opens the note when there is no commit behind it', () => {
    expect(notificationTarget(base)).toBe('/repos/repo-1?note=note-1')
  })

  it('prefers the commit over the note when both are available', () => {
    // The commit view is where the note is rendered in context anyway, so it
    // is the more specific destination of the two.
    expect(
      notificationTarget({ ...base, note_id: 'note-9', commit_hash: 'deadbee' })
    ).toBe('/repos/repo-1?commit=deadbee')
  })

  it('takes a reminder to its commit', () => {
    expect(
      notificationTarget({
        ...base,
        type: 'reminder',
        note_id: 'rem-1',
        commit_hash: 'feed123',
      })
    ).toBe('/repos/repo-1?commit=feed123')
  })

  it('falls back to the repo for events with no note, like a repo being added', () => {
    expect(
      notificationTarget({
        ...base,
        type: 'repo_added',
        note_id: null,
        commit_hash: null,
        subject: 'Repository added',
      })
    ).toBe('/repos/repo-1')
  })

  it('returns null when there is no repo to go to', () => {
    // A standalone reminder created from the notifications page. Returning
    // null keeps the row from offering a click that goes nowhere.
    expect(notificationTarget({ ...base, repo_id: null })).toBeNull()
  })
})
