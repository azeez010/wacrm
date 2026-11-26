import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildUnsubscribeAutomation, UNSUBSCRIBE_NO_ID, UNSUBSCRIBE_YES_ID } from './default-unsubscribe'
import { flattenSteps } from './steps-tree'
import { validateStepsForActivation, validateTriggerForActivation } from './validate'

describe('default Unsubscribe automation', () => {
  const def = buildUnsubscribeAutomation()

  it('is valid to activate as shipped', () => {
    expect(validateTriggerForActivation(def.trigger_type, def.trigger_config)).toEqual([])
    const flat = flattenSteps('a1', def.steps)
    expect(validateStepsForActivation(def.steps as never)).toEqual([])
    expect(flat.length).toBe(5)
  })

  it('asks for confirmation first, and sends the goodbye BEFORE blocking', () => {
    const flat = flattenSteps('a1', def.steps)
    expect(flat[0].step_type).toBe('send_buttons')
    expect(flat[0].step_config.wait_for_reply).toBe(true)
    expect(flat[1]).toMatchObject({ step_type: 'condition', step_config: { subject: 'reply_id', operand: UNSUBSCRIBE_YES_ID } })
    const yes = flat.filter((r) => r.branch === 'yes')
    expect(yes.map((r) => r.step_type)).toEqual(['send_message', 'block_contact'])
    expect(flat.filter((r) => r.branch === 'no').map((r) => r.step_type)).toEqual(['send_message'])
    expect(flat.filter((r) => r.step_type === 'block_contact')).toHaveLength(1)
  })

  it('uses whole-word keywords, never blocks on the keyword alone', () => {
    expect(def.trigger_config.match_type).toBe('word')
    expect(def.trigger_config.keywords.length).toBeGreaterThan(0)
    expect(def.steps[0].step_type).not.toBe('block_contact')
    expect(UNSUBSCRIBE_YES_ID).not.toBe(UNSUBSCRIBE_NO_ID)
  })

  it.each(['en', 'es', 'fr', 'pt', 'ko', 'ar', 'hi', 'id', 'sw'])('%s copy fits WhatsApp limits', (loc) => {
    const m = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf-8')).DefaultAutomations.unsubscribe
    expect(m.yes.length).toBeLessThanOrEqual(20)
    expect(m.no.length).toBeLessThanOrEqual(20)
    expect(m.question.length).toBeLessThanOrEqual(1024)
    expect(m.keywords.split(',').filter(Boolean).length).toBeGreaterThan(0)
  })
})
