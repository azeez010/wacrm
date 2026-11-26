import { describe, expect, it } from 'vitest'
import { AGENT_TEMPLATE_IDS, AGENT_TEMPLATES, isAgentTemplateId } from './agent-templates'
import { parseAgentInput } from './agent-input'

describe('agent templates', () => {
  it('has Support, Sales, Marketing and Admin plus Blank', () => {
    expect([...AGENT_TEMPLATE_IDS]).toEqual(['blank', 'support', 'sales', 'marketing', 'admin'])
    expect(isAgentTemplateId('support')).toBe(true)
    expect(isAgentTemplateId('hr')).toBe(false)
  })

  it.each(AGENT_TEMPLATE_IDS.filter((id) => id !== 'blank'))('%s is a valid agent', (id) => {
    const tpl = AGENT_TEMPLATES[id]
    const parsed = parseAgentInput(
      {
        name: `${id} agent`,
        system_prompt: tpl.system_prompt,
        channels: tpl.channels,
        auto_reply_max_per_conversation: tpl.auto_reply_max_per_conversation,
      },
      { partial: false },
    )
    expect('data' in parsed).toBe(true)
    expect(tpl.system_prompt).toMatch(/hand (it )?off|hand the conversation/i)
  })
})
