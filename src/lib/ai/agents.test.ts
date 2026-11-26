import { describe, it, expect } from 'vitest'
import { normalizeChannels, pickAgent, type AiAgentRow } from './agents'

function agent(overrides: Partial<AiAgentRow>): AiAgentRow {
  return {
    id: 'a',
    name: 'Agent',
    is_active: true,
    is_default: false,
    model: null,
    system_prompt: null,
    auto_reply_enabled: true,
    auto_reply_max_per_conversation: 3,
    handoff_agent_id: null,
    channels: ['whatsapp', 'web_chat'],
    priority: 0,
    knowledge_mode: 'selected',
    created_at: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

const DEFAULT = agent({ id: 'default', is_default: true, knowledge_mode: 'all' })
const SALES = agent({ id: 'sales', channels: ['whatsapp'], priority: 5 })
const SUPPORT = agent({ id: 'support', channels: ['web_chat'], priority: 1 })

describe('pickAgent', () => {
  it('returns a pinned agent even when it is inactive', () => {
    const off = agent({ id: 'off', is_active: false })
    expect(pickAgent([DEFAULT, off], { agentId: 'off' })?.id).toBe('off')
    expect(pickAgent([DEFAULT], { agentId: 'missing' })).toBeNull()
  })

  it('returns the default agent in any state when asked for it', () => {
    const offDefault = { ...DEFAULT, is_active: false }
    expect(pickAgent([offDefault, SALES], { defaultAgent: true })?.id).toBe('default')
  })

  it("uses the conversation's override when that agent is active", () => {
    expect(
      pickAgent([DEFAULT, SALES, SUPPORT], { conversationAgentId: 'support', channel: 'whatsapp' })?.id,
    ).toBe('support')
  })

  it('ignores an override pointing at an inactive agent', () => {
    const off = { ...SUPPORT, is_active: false }
    expect(
      pickAgent([DEFAULT, SALES, off], { conversationAgentId: 'support', channel: 'whatsapp' })?.id,
    ).toBe('sales')
  })

  it('picks the highest-priority active agent covering the channel', () => {
    expect(pickAgent([DEFAULT, SALES, SUPPORT], { channel: 'whatsapp' })?.id).toBe('sales')
    expect(pickAgent([DEFAULT, SALES, SUPPORT], { channel: 'web_chat' })?.id).toBe('support')
  })

  it('prefers the default agent on a priority tie, then the oldest', () => {
    const older = agent({ id: 'older', created_at: '2026-01-01T00:00:00Z' })
    const newer = agent({ id: 'newer', created_at: '2026-06-01T00:00:00Z' })
    expect(pickAgent([newer, older], { channel: 'whatsapp' })?.id).toBe('older')
    expect(pickAgent([older, DEFAULT], { channel: 'whatsapp' })?.id).toBe('default')
  })

  it('falls back to the default agent when nothing covers the channel', () => {
    const onlyWeb = { ...DEFAULT, channels: ['web_chat'] }
    expect(pickAgent([onlyWeb, SUPPORT], { channel: 'whatsapp' })?.id).toBe('default')
  })

  it('returns null when every agent is off', () => {
    const agents = [{ ...DEFAULT, is_active: false }, { ...SALES, is_active: false }]
    expect(pickAgent(agents, { channel: 'whatsapp' })).toBeNull()
  })
})

describe('normalizeChannels', () => {
  it('keeps known channels once, in a stable order', () => {
    expect(normalizeChannels(['web_chat', 'sms', 'whatsapp', 'web_chat'])).toEqual([
      'whatsapp',
      'web_chat',
    ])
    expect(normalizeChannels('whatsapp')).toEqual([])
  })
})
