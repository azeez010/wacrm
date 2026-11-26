// Turns git history into customer-facing changelog entries.
//
// Only commits that carry a `Changelog:` trailer are published, so internal work
// (refactors, CI, tests) never leaks onto the public page. The kind comes from the
// conventional-commit type: feat -> New, fix -> Fixed, anything else -> Improved.
// Optional per-language lines: `Changelog-fr:`, `Changelog-ar:` ... (English is the fallback).

const KIND = { feat: 'New', fix: 'Fixed' }

/** @param {string} raw  output of: git log --format=%ad%x1f%s%x1f%b%x1e --date=short */
export function parseGitLog(raw) {
  const byDate = new Map()
  for (const record of raw.split('\x1e')) {
    const [date, subject, body = ''] = record.trim().split('\x1f')
    if (!date || !subject) continue
    const text = {}
    for (const line of body.split('\n')) {
      const m = /^Changelog(?:-([a-z]{2}))?:\s*(.+)$/i.exec(line.trim())
      if (m) text[(m[1] ?? 'en').toLowerCase()] = m[2].trim()
    }
    if (!text.en) continue
    const type = /^(\w+)(\([^)]*\))?!?:/.exec(subject)?.[1]?.toLowerCase() ?? ''
    const change = { kind: KIND[type] ?? 'Improved', text }
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(change)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, changes]) => ({ date, changes: changes.reverse() }))
}
