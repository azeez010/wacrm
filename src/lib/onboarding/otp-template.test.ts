import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '@/test-utils/fake-db'

const submit = vi.fn()
vi.mock('@/lib/whatsapp/template-submit', () => ({ submitTemplateForAccount: (...a: unknown[]) => submit(...a) }))
vi.mock('@/lib/api/v1/contacts', () => ({ resolveAuditUserId: async () => 'owner-1' }))
const crmTrack = vi.fn()
vi.mock('@/lib/crm', () => ({ crmTrack: (...a: unknown[]) => crmTrack(...a) }))

const { ensureOtpTemplate, wantsDeveloperSetup } = await import('./otp-template')

beforeEach(() => {
  submit.mockReset().mockResolvedValue(Response.json({ success: true, template: { status: 'PENDING' } }))
  crmTrack.mockReset().mockResolvedValue(undefined)
})

describe('ensureOtpTemplate', () => {
  it('submits the default authentication template for the connection', async () => {
    const db = new FakeDb({}, { message_templates: [] })
    expect(await ensureOtpTemplate(db.asClient(), 'a1', 'cfg1')).toEqual({ created: true, status: 'PENDING' })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0].slice(1, 3)).toEqual(['a1', 'owner-1'])
    expect(submit.mock.calls[0][3]).toMatchObject({
      name: 'otp_verification',
      category: 'Authentication',
      language: 'en_US',
      whatsapp_config_id: 'cfg1',
      auth_options: { code_expiration_minutes: 10, otp_type: 'COPY_CODE', add_security_recommendation: true },
    })
    expect(crmTrack).toHaveBeenCalledWith('otp_template_created', { accountId: 'a1' })
  })

  it('is idempotent: any existing row for this connection (even rejected) blocks a new submit', async () => {
    const db = new FakeDb({}, { message_templates: [{ account_id: 'a1', whatsapp_config_id: 'cfg1', name: 'otp_verification', status: 'REJECTED' }] })
    expect(await ensureOtpTemplate(db.asClient(), 'a1', 'cfg1')).toEqual({ created: false, status: 'REJECTED' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('still creates one for a different connection of the same account', async () => {
    const db = new FakeDb({}, { message_templates: [{ account_id: 'a1', whatsapp_config_id: 'other', name: 'otp_verification', status: 'APPROVED' }] })
    expect((await ensureOtpTemplate(db.asClient(), 'a1', 'cfg1')).created).toBe(true)
  })

  it('reports a Meta/validation failure without throwing or tracking', async () => {
    submit.mockResolvedValue(Response.json({ error: 'Meta rejected it' }, { status: 502 }))
    const db = new FakeDb({}, { message_templates: [] })
    expect(await ensureOtpTemplate(db.asClient(), 'a1', 'cfg1')).toEqual({ created: false, error: 'Meta rejected it' })
    expect(crmTrack).not.toHaveBeenCalled()
  })
})

describe('wantsDeveloperSetup', () => {
  it('is true only when the workspace picked the Developer API', async () => {
    const db = new FakeDb({}, { accounts: [{ id: 'a1', use_cases: ['support', 'developer'] }, { id: 'a2', use_cases: ['sales'] }, { id: 'a3', use_cases: [] }] })
    expect(await wantsDeveloperSetup(db.asClient(), 'a1')).toBe(true)
    expect(await wantsDeveloperSetup(db.asClient(), 'a2')).toBe(false)
    expect(await wantsDeveloperSetup(db.asClient(), 'a3')).toBe(false)
    expect(await wantsDeveloperSetup(db.asClient(), 'missing')).toBe(false)
  })
})
