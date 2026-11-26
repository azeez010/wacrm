// The business's OWN Paystack account (not OgaDesk's billing): create a payment link the AI can send, and check a payment.
// Uses Paystack Payment Pages (no customer email needed): https://paystack.com/pay/<slug>.

const API = 'https://api.paystack.co'

export const PAYSTACK_TOOLS = [
  {
    name: 'create_payment_link',
    title: 'Create a payment link',
    kind: 'action' as const,
    description: 'Create a Paystack payment link for an amount and send it to the customer. Use the exact amount agreed in the conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount in the main currency unit (e.g. 15000 for ₦15,000).' },
        description: { type: 'string', description: 'What the payment is for, shown on the payment page.' },
      },
      required: ['amount', 'description'],
    },
  },
  {
    name: 'check_payment',
    title: 'Check a payment',
    kind: 'read' as const,
    description: 'Check whether a Paystack payment succeeded, using the transaction reference the customer received.',
    inputSchema: { type: 'object', properties: { reference: { type: 'string', description: 'The Paystack transaction reference.' } }, required: ['reference'] },
  },
]

async function call(key: string, path: string, init: RequestInit, f: typeof fetch) {
  const res = await f(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000) })
  const j = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: Record<string, unknown> } | null
  if (!res.ok || !j?.status) throw new Error(`Paystack: ${j?.message ?? `HTTP ${res.status}`}`)
  return j.data ?? {}
}

export async function verifyPaystackKey(key: string, f: typeof fetch = fetch): Promise<void> {
  await call(key, '/balance', { method: 'GET' }, f)
}

export async function runPaystackTool(
  key: string,
  config: { currency?: string; business_name?: string },
  tool: string,
  args: Record<string, unknown>,
  f: typeof fetch = fetch,
): Promise<{ text: string; isError: boolean }> {
  if (tool === 'create_payment_link') {
    const amount = Number(args.amount)
    if (!(amount > 0) || amount > 100_000_000) return { text: 'The amount must be a positive number.', isError: true }
    const description = String(args.description ?? '').slice(0, 200) || 'Payment'
    const d = await call(key, '/page', {
      method: 'POST',
      body: JSON.stringify({ name: `${config.business_name ? `${config.business_name}: ` : ''}${description}`.slice(0, 100), amount: Math.round(amount * 100), description, ...(config.currency ? { currency: config.currency } : {}) }),
    }, f)
    const slug = String(d.slug ?? '')
    if (!slug) return { text: 'Paystack did not return a link.', isError: true }
    return { text: JSON.stringify({ link: `https://paystack.com/pay/${slug}`, amount, currency: config.currency ?? 'NGN', description }), isError: false }
  }
  if (tool === 'check_payment') {
    const ref = String(args.reference ?? '').trim()
    if (!/^[A-Za-z0-9_.=-]{4,100}$/.test(ref)) return { text: 'That does not look like a payment reference.', isError: true }
    const d = await call(key, `/transaction/verify/${encodeURIComponent(ref)}`, { method: 'GET' }, f)
    return { text: JSON.stringify({ status: d.status, amount: Number(d.amount ?? 0) / 100, currency: d.currency, paid_at: d.paid_at ?? null }), isError: false }
  }
  return { text: `Unknown Paystack tool ${tool}.`, isError: true }
}
