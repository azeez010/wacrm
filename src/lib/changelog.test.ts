import { describe, expect, it } from 'vitest'
import { parseGitLog } from '../../scripts/changelog-parse.mjs'

const rec = (date: string, subject: string, body = '') => `${date}\x1f${subject}\x1f${body}\x1e`

describe('parseGitLog', () => {
  it('publishes only commits with a Changelog trailer, newest date first', () => {
    const raw =
      rec('2026-11-27', 'feat(inbox): snooze conversations', 'Body.\n\nChangelog: Snooze a conversation until later.\nChangelog-fr: Mettez une conversation en pause.') +
      rec('2026-11-27', 'refactor: tidy', 'no trailer here') +
      rec('2026-11-26', 'fix(forms): date field', 'Changelog: Date fields keep their value.') +
      rec('2026-11-26', 'perf: faster inbox', 'Changelog: The inbox opens faster.')
    expect(parseGitLog(raw)).toEqual([
      { date: '2026-11-27', changes: [{ kind: 'New', text: { en: 'Snooze a conversation until later.', fr: 'Mettez une conversation en pause.' } }] },
      { date: '2026-11-26', changes: [{ kind: 'Improved', text: { en: 'The inbox opens faster.' } }, { kind: 'Fixed', text: { en: 'Date fields keep their value.' } }] },
    ])
  })

  it('ignores records without a date or subject', () => {
    expect(parseGitLog('\x1e\n')).toEqual([])
  })
})
