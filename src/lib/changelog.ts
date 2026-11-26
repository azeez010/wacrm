export type ChangeKind = 'New' | 'Improved' | 'Fixed'

export interface ChangelogEntry {
  /** ISO date, newest first. */
  date: string
  changes: { kind: ChangeKind; text: string }[]
}

/** Add new releases at the top. Keep each line short and about what customers can do now. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-11-26',
    changes: [
      { kind: 'New', text: 'Partner program: every customer gets a referral link, live stats and a leaderboard spot. See what you could earn at /partners.' },
      { kind: 'New', text: 'Prices now show in your own currency, converted from naira.' },
      { kind: 'New', text: 'A public blog and this changelog.' },
      { kind: 'Improved', text: 'Marketing emails are a simple on/off switch in Settings → Your profile.' },
    ],
  },
  {
    date: '2026-11-25',
    changes: [
      { kind: 'New', text: 'Live chat: a message-first widget you can embed on your site, with visitor details saved to the contact.' },
      { kind: 'New', text: 'Flag and searchable country picker on every phone field.' },
      { kind: 'Improved', text: 'Newest conversations now appear first in the inbox.' },
      { kind: 'Improved', text: 'Forms list is calmer: single-line rows, with Import inside the New form dialog.' },
      { kind: 'Fixed', text: 'Live chat autofill no longer blocks sending.' },
    ],
  },
]
