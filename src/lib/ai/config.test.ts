import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAgentConfig, loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  base_url: null,
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.baseUrl).toBeNull()
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

/** A fake client serving the workspace row, agents and agent links. */
function agentDb(opts: {
  agents: Record<string, unknown>[] | null
  links?: { source_id: string }[]
  agentsError?: unknown
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'ai_configs') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: { ...ROW, is_active: true }, error: null }),
        }
        return chain
      }
      if (table === 'ai_agents') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: opts.agents, error: opts.agentsError ?? null }),
          }),
        }
      }
      // ai_agent_knowledge
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: opts.links ?? [], error: null }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

const AGENT = {
  id: 'agent-1',
  name: 'Sales',
  is_active: true,
  is_default: true,
  model: null,
  system_prompt: 'Sell nicely',
  auto_reply_enabled: true,
  auto_reply_max_per_conversation: 5,
  handoff_agent_id: 'user-9',
  channels: ['whatsapp'],
  priority: 0,
  knowledge_mode: 'all',
  created_at: '2026-11-01T00:00:00Z',
}

describe('loadAgentConfig', () => {
  it("layers the agent's settings over the workspace config", async () => {
    const config = await loadAgentConfig(agentDb({ agents: [AGENT] }), 'acct', { channel: 'whatsapp' })
    expect(config).toMatchObject({
      provider: 'openai',
      model: 'gpt-x',
      apiKey: 'plain:enc-key',
      systemPrompt: 'Sell nicely',
      autoReplyEnabled: true,
      autoReplyMaxPerConversation: 5,
      handoffAgentId: 'user-9',
      agentId: 'agent-1',
      agentName: 'Sales',
      knowledgeSourceIds: null,
    })
  })

  it("uses the agent's model override when set", async () => {
    const config = await loadAgentConfig(
      agentDb({ agents: [{ ...AGENT, model: 'gpt-big' }] }),
      'acct',
      { channel: 'whatsapp' },
    )
    expect(config!.model).toBe('gpt-big')
  })

  it("limits knowledge to the agent's linked sources in 'selected' mode", async () => {
    const config = await loadAgentConfig(
      agentDb({
        agents: [{ ...AGENT, knowledge_mode: 'selected' }],
        links: [{ source_id: 'src-1' }, { source_id: 'src-2' }],
      }),
      'acct',
      { channel: 'whatsapp' },
    )
    expect(config!.knowledgeSourceIds).toEqual(['src-1', 'src-2'])
  })

  it('returns null when no agent qualifies', async () => {
    const config = await loadAgentConfig(
      agentDb({ agents: [{ ...AGENT, is_active: false }] }),
      'acct',
      { channel: 'whatsapp' },
    )
    expect(config).toBeNull()
  })

  it('falls back to the workspace config when the account has no agents yet', async () => {
    const config = await loadAgentConfig(agentDb({ agents: [] }), 'acct', { channel: 'whatsapp' })
    expect(config).toMatchObject({ agentId: null, knowledgeSourceIds: null, model: 'gpt-x' })
  })
})
