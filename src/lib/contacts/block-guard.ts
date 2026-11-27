// A blocked contact never receives an outbound message of any kind
// (manual, API, broadcast, automation, flow, AI reply, OTP). Every send path
// checks this before talking to Meta.

export type BlockReason = 'manual' | 'opt_out' | 'import' | 'api'

export interface BlockableContact {
  blocked_at?: string | null
  /** Set when a lower plan archived the contact (migration 134). */
  plan_archived_at?: string | null
}

export function isBlocked(contact: BlockableContact | null | undefined): boolean {
  return Boolean(contact?.blocked_at)
}

export class ContactBlockedError extends Error {
  readonly code = 'contact_blocked'
  constructor(message = 'This contact is blocked. Unblock them to send messages.') {
    super(message)
    this.name = 'ContactBlockedError'
  }
}

/** Throws ContactBlockedError when the contact is blocked. */
export function assertNotBlocked(contact: BlockableContact | null | undefined): void {
  if (isBlocked(contact)) throw new ContactBlockedError()
}

// A contact archived by a lower plan stays in the inbox (the team can still reply by hand) but gets nothing
// automatic: no broadcast, automation, chatbot flow or AI reply, until an upgrade restores it.
export function isPlanArchived(contact: BlockableContact | null | undefined): boolean {
  return Boolean(contact?.plan_archived_at)
}

export class ContactPlanArchivedError extends Error {
  readonly code = 'contact_plan_archived'
  constructor(message = 'This contact was archived by your plan. Upgrade to message them automatically again.') {
    super(message)
    this.name = 'ContactPlanArchivedError'
  }
}

/** For automated sends: throws when the contact is blocked or archived by the plan. */
export function assertCanAutomate(contact: BlockableContact | null | undefined): void {
  assertNotBlocked(contact)
  if (isPlanArchived(contact)) throw new ContactPlanArchivedError()
}
