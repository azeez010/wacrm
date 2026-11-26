import { PaymentError, type PaymentDriver } from '../types'

// No provider API: the customer gets our bank details and a reference, an admin confirms the
// money arrived in the console (which settles the checkout via public.payment_settle).
const REQUIRED = ['bank_name', 'account_name', 'account_number'] as const
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export const manualTransferDriver: PaymentDriver = {
  kind: 'manual_transfer',

  async createCheckout(ctx, input) {
    const missing = REQUIRED.filter((k) => !str(ctx.config[k]))
    if (missing.length) throw new PaymentError(`Bank transfer is missing ${missing.join(', ')}`, false)
    return {
      kind: 'instructions',
      providerReference: input.reference,
      instructions: {
        bankName: str(ctx.config.bank_name), accountName: str(ctx.config.account_name), accountNumber: str(ctx.config.account_number),
        amount: input.amount.toFixed(2), currency: input.currency, reference: input.sessionReference, note: str(ctx.config.instructions),
      },
    }
  },

  async testConnection(ctx) {
    const missing = REQUIRED.filter((k) => !str(ctx.config[k]))
    return missing.length ? { ok: false, detail: `Missing ${missing.join(', ')}` } : { ok: true, detail: 'Bank details are complete.' }
  },
}
