import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicFormConfig } from '@/lib/forms/public-config'
import { PublicChat } from './public-chat'

function config(over: Partial<PublicFormConfig> = {}): PublicFormConfig {
  return {
    publicId: 'abc123def456',
    kind: 'support',
    name: 'Support',
    title: 'Chat with us',
    accent: '#10b981',
    logoAlign: 'left', logoSize: 'md', backgroundFit: 'cover', backgroundPosition: 'center', backgroundOverlay: 'medium',
    language: 'en',
    theme: 'auto',
    defaultCountry: 'NG',
    noindex: true,
    og: {},
    success: { action: 'message' },
    turnstile: false,
    showBranding: true,
    widget: { corner: 'bottom-right', offsetX: 20, offsetY: 20, icon: 'chat', mode: 'live_chat', greeting: 'Chat with us', animation: 'none', sound: 'none', preMessageDelay: 4, preMessageRepeat: 'session', showOn: 'all', devices: 'all' },
    chat: { greeting: 'Hello there, what do you need?', showOnlineBadge: true },
    fields: [
      { id: 'name', kind: 'name', required: true, label: '' },
      { id: 'phone', kind: 'phone', required: false, label: '' },
      { id: 'message', kind: 'message', required: true, label: '' },
    ] as PublicFormConfig['fields'],
    ...over,
  } as PublicFormConfig
}

describe('PublicChat pre-chat (preview render)', () => {
  it('shows the owner\'s greeting, the Online badge, only the fields the widget asks for, and the start button', () => {
    const html = renderToString(<PublicChat config={config()} preview />)
    expect(html).toContain('Hello there, what do you need?')
    expect(html).toContain('Online')
    expect(html).toContain('Chat with us')
    expect(html).toContain('id="ogc-name"')
    expect(html).toContain('id="ogc-phone"')
    expect(html).toContain('id="ogc-message"')
    expect(html).not.toContain('id="ogc-email"')
    expect(html).toContain('Start chat')
    // the optional phone is marked optional, the required name is starred
    expect(html).toContain('optional')
  })

  it('falls back to the built-in greeting in the form\'s language and hides the badge when switched off', () => {
    const html = renderToString(<PublicChat config={config({ language: 'es', chat: { showOnlineBadge: false } })} preview />)
    expect(html).toContain('Hola, ¿en qué puedo ayudarte?')
    expect(html).not.toContain('En línea')
  })

  it('renders the owner\'s text as text, never as HTML', () => {
    const html = renderToString(<PublicChat config={config({ chat: { greeting: '<img src=x onerror=alert(1)>', showOnlineBadge: true } })} preview />)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('hides the OgaDesk line when branding is off', () => {
    expect(renderToString(<PublicChat config={config({ showBranding: false })} preview />)).not.toContain('OgaDesk')
    expect(renderToString(<PublicChat config={config({ showBranding: true })} preview />)).toContain('Desk')
  })
})
