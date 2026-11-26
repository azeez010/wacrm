import { describe, expect, it } from 'vitest'
import { automationTriggersFor } from './web-chat-react'
import { cleanReplyId } from './web-chat'

describe('automationTriggersFor', () => {
  it('fires the message triggers when nothing consumed the message', () => {
    expect(automationTriggersFor({ contentConsumed: false, isFirstInbound: false, contactCreated: false })).toEqual(['new_message_received', 'keyword_match'])
  })
  it('adds interactive_reply for a tapped option', () => {
    expect(automationTriggersFor({ contentConsumed: false, replyId: 'yes', isFirstInbound: false, contactCreated: false })).toContain('interactive_reply')
  })
  it('keeps relationship triggers even when a flow consumed the message', () => {
    expect(automationTriggersFor({ contentConsumed: true, isFirstInbound: true, contactCreated: true })).toEqual(['first_inbound_message', 'new_contact_created'])
  })
})

describe('cleanReplyId', () => {
  it('keeps short tokens and drops anything else', () => {
    expect(cleanReplyId('opt_1')).toBe('opt_1')
    expect(cleanReplyId('a b')).toBeNull()
    expect(cleanReplyId('x'.repeat(65))).toBeNull()
    expect(cleanReplyId(null)).toBeNull()
  })
})
