import { beforeEach, describe, expect, it } from 'vitest'
import { chatTicketTarget, chatTicketTitle, ensureOpenTicket } from './ensure-ticket'

type Resp = { data?: unknown; error?: unknown }
let responses: Record<string, Resp> = {}
let inserts: { table: string; payload: unknown }[] = []

function fakeDb() {
  return {
    from(table: string) {
      let op = 'select'
      const chain: Record<string, unknown> = {}
      const terminal = () => Promise.resolve(responses[`${table}.${op}`] ?? { data: null, error: null })
      for (const m of ['select', 'eq', 'limit', 'order']) chain[m] = () => chain
      chain.insert = (p: unknown) => {
        op = 'insert'
        inserts.push({ table, payload: p })
        return chain
      }
      chain.maybeSingle = terminal
      chain.single = terminal
      return chain
    },
  } as never
}

const args = {
  accountId: 'acc',
  userId: 'owner',
  pipelineId: 'pl',
  stageId: 'st',
  contactId: 'c',
  conversationId: 'conv',
  title: 'Live chat: Ada',
  notes: 'My order is late',
}

beforeEach(() => {
  responses = {
    'pipelines.select': { data: { id: 'pl', kind: 'support' } },
    'pipeline_stages.select': { data: { id: 'st', outcome: null } },
    'deals.insert': { data: { id: 'ticket-1' } },
  }
  inserts = []
})

describe('ensureOpenTicket', () => {
  it('creates an open, normal-priority ticket linked to the chat', async () => {
    expect(await ensureOpenTicket(fakeDb(), args)).toEqual({ created: true, id: 'ticket-1' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload).toMatchObject({
      account_id: 'acc',
      pipeline_id: 'pl',
      stage_id: 'st',
      contact_id: 'c',
      conversation_id: 'conv',
      status: 'open',
      priority: 'normal',
      value: 0,
    })
  })

  it('does nothing when the chat already has an open ticket', async () => {
    responses['deals.select'] = { data: { id: 'old' } }
    expect(await ensureOpenTicket(fakeDb(), args)).toEqual({ created: false, reason: 'exists' })
    expect(inserts).toHaveLength(0)
  })

  it('refuses a sales pipeline', async () => {
    responses['pipelines.select'] = { data: { id: 'pl', kind: 'sales' } }
    expect(await ensureOpenTicket(fakeDb(), args)).toEqual({ created: false, reason: 'invalid_pipeline' })
  })

  it('refuses a stage outside the pipeline or a final stage', async () => {
    responses['pipeline_stages.select'] = { data: null }
    expect((await ensureOpenTicket(fakeDb(), args)).created).toBe(false)
    responses['pipeline_stages.select'] = { data: { id: 'st', outcome: 'won' } }
    expect(await ensureOpenTicket(fakeDb(), args)).toEqual({ created: false, reason: 'invalid_stage' })
    expect(inserts).toHaveLength(0)
  })

  it('never throws', async () => {
    const broken = { from: () => { throw new Error('boom') } } as never
    expect(await ensureOpenTicket(broken, args)).toEqual({ created: false, reason: 'error' })
  })
})

describe('chatTicketTarget / chatTicketTitle', () => {
  it('needs the switch on and both ids', () => {
    expect(chatTicketTarget({ chat: { ticket: { enabled: true, pipelineId: 'p', stageId: 's' } } })).toEqual({ pipelineId: 'p', stageId: 's' })
    expect(chatTicketTarget({ chat: { ticket: { enabled: false, pipelineId: 'p', stageId: 's' } } })).toBeNull()
    expect(chatTicketTarget({ chat: { ticket: { enabled: true, pipelineId: 'p' } } })).toBeNull()
    expect(chatTicketTarget({})).toBeNull()
  })
  it('titles by visitor, else widget', () => {
    expect(chatTicketTitle('Ada', 'Support')).toBe('Live chat: Ada')
    expect(chatTicketTitle('  ', 'Support')).toBe('Live chat: Support')
  })
})
