import { describe, expect, it } from 'vitest'
import type { MessageTemplate } from '@/types'
import { buildMetaTemplatePayload } from './template-components'
import { buildSendComponents } from './template-send-builder'
import {
  AUTH_BODY_TEXT,
  normalizeAuthPayload,
  validateTemplatePayload,
  type TemplatePayload,
} from './template-validators'

const base: TemplatePayload = {
  name: 'otp_verification',
  category: 'Authentication',
  language: 'en_US',
  body_text: '',
}

describe('authentication templates', () => {
  it('fills defaults: fixed wording, OTP button, sample code', () => {
    const p = normalizeAuthPayload(base)
    expect(p.body_text).toBe(AUTH_BODY_TEXT)
    expect(p.buttons).toEqual([{ type: 'OTP', text: 'Copy code', otp_type: 'COPY_CODE' }])
    expect(p.auth_options).toEqual({
      add_security_recommendation: true,
      code_expiration_minutes: 10,
      otp_type: 'COPY_CODE',
    })
    expect(p.footer_text).toContain('10 minutes')
    expect(() => validateTemplatePayload(p)).not.toThrow()
  })

  it('leaves other categories untouched', () => {
    const marketing: TemplatePayload = { ...base, category: 'Marketing', body_text: 'Hi' }
    expect(normalizeAuthPayload(marketing)).toBe(marketing)
  })

  it('rejects custom header, footer or buttons', () => {
    expect(() => normalizeAuthPayload({ ...base, footer_text: 'hi' })).toThrow()
    expect(() => normalizeAuthPayload({ ...base, header_type: 'text', header_content: 'x' })).toThrow()
    expect(() =>
      normalizeAuthPayload({ ...base, buttons: [{ type: 'QUICK_REPLY', text: 'ok' }] }),
    ).toThrow()
  })

  it('validates the expiry range and option types', () => {
    expect(() => normalizeAuthPayload({ ...base, auth_options: { code_expiration_minutes: 0 } })).toThrow()
    expect(() => normalizeAuthPayload({ ...base, auth_options: { code_expiration_minutes: 91 } })).toThrow()
    expect(() => normalizeAuthPayload({ ...base, auth_options: { code_expiration_minutes: 5.5 } })).toThrow()
    expect(
      normalizeAuthPayload({ ...base, auth_options: { code_expiration_minutes: 5, add_security_recommendation: false } })
        .auth_options,
    ).toMatchObject({ code_expiration_minutes: 5, add_security_recommendation: false })
  })

  it("builds Meta's authentication payload (no text, no samples)", () => {
    const meta = buildMetaTemplatePayload(
      normalizeAuthPayload({ ...base, auth_options: { code_expiration_minutes: 15, add_security_recommendation: false } }),
    )
    expect(meta).toEqual({
      name: 'otp_verification',
      category: 'AUTHENTICATION',
      language: 'en_US',
      components: [
        { type: 'BODY', add_security_recommendation: false },
        { type: 'FOOTER', code_expiration_minutes: 15 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
      ],
    })
  })

  it('sends the code in the body AND as the url-type button parameter', () => {
    const row = {
      id: 't1',
      name: 'otp_verification',
      language: 'en_US',
      category: 'Authentication',
      body_text: AUTH_BODY_TEXT,
      buttons: [{ type: 'OTP', text: 'Copy code', otp_type: 'COPY_CODE' }],
    } as unknown as MessageTemplate
    expect(buildSendComponents(row, { body: ['482913'] })).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
    ])
  })

  it('refuses to send an authentication template without a code', () => {
    const row = {
      name: 'otp_verification',
      language: 'en_US',
      body_text: AUTH_BODY_TEXT,
      buttons: [{ type: 'OTP', text: 'Copy code', otp_type: 'COPY_CODE' }],
    } as unknown as MessageTemplate
    expect(() => buildSendComponents(row, {})).toThrow()
  })
})
