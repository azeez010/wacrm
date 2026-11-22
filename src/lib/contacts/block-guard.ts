// A blocked contact never receives an outbound message of any kind
// (manual, API, broadcast, automation, flow, AI reply, OTP). Every send path
// checks this before talking to Meta.

export type BlockReason = 'manual' | 'opt_out' | 'import' | 'api'

export interface BlockableContact {
  blocked_at?: string | null
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
