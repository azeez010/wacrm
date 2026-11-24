import { describe, expect, it } from 'vitest'
import { pickChatSecret } from './secret'

describe('pickChatSecret', () => {
  it('prefers the dedicated secret, then the service-role secret', () => {
    expect(pickChatSecret({ CHAT_TOKEN_SECRET: 'dedicated-secret-123456', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-123456' })).toBe('dedicated-secret-123456')
    expect(pickChatSecret({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-123456' })).toBe('service-role-key-123456')
  })
  it('does not accept ENCRYPTION_KEY, short values or nothing', () => {
    expect(pickChatSecret({ ENCRYPTION_KEY: 'a'.repeat(64) })).toBe('')
    expect(pickChatSecret({ CHAT_TOKEN_SECRET: 'short' })).toBe('')
    expect(pickChatSecret({ CHAT_TOKEN_SECRET: 42 })).toBe('')
    expect(pickChatSecret(undefined)).toBe('')
    expect(pickChatSecret({})).toBe('')
  })
})
