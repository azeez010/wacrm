import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicFormConfig } from '@/lib/forms/public-config'
import { stringsFor } from '@/lib/forms/public-strings'
import { IntroView, PublicChat } from './public-chat'

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
    chat: { greeting: 'Hello there, what do you need?', showOnlineBadge: true, onlineMode: 'auto', showTyping: true },
    fields: [
      { id: 'name', kind: 'name', required: true, label: '' },
      { id: 'phone', kind: 'phone', required: false, label: '' },
      { id: 'message', kind: 'message', required: true, label: '' },
    ] as PublicFormConfig['fields'],
    ...over,
  } as PublicFormConfig
}

describe('PublicChat intro (preview render)', () => {
  it('opens with the owner\'s greeting, the Online badge and a message box only (details come after the first message)', () => {
    const html = renderToString(<PublicChat config={config()} preview />)
    expect(html).toContain('Hello there, what do you need?')
    expect(html).toContain('Online')
    expect(html).toContain('Chat with us')
    expect(html).not.toContain('id="ogc-name"')
    expect(html).not.toContain('id="ogc-phone"')
    expect(html).toContain('<textarea')
  })

  it('after the first message asks only for the details the widget wants, with optional/required marks', () => {
    const status = { online: true, showOnlineBadge: true, showTyping: true, greeting: null, offlineText: null, ask: { name: { required: true, label: '' }, phone: { required: false, label: '' }, email: null } }
    const html = renderToString(
      <IntroView t={stringsFor('en')} status={status} greeting="Hi" accent="#111" online intro={{ text: 'need help', phase: 'details' }} notice={null} onNotice={() => undefined} defaultCountry="NG" onSend={() => undefined} onSubmit={async () => undefined} errorText={(c) => c ?? ''} />,
    )
    expect(html).toContain('need help')
    expect(html).toContain('id="ogc-name"')
    expect(html).toContain('id="ogc-phone"')
    expect(html).not.toContain('id="ogc-email"')
    expect(html).toContain('Phone number')
    expect(html).not.toContain('Skip')
  })

  it('falls back to the built-in greeting in the form\'s language and hides the badge when switched off', () => {
    const html = renderToString(<PublicChat config={config({ language: 'es', chat: { showOnlineBadge: false, onlineMode: 'auto', showTyping: true } })} preview />)
    expect(html).toContain('Hola, ¿en qué puedo ayudarte?')
    expect(html).not.toContain('En línea')
  })

  it('renders the owner\'s text as text, never as HTML', () => {
    const html = renderToString(<PublicChat config={config({ chat: { greeting: '<img src=x onerror=alert(1)>', showOnlineBadge: true, onlineMode: 'auto', showTyping: true } })} preview />)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('hides the OgaDesk line when branding is off', () => {
    expect(renderToString(<PublicChat config={config({ showBranding: false })} preview />)).not.toContain('OgaDesk')
    expect(renderToString(<PublicChat config={config({ showBranding: true })} preview />)).toContain('Desk')
  })
})
