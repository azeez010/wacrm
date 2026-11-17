import { describe, expect, it } from 'vitest'
import { activationIssues, structuralError } from './automations'
import { flowIssues, flowStructuralError, hasErrors } from './flows'
import { normalizeStages } from './pipelines'

describe('automation definition checks', () => {
  it('rejects unknown trigger types and malformed steps outright', () => {
    expect(structuralError('nope', {}, [])).toMatch(/trigger_type/)
    expect(structuralError('keyword_match', {}, 'x')).toMatch(/steps/)
    expect(structuralError('keyword_match', {}, [{ step_config: {} }])).toMatch(/step_type/)
  })

  it('accepts a sane definition and caps size / nesting', () => {
    expect(structuralError('first_inbound_message', {}, [{ step_type: 'send_message', step_config: { text: 'hi' } }])).toBeNull()
    const many = Array.from({ length: 101 }, () => ({ step_type: 'close_conversation', step_config: {} }))
    expect(structuralError('first_inbound_message', {}, many)).toMatch(/at most/)
    let deep: unknown = [{ step_type: 'close_conversation', step_config: {} }]
    for (let i = 0; i < 8; i++) {
      deep = [{ step_type: 'condition', step_config: { subject: 'message_content', value: 'x' }, branches: { yes: deep } }]
    }
    expect(structuralError('first_inbound_message', {}, deep)).toMatch(/nest/)
  })

  it('reports what blocks activation for a draft', () => {
    const issues = activationIssues('keyword_match', {}, [{ step_type: 'add_tag', step_config: { tag_id: '' } }])
    const paths = issues.map((i) => i.path)
    expect(paths).toContain('trigger.keywords')
    expect(paths.some((p) => p.includes('tag_id'))).toBe(true)
    expect(activationIssues('first_inbound_message', {}, [{ step_type: 'send_message', step_config: { text: 'Welcome!' } }])).toEqual([])
  })
})

describe('flow definition checks', () => {
  const good = {
    name: 'Menu',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['menu'] },
    entry_node_id: 'start',
  }
  const nodes = [
    { node_key: 'start', node_type: 'start', config: { next_node_key: 'hello' } },
    { node_key: 'hello', node_type: 'send_message', config: { text: 'Hi', next_node_key: 'end' } },
    { node_key: 'end', node_type: 'end', config: {} },
  ]

  it('rejects unknown trigger/node types', () => {
    expect(flowStructuralError({ trigger_type: 'carrier_pigeon' })).toMatch(/trigger_type/)
    expect(flowStructuralError({ nodes: [{ node_key: 'a', node_type: 'teleport', config: {} }] })).toMatch(/node_type/)
    expect(flowStructuralError({ nodes: [{ node_key: '', node_type: 'end', config: {} }] })).toMatch(/node_key/)
  })

  it('a well-formed graph has no errors', () => {
    expect(hasErrors(flowIssues(good, nodes))).toBe(false)
  })

  it('flags a dangling edge and a missing entry as errors', () => {
    const broken = [{ ...nodes[0], config: { next_node_key: 'ghost' } }, nodes[1], nodes[2]]
    expect(hasErrors(flowIssues(good, broken))).toBe(true)
    expect(hasErrors(flowIssues({ ...good, entry_node_id: null }, nodes))).toBe(true)
  })
})

describe('normalizeStages', () => {
  it('accepts names or objects and assigns colors', () => {
    const r = normalizeStages(['New', { name: 'Won', color: '#22c55e' }])
    expect(Array.isArray(r) && r.map((s) => s.name)).toEqual(['New', 'Won'])
    expect(Array.isArray(r) && /^#[0-9a-f]{6}$/i.test(r[0].color)).toBe(true)
  })
  it('rejects empty, oversized and nameless input', () => {
    expect(typeof normalizeStages([])).toBe('string')
    expect(typeof normalizeStages(Array.from({ length: 21 }, (_, i) => `s${i}`))).toBe('string')
    expect(typeof normalizeStages([{ name: '  ' }])).toBe('string')
    expect(typeof normalizeStages('x')).toBe('string')
  })
})
