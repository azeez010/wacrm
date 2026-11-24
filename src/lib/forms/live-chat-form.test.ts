import { describe, expect, it } from 'vitest'

import { isLiveChatForm } from '@/lib/chat/http'
import { EMBED_SCRIPT } from './embed-script'
import { getFormTemplate } from './templates'
import { TEMPLATE_SLUGS } from './template-slugs'
import { formSettingsSchema, parseFormSettings } from './types'

describe('support_chat template', () => {
  const tpl = getFormTemplate('support_chat')!

  it('is a support button in live-chat mode with the chat wording and an optional phone', () => {
    expect(tpl.kind).toBe('support')
    expect(tpl.settings.widget?.mode).toBe('live_chat')
    expect(tpl.settings.widget?.icon).toBe('chat')
    expect(tpl.settings.chat?.greeting).toBeTruthy()
    expect(tpl.settings.chat?.offlineText).toBeTruthy()
    expect(tpl.settings.chat?.showOnlineBadge).toBe(true)
    const phone = tpl.fields.find((f) => f.kind === 'phone')
    expect(phone?.required).toBe(false)
    expect(tpl.fields.find((f) => f.kind === 'message')?.required).toBe(true)
  })
  it('is offered in the template list, and the WhatsApp support template stays WhatsApp', () => {
    expect(TEMPLATE_SLUGS).toContain('support_chat')
    expect(getFormTemplate('support')!.settings.widget?.mode).toBe('whatsapp')
  })
})

describe('widget.mode and settings.chat', () => {
  it('default to WhatsApp, and reject unknown modes or keys', () => {
    expect(formSettingsSchema.parse({ widget: {} }).widget?.mode).toBe('whatsapp')
    expect(formSettingsSchema.safeParse({ widget: { mode: 'sms' } }).success).toBe(false)
    expect(formSettingsSchema.safeParse({ chat: { evil: true } }).success).toBe(false)
  })
  it('isLiveChatForm only accepts a support button switched to live chat', () => {
    const settings = { widget: { mode: 'live_chat' } }
    expect(isLiveChatForm({ kind: 'support', settings })).toBe(true)
    expect(isLiveChatForm({ kind: 'lead', settings })).toBe(false)
    expect(isLiveChatForm({ kind: 'support', settings: { widget: { mode: 'whatsapp' } } })).toBe(false)
    expect(isLiveChatForm({ kind: 'support', settings: {} })).toBe(false)
    expect(parseFormSettings(settings).widget?.mode).toBe('live_chat')
  })
})

describe('embed script', () => {
  it('opens the chat page in live-chat mode and keeps the form page for WhatsApp mode and the editor preview', () => {
    expect(EMBED_SCRIPT).toContain('/embed/chat/')
    expect(EMBED_SCRIPT).toContain("mode === 'live_chat'")
    expect(EMBED_SCRIPT).toMatch(/chat && !PREVIEW \? '\/embed\/chat\/' : '\/embed\/f\/'/)
  })
})
